import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";

/**
 * Site email settings. Resend is the only send path.
 *
 * All site email goes through the Resend SMTP relay as Kneaded Loaves <noreply@kneadedloaves.com>,
 * with Reply-To kneadedloaves@gmail.com. The only credential is RESEND_API_KEY, a Vercel env var
 * that is never stored in Admin > Setup. When it is not set, no email is sent and queued jobs
 * stay retryable until it is.
 */
export const SENDING_DOMAIN = "kneadedloaves.com";
export const RESEND_SMTP_HOST = "smtp.resend.com";
export const RESEND_SMTP_PORT = 465;
export const RESEND_SMTP_USER = "resend";
export const RESEND_EMAIL_FROM = `Kneaded Loaves <noreply@${SENDING_DOMAIN}>`;
/** Every site email carries this Reply-To so replies reach the bakery inbox, not noreply@. */
export const EMAIL_REPLY_TO = BAKERY_CONTACT_EMAIL;

/** The only recipients a non-production Vercel deployment (preview/development) may email. */
export const PREVIEW_ALLOWED_RECIPIENTS: readonly string[] = ["tobias.fletch@gmail.com", "kneadedloaves@gmail.com"];

type Env = Record<string, string | undefined>;

export function resendApiKey(env: Env = process.env) {
  return env.RESEND_API_KEY?.trim() || "";
}

/** Whether RESEND_API_KEY is set. Safe to show in admin screens: it never reveals the value. */
export function resendConfigured(env: Env = process.env) {
  return resendApiKey(env) !== "";
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Site email is not configured: set RESEND_API_KEY in Vercel.");
    this.name = "EmailNotConfiguredError";
  }
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

/** Sender mailboxes the site may use: only addresses on the bakery's own (Resend-verified) domain. */
export function allowedSenderMailbox(address: string) {
  return address.trim().toLowerCase().endsWith(`@${SENDING_DOMAIN}`);
}
