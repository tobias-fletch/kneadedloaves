import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { customerSaysPaid, shouldAutoExpire, verifyWithinDeadline } from "../lib/order-rules";
import { customerSaysPaidFirst, orderStatusBadge } from "../lib/admin-status";
import { summarizeOrders } from "../lib/admin-metrics";
import { quoteDelivery } from "../lib/delivery-distance";

const now = new Date("2026-10-24T15:00:00Z"), past = new Date("2026-10-24T14:00:00Z"), future = new Date("2026-10-24T16:00:00Z");
const order = (over: Partial<Parameters<typeof shouldAutoExpire>[0]> = {}) => ({ paymentMethod: "VENMO", status: "PENDING", paymentState: "UNPAID", paymentDueAt: past, paymentReviewRequestedAt: null as Date | null, ...over });

test("overdue unflagged Venmo orders still expire", () => {
  assert.equal(shouldAutoExpire(order(), now), true);
  assert.equal(shouldAutoExpire(order({ paymentDueAt: future }), now), false);
  assert.equal(shouldAutoExpire(order({ paymentState: "VERIFIED" }), now), false);
});

test("'I sent payment' orders never auto-expire, even long after the deadline", () => {
  const flagged = order({ paymentState: "REVIEW", paymentReviewRequestedAt: past });
  assert.equal(customerSaysPaid(flagged), true);
  assert.equal(shouldAutoExpire(flagged, now), false);
  assert.equal(shouldAutoExpire(flagged, new Date("2027-01-01T00:00:00Z")), false);
});

test("every expiry path uses the exemption: the per-order check and the batch query", () => {
  const src = readFileSync("lib/manual-payments.ts", "utf8");
  assert.match(src, /if \(!shouldAutoExpire\(order, now\)\) return false;/);
  assert.match(src, /paymentState: \{ not: "VERIFIED" \}, paymentReviewRequestedAt: null \}/);
  assert.match(readFileSync("lib/manual-payments.ts", "utf8"), /expireUnpaidOrdersOnce[\s\S]*expireOrder\(tx, order\.id/);
});

test("mark-paid works after the deadline only for customer-says-paid orders", () => {
  assert.equal(verifyWithinDeadline(order(), past, now), false);
  assert.equal(verifyWithinDeadline(order({ paymentDueAt: future }), past, now), true);
  assert.equal(verifyWithinDeadline(order({ paymentReviewRequestedAt: past }), now, now), true);
  assert.equal(verifyWithinDeadline({ ...order({ paymentReviewRequestedAt: past }), status: "CANCELLED" }, now, now), false);
  assert.match(readFileSync("lib/manual-payments.ts", "utf8"), /!verifyWithinDeadline\(order, receivedAt, now\)/);
  assert.match(readFileSync("components/AdminOrderActions.tsx", "utf8"), /Boolean\(props\.customerSaysPaid\) \|\|/);
});

test("flagged orders keep their cap space: checkout counts every non-cancelled order", () => {
  assert.match(readFileSync("app/api/checkout/route.ts", "utf8"), /tx\.order\.count\(\{ where: \{ orderWindowId: openWindow\.id, status: \{ not: "CANCELLED" \} \} \}\)/);
});

test("admin shows a distinct badge and lists customer-says-paid orders first", () => {
  assert.deepEqual(orderStatusBadge({ status: "PENDING", paymentReviewRequestedAt: past }), { label: "Customer says paid", tone: "bg-ink text-butter" });
  assert.equal(orderStatusBadge({ status: "PENDING", paymentReviewRequestedAt: null }).label, "Awaiting payment");
  const sorted = customerSaysPaidFirst([{ id: "a", status: "PENDING", paymentReviewRequestedAt: null }, { id: "b", status: "CANCELLED", paymentReviewRequestedAt: past }, { id: "c", status: "PENDING", paymentReviewRequestedAt: past }]);
  assert.deepEqual(sorted.map(o => o.id), ["c", "a", "b"]);
  assert.match(readFileSync("app/admin/orders/page.tsx", "utf8"), /payment=CLAIMED/);
});

test("overview counts customer-says-paid separately from awaiting payment", () => {
  const summary = summarizeOrders([
    { status: "PENDING", paymentState: "UNPAID", totalCents: 1000, paymentReviewRequestedAt: null },
    { status: "PENDING", paymentState: "REVIEW", totalCents: 1000, paymentReviewRequestedAt: past },
    { status: "CANCELLED", paymentState: "REVIEW", totalCents: 1000, paymentReviewRequestedAt: past }
  ]);
  assert.equal(summary.awaitingPayment, 1); assert.equal(summary.customerSaysPaid, 1); assert.equal(summary.orders, 2);
});

test("unverifiable delivery distance is accepted at $6 and flagged on the admin card", async () => {
  const quote = await quoteDelivery("1 Nowhere Rd", "00000", { origin: null, geocode: async () => null });
  assert.equal(quote.feeCents, 600); assert.equal(quote.inRange, true); assert.equal(quote.verified, false);
  assert.match(readFileSync("app/admin/orders/page.tsx", "utf8"), /data-testid="distance-unverified">\{DISTANCE_NOT_VERIFIED_ADMIN_NOTE\}/);
});

test("Social tab and its code are removed; its stored data models stay in the schema", () => {
  for (const gone of ["app/admin/social/page.tsx", "app/api/admin/social/route.ts", "lib/social.ts"]) assert.equal(existsSync(gone), false, gone);
  assert.doesNotMatch(readFileSync("components/AdminNav.tsx", "utf8"), /\/admin\/social/);
  assert.doesNotMatch(readFileSync("components/AdminForm.tsx", "utf8"), /SocialPostForm|\/api\/admin\/social/);
  assert.doesNotMatch(readFileSync("lib/app-config.ts", "utf8"), /INSTAGRAM_GRAPH_TOKEN|TIKTOK_CLIENT|YOUTUBE_CLIENT|FACEBOOK_PAGE_TOKEN/);
  for (const route of ["app/api/admin/products/route.ts", "app/api/admin/events/route.ts", "app/api/admin/windows/route.ts"]) assert.doesNotMatch(readFileSync(route, "utf8"), /createAutomatedDraft/);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  for (const model of ["model SocialPost ", "model SocialPlatformAccount ", "model SocialPostAsset ", "model ContentTemplate "]) assert.ok(schema.includes(model), model);
});
