import { createHash, timingSafeEqual } from "crypto";

export function hasReceiptAccess(token: unknown, receiptTokenHash: string | null) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !receiptTokenHash) return false;
  const digest = createHash("sha256").update(token).digest();
  const expected = Buffer.from(receiptTokenHash, "hex");
  return expected.length === digest.length && timingSafeEqual(expected, digest);
}
export function dollarsToCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) throw new Error("Invalid provider amount.");
  const [dollars, cents] = value.split(".");
  const total = Number(dollars) * 100 + Number(cents);
  if (!Number.isSafeInteger(total)) throw new Error("Invalid provider amount.");
  return total;
}
export function assertPaymentMatches(expected: { id: string; totalCents: number }, actual: { orderId: unknown; amountCents: unknown; currency: unknown }) {
  if (actual.orderId !== expected.id || actual.amountCents !== expected.totalCents || String(actual.currency).toUpperCase() !== "USD") throw new Error("Provider payment does not match the reserved order.");
}
