import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentOrderWindow, resetWeeklyTableCache } from "../lib/order-window";
import { acceptsOrders } from "../lib/order-rules";
import {
  DEFAULT_WEEKLY_SETTINGS, applyOverride, checkoutClosedMessage, describeWeeklyWindow, parseWeeklySettings,
  resolveWeeklyWindow, scheduledWeek, weekKeysAround, type WeekOverride, type WeeklySettings
} from "../lib/weekly-window";

const on: WeeklySettings = { ...DEFAULT_WEEKLY_SETTINGS, enabled: true };
const none = new Map<string, WeekOverride>();
const at = (iso: string) => new Date(iso);

test("defaults match today's live window: close Sat 9:00 PM ET, Sunday fulfillment, weekly mode off", () => {
  assert.equal(DEFAULT_WEEKLY_SETTINGS.enabled, false);
  const week = scheduledWeek(on, "2026-10-24");
  assert.equal(week.closesAt.toISOString(), "2026-10-25T01:00:00.000Z"); // Sat Oct 24, 9:00 PM EDT
  assert.equal(week.opensAt.toISOString(), "2026-10-19T13:00:00.000Z"); // Mon Oct 19, 9:00 AM EDT
  assert.equal(week.fulfillmentDate.toISOString(), "2026-10-25T16:00:00.000Z"); // Sun Oct 25, noon EDT
});

test("open now: says until when and for which day", () => {
  const result = resolveWeeklyWindow(on, none, at("2026-10-24T20:00:00Z")); // Sat 4 PM ET
  assert.equal(result.status, "open");
  assert.equal(describeWeeklyWindow(result).headline, "Orders open until Sat, Oct 24 at 9:00 PM ET for Sunday, Oct 25 pickup or delivery.");
});

test("close is inclusive at 9:00 PM and rolls to next week right after", () => {
  assert.equal(resolveWeeklyWindow(on, none, at("2026-10-25T01:00:00Z")).status, "open");
  const after = resolveWeeklyWindow(on, none, at("2026-10-25T01:00:01Z"));
  assert.equal(after.status, "closed");
  assert.equal(after.next?.weekKey, "2026-10-31");
  // Mon Oct 26 9:00 AM EDT; Sat Oct 31 9:00 PM EDT; fulfillment Sun Nov 1 (DST ends that morning) at noon EST.
  assert.equal(after.next?.opensAt.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(after.next?.closesAt.toISOString(), "2026-11-01T01:00:00.000Z");
  assert.equal(after.next?.fulfillmentDate.toISOString(), "2026-11-01T17:00:00.000Z");
  assert.match(describeWeeklyWindow(after).headline, /^Next orders open Mon, Oct 26 at 9:00 AM ET/);
});

test("DST fall-back: the week after Nov 1 uses EST (UTC-5)", () => {
  const week = scheduledWeek(on, "2026-11-07");
  assert.equal(week.opensAt.toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(week.closesAt.toISOString(), "2026-11-08T02:00:00.000Z");
});

test("DST spring-forward: Mar 14 2027 times stay at local wall-clock; a 2:30 AM time in the gap moves to 3:30 AM", () => {
  const week = scheduledWeek(on, "2027-03-13");
  assert.equal(week.opensAt.toISOString(), "2027-03-08T14:00:00.000Z"); // EST
  assert.equal(week.closesAt.toISOString(), "2027-03-14T02:00:00.000Z"); // Sat 9 PM EST
  assert.equal(week.fulfillmentDate.toISOString(), "2027-03-14T16:00:00.000Z"); // Sun noon EDT
  const gap = scheduledWeek({ ...on, openWeekday: 0, openTime: "02:30", closeWeekday: 6 }, "2027-03-20");
  assert.equal(gap.opensAt.toISOString(), "2027-03-14T07:30:00.000Z"); // 3:30 AM EDT
});

test("rollover needs no cron: resolution only depends on the clock", () => {
  const keys = weekKeysAround(on, at("2026-12-30T12:00:00Z"));
  assert.ok(keys.includes("2027-01-02"));
  const result = resolveWeeklyWindow(on, none, at("2026-12-30T12:00:00Z"));
  assert.equal(result.status, "open");
  assert.equal(result.status === "open" && result.current.weekKey, "2027-01-02");
});

test("single-week override changes only that week", () => {
  const overrides = new Map<string, WeekOverride>([["2026-10-31", { closesAt: at("2026-10-30T22:00:00Z"), fulfillmentDate: at("2026-10-31T16:00:00Z"), message: "Halloween bake!" }]]);
  const applied = applyOverride(on, "2026-10-31", overrides.get("2026-10-31"));
  assert.equal(applied.overridden, true);
  const fri = resolveWeeklyWindow(on, overrides, at("2026-10-30T23:00:00Z"));
  assert.equal(fri.status, "closed");
  assert.equal(fri.next?.weekKey, "2026-11-07");
  assert.equal(scheduledWeek(on, "2026-11-07").closesAt.getTime(), fri.next?.closesAt.getTime());
});

test("skip a week shows the message and points to the following week", () => {
  const overrides = new Map<string, WeekOverride>([["2026-10-31", { skip: true, message: "Off for the holiday." }]]);
  const result = resolveWeeklyWindow(on, overrides, at("2026-10-27T12:00:00Z"));
  assert.equal(result.status, "closed");
  assert.equal(result.next?.weekKey, "2026-11-07");
  assert.match(describeWeeklyWindow(result).detail ?? "", /Off for the holiday\./);
});

test("pause stops ordering and shows the optional message", () => {
  const result = resolveWeeklyWindow({ ...on, paused: true, pauseMessage: "Back in two weeks." }, none, at("2026-10-24T20:00:00Z"));
  assert.equal(result.status, "paused");
  assert.equal(checkoutClosedMessage(result), "Ordering is paused. Back in two weeks.");
});

test("settings validation", () => {
  assert.throws(() => parseWeeklySettings({ ...on, openTime: "25:00" }));
  assert.throws(() => parseWeeklySettings({ ...on, openWeekday: 6, openTime: "21:00" }));
  assert.equal(parseWeeklySettings({ ...on, maxOrders: "" }).maxOrders, null);
});

function fakeDb(settings: WeeklySettings, windows: Record<string, unknown>[] = []) {
  const created: unknown[] = [];
  const db = {
    $queryRaw: async () => [{ ready: true }],
    weeklyOrderSchedule: { findUnique: async () => ({ id: "default", ...settings }) },
    weeklyOrderWeek: {
      findMany: async () => [],
      findUnique: async () => null,
      createMany: async () => ({ count: 1 }),
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ weekKey: "2026-10-24", orderWindowId: "w1", orderWindow: created[0] ?? windows[0] })
    },
    orderWindow: {
      findMany: async () => windows,
      findFirst: async () => windows[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: "w1", manualOpen: false, manualClosed: false, ...data }; created.push(row); return row; },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...(created[0] ?? windows[0]) as object, ...data }),
      delete: async () => ({})
    },
    order: { findMany: async () => [] }
  };
  return { db: db as never, created };
}

