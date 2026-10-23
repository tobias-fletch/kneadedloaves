/** Public pickup label. No street address is on file; 11217 covers several Brooklyn neighborhoods. */
export const PICKUP_AREA = "Brooklyn, NY 11217";

export function describePickup(location: { name: string; address?: string | null }) {
  const raw = location.address?.trim() || "";
  const address = !raw || /123 Oven Lane/i.test(raw) ? PICKUP_AREA : raw.includes("11217") ? raw : `${raw}, ${PICKUP_AREA}`;
  return { name: location.name, address, text: `${location.name}\n${address}` };
}
