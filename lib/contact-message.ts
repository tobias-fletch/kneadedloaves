import { createHash } from "crypto";
import { z } from "zod";
import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";
import { prisma } from "@/lib/prisma";

const EASTERN_TIME = "America/New_York";
const SITE_NAME = "kneadedloaves.com";
export const CONTACT_SENDER_NAME = "Kneaded Loaves";

/** Field limits shared by the server route and the /contact form. */
export const CONTACT_LIMITS = { nameMax: 120, emailMax: 254, messageMin: 10, messageMax: 5000 } as const;

/** Submissions faster than this after the form rendered are treated as bots (quiet success, nothing sent). */
export const CONTACT_MIN_FILL_MS = 3000;

/** Per-IP limits, matching the shared contact relay: 5 an hour and 20 a day. */
export const CONTACT_IP_LIMITS = [
  { scope: "contact-ip-hour", limit: 5, windowMs: 60 * 60 * 1000 },
  { scope: "contact-ip-day", limit: 20, windowMs: 24 * 60 * 60 * 1000 }
] as const;

/**
 * Every contact-form notification goes to the bakery mailbox, and every email the form
 * sends comes from it. This is deliberately not configurable (Kneaded Loaves is the only
 * site whose contact form uses kneadedloaves@gmail.com).
 */
export const CONTACT_MAILBOX = BAKERY_CONTACT_EMAIL;

const singleLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

export const contactMessageSchema = z.object({
  name: z.string().transform(singleLine).pipe(z.string().min(1, "Please tell us your name.").max(CONTACT_LIMITS.nameMax, "That name is a little long.")),
  email: z.string().trim().max(CONTACT_LIMITS.emailMax).email("Please enter a valid email address."),
  message: z.string().trim().min(CONTACT_LIMITS.messageMin, `Please write at least ${CONTACT_LIMITS.messageMin} characters.`).max(CONTACT_LIMITS.messageMax, `Please keep it under ${CONTACT_LIMITS.messageMax} characters.`),
  /** Honeypot: hidden from people, often filled in by bots. */
  website: z.string().optional().default("")
});

export type ContactMessage = z.infer<typeof contactMessageSchema>;

export type OutgoingMail = { from: string; to: string; replyTo?: string; subject: string; text: string };

/** "Friday, Oct 23, 2026, 6:11 PM ET" regardless of the server time zone. */
export function formatContactTimestamp(value: Date) {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME, weekday: "long", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true
  }).format(value);
  return `${text.replace(/\u202f/g, " ")} ET`;
}

/** Eastern calendar day, e.g. "2026-10-23", used for the one-confirmation-per-day rule. */
export function easternDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN_TIME, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

/**
 * Real email leaves only when CONTACT_LIVE_SEND=true is set on the production
 * deployment or on a preview deployment. Previews then email only the test
 * allowlist (lib/mail-provider.ts): the owner notification goes to the bakery
 * inbox and a confirmation to anyone else is refused. Everything else
 * (development, local, or the flag unset or any other value) is a dry run that
 * logs one masked line and sends nothing.
 */
