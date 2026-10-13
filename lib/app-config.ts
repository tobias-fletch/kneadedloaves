import type { Prisma } from "@prisma/client";
import { decryptSecret } from "@/lib/secrets";
import { prisma } from "@/lib/prisma";

export const setupConfigFields = [
  { key: "VENMO_CHECKOUT_ENABLED", label: "Enable manual Venmo checkout", group: "Manual Venmo", secret: false, input: "checkbox", optional: true },
  { key: "VENMO_HANDLE", label: "Venmo business handle", group: "Manual Venmo", secret: false, optional: true },
  { key: "VENMO_DESTINATION", label: "Copied Venmo receiving link", group: "Manual Venmo", secret: false, optional: true },
  { key: "VENMO_DESTINATION_VERIFIED", label: "Owner checked receiving destination", group: "Manual Venmo", secret: false, input: "checkbox", optional: true },
  { key: "PAYMENT_HOLD_MINUTES", label: "Owner-selected payment hold (minutes)", group: "Manual Venmo", secret: false, optional: true },
  { key: "PAYMENT_WORKERS_READY", label: "Deployed email and expiry workers tested", group: "Manual Venmo", secret: false, input: "checkbox", optional: true },
  { key: "APP_URL", label: "Public shop URL", group: "Launch", secret: false },
  { key: "JWT_SECRET", label: "Session secret", group: "Launch", secret: true },
  { key: "CHECKOUT_SMOKE_TESTED", label: "Customer checkout smoke tested", group: "Launch", secret: false, input: "checkbox", optional: true },
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
  const saved = await prisma.appConfig.findUnique({ where: { key } }).catch(() => null);
  if (process.env[key]?.trim()) return process.env[key]!.trim();
  return saved?.value ? (saved.secret ? decryptSecret(saved.value) : saved.value).trim() : "";
}

export async function getAppConfigValues(keys: (SetupConfigKey | "VENMO_VERIFIED_FINGERPRINT")[], db: Pick<Prisma.TransactionClient, "appConfig"> = prisma) {
  const saved = await db.appConfig.findMany({ where: { key: { in: keys } } });
  const savedByKey = new Map(saved.map((item) => [item.key, item.secret && !process.env[item.key]?.trim() ? decryptSecret(item.value) : item.value]));
  return Object.fromEntries(keys.map((key) => [key, process.env[key]?.trim() || savedByKey.get(key)?.trim() || ""])) as Record<
    SetupConfigKey | "VENMO_VERIFIED_FINGERPRINT",
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
