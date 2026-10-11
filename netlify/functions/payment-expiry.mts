import { expireAbandonedPayPalOrders } from "../../lib/payment-reconciliation";

// A full window cannot rely on a new checkout POST to release abandoned slots.
// Recheck one expired PayPal order against the provider. This never captures or
// issues a refund. Unknown outcomes retain their inventory for manual review.
const paymentExpiry = async () => {
  try { await expireAbandonedPayPalOrders(1); }
  catch { console.error("Payment expiry awaits a later retry or admin review."); }
};
export default paymentExpiry;
export const config = { schedule: "*/15 * * * *" };
