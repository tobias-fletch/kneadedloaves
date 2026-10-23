import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatDeadline, formatFulfillmentDate } from "../lib/format-datetime";

const saturdayEvening = new Date("2026-10-25T01:00:00.000Z");
const sundayNoon = new Date("2026-10-25T16:00:00.000Z");

test("fulfillment dates use a long Eastern Time calendar day", () => {
  assert.equal(formatFulfillmentDate(sundayNoon), "Sunday, October 25");
  assert.equal(formatFulfillmentDate(saturdayEvening), "Saturday, October 24");
  assert.equal(formatFulfillmentDate(new Date("2026-01-15T05:00:00.000Z")), "Thursday, January 15");
  assert.equal(formatFulfillmentDate(new Date("2026-07-15T00:30:00.000Z")), "Tuesday, July 14");
});

test("deadlines use an Eastern Time clock and an ET label", () => {
  assert.equal(formatDeadline(saturdayEvening), "Saturday, Oct 24 at 9:00 PM ET");
  assert.equal(formatDeadline(new Date("2026-01-15T05:00:00.000Z")), "Thursday, Jan 15 at 12:00 AM ET");
  assert.equal(formatDeadline(new Date("2026-07-15T00:30:00.000Z")), "Tuesday, Jul 14 at 8:30 PM ET");
  assert.doesNotMatch(formatDeadline(saturdayEvening), /Z|GMT|UTC|EDT|EST|\d{4}-\d{2}-\d{2}T/);
});

test("spring-forward and fall-back follow the Eastern Time wall clock", () => {
  assert.equal(formatDeadline(new Date("2026-03-08T06:30:00.000Z")), "Sunday, Mar 8 at 1:30 AM ET");
  assert.equal(formatDeadline(new Date("2026-03-08T07:30:00.000Z")), "Sunday, Mar 8 at 3:30 AM ET");
  assert.equal(formatDeadline(new Date("2026-11-01T05:30:00.000Z")), "Sunday, Nov 1 at 1:30 AM ET");
  assert.equal(formatDeadline(new Date("2026-11-01T06:30:00.000Z")), "Sunday, Nov 1 at 1:30 AM ET");
});

test("formatting names America/New_York and does not use the server zone", () => {
  const source = readFileSync(new URL("../lib/format-datetime.ts", import.meta.url), "utf8");
  assert.match(source, /America\/New_York/);
  assert.doesNotMatch(source, /toISOString|toString\(|toLocaleString|getTimezoneOffset/);
  const utcDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(saturdayEvening);
  assert.equal(utcDay, "Sunday, October 25");
  assert.equal(formatFulfillmentDate(saturdayEvening), "Saturday, October 24");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const moduleUrl = new URL("../lib/format-datetime.ts", import.meta.url).href;
  for (const TZ of ["Pacific/Honolulu", "UTC", "Asia/Tokyo"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      import { formatDeadline, formatFulfillmentDate } from ${JSON.stringify(moduleUrl)};
      const deadline = formatDeadline(new Date("2026-10-25T01:00:00.000Z"));
      const day = formatFulfillmentDate(new Date("2026-10-25T01:00:00.000Z"));
      console.log(JSON.stringify({ deadline, day }));
    `], { cwd: root, env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.trim().split("\n").at(-1);
    assert.deepEqual(JSON.parse(line ?? ""), {
      deadline: "Saturday, Oct 24 at 9:00 PM ET",
      day: "Saturday, October 24"
    });
  }
});

test("invalid dates are rejected", () => {
  assert.throws(() => formatFulfillmentDate(new Date("not-a-date")), /valid date/);
  assert.throws(() => formatDeadline(new Date(Number.NaN)), /valid date/);
});
