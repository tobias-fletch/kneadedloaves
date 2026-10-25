import { getContactDetails, type ContactDetails } from "@/lib/contact";
import { adminCheckoutReadiness, getManualPaymentConfig, paymentReadiness } from "@/lib/manual-payment-config";
import { expireUnpaidOrders } from "@/lib/manual-payments";
import { orderingAvailability } from "@/lib/ordering-status";
import { getCurrentOrderWindow } from "@/lib/order-window";

export function storefrontCheckoutAccess(config: Record<string, unknown>, isAdmin = false) {
  const publicReadiness = paymentReadiness(config);
  const admin = adminCheckoutReadiness(config, isAdmin);
  return {
    checkoutReady: admin.ready,
    publicCheckoutReady: publicReadiness.ready,
    adminTestMode: isAdmin && !publicReadiness.ready && admin.ready,
    adminSetupReasons: isAdmin && !admin.ready ? admin.reasons : []
  };
}

export async function getStorefrontOrderingState(isAdmin = false) {
  await expireUnpaidOrders().catch(() => {
    console.error("Could not expire overdue reservations before showing ordering status.");
  });
  const [{ openWindow, nextWindow, weekly }, payment, contact] = await Promise.all([
    getCurrentOrderWindow(),
    getManualPaymentConfig(),
    getContactDetails()
  ]);
  const access = storefrontCheckoutAccess(payment, isAdmin);
  const availability = orderingAvailability(Boolean(openWindow), access.checkoutReady);
  return {
    openWindow,
    nextWindow,
    weekly,
    checkoutReady: access.checkoutReady,
    publicCheckoutReady: access.publicCheckoutReady,
    adminTestMode: access.adminTestMode,
    adminSetupReasons: access.adminSetupReasons,
    contact: contact satisfies ContactDetails,
    ...availability
  };
}
