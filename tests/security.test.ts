import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { cartOwner, acceptsOrders } from "../lib/order-rules";
import { cartMutationSchema, orderSchema } from "../lib/validation";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { sanitizeImage } from "../lib/images";
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
  const input = { customerName: "Test Customer", customerEmail: "test@example.com", orderWindowId: "window", checkoutKey: "12345678-1234-4234-8234-123456789abc", paymentProvider: "STRIPE" };
  assert.equal(orderSchema.safeParse({ ...input, fulfillmentType: "DELIVERY" }).success, false);
  assert.equal(orderSchema.safeParse({ ...input, fulfillmentType: "PICKUP" }).success, true);
});
test("manual opening cannot bypass closure or capacity", () => {
  const window = { manualClosed: false, manualOpen: true, opensAt: new Date("2026-10-13T14:00:00Z"), closesAt: new Date("2026-10-15T22:00:00Z"), fulfillmentDate: new Date("2026-10-17T14:00:00Z"), maxOrders: 1 };
  const now = new Date("2026-10-14T14:00:00Z");
  assert.equal(acceptsOrders(window, 0, now), true);
  assert.equal(acceptsOrders(window, 1, now), false);
  assert.equal(acceptsOrders({ ...window, manualClosed: true }, 0, now), false);
});
test("secret encryption authenticates ciphertext and uses a unique nonce", () => {
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const a = encryptSecret("private-value"), b = encryptSecret("private-value");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "private-value");
  const pieces = a.split(":"); pieces[3] = "00".repeat(16);
  assert.throws(() => decryptSecret(pieces.join(":")));
});
test("uploaded bytes are decoded and re-encoded, not trusted by filename or MIME", async () => {
  await assert.rejects(sanitizeImage(Buffer.from("<script>alert(1)</script>")));
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const result = await sanitizeImage(png);
  assert.equal((await sharp(result).metadata()).format, "webp");
});
test("malformed, non-object and oversized JSON cannot reach handlers as valid input", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify({ message: "x".repeat(65537) })]) {
    assert.deepEqual(await readJson(new Request("http://localhost", { method: "POST", body })), {});
  }
});
