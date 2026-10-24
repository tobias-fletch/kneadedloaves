import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { cartOwner, acceptsOrders } from "../lib/order-rules";
import { cartMutationSchema, orderSchema } from "../lib/validation";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { readJson } from "../lib/request";

test("missing and malformed guest identities cannot produce an unfiltered cart query", () => {
  assert.equal(cartOwner(), null);
  assert.equal(cartOwner(undefined, "bad-cookie"), null);
  assert.deepEqual(cartOwner("customer", "other-cart"), { userId: "customer" });
});
test("cart quantities reject fractions, strings, negative values and non-finite numbers", () => {
  for (const quantity of [-1, 0.5, NaN, Infinity, "2", 1001]) assert.equal(cartMutationSchema.safeParse({ productId: "product", quantity }).success, false);
  assert.equal(cartMutationSchema.safeParse({ productId: "product", quantity: 2 }).success, true);
});
test("delivery requires address and ZIP while pickup does not", () => {
  const input = { customerName: "Test Customer", customerEmail: "test@example.com" };
  assert.equal(orderSchema.safeParse({ ...input, fulfillmentType: "DELIVERY" }).success, false);
  assert.equal(orderSchema.safeParse({ ...input, fulfillmentType: "PICKUP" }).success, true);
});
test("manual opening cannot bypass closure or capacity", () => {
  const window = { manualClosed: false, manualOpen: true, opensAt: new Date(0), closesAt: new Date(0), maxOrders: 1 };
  assert.equal(acceptsOrders(window, 0), true);
  assert.equal(acceptsOrders(window, 1), false);
  assert.equal(acceptsOrders({ ...window, manualClosed: true }, 0), false);
});
test("secret encryption authenticates ciphertext and uses a unique nonce", () => {
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const a = encryptSecret("private-value"), b = encryptSecret("private-value");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "private-value");
  const pieces = a.split(":"); pieces[3] = "00".repeat(16);
  assert.throws(() => decryptSecret(pieces.join(":")));
});
test("malformed, non-object and oversized JSON cannot reach handlers as valid input", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify({ message: "x".repeat(65537) })]) {
    assert.deepEqual(await readJson(new Request("http://localhost", { method: "POST", body })), {});
  }
});
