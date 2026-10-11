import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { getAppConfigValue } from "@/lib/app-config";
import { getStripe } from "@/lib/stripe";
import { paypalRequest, PayPalOrder } from "@/lib/paypal";
import { decryptSecret } from "@/lib/secrets";
import { lockOrder } from "@/lib/payment-state";

export async function receiptTokenFor(id: string, secret?: string) {
  const key = secret || await getAppConfigValue("JWT_SECRET");
  if (key.length < 32) throw new Error("Session configuration is required.");
  return createHmac("sha256", key).update(`kneaded-loaves:receipt:v1:${id}`).digest("hex");
}
export async function createProviderCheckout(id: string) {
  return prisma.$transaction(async tx => {
    const order = await lockOrder(tx, id);
    if (!order.providerRequest) throw new Error("Missing original provider request; review this order.");
    const saved = JSON.parse(decryptSecret(order.providerRequest)) as { receiptPath: string; stripe?: import("stripe").default.Checkout.SessionCreateParams; paypal?: Record<string, unknown> };
    const receiptPath = saved.receiptPath;
    if (order.paymentState !== "PENDING" && !(order.paymentState === "REVIEW" && order.paymentReviewReason === "CREATION_UNKNOWN" && !order.providerPaymentId)) return { url: receiptPath, orderId: id };
    if (order.paymentUrl) return { url: order.paymentUrl, orderId: id };
    // Missing reservation metadata requires explicit recovery.
    if (!order.reservationExpiresAt) throw new Error("This checkout needs review before retrying.");
    // Stripe keeps an idempotent result for at least 24 hours. Replay the exact
    // original expires_at for at most 23 hours, even when it is now in the past.
    // PayPal approval creation is only retried during its local reservation.
    if ((order.paymentProvider === "STRIPE" && Date.now() - order.createdAt.getTime() >= 23 * 3600000) || (order.paymentProvider === "PAYPAL" && order.reservationExpiresAt <= new Date())) throw new Error("This checkout needs review before retrying. Please contact the bakery.");
    if (order.paymentProvider === "STRIPE") {
      const stripe = await getStripe();
      if (!stripe) throw new Error("Stripe is unavailable.");
      if (!saved.stripe) throw new Error("Missing original Stripe request.");
      // Validation errors after an earlier timeout are still ambiguous. Keep
      // the reservation until canonical provider recovery, never infer absence.
      const checkout = await stripe.checkout.sessions.create(saved.stripe, { idempotencyKey: `bakery-create-${id}` });
      if (!checkout.url || !checkout.url.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe did not return a valid checkout.");
      await tx.order.update({ where: { id }, data: { stripeCheckoutSessionId: checkout.id, paymentUrl: checkout.url, paymentState: "PENDING", paymentReviewReason: null } });
      return { url: checkout.url, orderId: id };
    }
    if (order.paymentProvider === "PAYPAL") {
      if (!saved.paypal) throw new Error("Missing original PayPal request.");
      const checkout = await paypalRequest<PayPalOrder>("/v2/checkout/orders", "POST", saved.paypal, `create-${id}`);
      const url = checkout.links?.find(link => ["payer-action", "approve"].includes(link.rel))?.href;
      const allowed = new Set(["www.paypal.com", "www.sandbox.paypal.com"]);
      if (!url || new URL(url).protocol !== "https:" || !allowed.has(new URL(url).hostname)) throw new Error("PayPal did not return a valid checkout.");
      await tx.order.update({ where: { id }, data: { paypalOrderId: checkout.id, paymentUrl: url, paymentState: "PENDING", paymentReviewReason: null } });
      return { url, orderId: id };
    }
    throw new Error("Payment provider is unavailable.");
  }, { timeout: 40000 });
}
