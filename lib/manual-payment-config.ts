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
export function paymentReadiness(config: Record<string, string>) {
  const holdMinutes = Number(config.PAYMENT_HOLD_MINUTES);
  const reasons: string[] = [];
  // Launch release (Oct 2026): the deliberate production hard-stop was removed
  // by a separately approved release. The operational gates below still apply.
  if (config.VENMO_CHECKOUT_ENABLED !== "true") reasons.push("Venmo checkout is disabled.");
  if (!/^@[A-Za-z0-9_-]{3,30}$/.test(config.VENMO_HANDLE || "") || !validVenmoDestination(config.VENMO_DESTINATION || "")) reasons.push("A verified Venmo business handle and copied receiving link are required.");
  if (config.VENMO_DESTINATION_VERIFIED !== "true" || config.VENMO_VERIFIED_FINGERPRINT !== destinationFingerprint(config.VENMO_HANDLE || "", config.VENMO_DESTINATION || "")) reasons.push("The owner must verify the current receiving destination.");
  if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 10080) reasons.push("The owner must configure a payment hold deadline (1–10080 minutes).");
  if (config.PAYMENT_WORKERS_READY !== "true") reasons.push("Expiry and email workers must be configured and tested.");
  if (config.CHECKOUT_SMOKE_TESTED !== "true") reasons.push("Checkout testing must be confirmed.");
  if (!["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"].every(key => Boolean(config[key])) || ![465,587,2525].includes(Number(config.SMTP_PORT))) reasons.push("Authenticated TLS email configuration is required.");
  if ((config.JWT_SECRET || "").length < 32 || /development|replace-with|change-me/i.test(config.JWT_SECRET || "")) reasons.push("A strong session secret is required.");
  try { const url = new URL(config.APP_URL); if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) reasons.push("A canonical HTTPS shop URL is required."); } catch { reasons.push("A canonical shop URL is required."); }
  return { ready: reasons.length === 0, reasons, holdMinutes };
}
export async function getManualPaymentConfig(db?: Pick<Prisma.TransactionClient, "appConfig">) {
  const config = await getAppConfigValues([...paymentConfigKeys], db);
  return { ...config, ...paymentReadiness(config) };
}
