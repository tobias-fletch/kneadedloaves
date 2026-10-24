import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acceptsOrders } from "@/lib/order-rules";
import { DEFAULT_WEEKLY_SETTINGS, resolveWeeklyWindow, weekKeysAround, type WeekOverride, type WeekWindow, type WeeklyResolution, type WeeklySettings } from "@/lib/weekly-window";

type Db = Prisma.TransactionClient;
export type WindowTimes = { opensAt: Date; closesAt: Date; fulfillmentDate: Date };

// The weekly tables come from an additive migration that only runs on a production deploy.
// Previews share the production database, so until it has run the app must behave exactly as
// before. to_regclass never raises, so this check is also safe inside the checkout transaction.
let weeklyTables: { value: boolean; at: number } | null = null;
export async function hasWeeklyTables(db: Pick<Db, "$queryRaw">): Promise<boolean> {
  if (weeklyTables && (weeklyTables.value || Date.now() - weeklyTables.at < 60000)) return weeklyTables.value;
  try {
    const rows = await db.$queryRaw<{ ready: boolean }[]>`SELECT (to_regclass(format('%I.%I', current_schema(), 'WeeklyOrderSchedule')) IS NOT NULL AND to_regclass(format('%I.%I', current_schema(), 'WeeklyOrderWeek')) IS NOT NULL) AS ready`;
    weeklyTables = { value: Boolean(rows[0]?.ready), at: Date.now() };
  } catch {
    weeklyTables = { value: false, at: Date.now() };
  }
  return weeklyTables.value;
}
export function resetWeeklyTableCache() { weeklyTables = null; }

/** Saved weekly settings, or the defaults (disabled) when nothing is saved or the tables don't exist yet. */
export async function getWeeklySettings(db: Db = prisma): Promise<{ settings: WeeklySettings; saved: boolean; available: boolean }> {
  if (!await hasWeeklyTables(db)) return { settings: DEFAULT_WEEKLY_SETTINGS, saved: false, available: false };
  const row = await db.weeklyOrderSchedule.findUnique({ where: { id: "default" } });
  if (!row) return { settings: DEFAULT_WEEKLY_SETTINGS, saved: false, available: true };
  const { enabled, windowName, openWeekday, openTime, closeWeekday, closeTime, fulfillmentWeekday, maxOrders, paused, pauseMessage } = row;
  return { settings: { enabled, windowName, openWeekday, openTime, closeWeekday, closeTime, fulfillmentWeekday, maxOrders, paused, pauseMessage }, saved: true, available: true };
}

export async function getWeekOverrides(db: Db, keys: string[]) {
  const rows = await db.weeklyOrderWeek.findMany({ where: { weekKey: { in: keys } } });
  return new Map<string, WeekOverride & { orderWindowId: string | null }>(rows.map((row) => [row.weekKey, {
    opensAt: row.overrideOpensAt, closesAt: row.overrideClosesAt, fulfillmentDate: row.overrideFulfillmentDate,
    skip: row.skip, message: row.message, orderWindowId: row.orderWindowId
  }]));
}

const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * Makes sure the week has an OrderWindow row (orders, capacity, the Venmo hold cap and the
 * admin orders list all hang off it) and that its times match the schedule/override.
 * Runs lazily when the window is current, so no cron is needed.
 */
export async function materializeWeek(db: Db, settings: WeeklySettings, week: WeekWindow) {
  const name = `${settings.windowName} (${week.weekKey})`;
  const link = await db.weeklyOrderWeek.findUnique({ where: { weekKey: week.weekKey }, include: { orderWindow: true } });
  let window = link?.orderWindow ?? null;
  if (!window) {
    // Adopt a one-off window the owner already made for this exact close (e.g. this week's live
    // window), so turning weekly mode on mid-week keeps its orders together.
    const legacy = await db.orderWindow.findFirst({ where: { closesAt: week.closesAt, weeklyWeek: { is: null } }, orderBy: { createdAt: "asc" } });
    const created = legacy ? null : await db.orderWindow.create({ data: { name, opensAt: week.opensAt, closesAt: week.closesAt, fulfillmentDate: week.fulfillmentDate, maxOrders: settings.maxOrders } });
    const candidate = legacy ?? created!;
    await db.weeklyOrderWeek.createMany({ data: [{ weekKey: week.weekKey }], skipDuplicates: true });
    await db.weeklyOrderWeek.updateMany({ where: { weekKey: week.weekKey, orderWindowId: null }, data: { orderWindowId: candidate.id } });
    const winner = await db.weeklyOrderWeek.findUniqueOrThrow({ where: { weekKey: week.weekKey }, include: { orderWindow: true } });
    if (created && winner.orderWindowId !== created.id) await db.orderWindow.delete({ where: { id: created.id } });
    window = winner.orderWindow ?? candidate;
  }
  if (!sameTime(window.opensAt, week.opensAt) || !sameTime(window.closesAt, week.closesAt) || !sameTime(window.fulfillmentDate, week.fulfillmentDate) || window.maxOrders !== settings.maxOrders || window.manualOpen || window.manualClosed) {
    window = await db.orderWindow.update({ where: { id: window.id }, data: { opensAt: week.opensAt, closesAt: week.closesAt, fulfillmentDate: week.fulfillmentDate, maxOrders: settings.maxOrders, manualOpen: false, manualClosed: false } });
  }
  return window;
}

export async function resolveWeekly(db: Db, now: Date) {
  const { settings } = await getWeeklySettings(db);
  if (!settings.enabled) return null;
  const overrides = await getWeekOverrides(db, weekKeysAround(settings, now));
  return { settings, resolution: resolveWeeklyWindow(settings, overrides, now) };
}

export type CurrentOrderWindow = {
  openWindow: Prisma.OrderWindowGetPayload<{ include: { orders: { select: { id: true } } } }> | undefined;
  nextWindow: WindowTimes | undefined;
  /** Set only when the weekly schedule is turned on. */
  weekly: WeeklyResolution | null;
};

export async function getCurrentOrderWindow(tx: Db = prisma, now = new Date()): Promise<CurrentOrderWindow> {
  const weekly = await resolveWeekly(tx, now);
  if (weekly) {
    const { settings, resolution } = weekly;
    if (resolution.status !== "open") return { openWindow: undefined, nextWindow: resolution.next ?? undefined, weekly: resolution };
    const row = await materializeWeek(tx, settings, resolution.current);
    const orders = await tx.order.findMany({ where: { orderWindowId: row.id, status: { not: "CANCELLED" } }, select: { id: true } });
    const withOrders = { ...row, orders };
    return { openWindow: acceptsOrders(row, orders.length, now) ? withOrders : undefined, nextWindow: undefined, weekly: resolution };
  }
  // Legacy one-off windows (the behavior before weekly mode, and while it is off).
  const windows = await tx.orderWindow.findMany({ where: { manualClosed: false }, orderBy: { opensAt: "asc" }, include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } } } });
  return { openWindow: windows.find((w) => acceptsOrders(w, w.orders.length, now)), nextWindow: windows.find((w) => w.opensAt > now), weekly: null };
}

export async function isOrderingOpen() { return Boolean((await getCurrentOrderWindow()).openWindow); }
