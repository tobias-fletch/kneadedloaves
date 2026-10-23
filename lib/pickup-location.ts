/** Public pickup location at S Portland Ave & Atlantic Ave. */
export const PICKUP_AREA = "S Portland Ave & Atlantic Ave, Brooklyn, NY 11217";

const ZIP_ONLY = /^brooklyn,\s*ny\s*11217$/i;

export function describePickup(location: { name: string; address?: string | null }) {
  const raw = location.address?.trim() || "";
  const placeholder = !raw || /123 Oven Lane/i.test(raw) || ZIP_ONLY.test(raw);
  const address = placeholder ? PICKUP_AREA : raw.includes("11217") ? raw : `${raw}, ${PICKUP_AREA}`;
  return { name: location.name, address, text: `${location.name}\n${address}` };
}