test("server-side: checkout gets no open window when paused or outside the weekly window", async () => {
  resetWeeklyTableCache();
  const paused = await getCurrentOrderWindow(fakeDb({ ...on, paused: true }).db, at("2026-10-24T20:00:00Z"));
  assert.equal(paused.openWindow, undefined);
  assert.equal(checkoutClosedMessage(paused.weekly), "Ordering is paused.");
  const late = await getCurrentOrderWindow(fakeDb(on).db, at("2026-10-25T01:05:00Z"));
  assert.equal(late.openWindow, undefined);
  assert.match(checkoutClosedMessage(late.weekly), /^Ordering is closed\. Next orders open Mon, Oct 26 at 9:00 AM ET\.$/);
  resetWeeklyTableCache();
});

test("server-side: inside the window the week's order row is created lazily and accepts orders until close", async () => {
  resetWeeklyTableCache();
  const { db, created } = fakeDb(on);
  const now = at("2026-10-24T20:00:00Z");
  const result = await getCurrentOrderWindow(db, now);
  assert.ok(result.openWindow);
  assert.equal(created.length, 1);
  assert.equal(result.openWindow!.closesAt.toISOString(), "2026-10-25T01:00:00.000Z");
  // The checkout transaction re-checks the stored row; a second after close it refuses.
  assert.equal(acceptsOrders(result.openWindow!, 0, at("2026-10-25T01:00:01Z")), false);
  resetWeeklyTableCache();
});

test("adopts the existing one-off window for the same close instead of duplicating it", async () => {
  resetWeeklyTableCache();
  const legacy = { id: "live", name: "Weekly Bake", opensAt: at("2026-10-19T13:00:00Z"), closesAt: at("2026-10-25T01:00:00Z"), fulfillmentDate: at("2026-10-25T16:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false };
  const { db, created } = fakeDb(on, [legacy]);
  const result = await getCurrentOrderWindow(db, at("2026-10-24T20:00:00Z"));
  assert.equal(created.length, 0);
  assert.equal(result.openWindow?.id, "live");
  resetWeeklyTableCache();
});

test("weekly mode off (or tables missing): legacy one-off windows exactly as before", async () => {
  resetWeeklyTableCache();
  const legacy = { id: "live", opensAt: at("2026-10-19T13:00:00Z"), closesAt: at("2026-10-25T01:00:00Z"), fulfillmentDate: at("2026-10-25T16:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false, orders: [] };
  const off = await getCurrentOrderWindow(fakeDb(DEFAULT_WEEKLY_SETTINGS, [legacy]).db, at("2026-10-24T20:00:00Z"));
  assert.equal(off.openWindow?.id, "live");
  assert.equal(off.weekly, null);
  resetWeeklyTableCache();
  const missing = fakeDb(on, [legacy]).db as unknown as Record<string, unknown>;
  missing.$queryRaw = async () => [{ ready: false }];
  const result = await getCurrentOrderWindow(missing as never, at("2026-10-24T20:00:00Z"));
  assert.equal(result.openWindow?.id, "live");
  assert.equal(result.weekly, null);
  resetWeeklyTableCache();
});
