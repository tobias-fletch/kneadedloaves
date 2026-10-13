import { createHash, createHmac } from "crypto";
import type { Order, Prisma } from "@prisma/client";
import { cartOwner } from "@/lib/order-rules";

export const validCheckoutKey = (key: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key);
export const checkoutDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function checkoutOwners(userId?: string, guestSessionId?: string) {
  return [cartOwner(userId), cartOwner(undefined, guestSessionId)].filter((owner): owner is NonNullable<typeof owner> => Boolean(owner));
}
export type CheckoutOwner = ReturnType<typeof checkoutOwners>[number];
export const checkoutOwnerHash = (owner: CheckoutOwner, key: string) => checkoutDigest(`${JSON.stringify(owner)}:${key.toLowerCase()}`);
export const checkoutRequestHash = (key: string) => checkoutDigest(`checkout-request:${key.toLowerCase()}`);
export async function lockCheckoutRequest(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout-request:${checkoutRequestHash(key)}`}))`;
}
export async function receiptForOwnedAttempt(tx: Prisma.TransactionClient, order: Order, key: string, owners: CheckoutOwner[], secret: string) {
  if (!order.checkoutKeyHash || !owners.some(owner => checkoutOwnerHash(owner, key) === order.checkoutKeyHash)) throw new Error("Checkout recovery is unavailable for this browser or account.");
  if (secret.length < 32 || /development|replace-with|change-me/i.test(secret)) throw new Error("Checkout recovery is temporarily unavailable.");
  const token = createHmac("sha256", secret).update(`receipt:${order.checkoutKeyHash}`).digest("hex");
  const tokenHash = checkoutDigest(token);
  // Both the opaque attempt key and its authenticated owner/cookie are required.
  // After a server secret rotation they can safely recover a new private link.
  if (order.receiptTokenHash !== tokenHash) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${order.id}`}))`;
    await tx.order.update({ where: { id: order.id }, data: { receiptTokenHash: tokenHash } });
  }
  return { orderId: order.id, url: `/orders/${order.id}?token=${token}` };
}
