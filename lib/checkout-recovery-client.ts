// Browser-only data contract: never persist customer details, tokens, or receipt URLs.
export const CHECKOUT_ATTEMPT_STORAGE_KEY = "kneaded-loaves:checkout-attempt:v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ORDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
export type CheckoutAttempt = { idempotencyKey: string; createdAt: number; orderId?: string };
export type CheckoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CheckoutFetcher = (path: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
export class CheckoutStorageError extends Error {
  constructor(message = "Your browser could not access checkout recovery storage. Checkout is paused. Allow this site's session storage and retry. If you already tried checkout, contact the bakery before placing another order.") { super(message); this.name = "CheckoutStorageError"; }
}
export function browserCheckoutStorage(): CheckoutStorage {
  try { return window.sessionStorage; } catch { throw new CheckoutStorageError(); }
}
export function shouldOpenCheckoutRecovery(storage: CheckoutStorage, pathname: string) {
  return !pathname.startsWith("/orders/") && storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) !== null;
}
function validate(value: unknown): CheckoutAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CheckoutStorageError("We could not read your saved checkout. Contact the bakery before placing another order so an earlier attempt is not duplicated.");
  const record = value as Record<string, unknown>;
  if (typeof record.idempotencyKey !== "string" || !UUID.test(record.idempotencyKey) || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0 || (record.orderId !== undefined && (typeof record.orderId !== "string" || !ORDER_ID.test(record.orderId))) || Object.keys(record).some(key => !["idempotencyKey", "createdAt", "orderId"].includes(key))) throw new CheckoutStorageError("We could not read your saved checkout. Contact the bakery before placing another order so an earlier attempt is not duplicated.");
  return { idempotencyKey: record.idempotencyKey, createdAt: record.createdAt as number, ...(record.orderId === undefined ? {} : { orderId: record.orderId as string }) };
}
export function readCheckoutAttempt(storage: CheckoutStorage): CheckoutAttempt | null {
  try { const raw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY); return raw === null ? null : validate(JSON.parse(raw)); }
  catch (error) { if (error instanceof CheckoutStorageError) throw error; throw new CheckoutStorageError(); }
}
export function writeCheckoutAttempt(storage: CheckoutStorage, attempt: CheckoutAttempt) {
  const record = validate(attempt), serialized = JSON.stringify(record);
  try { storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, serialized); if (storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) !== serialized) throw new Error("Storage did not retain the key."); return record; }
  catch { throw new CheckoutStorageError(); }
}
export function prepareCheckoutAttempt(storage: CheckoutStorage, createKey: () => string, now = Date.now()) {
  return writeCheckoutAttempt(storage, readCheckoutAttempt(storage) ?? { idempotencyKey: createKey(), createdAt: now });
}
export function rememberCheckoutOrder(storage: CheckoutStorage, key: string, orderId: string) {
  const current = readCheckoutAttempt(storage);
  if (!current || current.idempotencyKey !== key || !ORDER_ID.test(orderId) || (current.orderId && current.orderId !== orderId)) throw new Error("Your saved checkout changed. Check your existing order before trying again.");
  try { return writeCheckoutAttempt(storage, { ...current, orderId }); }
  catch { throw new CheckoutStorageError("Your order was found, but your browser could not save its recovery details. Do not place another order. Retry the saved-checkout check or contact the bakery."); }
}
export function clearCheckoutAttemptForOrder(storage: CheckoutStorage, orderId: string) {
  const current = readCheckoutAttempt(storage);
  if (!current || current.orderId !== orderId) return false;
  try { storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY); if (storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) !== null) throw new Error("Not cleared"); return true; }
  catch { throw new CheckoutStorageError("Your order is saved, but this browser could not finish resetting checkout."); }
}
export function receiptDestination(value: unknown, orderId: unknown) {
  if (typeof value !== "string" || typeof orderId !== "string" || !ORDER_ID.test(orderId) || !value.startsWith("/") || value.startsWith("//")) throw new Error("The order receipt could not be opened safely. Check your saved checkout before trying again.");
  const parsed = new URL(value, "https://checkout.invalid"), query = [...parsed.searchParams.entries()];
  if (parsed.origin !== "https://checkout.invalid" || parsed.pathname !== `/orders/${orderId}` || parsed.hash || (query.length > 0 && (query.length !== 1 || query[0][0] !== "token" || !/^[a-f0-9]{64}$/.test(query[0][1])))) throw new Error("The order receipt could not be opened safely. Check your saved checkout before trying again.");
  return `${parsed.pathname}${parsed.search}`;
}
export async function recoverCheckoutAttempt(storage: CheckoutStorage, fetcher: CheckoutFetcher): Promise<{ state: "empty" } | { state: "not-found"; attempt: CheckoutAttempt } | { state: "found"; attempt: CheckoutAttempt; url: string }> {
  const attempt = readCheckoutAttempt(storage);
  if (!attempt) return { state: "empty" };
  const response = await fetcher("/api/checkout/recover", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: attempt.idempotencyKey }) });
  if (response.status === 404) return { state: "not-found", attempt };
  const body = await response.json() as { orderId?: unknown; url?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Your saved checkout could not be checked. Retry the check before placing another order.");
  const url = receiptDestination(body?.url, body?.orderId);
  return { state: "found", attempt: rememberCheckoutOrder(storage, attempt.idempotencyKey, body.orderId as string), url };
}