export function contactDeliveryMode(env: Record<string, string | undefined> = process.env): "live" | "dry-run" {
  const flag = env.CONTACT_LIVE_SEND?.trim().toLowerCase();
  return (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") && flag === "true" ? "live" : "dry-run";
}

export function buildOwnerNotification(input: ContactMessage, submittedAt: Date, options: { from: string; to: string }): OutgoingMail {
  const lines = [
    `New message from the ${SITE_NAME} contact form.`,
    "",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Sent: ${formatContactTimestamp(submittedAt)}`,
    "",
    "Message:",
    input.message,
    "",
    "Reply to this email to answer them directly."
  ];
  return { from: options.from, to: options.to, replyTo: input.email, subject: `New message from ${SITE_NAME}: ${input.name}`, text: lines.join("\n") };
}

export function buildSenderConfirmation(input: ContactMessage, submittedAt: Date, options: { from: string; replyTo: string }): OutgoingMail {
  const firstName = input.name.split(" ")[0] || input.name;
  const quoted = input.message.split("\n").map((line) => `> ${line}`).join("\n");
  const text = [
    `Hi ${firstName},`,
    "",
    "Thanks so much for reaching out to Kneaded Loaves! Your message landed safely and I'll get back to you soon, usually within a day or two.",
    "",
    `Here's a copy of what you sent on ${formatContactTimestamp(submittedAt)}:`,
    "",
    quoted,
    "",
    "Warmly,",
    "Tobias at Kneaded Loaves",
    `https://${SITE_NAME}`
  ].join("\n");
  return { from: options.from, to: input.email, replyTo: options.replyTo, subject: "Thanks for your message to Kneaded Loaves", text };
}

/** Mask an address for logs: k***@gmail.com. */
export function maskEmail(address: string) {
  const [local, domain] = address.split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "***";
}

/**
 * Claims today's (Eastern) single confirmation for a sender. Stored as a hashed key
 * in the existing RateLimit table (no plaintext address, cleaned up by the email
 * maintenance worker). Dry-run claims use a separate scope so preview traffic never
 * uses up a real sender's production confirmation. Storage errors skip the confirmation.
 */
export async function claimDailyConfirmation(
  email: string,
  now: Date,
  mode: "live" | "dry-run",
  db: { rateLimit: { upsert: (args: { where: { key: string }; update: { count: { increment: number } }; create: { key: string; count: number; expiresAt: Date } }) => Promise<{ count: number }> } } = prisma
) {
  const key = createHash("sha256").update(`contact-confirmation:${mode}:${email.trim().toLowerCase()}:${easternDateKey(now)}`).digest("hex");
  try {
    const result = await db.rateLimit.upsert({
      where: { key },
      update: { count: { increment: 1 } },
      create: { key, count: 1, expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000) }
    });
    return result.count === 1;
  } catch {
    console.warn("[contact] Could not record the daily confirmation; skipping the sender confirmation.");
    return false;
  }
}

export type ContactDeliveryDeps = {
  mode: "live" | "dry-run";
  notifyTo: string;
  /** The configured sender (e.g. Kneaded Loaves <noreply@kneadedloaves.com>). Defaults to the bakery Gmail mailbox. */
  from?: string;
  sendMail?: (mail: OutgoingMail) => Promise<unknown>;
  claimConfirmation: (email: string, now: Date) => Promise<boolean>;
  log?: (message: string) => void;
  now?: Date;
};

export type ContactDeliveryResult = { ok: true; confirmationSent: boolean; dryRun: boolean } | { ok: false; reason: "notification-failed" };

/** Sends the owner notification (always) and at most one confirmation per sender per Eastern day. */
export async function deliverContactMessage(input: ContactMessage, deps: ContactDeliveryDeps): Promise<ContactDeliveryResult> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? ((message: string) => console.info(message));
  const mailbox = CONTACT_MAILBOX;
  const from = deps.from?.trim() || `${CONTACT_SENDER_NAME} <${mailbox}>`;
  const dryRun = deps.mode !== "live";
  const send = async (kind: string, mail: OutgoingMail) => {
    if (dryRun) {
      log(`[contact] DRY RUN, not sending ${kind}: to=${maskEmail(mail.to)} replyTo=${mail.replyTo ? maskEmail(mail.replyTo) : "-"} subject=${JSON.stringify(mail.subject)}`);
      return;
    }
    if (!deps.sendMail) throw new Error("No mail transport configured.");
    await deps.sendMail(mail);
  };

  try {
    await send("owner notification", buildOwnerNotification(input, now, { from, to: deps.notifyTo }));
  } catch {
    console.error("[contact] Owner notification failed to send.");
    return { ok: false, reason: "notification-failed" };
  }

  let confirmationSent = false;
  if (await deps.claimConfirmation(input.email, now)) {
    try {
      await send("sender confirmation", buildSenderConfirmation(input, now, { from, replyTo: mailbox }));
      confirmationSent = true;
    } catch {
      console.error("[contact] Sender confirmation failed to send.");
    }
  }
  return { ok: true, confirmationSent, dryRun };
}
