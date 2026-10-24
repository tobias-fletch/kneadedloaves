import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHARE_DESCRIPTION } from "../lib/site-metadata";

test("share description is short, public-facing, and states real ordering facts", () => {
  assert.ok(SHARE_DESCRIPTION.length <= 155, `too long: ${SHARE_DESCRIPTION.length}`);
  assert.match(SHARE_DESCRIPTION, /Brooklyn/);
  assert.match(SHARE_DESCRIPTION, /11217/);
  assert.match(SHARE_DESCRIPTION, /Venmo/);
  assert.doesNotMatch(SHARE_DESCRIPTION, /admin|dashboard/i);
});

test("root layout uses the share description for description, og and twitter", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /admin dashboard/);
  assert.equal(layout.match(/description: SHARE_DESCRIPTION/g)?.length, 3);
});
