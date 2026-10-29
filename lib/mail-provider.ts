import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";

/**
 * Site email provider selection.
 *
 * When RESEND_API_KEY is set (a Vercel env var, never stored in Admin > Setup), all site
 * email goes through the Resend SMTP relay as Kneaded Loaves <noreply@kneadedloaves.com>.
 * When it is not set, the existing SMTP_* / EMAIL_FROM settings (the Gmail app password)
 * keep working unchanged, so nothing breaks before the go-live switch.
 */
export const SENDING_DOMAIN = "kneadedloaves.com";
export const RESEND_SMTP_HOST = "smtp.resend.com";
export const RESEND_SMTP_PORT = "465";
export const RESEND_SMTP_USER = "resend";
export const RESEND_EMAIL_FROM = `Kneaded Loaves <noreply@${SENDING_DOMAIN}>`;
/** Every site email carries this Reply-To so replies reach the bakery inbox, not noreply@. */
export const EMAIL_REPLY_TO = BAKERY_CONTACT_EMAIL;

/** The only recipients a non-production Vercel deployment (preview/development) may email. */
export const PREVIEW_ALLOWED_RECIPIENTS: readonly string[] = ["tobias.fletch@gmail.com", "kneadedloaves@gmail.com"];

export const MAIL_CONFIG_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const;
type MailConfigKey = (typeof MAIL_CONFIG_KEYS)[number];
type Env = Record<string, string | undefined>;

export function resendApiKey(env: Env = process.env) {
  return env.RESEND_API_KEY?.trim() || "";
}

export function mailProvider(env: Env = process.env): "resend" | "smtp" {
  return resendApiKey(env) ? "resend" : "smtp";
}

/** The Resend value for a mail setting, or undefined when Resend is off or the key is not a mail setting. */
export function resendOverride(key: string, env: Env = process.env): string | undefined {
  const apiKey = resendApiKey(env);
  if (!apiKey || !(MAIL_CONFIG_KEYS as readonly string[]).includes(key)) return undefined;
  const values: Record<MailConfigKey, string> = {
    SMTP_HOST: RESEND_SMTP_HOST,
    SMTP_PORT: RESEND_SMTP_PORT,
    SMTP_USER: RESEND_SMTP_USER,
    SMTP_PASSWORD: apiKey,
    EMAIL_FROM: RESEND_EMAIL_FROM
  };
  return values[key as MailConfigKey];
}

/** True on any Vercel deployment that is not production: those may only email the allowlist. */
export function previewAllowlistActive(env: Env = process.env) {
  const vercelEnv = env.VERCEL_ENV?.trim();
  return Boolean(vercelEnv) && vercelEnv !== "production";
}

export class PreviewRecipientBlockedError extends Error {
  constructor() {
    super("Not sent: preview deployments only email the test allowlist.");
    this.name = "PreviewRecipientBlockedError";
  }
}

function recipientAddresses(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(recipientAddresses);
  if (typeof value === "object" && "address" in (value as Record<string, unknown>)) return [String((value as { address: unknown }).address)];
  return String(value).split(",").map(part => {
    const wrapped = part.match(/<([^<>]+)>/);
    return (wrapped ? wrapped[1] : part).trim();
  }).filter(Boolean);
}

/** Throws PreviewRecipientBlockedError when a non-production deployment would email anyone off the allowlist. */
export function assertPreviewRecipients(message: { to?: unknown; cc?: unknown; bcc?: unknown }, env: Env = process.env) {
  if (!previewAllowlistActive(env)) return;
  const recipients = [...recipientAddresses(message.to), ...recipientAddresses(message.cc), ...recipientAddresses(message.bcc)];
  const allowed = new Set(PREVIEW_ALLOWED_RECIPIENTS.map(address => address.toLowerCase()));
  if (recipients.length === 0 || recipients.some(address => !allowed.has(address.toLowerCase()))) throw new PreviewRecipientBlockedError();
}

/** Sender mailboxes the site may use: the Gmail fallback account or any address on the bakery's own domain. */
export function allowedSenderMailbox(address: string) {
  const lower = address.trim().toLowerCase();
  return lower === BAKERY_CONTACT_EMAIL || lower.endsWith(`@${SENDING_DOMAIN}`);
}
