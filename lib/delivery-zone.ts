export const FREE_DELIVERY_ZIP = "11217";
export const DELIVERY_ZONE_INACTIVE_MESSAGE = "Choose an active delivery zone covering your ZIP code.";
export const DELIVERY_ONLY_11217_MESSAGE = "Delivery is only available in ZIP 11217.";

type DeliveryZoneCoverage = { active: boolean; zipCodes: string[] } | null | undefined;

/** An inactive zone covers nothing, including a zone whose zipCodes array is empty. */
export function deliveryCoverageError(zone: DeliveryZoneCoverage, zip: string) {
  if (!zone?.active) return DELIVERY_ZONE_INACTIVE_MESSAGE;
  if (zone.zipCodes.length === 0 || zone.zipCodes.includes(zip)) return null;
  if (zone.zipCodes.length === 1 && zone.zipCodes[0] === FREE_DELIVERY_ZIP) return DELIVERY_ONLY_11217_MESSAGE;
  return DELIVERY_ZONE_INACTIVE_MESSAGE;
}
