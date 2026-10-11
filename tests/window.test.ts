import { test } from "node:test";
import assert from "node:assert/strict";
import { BAKERY_TIME_ZONE, bakeryDateKey, bakeryWeekday, formatBakeryDate, parseBakeryDateTime, toBakeryDateTimeLocal } from "../lib/bakery-time";
import { acceptsOrders, orderWindowConfigurationError, parseOrderWindowInput } from "../lib/order-rules";

const saturdayInput = {
  name: "Saturday delivery",
  opensAt: "2026-10-13T09:00",
  closesAt: "2026-10-15T18:00",
  fulfillmentDate: "2026-10-17T10:00",
  maxOrders: 3,
  manualClosed: false,
  manualOpen: false
};

function saturdayWindow() { return parseOrderWindowInput(saturdayInput); }

// Dates and times below are test fixtures only; no launch schedule is seeded.
test("bakery local timestamps map to Eastern winter and summer offsets", () => {
  assert.equal(BAKERY_TIME_ZONE, "America/New_York");
  assert.equal(parseBakeryDateTime("2026-01-15T09:30").toISOString(), "2026-01-15T14:30:00.000Z");
  assert.equal(parseBakeryDateTime("2026-07-15T09:30:15").toISOString(), "2026-07-15T13:30:15.000Z");
  assert.equal(toBakeryDateTimeLocal(new Date("2026-07-15T13:30:15Z")), "2026-07-15T09:30:15");
});

