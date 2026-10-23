import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { getAppConfigValues } from "@/lib/app-config";

export const paymentConfigKeys = ["VENMO_CHECKOUT_ENABLED", "VENMO_HANDLE", "VENMO_DESTINATION", "VENMO_DESTINATION_VERIFIED", "VENMO_VERIFIED_FINGERPRINT", "PAYMENT_HOLD_MINUTES", "PAYMENT_WORKERS_READY", "CHECKOUT_SMOKE_TESTED", "APP_URL", "JWT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const;
export function destinationFingerprint(handle: string, destination: string) {
  return createHash("sha256").update(JSON.stringify([handle, destination])).digest("hex");
}
export function validVenmoDestination(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["venmo.com", "www.venmo.com", "account.venmo.com"].includes(url.hostname) && !url.username && !url.password && !url.port && url.pathname !== "/"; } catch { return false; }
}
function paymentValues(config: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const key of paymentConfigKeys) {
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
  if (!["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"].every(key => Boolean(values[key])) || ![465,587,2525].includes(Number(values.SMTP_PORT))) reasons.push("Authenticated TLS email configuration is required.");
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
  const config = await getAppConfigValues([...paymentConfigKeys], db);
  return { ...config, ...paymentReadiness(config) };
}
