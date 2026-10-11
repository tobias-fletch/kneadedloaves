import { decryptSecret } from "@/lib/secrets";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const setupConfigFields = [
  { key: "APP_URL", label: "Public shop URL", group: "Launch", secret: false },
  { key: "JWT_SECRET", label: "Session secret", group: "Launch", secret: true },
  { key: "CHECKOUT_SMOKE_TESTED", label: "Customer checkout smoke tested", group: "Launch", secret: false, input: "checkbox", optional: true },
  { key: "CHECKOUT_ENABLED", label: "Enable checkout after launch checks", group: "Launch", secret: false, input: "checkbox", optional: true },
  { key: "OPERATIONS_CONFIRMED", label: "Menu, ingredients, taxes, ZIPs, fees, capacity and fulfillment times reviewed", group: "Launch", secret: false, input: "checkbox", optional: true },
  { key: "TAX_RATE_BPS", label: "Confirmed flat tax rate in basis points (0 means no tax)", group: "Launch", secret: false },
  { key: "TAX_DELIVERY_FEE", label: "Tax delivery fee: enter true or false", group: "Launch", secret: false },
  { key: "STRIPE_ENABLED", label: "Enable Stripe", group: "Payments", secret: false, input: "checkbox", optional: true },
  { key: "PAYPAL_ENABLED", label: "Enable PayPal", group: "Payments", secret: false, input: "checkbox", optional: true },
  { key: "PAYPAL_SANDBOX", label: "PayPal sandbox (development only)", group: "Payments", secret: false, input: "checkbox", optional: true },
  { key: "PAYPAL_CLIENT_ID", label: "PayPal client ID", group: "Payments", secret: true },
  { key: "PAYPAL_CLIENT_SECRET", label: "PayPal client secret", group: "Payments", secret: true },
  { key: "PAYPAL_WEBHOOK_ID", label: "PayPal webhook ID", group: "Payments", secret: false },
  { key: "STRIPE_TEST_MODE", label: "Stripe test mode", group: "Payments", secret: false, input: "checkbox", optional: true },
  { key: "STRIPE_SECRET_KEY", label: "Stripe secret key", group: "Payments", secret: true },
  { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe webhook secret", group: "Payments", secret: true },
  { key: "EMAIL_FROM", label: "From email", group: "Email", secret: false },
  { key: "SMTP_HOST", label: "SMTP host", group: "Email", secret: false },
  { key: "SMTP_PORT", label: "SMTP port", group: "Email", secret: false },
  { key: "SMTP_USER", label: "SMTP username", group: "Email", secret: true },
  { key: "SMTP_PASSWORD", label: "SMTP password", group: "Email", secret: true },
  { key: "EMAIL_PICKUP_SUBJECT", label: "Pickup email subject", group: "Email", secret: false, optional: true },
  { key: "EMAIL_PICKUP_BODY", label: "Pickup email body", group: "Email", secret: false, optional: true },
  { key: "EMAIL_DELIVERY_SUBJECT", label: "Delivery email subject", group: "Email", secret: false, optional: true },
  { key: "EMAIL_DELIVERY_BODY", label: "Delivery email body", group: "Email", secret: false, optional: true },
  { key: "INSTAGRAM_GRAPH_TOKEN", label: "Instagram Graph token", group: "Social", secret: true },
  { key: "FACEBOOK_PAGE_TOKEN", label: "Facebook page token", group: "Social", secret: true },
  { key: "TIKTOK_CLIENT_KEY", label: "TikTok client key", group: "Social", secret: true },
  { key: "TIKTOK_CLIENT_SECRET", label: "TikTok client secret", group: "Social", secret: true },
  { key: "YOUTUBE_CLIENT_ID", label: "YouTube client ID", group: "Social", secret: true },
  { key: "YOUTUBE_CLIENT_SECRET", label: "YouTube client secret", group: "Social", secret: true }
] as const;

export type SetupConfigKey = (typeof setupConfigFields)[number]["key"];

export const setupConfigKeys = setupConfigFields.map((field) => field.key);

export function isSetupConfigKey(key: string): key is SetupConfigKey {
  return setupConfigKeys.includes(key as SetupConfigKey);
}

export async function getAppConfigValue(key: SetupConfigKey) {
  if (process.env[key]?.trim()) return process.env[key]!.trim();
  const saved = await prisma.appConfig.findUnique({ where: { key } }).catch(() => null);
  return saved?.value ? (saved.secret ? decryptSecret(saved.value) : saved.value).trim() : "";
}

export async function getAppConfigValues(keys: SetupConfigKey[], db: Prisma.TransactionClient = prisma) {
  if (keys.every(key => process.env[key]?.trim())) return Object.fromEntries(keys.map(key => [key, process.env[key]!.trim()])) as Record<SetupConfigKey, string>;
  const saved = await db.appConfig.findMany({ where: { key: { in: keys } } }).catch(() => []);
  const savedByKey = new Map(saved.map((item) => [item.key, item.secret && !process.env[item.key]?.trim() ? decryptSecret(item.value) : item.value]));
  return Object.fromEntries(keys.map((key) => [key, process.env[key]?.trim() || savedByKey.get(key)?.trim() || ""])) as Record<
    SetupConfigKey,
    string
  >;
}

export async function getSetupConfigSummary() {
  const saved = await prisma.appConfig.findMany({ where: { key: { in: [...setupConfigKeys] } } }).catch(() => []);
  const savedByKey = new Map(saved.map((item) => [item.key, item]));

  return setupConfigFields.map((field) => {
    const savedItem = savedByKey.get(field.key);
    const envValue = process.env[field.key]?.trim() || "";
    const savedValue = savedItem?.value?.trim() || "";
    const value = envValue || savedValue;
    return {
      ...field,
      configured: "optional" in field && field.optional ? true : Boolean(value),
      savedInAdmin: Boolean(savedValue),
      envConfigured: Boolean(envValue),
      value: field.secret ? "" : value
    };
  });
}
