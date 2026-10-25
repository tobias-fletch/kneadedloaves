import assert from "node:assert/strict";
import test from "node:test";
import { getOverviewWindow, overviewWindowLabel, resetWeeklyTableCache } from "../lib/order-window";
import { DEFAULT_WEEKLY_SETTINGS, type WeeklySettings } from "../lib/weekly-window";

// Mirrors the real windows: last week's closed Sat Oct 24 9:00 PM ET (fulfilled Sun Oct 25);
// this week's opens Mon Oct 26 9:00 AM ET and closes Sat Oct 31 1:00 PM ET (fulfilled Sun Nov 1).
const at = (iso: string) => new Date(iso);
const past = { id: "past", name: "Weekly Bake", opensAt: at("2026-10-19T13:00:00Z"), closesAt: at("2026-10-25T01:00:00Z"), fulfillmentDate: at("2026-10-25T16:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false, orders: [] };
const upcoming = { id: "next", name: "Weekly Bake", opensAt: at("2026-10-26T13:00:00Z"), closesAt: at("2026-10-31T17:00:00Z"), fulfillmentDate: at("2026-11-01T17:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false, orders: [] };
const weekly: WeeklySettings = { ...DEFAULT_WEEKLY_SETTINGS, enabled: true };
// This week closes early (Sat 1:00 PM ET instead of 9:00 PM) via a per-week override.
const override = { weekKey: "2026-10-31", overrideOpensAt: null, overrideClosesAt: upcoming.closesAt, overrideFulfillmentDate: null, skip: false, message: null, orderWindowId: null };

type Row = Omit<typeof past, "maxOrders"> & { maxOrders: number | null };
type FindFirst = { where: { closesAt: Date | { lt: Date } } };
function fakeDb(settings: WeeklySettings, windows: Row[], links: Record<string, Row> = {}, orderCount = 0) {
  let created: Record<string, unknown> | null = null;
  return {
    $queryRaw: async () => [{ ready: true }],
    weeklyOrderSchedule: { findUnique: async () => ({ id: "default", ...settings }) },
    weeklyOrderWeek: {
      findMany: async () => [override],
      findUnique: async ({ where }: { where: { weekKey: string } }) => links[where.weekKey] ? { weekKey: where.weekKey, orderWindowId: links[where.weekKey].id, orderWindow: links[where.weekKey] } : null,
      createMany: async () => ({ count: 1 }),
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async ({ where }: { where: { weekKey: string } }) => ({ weekKey: where.weekKey, orderWindowId: "w1", orderWindow: links[where.weekKey] ?? created })
    },
    orderWindow: {
      findMany: async () => [...windows].sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime()),
      findFirst: async ({ where }: FindFirst) => where.closesAt instanceof Date
        ? windows.find((w) => w.closesAt.getTime() === (where.closesAt as Date).getTime()) ?? null
        : [...windows].filter((w) => w.closesAt < (where.closesAt as { lt: Date }).lt).sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime())[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => (created = { id: "w1", manualOpen: false, manualClosed: false, ...data }),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...(windows.find((w) => w.id === where.id) ?? created), ...data }),
      delete: async () => ({})
    },
    order: { findMany: async () => Array.from({ length: orderCount }, (_, i) => ({ id: `o${i}` })) }
  } as never;
}

const summary = (w: Awaited<ReturnType<typeof getOverviewWindow>>) => w && { status: w.status, opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString(), fulfillmentDate: w.fulfillmentDate.toISOString() };
const NEXT = { status: "upcoming", opensAt: "2026-10-26T13:00:00.000Z", closesAt: "2026-10-31T17:00:00.000Z", fulfillmentDate: "2026-11-01T17:00:00.000Z" };

for (const [mode, settings] of [["weekly schedule", weekly], ["one-off windows", DEFAULT_WEEKLY_SETTINGS]] as const) {
  test(`admin overview (${mode}): after last week closed, shows the upcoming window, not the past one`, async () => {
    resetWeeklyTableCache();
    const shown = await getOverviewWindow(fakeDb(settings, [past, upcoming]), at("2026-10-25T16:39:00Z")); // Sun Oct 25, 12:39 PM ET
    assert.deepEqual(summary(shown), NEXT);
    assert.equal(shown?.name, "Weekly Bake");
  });

  test(`admin overview (${mode}): while a window is open, shows that current window`, async () => {
    resetWeeklyTableCache();
    const lastWeek = await getOverviewWindow(fakeDb(settings, [past, upcoming]), at("2026-10-24T20:00:00Z")); // Sat Oct 24, 4 PM ET
    assert.deepEqual(summary(lastWeek), { status: "open", opensAt: "2026-10-19T13:00:00.000Z", closesAt: "2026-10-25T01:00:00.000Z", fulfillmentDate: "2026-10-25T16:00:00.000Z" });
    resetWeeklyTableCache();
    const thisWeek = await getOverviewWindow(fakeDb(settings, [past, upcoming]), at("2026-10-28T16:00:00Z")); // Wed Oct 28, noon ET
    assert.deepEqual(summary(thisWeek), { ...NEXT, status: "open" });
  });
}


test("admin overview counts: an upcoming weekly window has no row yet (no orders), and the heading says it's next", async () => {
  resetWeeklyTableCache();
  const shown = await getOverviewWindow(fakeDb(weekly, [past]), at("2026-10-25T16:39:00Z"));
  assert.equal(shown?.id, null);
  assert.equal(overviewWindowLabel(shown), "Next window · Weekly Bake (opens Oct 26, 9:00 AM ET)");
  resetWeeklyTableCache();
});

test("admin overview counts: an open window counts its own row's orders", async () => {
  resetWeeklyTableCache();
  const open = await getOverviewWindow(fakeDb(DEFAULT_WEEKLY_SETTINGS, [past, upcoming]), at("2026-10-28T16:00:00Z"));
  assert.equal(open?.id, "next");
  assert.equal(overviewWindowLabel(open), "This window · Weekly Bake (open now)");
  // Weekly window open but full (so checkout gets no openWindow): still counts the week's row, not last week's.
  resetWeeklyTableCache();
  const full = { ...upcoming, maxOrders: 2 };
  const shown = await getOverviewWindow(fakeDb({ ...weekly, maxOrders: 2 }, [past, full], { "2026-10-31": full }, 2), at("2026-10-28T16:00:00Z"));
  assert.equal(shown?.id, "next");
  assert.equal(shown?.status, "open");
  resetWeeklyTableCache();
});

test("admin overview: with nothing open or upcoming, falls back to the last closed window, clearly labeled", async () => {
  for (const settings of [DEFAULT_WEEKLY_SETTINGS, { ...weekly, paused: true }]) {
    resetWeeklyTableCache();
    const shown = await getOverviewWindow(fakeDb(settings, [past]), at("2026-10-25T16:39:00Z"));
    assert.equal(shown?.id, "past");
    assert.equal(shown?.status, "closed");
    assert.equal(overviewWindowLabel(shown), "Last window (closed Oct 24, 9:00 PM ET) · Weekly Bake");
  }
  resetWeeklyTableCache();
  assert.equal(await getOverviewWindow(fakeDb(DEFAULT_WEEKLY_SETTINGS, []), at("2026-10-25T16:39:00Z")), null);
  assert.equal(overviewWindowLabel(null), "No order window yet");
  resetWeeklyTableCache();
});
