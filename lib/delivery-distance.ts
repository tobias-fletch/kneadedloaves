// Server-only distance pricing. The bakery origin comes from the server-only
// KL_ORIGIN_LATLNG env var ("lat,lng"). Never import this from a client
// component, and never return origin coordinates or distances to a browser.
import {
  feeForDistance, FREE_DELIVERY_MESSAGE, NEAR_DELIVERY_MESSAGE, OUT_OF_RANGE_MESSAGE,
  UNVERIFIED_DELIVERY_FEE_CENTS, UNVERIFIED_DELIVERY_MESSAGE, type PublicDeliveryQuote
} from "./delivery-pricing";

export type LatLng = { lat: number; lng: number };
export type Geocoder = (oneLineAddress: string) => Promise<LatLng | null>;
/** Internal quote. distanceMiles and verified are for the order record and /admin only. */
export type DeliveryQuote = PublicDeliveryQuote & { verified: boolean; distanceMiles: number | null };

export const CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const CENSUS_BENCHMARK = "Public_AR_Current";
export const GEOCODE_TIMEOUT_MS = 5000;
const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a: LatLng, b: LatLng) {
  const rad = (deg: number) => deg * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseLatLng(raw: string | undefined | null): LatLng | null {
  const parts = raw?.trim().split(",").map(part => Number(part.trim()));
  if (!parts || parts.length !== 2 || parts.some(value => !Number.isFinite(value))) return null;
  const [lat, lng] = parts;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function originFromEnv(env: Record<string, string | undefined> = process.env) {
  return parseLatLng(env.KL_ORIGIN_LATLNG);
}

export function oneLineAddress(address: string, zip: string) {
  return `${address.replace(/\s*[\r\n]+\s*/g, ", ").replace(/\s+/g, " ").trim()}, ${zip.trim()}`.slice(0, 300);
}

/** US Census Bureau geocoder (free, no key). Resolves null on no match, error, or timeout. */
export function censusGeocoder(fetchImpl: typeof fetch = fetch, timeoutMs = GEOCODE_TIMEOUT_MS): Geocoder {
  return async (line) => {
    const url = `${CENSUS_GEOCODER_URL}?${new URLSearchParams({ address: line, benchmark: CENSUS_BENCHMARK, format: "json" })}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const body = await response.json() as { result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] } };
      const coordinates = body?.result?.addressMatches?.[0]?.coordinates;
      const lat = Number(coordinates?.y), lng = Number(coordinates?.x);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  };
}

const cache = new Map<string, { at: number; value: LatLng | null }>();
const CACHE_MS = 10 * 60 * 1000;
/** Short in-memory cache so a quote and the following checkout do not geocode twice. Failures are not cached. */
export function cachedGeocoder(inner: Geocoder): Geocoder {
  return async (line) => {
    const key = line.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await inner(line);
    if (value) {
      if (cache.size > 500) cache.clear();
      cache.set(key, { at: Date.now(), value });
    }
    return value;
  };
}

const unverified = (): DeliveryQuote => ({ feeCents: UNVERIFIED_DELIVERY_FEE_CENTS, inRange: true, message: UNVERIFIED_DELIVERY_MESSAGE, verified: false, distanceMiles: null });

/**
 * Prices delivery by straight-line distance. A missing origin or a failed/timed-out
 * geocode is charged $6, allowed to proceed, and marked unverified for /admin.
 */
export async function quoteDelivery(address: string, zip: string, deps: { origin: LatLng | null; geocode: Geocoder }): Promise<DeliveryQuote> {
  if (!deps.origin) {
    console.error("Delivery origin is not configured; quoting the unverified delivery fee.");
    return unverified();
  }
  let point: LatLng | null = null;
  try { point = await deps.geocode(oneLineAddress(address, zip)); } catch { point = null; }
  if (!point) {
    console.error("Delivery address could not be geocoded; quoting the unverified delivery fee.");
    return unverified();
  }
  const distanceMiles = haversineMiles(deps.origin, point);
  const feeCents = feeForDistance(distanceMiles);
  if (feeCents === null) return { feeCents: null, inRange: false, message: OUT_OF_RANGE_MESSAGE, verified: true, distanceMiles };
  return { feeCents, inRange: true, message: feeCents === 0 ? FREE_DELIVERY_MESSAGE : NEAR_DELIVERY_MESSAGE, verified: true, distanceMiles };
}

/** Strips everything except fee, in-range flag, and message. Use for every browser response. */
export function publicQuote(quote: DeliveryQuote): PublicDeliveryQuote {
  return { feeCents: quote.feeCents, inRange: quote.inRange, message: quote.message };
}

export function defaultDeliveryDeps() {
  return { origin: originFromEnv(), geocode: cachedGeocoder(censusGeocoder()) };
}

/** Request-body handling for /api/delivery-quote, separated for tests. */
export async function handleDeliveryQuote(body: Record<string, unknown>, deps: { origin: LatLng | null; geocode: Geocoder }): Promise<{ status: number; body: PublicDeliveryQuote | { error: string } }> {
  const address = typeof body.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  const zip = typeof body.deliveryZip === "string" ? body.deliveryZip.trim() : "";
  if (!address || address.length > 500 || !/^\d{5}$/.test(zip)) return { status: 400, body: { error: "Enter a delivery address and five-digit ZIP code." } };
  return { status: 200, body: publicQuote(await quoteDelivery(address, zip, deps)) };
}
