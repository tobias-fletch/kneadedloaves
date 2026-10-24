// Client-safe delivery pricing copy and tiers. No coordinates or distances live here.
export const FREE_DELIVERY_MAX_MILES = 1;
export const MAX_DELIVERY_MILES = 3;
export const NEAR_DELIVERY_FEE_CENTS = 600;
export const UNVERIFIED_DELIVERY_FEE_CENTS = NEAR_DELIVERY_FEE_CENTS;

export const DELIVERY_FEE_COPY = "Free delivery within 1 mile, $6 up to 3 miles.";
export const OUT_OF_RANGE_MESSAGE = "Sorry, we only deliver within 3 miles \u2014 pickup is available.";
export const FREE_DELIVERY_MESSAGE = "Delivery to this address is free.";
export const NEAR_DELIVERY_MESSAGE = "Delivery to this address is $6.00.";
export const UNVERIFIED_DELIVERY_MESSAGE = "We couldn't verify this address, so a $6.00 delivery fee applies. The bakery will confirm your address before delivery.";
export const DISTANCE_NOT_VERIFIED_ADMIN_NOTE = "Distance not verified \u2014 check address";

/** The only delivery-quote fields that may ever reach a browser. */
export type PublicDeliveryQuote = { feeCents: number | null; inRange: boolean; message: string };

/** Tier pricing by straight-line miles: <=1 free, >1 and <=3 is $6, >3 no delivery. */
export function feeForDistance(miles: number): number | null {
  if (!Number.isFinite(miles) || miles < 0) return null;
  if (miles <= FREE_DELIVERY_MAX_MILES) return 0;
  if (miles <= MAX_DELIVERY_MILES) return NEAR_DELIVERY_FEE_CENTS;
  return null;
}
