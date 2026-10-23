import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emailDeliveryMessage } from "../lib/email-queue";
import { BAKERY_CONTACT_EMAIL } from "../lib/config-messages";
import { PICKUP_AREA } from "../lib/pickup-location";
import { ADMIN_TEST_REFERENCE_PREFIX, detailsFromOrder, escapeHtml, renderOrderEmail, type OrderEmailDetails } from "../lib/order-email";

const due = new Date("2026-10-25T01:00:00.000Z");
const fulfillment = new Date("2026-10-25T16:00:00.000Z");
const reference = "KL-3F8A1C04-9B2E-4D77-A1C0-6E5D4C3B2A19";
const testReference = `${ADMIN_TEST_REFERENCE_PREFIX}3F8A1C04-9B2E-4D77-A1C0-6E5D4C3B2A19`;

function pickup(overrides: Partial<OrderEmailDetails> = {}): OrderEmailDetails {
  return {
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    paymentReference: reference,
    items: [
      { productName: "Sesame Sourdough", quantity: 1, unitPriceCents: 1400 },
      { productName: "Olive & Rosemary Loaf", quantity: 2, unitPriceCents: 1200 }
    ],
    deliveryFeeCents: 0,
    totalCents: 3800,
    fulfillmentType: "PICKUP",
    fulfillmentDate: fulfillment,
    pickupAddress: PICKUP_AREA,
    fulfillmentInstructions: "The bakery confirms the exact handoff after payment.",
    paymentHandle: "@kneadedloaves",
    paymentDestination: "https://www.venmo.com/u/kneadedloaves",
    paymentDueAt: due,
    ...overrides
  };
}

function headings(text: string) {
  return [...text.matchAll(/^(ORDER SUMMARY|PICKUP|DELIVERY|PAYMENT|NEXT STEPS|CONTACT)$/gm)].map((match) => match[1]);
}