test("parsing and display are independent of the server timezone", () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = timezone;
      assert.equal(parseBakeryDateTime("2026-10-13T09:00").toISOString(), "2026-10-13T13:00:00.000Z");
      assert.equal(bakeryDateKey(new Date("2026-10-18T02:00:00Z")), "2026-10-17");
      assert.equal(bakeryWeekday(new Date("2026-10-18T02:00:00Z")), 6);
      assert.match(formatBakeryDate(new Date("2026-10-13T13:00:00Z")), /9:00 AM/);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("spring-forward gaps and fall-back overlaps are rejected explicitly", () => {
  assert.throws(() => parseBakeryDateTime("2026-03-08T02:30"), /does not exist/);
  assert.throws(() => parseBakeryDateTime("2026-11-01T01:30"), /ambiguous/);
  assert.equal(parseBakeryDateTime("2026-03-08T01:59:59").toISOString(), "2026-03-08T06:59:59.000Z");
  assert.equal(parseBakeryDateTime("2026-03-08T03:00").toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(parseBakeryDateTime("2026-11-01T02:00").toISOString(), "2026-11-01T07:00:00.000Z");
});

test("invalid calendar dates, rollovers and implicitly zoned input are rejected", () => {
  for (const value of [undefined, null, new Date(), "", "2026-02-29T12:00", "2026-04-31T12:00", "2026-13-01T12:00", "2026-00-01T12:00", "2026-10-00T12:00", "2026-10-13T24:00", "2026-10-13T12:60", "2026-10-13T12:00:60", "2026-10-13", "2026-10-13T12:00Z", "2026-10-13T12:00-04:00"]) {
    assert.throws(() => parseBakeryDateTime(value), Error, String(value));
  }
  assert.equal(parseBakeryDateTime("2028-02-29T12:00").toISOString(), "2028-02-29T17:00:00.000Z");
});

test("opening is inclusive and cutoff is exclusive down to a millisecond", () => {
  const window = saturdayWindow();
  assert.equal(acceptsOrders(window, 0, new Date(window.opensAt.getTime() - 1)), false);
  assert.equal(acceptsOrders(window, 0, window.opensAt), true);
  assert.equal(acceptsOrders(window, 0, new Date(window.closesAt.getTime() - 1)), true);
  assert.equal(acceptsOrders(window, 0, window.closesAt), false);
  assert.equal(acceptsOrders(window, 0, new Date(window.closesAt.getTime() + 1)), false);
});

test("manual opening cannot bypass cutoff, closure, invalid schedules or capacity", () => {
  const window = { ...saturdayWindow(), manualOpen: true };
  assert.equal(acceptsOrders(window, 0, new Date(window.opensAt.getTime() - 1)), true);
  assert.equal(acceptsOrders(window, 0, window.closesAt), false);
  assert.equal(acceptsOrders(window, 0, window.fulfillmentDate), false);
  assert.equal(acceptsOrders({ ...window, manualClosed: true }, 0, window.opensAt), false);
  assert.equal(acceptsOrders(window, window.maxOrders, window.opensAt), false);
  assert.equal(acceptsOrders({ ...window, opensAt: new Date("invalid") }, 0, window.opensAt), false);
  assert.equal(acceptsOrders({ ...window, closesAt: new Date(window.fulfillmentDate.getTime() + 1) }, 0, window.opensAt), false);
});

test("unknown or invalid capacity fails closed; the last available order remains bookable", () => {
  const window = saturdayWindow();
  for (const maxOrders of [null, 0, -1, 1.5, NaN, Infinity, 2147483648]) {
    assert.equal(acceptsOrders({ ...window, maxOrders }, 0, window.opensAt), false, String(maxOrders));
  }
  assert.equal(acceptsOrders(window, 2, window.opensAt), true);
  assert.equal(acceptsOrders(window, 3, window.opensAt), false);
  for (const count of [-1, 0.1, NaN, Infinity]) assert.equal(acceptsOrders(window, count, window.opensAt), false);
  assert.equal(acceptsOrders(window, 0, new Date("invalid")), false);
});

test("Saturday and Sunday windows each use their own cutoff and availability", () => {
  const saturday = saturdayWindow();
  const sunday = parseOrderWindowInput({ ...saturdayInput, name: "Sunday delivery", closesAt: "2026-10-16T18:00", fulfillmentDate: "2026-10-18T10:00" });
  const afterThursdayCutoff = parseBakeryDateTime("2026-10-16T09:00");
  assert.equal(acceptsOrders(saturday, 0, afterThursdayCutoff), false);
  assert.equal(acceptsOrders(sunday, 0, afterThursdayCutoff), true);
  assert.equal(acceptsOrders(saturday, 0, parseBakeryDateTime("2026-10-18T12:00")), false);
  assert.equal(acceptsOrders(sunday, 0, parseBakeryDateTime("2026-10-18T12:00")), false);
});

test("calendar rules use local weekdays and dates, including the DST weekend", () => {
  assert.doesNotThrow(() => parseOrderWindowInput({ ...saturdayInput, opensAt: "2026-10-27T09:00", closesAt: "2026-10-30T23:00", fulfillmentDate: "2026-11-01T09:00" }));
  assert.doesNotThrow(() => parseOrderWindowInput({ ...saturdayInput, closesAt: "2026-10-15T23:00", fulfillmentDate: "2026-10-17T23:00" }));
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, fulfillmentDate: "2026-10-16T10:00" }), /Saturday or Sunday/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, closesAt: "2026-10-14T18:00" }), /Thursday cutoff/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, closesAt: "2026-10-16T18:00" }), /Thursday cutoff/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, opensAt: "2026-10-06T09:00", closesAt: "2026-10-08T18:00" }), /same week/);
});

test("window edits validate complete merged configuration and preserve unchanged fields", () => {
  const original = saturdayWindow();
  const updated = parseOrderWindowInput({ maxOrders: "5", manualOpen: "false", name: "  Saturday loaves  " }, original);
  assert.equal(updated.maxOrders, 5);
  assert.equal(updated.manualOpen, false);
  assert.equal(updated.name, "Saturday loaves");
  assert.equal(updated.closesAt, original.closesAt);
  assert.throws(() => parseOrderWindowInput({ opensAt: "2026-10-16T09:00" }, original), /open before/);
  assert.throws(() => parseOrderWindowInput({ maxOrders: "" }, original), /capacity/);
  assert.throws(() => parseOrderWindowInput({ manualClosed: "yes" }, original), /true or false/);
  assert.throws(() => parseOrderWindowInput({ manualOpen: true, manualClosed: true }, original), /both/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, maxOrders: true }), /capacity/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, maxOrders: "1e2" }), /capacity/);
  assert.throws(() => parseOrderWindowInput({ ...saturdayInput, name: " " }), /window name/);
});

test("persisted legacy windows missing a confirmed capacity stay unavailable", () => {
  const original = saturdayWindow();
  const legacy = { ...original, maxOrders: null };
  assert.match(orderWindowConfigurationError(legacy) ?? "", /capacity/);
  assert.equal(acceptsOrders(legacy, 0, original.opensAt), false);
});
