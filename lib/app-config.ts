import type { Prisma } from "@prisma/client";
import { UNDECRYPTABLE_SETTING_MESSAGE } from "@/lib/config-messages";
import { configEncryptionKeyStatus, decryptSecret } from "@/lib/secrets";
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
  { key: "EMAIL_PICKUP_SUBJECT", label: "Pickup email subject", group: "Email", secret: false, optional: true },
  { key: "EMAIL_PICKUP_BODY", label: "Pickup email body", group: "Email", secret: false, optional: true },
  { key: "EMAIL_DELIVERY_SUBJECT", label: "Delivery email subject", group: "Email", secret: false, optional: true },
  { key: "EMAIL_DELIVERY_BODY", label: "Delivery email body", group: "Email", secret: false, optional: true }
] as const;

export type SetupConfigKey = (typeof setupConfigFields)[number]["key"];

/**
 * Legacy pickup/delivery email templates. Nothing reads them: customer emails use the
 * built-in text in lib/order-email.ts. They stay valid keys (so saved rows and the save
 * API are untouched) but are hidden from /admin/setup so they are never shown as missing.
 */
export const legacyUnusedSetupKeys: readonly SetupConfigKey[] = ["EMAIL_PICKUP_SUBJECT", "EMAIL_PICKUP_BODY", "EMAIL_DELIVERY_SUBJECT", "EMAIL_DELIVERY_BODY"];

export function isLegacyUnusedSetupKey(key: string) {
  return (legacyUnusedSetupKeys as readonly string[]).includes(key);
}

export const setupConfigKeys = setupConfigFields.map((field) => field.key);

export function isSetupConfigKey(key: string): key is SetupConfigKey {
  return setupConfigKeys.includes(key as SetupConfigKey);
}

type StoredConfig = { value: string; secret: boolean };

export function readStoredConfig(key: string, stored: StoredConfig | undefined) {
  const envValue = process.env[key]?.trim() || "";
  if (envValue) return { value: envValue, undecryptable: false };
  const raw = stored?.value?.trim() || "";
  if (!raw || !stored?.secret) return { value: raw, undecryptable: false };
  try {
    return { value: decryptSecret(raw).trim(), undecryptable: false };
  } catch {
    console.warn(`Stored setting ${key} can't be decrypted. ${UNDECRYPTABLE_SETTING_MESSAGE} The CONFIG_ENCRYPTION_KEY may have been rotated.`);
    return { value: "", undecryptable: true };
  }
}

export async function readAppConfig(keys: (SetupConfigKey | "VENMO_VERIFIED_FINGERPRINT")[], db: Pick<Prisma.TransactionClient, "appConfig"> = prisma) {
  const saved = await db.appConfig.findMany({ where: { key: { in: keys } } });
  const savedByKey = new Map(saved.map((item) => [item.key, item]));
  const undecryptable: string[] = [];
  const values = Object.fromEntries(keys.map((key) => {
    const read = readStoredConfig(key, savedByKey.get(key));
    if (read.undecryptable) undecryptable.push(key);
    return [key, read.value];
  })) as Record<SetupConfigKey | "VENMO_VERIFIED_FINGERPRINT", string>;
  return { values, undecryptable };
}

export async function getAppConfigValue(key: SetupConfigKey) {
  const saved = await prisma.appConfig.findUnique({ where: { key } }).catch(() => null);
  return readStoredConfig(key, saved ?? undefined).value;
}

export async function getAppConfigValues(keys: (SetupConfigKey | "VENMO_VERIFIED_FINGERPRINT")[], db: Pick<Prisma.TransactionClient, "appConfig"> = prisma) {
  return (await readAppConfig(keys, db)).values;
}

export async function getSetupConfigSummary() {
  const saved = await prisma.appConfig.findMany({ where: { key: { in: [...setupConfigKeys] } } }).catch(() => []);
  const savedByKey = new Map(saved.map((item) => [item.key, item]));

  const encryptionKeyValid = configEncryptionKeyStatus().valid;
  return setupConfigFields.filter((field) => !isLegacyUnusedSetupKey(field.key)).map((field) => {
    const savedItem = savedByKey.get(field.key);
    const envValue = process.env[field.key]?.trim() || "";
    const savedValue = savedItem?.value?.trim() || "";
    const read = readStoredConfig(field.key, savedItem ? { value: savedItem.value, secret: savedItem.secret } : undefined);
    const value = read.value;
    return {
      ...field,
      configured: "optional" in field && field.optional ? true : Boolean(value),
      savedInAdmin: Boolean(savedValue),
      envConfigured: Boolean(envValue),
      undecryptable: read.undecryptable,
      encryptionKeyValid,
      value: field.secret ? "" : value
    };
  });
}
