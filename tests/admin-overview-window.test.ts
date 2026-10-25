import assert from "node:assert/strict";
import test from "node:test";
import { getOverviewWindow, resetWeeklyTableCache } from "../lib/order-window";
import { DEFAULT_WEEKLY_SETTINGS, type WeeklySettings } from "../lib/weekly-window";

// Mirrors the real windows: last week's closed Sat Oct 24 9:00 PM ET (fulfilled Sun Oct 25);
// this week's opens Mon Oct 26 9:00 AM ET and closes Sat Oct 31 1:00 PM ET (fulfilled Sun Nov 1).
const at = (iso: string) => new Date(iso);
const past = { id: "past", name: "Weekly Bake", opensAt: at("2026-10-19T13:00:00Z"), closesAt: at("2026-10-25T01:00:00Z"), fulfillmentDate: at("2026-10-25T16:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false, orders: [] };
const upcoming = { id: "next", name: "Weekly Bake", opensAt: at("2026-10-26T13:00:00Z"), closesAt: at("2026-10-31T17:00:00Z"), fulfillmentDate: at("2026-11-01T17:00:00Z"), maxOrders: null, manualOpen: false, manualClosed: false, orders: [] };
const weekly: WeeklySettings = { ...DEFAULT_WEEKLY_SETTINGS, enabled: true };
// This week closes early (Sat 1:00 PM ET instead of 9:00 PM) via a per-week override.
const override = { weekKey: "2026-10-31", overrideOpensAt: null, overrideClosesAt: upcoming.closesAt, overrideFulfillmentDate: null, skip: false, message: null, orderWindowId: null };

function fakeDb(settings: WeeklySettings, windows: typeof past[]) {
  let created: Record<string, unknown> | null = null;
  return {
    $queryRaw: async () => [{ ready: true }],
    weeklyOrderSchedule: { findUnique: async () => ({ id: "default", ...settings }) },
    weeklyOrderWeek: {
      findMany: async () => [override],
      findUnique: async () => null,
      createMany: async () => ({ count: 1 }),
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ weekKey: "x", orderWindowId: "w1", orderWindow: created })
    },
    orderWindow: {
      findMany: async () => [...windows].sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime()),
      findFirst: async ({ where }: { where: { closesAt: Date } }) => windows.find((w) => w.closesAt.getTime() === where.closesAt.getTime()) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => (created = { id: "w1", manualOpen: false, manualClosed: false, ...data }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...created, ...data }),
      delete: async () => ({})
    },
    order: { findMany: async () => [] }
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

test("admin overview (one-off windows): only past windows means nothing to show", async () => {
  resetWeeklyTableCache();
  assert.equal(await getOverviewWindow(fakeDb(DEFAULT_WEEKLY_SETTINGS, [past]), at("2026-10-25T16:39:00Z")), null);
  resetWeeklyTableCache();
});
