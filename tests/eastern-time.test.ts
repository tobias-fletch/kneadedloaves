import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  formatDeadline,
  formatEasternDateTime,
  formatEasternDay,
  formatEasternWeekday,
  parseEasternDateTimeLocal,
  toEasternDateTimeLocal
} from "../lib/format-datetime";
import { assertWindowOrder, parseMaxOrders, parseWindowTimes } from "../lib/order-window-input";

const iso = (value: Date) => new Date(value.getTime()).toJSON();

test("9:00 PM ET on Sat Oct 24 2026 is stored as 2026-10-25T01:00:00Z", () => {
  assert.equal(iso(parseEasternDateTimeLocal("2026-10-24T21:00")), "2026-10-25T01:00:00.000Z");
  assert.equal(formatEasternDateTime(parseEasternDateTimeLocal("2026-10-24T21:00")), "Oct 24, 9:00 PM ET");
});

test("the value most likely stored today (21:00Z) displays as 5:00 PM ET", () => {
  assert.equal(formatEasternDateTime(new Date("2026-10-24T21:00:00Z")), "Oct 24, 5:00 PM ET");
  assert.equal(toEasternDateTimeLocal(new Date("2026-10-24T21:00:00Z")), "2026-10-24T17:00");
});

test("EST (winter) and EDT (summer) use the right offset", () => {
  assert.equal(iso(parseEasternDateTimeLocal("2026-12-05T21:00")), "2026-12-06T02:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-07-04T09:30")), "2026-07-04T13:30:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-10-24T21:00:30")), "2026-10-25T01:00:30.000Z");
});

test("fall back, Nov 1 2026: the repeated 1:00-2:00 AM hour uses the first (EDT) occurrence", () => {
  assert.equal(iso(parseEasternDateTimeLocal("2026-11-01T00:30")), "2026-11-01T04:30:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-11-01T01:30")), "2026-11-01T05:30:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-11-01T02:00")), "2026-11-01T07:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-11-01T21:00")), "2026-11-02T02:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-10-31T21:00")), "2026-11-01T01:00:00.000Z");
  assert.equal(formatEasternDateTime(new Date("2026-11-01T05:30:00Z")), "Nov 1, 1:30 AM ET");
  assert.equal(formatEasternDateTime(new Date("2026-11-01T06:30:00Z")), "Nov 1, 1:30 AM ET");
});

test("spring forward, Mar 14 2027: the skipped 2:00-3:00 AM hour is rejected, neighbours are exact", () => {
  assert.equal(iso(parseEasternDateTimeLocal("2027-03-14T01:59")), "2027-03-14T06:59:00.000Z");
  assert.throws(() => parseEasternDateTimeLocal("2027-03-14T02:30"), /does not exist in Eastern Time/);
  assert.equal(iso(parseEasternDateTimeLocal("2027-03-14T03:00")), "2027-03-14T07:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2027-03-13T21:00")), "2027-03-14T02:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2027-03-14T21:00")), "2027-03-15T01:00:00.000Z");
  assert.equal(formatEasternDateTime(new Date("2027-03-14T07:00:00Z")), "Mar 14, 3:00 AM ET");
});

test("round trip: pre-filled ET value parses back to the same instant", () => {
  const instants = [
    "2026-10-25T01:00:00Z", "2026-10-24T21:00:00Z", "2026-11-01T05:30:00Z", "2026-11-01T07:00:00Z",
    "2027-03-14T06:59:00Z", "2027-03-14T07:00:00Z", "2027-01-01T04:59:00Z", "2026-06-30T23:15:00Z"
  ];
  for (const value of instants) {
    const instant = new Date(value);
    assert.equal(parseEasternDateTimeLocal(toEasternDateTimeLocal(instant)).getTime(), instant.getTime(), value);
  }
  for (const wall of ["2026-10-24T21:00", "2026-11-01T01:30", "2027-03-14T03:00", "2026-12-31T23:59", "2027-01-01T00:00"]) {
    assert.equal(toEasternDateTimeLocal(parseEasternDateTimeLocal(wall)), wall);
  }
});

