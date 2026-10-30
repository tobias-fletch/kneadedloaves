import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { getAppConfigValues } from "@/lib/app-config";
import { resendConfigured } from "@/lib/mail-provider";

export const paymentConfigKeys = ["VENMO_CHECKOUT_ENABLED", "VENMO_HANDLE", "VENMO_DESTINATION", "VENMO_DESTINATION_VERIFIED", "VENMO_VERIFIED_FINGERPRINT", "PAYMENT_HOLD_MINUTES", "PAYMENT_WORKERS_READY", "CHECKOUT_SMOKE_TESTED", "APP_URL", "JWT_SECRET"] as const;
/**
 * Not a stored setting: "true" when RESEND_API_KEY is set in the environment, "" otherwise.
 * Added by withEmailStatus so readiness checks stay pure and never see the key itself.
 */
export const EMAIL_STATUS_KEY = "RESEND_CONFIGURED";
export function withEmailStatus<T extends Record<string, unknown>>(config: T, env: Record<string, string | undefined> = process.env) {
  return { ...config, [EMAIL_STATUS_KEY]: resendConfigured(env) ? "true" : "" };
}
export function destinationFingerprint(handle: string, destination: string) {
  return createHash("sha256").update(JSON.stringify([handle, destination])).digest("hex");
}
export function validVenmoDestination(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["venmo.com", "www.venmo.com", "account.venmo.com"].includes(url.hostname) && !url.username && !url.password && !url.port && url.pathname !== "/"; } catch { return false; }
}
function paymentValues(config: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const key of [...paymentConfigKeys, EMAIL_STATUS_KEY]) {
    const value = config[key];
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
export function paymentReadiness(config: Record<string, unknown>, options?: { ignoreLaunchGates?: boolean }) {
  const values = paymentValues(config);
  const holdMinutes = Number(values.PAYMENT_HOLD_MINUTES);
  const ignoreLaunchGates = options?.ignoreLaunchGates === true;
  const reasons: string[] = [];
  // Launch release (Oct 2026): the deliberate production hard-stop was removed
  // by a separately approved release. The operational gates below still apply.
  // Admin test checkout may ignore only the three launch flags below.
  if (!ignoreLaunchGates && values.VENMO_CHECKOUT_ENABLED !== "true") reasons.push("Venmo checkout is disabled.");
  if (!/^@[A-Za-z0-9_-]{3,30}$/.test(values.VENMO_HANDLE || "") || !validVenmoDestination(values.VENMO_DESTINATION || "")) reasons.push("A verified Venmo business handle and copied receiving link are required.");
  if (values.VENMO_DESTINATION_VERIFIED !== "true" || values.VENMO_VERIFIED_FINGERPRINT !== destinationFingerprint(values.VENMO_HANDLE || "", values.VENMO_DESTINATION || "")) reasons.push("The owner must verify the current receiving destination.");
  if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 10080) reasons.push("The owner must configure a payment hold deadline (1–10080 minutes).");
  if (!ignoreLaunchGates && values.PAYMENT_WORKERS_READY !== "true") reasons.push("Expiry and email workers must be configured and tested.");
  if (!ignoreLaunchGates && values.CHECKOUT_SMOKE_TESTED !== "true") reasons.push("Checkout testing must be confirmed.");
  if (values[EMAIL_STATUS_KEY] !== "true") reasons.push("Site email (Resend) must be configured: set RESEND_API_KEY.");
  if ((values.JWT_SECRET || "").length < 32 || /development|replace-with|change-me/i.test(values.JWT_SECRET || "")) reasons.push("A strong session secret is required.");
  try { const url = new URL(values.APP_URL); if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) reasons.push("A canonical HTTPS shop URL is required."); } catch { reasons.push("A canonical shop URL is required."); }
  return { ready: reasons.length === 0, reasons, holdMinutes };
}
/** True only for a server-resolved ADMIN session. Never a query param, cookie, or env toggle. */
export function adminCheckoutReadiness(config: Record<string, unknown>, isAdmin: boolean) {
  return paymentReadiness(config, { ignoreLaunchGates: isAdmin === true });
}
/** An order is an admin test only when public checkout is closed and the admin bypass is what made it ready. */
export function isAdminTestOrder(config: Record<string, unknown>, isAdmin: boolean) {
  return isAdmin === true && adminCheckoutReadiness(config, true).ready && !paymentReadiness(config).ready;
}
export async function getManualPaymentConfig(db?: Pick<Prisma.TransactionClient, "appConfig">) {
  const config = withEmailStatus(await getAppConfigValues([...paymentConfigKeys], db));
  return { ...config, ...paymentReadiness(config) };
}