test("customer pickup confirmation has spaced sections, money, and Eastern Time", () => {
  const email = renderOrderEmail("customer-reservation", pickup());
  assert.equal(email.subject, "Bakery reservation received — awaiting payment");
  assert.deepEqual(headings(email.text), ["ORDER SUMMARY", "PICKUP", "PAYMENT", "NEXT STEPS", "CONTACT"]);
  assert.match(email.text, /^Hi Maya Chen,\n\nThanks for ordering/);
  assert.match(email.text, /\n\nORDER SUMMARY\n\n/);
  assert.match(email.text, /\n\nPICKUP\n\n/);
  assert.match(email.text, /\n\nPAYMENT\n\n/);
  assert.match(email.text, /\n\nNEXT STEPS\n\n/);
  assert.match(email.text, /\n\nCONTACT\n\n/);
  assert.match(email.text, /1 x Sesame Sourdough — \$14\.00/);
  assert.match(email.text, /2 x Olive & Rosemary Loaf — \$24\.00/);
  assert.match(email.text, /Subtotal: \$38\.00\nDelivery fee: \$0\.00\nTotal: \$38\.00/);
  assert.match(email.text, new RegExp(PICKUP_AREA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(email.text, /Sunday, October 25/);
  assert.match(email.text, /Venmo: @kneadedloaves/);
  assert.match(email.text, /Exact amount: \$38\.00/);
  assert.match(email.text, new RegExp(`Venmo note: ${reference}`));
  assert.match(email.text, /Pay by: Saturday, Oct 24 at 9:00 PM ET/);
  assert.match(email.text, /https:\/\/www\.venmo\.com\/u\/kneadedloaves/);
  assert.match(email.text, /Do not include your address/);
  assert.match(email.text, new RegExp(BAKERY_CONTACT_EMAIL));
  assert.doesNotMatch(`${email.text}\n${email.html}`, /\d{4}-\d{2}-\d{2}T|GMT|UTC/);
  assert.doesNotMatch(`${email.text}\n${email.html}`, /token|password|smtp|secret/i);
});

test("customer delivery confirmation shows the address and ZIP", () => {
  const email = renderOrderEmail("customer-reservation", pickup({
    customerName: "Jordan Hale",
    fulfillmentType: "DELIVERY",
    pickupAddress: null,
    deliveryAddress: "184 Dean Street, Apt 3",
    deliveryZip: "11217",
    deliveryFeeCents: 0,
    totalCents: 2050,
    items: [
      { productName: "Country Miche", quantity: 1, unitPriceCents: 1600 },
      { productName: "Honey Butter Roll", quantity: 1, unitPriceCents: 450 }
    ],
    fulfillmentInstructions: "Free delivery in 11217."
  }));
  assert.deepEqual(headings(email.text), ["ORDER SUMMARY", "DELIVERY", "PAYMENT", "NEXT STEPS", "CONTACT"]);
  assert.match(email.text, /184 Dean Street, Apt 3/);
  assert.match(email.text, /ZIP 11217/);
  assert.match(email.text, /Sunday, October 25/);
  assert.match(email.text, /Subtotal: \$20\.50\nDelivery fee: \$0\.00\nTotal: \$20\.50/);
  assert.match(email.text, /not scheduled for delivery/);
  assert.doesNotMatch(email.text, /S Portland Ave/);
});

test("HTML layout is table-based, styled, and escapes user content", () => {
  const email = renderOrderEmail("customer-reservation", pickup({
    customerName: `Ann <script>alert("x")</script>`,
    items: [{ productName: `Rye & <b>Honey</b>`, quantity: 1, unitPriceCents: 500 }],
    totalCents: 500
  }));
  assert.match(email.html, /<!DOCTYPE html>/);
  assert.match(email.html, /<table/);
  assert.match(email.html, /style="/);
  assert.match(email.html, /max-width:600px/);
  assert.match(email.html, /width="600"/);
  for (const color of ["#A85A2A", "#D8CDAE", "#E88B4A", "#D9703B", "#55663A", "#3B4527", "#E9E4D3"]) assert.match(email.html, new RegExp(color));
  assert.match(email.html, /Oswald/);
  assert.match(email.html, /Inter/);
  assert.match(email.html, /Ann &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(email.html, /Rye &amp; &lt;b&gt;Honey&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<script>alert/);
  assert.match(email.text, /Ann <script>alert\("x"\)<\/script>/);
  assert.match(email.text, /Rye & <b>Honey<\/b>/);
  assert.equal(escapeHtml(`A&B <tag> "q" 'z'`), "A&amp;B &lt;tag&gt; &quot;q&quot; &#39;z&#39;");
});

test("unsafe payment destinations are omitted and safe Venmo links stay clickable", () => {
  const bad = renderOrderEmail("customer-reservation", pickup({ paymentDestination: "javascript:alert(1)" }));
  assert.doesNotMatch(`${bad.text}\n${bad.html}`, /javascript:/i);
  assert.doesNotMatch(bad.text, /Receiving link/);
  const good = renderOrderEmail("customer-reservation", pickup());
  assert.match(good.html, /href="https:\/\/www\.venmo\.com\/u\/kneadedloaves"/);
});

test("payment verified, expiry, and admin review keep the same sections", () => {
  const verified = renderOrderEmail("payment-verified", pickup());
  assert.equal(verified.subject, "Bakery payment verified");
  assert.deepEqual(headings(verified.text), ["ORDER SUMMARY", "PICKUP", "PAYMENT", "NEXT STEPS", "CONTACT"]);
  assert.match(verified.text, /verified your payment/i);
  assert.match(verified.text, /No further payment is due/);
  assert.match(verified.text, /Saturday, Oct 24 at 9:00 PM ET/);
  assert.doesNotMatch(verified.text, /awaiting payment/i);

  const expired = renderOrderEmail("reservation-expired", pickup());
  assert.equal(expired.subject, "Your bakery reservation expired");
  assert.match(expired.text, /Do not send a new payment/);
  assert.match(expired.text, /Saturday, Oct 24 at 9:00 PM ET/);
  assert.match(expired.text, /kneadedloaves@gmail.com/);

  const review = renderOrderEmail("admin-payment-review", pickup());
  assert.equal(review.subject, "Bakery payment needs review");
  assert.match(review.text, /not proof of payment/i);
  assert.match(review.text, /Customer: Maya Chen/);
  assert.match(review.text, /Email: maya\.chen@example\.com/);
  assert.match(review.text, /Independently inspect Venmo/);
  assert.doesNotMatch(review.text, /token|password/i);
});

test("admin new-order mail tells the owner what to check and keeps the full test reference", () => {
  const email = renderOrderEmail("admin-new-order", pickup({ paymentReference: testReference }));
  assert.equal(email.subject, "New bakery reservation awaiting payment");
  assert.deepEqual(headings(email.text), ["ORDER SUMMARY", "PICKUP", "PAYMENT", "NEXT STEPS", "CONTACT"]);
  assert.match(email.text, /Do not mark it paid/);
  assert.match(email.text, /Open Admin, then Orders/);
  assert.match(email.text, new RegExp(testReference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(email.text, /Admin test order/);
  assert.match(email.html, /Admin test order/);
  assert.doesNotMatch(email.text, /KL-3F8A/);
  assert.match(email.text, /Exact amount: \$38\.00/);
  assert.match(email.text, /Pay by: Saturday, Oct 24 at 9:00 PM ET/);
});

test("stored orders rebuild pickup and delivery details without raw timestamps", () => {
  const fromPickup = detailsFromOrder({
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    paymentReference: reference,
    items: [{ productName: "Sesame Sourdough", quantity: 1, unitPriceCents: 1400 }],
    deliveryFeeCents: 0,
    totalCents: 1400,
    fulfillmentType: "PICKUP",
    fulfillmentLocation: `Brooklyn pickup\n${PICKUP_AREA}`,
    paymentHandle: "@kneadedloaves",
    paymentDestination: "https://www.venmo.com/u/kneadedloaves",
    paymentDueAt: due
  }, fulfillment);
  assert.equal(fromPickup.pickupAddress, PICKUP_AREA);
  const fromDelivery = detailsFromOrder({
    customerName: "Jordan Hale",
    paymentReference: reference,
    items: [{ productName: "Country Miche", quantity: 1, unitPriceCents: 1600 }],
    deliveryFeeCents: 0,
    totalCents: 1600,
    fulfillmentType: "DELIVERY",
    deliveryAddress: "184 Dean Street, Apt 3\n11217",
    paymentDueAt: due
  }, fulfillment);
  assert.equal(fromDelivery.deliveryZip, "11217");
  assert.match(fromDelivery.deliveryAddress ?? "", /184 Dean Street/);
  const email = renderOrderEmail("payment-verified", fromPickup);
  assert.match(email.text, /Sunday, October 25/);
  assert.doesNotMatch(email.text, /toISOString|GMT/);
});

test("multipart delivery keeps plain text and adds HTML only when it was queued", () => {
  const rendered = renderOrderEmail("customer-reservation", pickup());
  const both = emailDeliveryMessage({ id: "job-1", to: "maya.chen@example.com", subject: rendered.subject, body: rendered.text, html: rendered.html }, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.equal(both.text, rendered.text);
  assert.equal(both.html, rendered.html);
  assert.equal(both.messageId, "<job-1@gmail.com>");
  const textOnly = emailDeliveryMessage({ id: "job-2", to: "maya.chen@example.com", subject: "Reset", body: "Use this private link.", html: null }, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.equal(textOnly.text, "Use this private link.");
  assert.equal("html" in textOnly, false);
});

test("order email call sites keep recipients, dedupe keys, and the admin test prefix", () => {
  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  const payments = readFileSync(new URL("../lib/manual-payments.ts", import.meta.url), "utf8");
  const review = readFileSync(new URL("../app/api/orders/[id]/payment-review/route.ts", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../lib/email-queue.ts", import.meta.url), "utf8");
  assert.match(checkout, /renderOrderEmail\("customer-reservation"/);
  assert.match(checkout, /renderOrderEmail\("admin-new-order"/);
  assert.match(checkout, /dedupeKey: `order-received:\$\{created\.id\}`/);
  assert.match(checkout, /dedupeKey: `admin-order:\$\{created\.id\}`/);
  assert.match(checkout, /to: created\.customerEmail/);
  assert.match(checkout, /to: settings\.notificationEmail/);
  assert.match(checkout, /isAdminTestOrder\(config, isAdmin\) \? "KL-ADMIN-TEST-" : "KL-"/);
  assert.doesNotMatch(checkout, /toISOString|formatMoney/);
  assert.match(payments, /renderOrderEmail\(kind/);
  assert.match(payments, /"payment-verified"/);
  assert.match(payments, /"reservation-expired"/);
  assert.match(payments, /dedupeKey, to: order\.customerEmail/);
  assert.doesNotMatch(payments, /toISOString/);
  assert.match(review, /renderOrderEmail\("admin-payment-review"/);
  assert.match(review, /dedupeKey: `payment-review:\$\{id\}`/);
  assert.match(review, /to: settings\.notificationEmail/);
  assert.match(queue, /message\.html = job\.html/);
  assert.match(queue, /RETURNING "id", "to", "subject", "body", "html", "attempts"/);
});
