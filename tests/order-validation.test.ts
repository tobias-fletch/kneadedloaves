import assert from "node:assert/strict";
import test from "node:test";
import { orderSchema } from "../lib/validation";
import { contactMessageSchema } from "../lib/contact-message";

const first = (input: unknown) => { const r = orderSchema.safeParse(input); return r.success ? null : r.error.issues[0]?.message; };
const pickup = { customerEmail: "baker@example.com", customerName: "Al B", fulfillmentType: "PICKUP" };

test("checkout order schema rejects empty and invalid input with friendly messages", () => {
  assert.equal(first({}), "Enter your email address.");
  assert.equal(first({ ...pickup, customerEmail: "" }), "Enter a valid email address.");
  assert.equal(first({ ...pickup, customerEmail: "not-an-email" }), "Enter a valid email address.");
  assert.equal(first({ ...pickup, customerName: "" }), "Enter your name (at least 2 characters).");
  assert.equal(first({ ...pickup, customerName: " A " }), "Enter your name (at least 2 characters).");
  assert.equal(first({ ...pickup, customerName: undefined }), "Enter your name.");
  assert.equal(first({ ...pickup, fulfillmentType: "SHIP" }), "Choose pickup or delivery.");
  assert.equal(first({ ...pickup, fulfillmentType: "DELIVERY", deliveryAddress: "1 Main St" }), "Enter a delivery address and five-digit ZIP code.");
  assert.equal(first({ ...pickup, fulfillmentType: "DELIVERY", deliveryAddress: "  ", deliveryZip: "10001" }), "Enter a delivery address and five-digit ZIP code.");
  assert.equal(first({ ...pickup, fulfillmentType: "DELIVERY", deliveryAddress: "1 Main St", deliveryZip: "123" }), "Enter a delivery address and five-digit ZIP code.");
  for (const message of [first({}), first({ ...pickup, customerName: "A" }), first({ ...pickup, fulfillmentType: "X" })]) assert.doesNotMatch(String(message), /expected|received|Too small|Invalid input/);
});

test("checkout order schema accepts valid pickup and delivery orders", () => {
  const p = orderSchema.parse({ ...pickup, customerEmail: "  baker@example.com " });
  assert.equal(p.customerEmail, "baker@example.com");
  const d = orderSchema.parse({ ...pickup, fulfillmentType: "DELIVERY", deliveryAddress: "1 Main St", deliveryZip: "10001" });
  assert.equal(d.fulfillmentType, "DELIVERY");
});

test("contact schema keeps its field messages for empty and invalid input", () => {
  const r = contactMessageSchema.safeParse({ name: "", email: "x@", message: "short" });
  assert.equal(r.success, false);
  if (r.success) return;
  const fe = r.error.flatten().fieldErrors;
  assert.equal(fe.name?.[0], "Please tell us your name.");
  assert.equal(fe.email?.[0], "Please enter a valid email address.");
  assert.match(String(fe.message?.[0]), /^Please write at least \d+ characters\.$/);
  const ok = contactMessageSchema.parse({ name: "Jo\nX", email: "jo@example.com", message: "Hello there, a real message." });
  assert.equal(ok.name, "Jo X");
  assert.equal(ok.website, "");
});