test("display helpers label Eastern Time and never show UTC", () => {
  const close = new Date("2026-10-25T01:00:00Z");
  assert.equal(formatEasternDateTime(close), "Oct 24, 9:00 PM ET");
  assert.equal(formatEasternDay(new Date("2026-10-25T16:00:00Z")), "Sunday, Oct 25");
  assert.equal(formatEasternDay(close), "Saturday, Oct 24");
  assert.equal(formatEasternWeekday(new Date("2026-10-25T16:00:00Z")), "Sunday");
  assert.equal(formatDeadline(close), "Saturday, Oct 24 at 9:00 PM ET");
  assert.equal(formatEasternDateTime(new Date("2026-10-24T16:00:00Z")), "Oct 24, 12:00 PM ET");
  assert.equal(formatEasternDateTime(new Date("2026-10-25T04:05:00Z")), "Oct 25, 12:05 AM ET");
  assert.doesNotMatch(formatEasternDateTime(close), /UTC|GMT|Z$/);
});

test("invalid admin input is rejected; zoned API input is read as-is", () => {
  for (const bad of ["", "not a date", "2026-02-30T10:00", "2026-13-01T10:00", "2026-10-24T24:00", "2026-10-24", 42, null, undefined]) {
    assert.throws(() => parseEasternDateTimeLocal(bad), /valid date/, String(bad));
  }
  assert.equal(iso(parseEasternDateTimeLocal("2026-10-25T01:00:00.000Z")), "2026-10-25T01:00:00.000Z");
  assert.equal(iso(parseEasternDateTimeLocal("2026-10-24T21:00-04:00")), "2026-10-25T01:00:00.000Z");
});

test("window form input: ET parsing, required fields, ordering and max orders", () => {
  const times = parseWindowTimes({ opensAt: "2026-10-21T08:00", closesAt: "2026-10-24T21:00", fulfillmentDate: "2026-10-25T10:00" }, true);
  assert.equal(iso(times.opensAt!), "2026-10-21T12:00:00.000Z");
  assert.equal(iso(times.closesAt!), "2026-10-25T01:00:00.000Z");
  assert.equal(iso(times.fulfillmentDate!), "2026-10-25T14:00:00.000Z");
  assert.throws(() => parseWindowTimes({ opensAt: "2026-10-21T08:00" }, true), /Closes is required/);
  assert.deepEqual(parseWindowTimes({ closesAt: "" }, false), {});
  assert.throws(() => parseWindowTimes({ closesAt: "2027-03-14T02:30" }, false), /Closes: That time does not exist/);
  assert.throws(() => assertWindowOrder(times.closesAt!, times.opensAt!), /after Opens/);
  assert.equal(parseMaxOrders(undefined), undefined);
  assert.equal(parseMaxOrders(""), null);
  assert.equal(parseMaxOrders(null), null);
  assert.equal(parseMaxOrders("12"), 12);
  assert.throws(() => parseMaxOrders("0"), /whole number/);
  assert.throws(() => parseMaxOrders("2.5"), /whole number/);
});

test("parsing and display do not depend on the server TZ", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const moduleUrl = new URL("../lib/format-datetime.ts", import.meta.url).href;
  for (const TZ of ["UTC", "Pacific/Honolulu", "Asia/Tokyo", "Europe/London"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      import { parseEasternDateTimeLocal, formatEasternDateTime, toEasternDateTimeLocal } from ${JSON.stringify(moduleUrl)};
      const close = parseEasternDateTimeLocal("2026-10-24T21:00");
      const fall = parseEasternDateTimeLocal("2026-11-01T01:30");
      console.log(JSON.stringify({ close: close.getTime(), fall: fall.getTime(), shown: formatEasternDateTime(close), prefill: toEasternDateTimeLocal(new Date(Date.UTC(2026, 9, 24, 21))) }));
    `], { cwd: root, env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? ""), {
      close: Date.UTC(2026, 9, 25, 1),
      fall: Date.UTC(2026, 10, 1, 5, 30),
      shown: "Oct 24, 9:00 PM ET",
      prefill: "2026-10-24T17:00"
    }, TZ);
  }
});
