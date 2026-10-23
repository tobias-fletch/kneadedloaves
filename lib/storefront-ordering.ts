import { getContactDetails, type ContactDetails } from "@/lib/contact";
import { getManualPaymentConfig } from "@/lib/manual-payment-config";
import { expireUnpaidOrders } from "@/lib/manual-payments";
import { orderingAvailability } from "@/lib/ordering-status";
import { getCurrentOrderWindow } from "@/lib/order-window";

export async function getStorefrontOrderingState() {
  await expireUnpaidOrders().catch(() => {
    console.error("Could not expire overdue reservations before showing ordering status.");
  });
  const [{ openWindow, nextWindow }, payment, contact] = await Promise.all([
    getCurrentOrderWindow(),
    getManualPaymentConfig(),
    getContactDetails()
  ]);
  const availability = orderingAvailability(Boolean(openWindow), payment.ready);
  return { openWindow, nextWindow, checkoutReady: payment.ready, contact: contact satisfies ContactDetails, ...availability };
}
