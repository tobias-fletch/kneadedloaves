import { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { EMAIL_REPLY_TO, EmailNotConfiguredError, PreviewRecipientBlockedError, RESEND_EMAIL_FROM, RESEND_SMTP_HOST, RESEND_SMTP_PORT, RESEND_SMTP_USER, assertPreviewRecipients, resendApiKey } from "@/lib/mail-provider";

export async function queueEmail(input: { dedupeKey: string; to: string; subject: string; body: string; html?: string | null }, tx: Prisma.TransactionClient = prisma) {
  return tx.emailJob.upsert({ where: { dedupeKey: input.dedupeKey }, update: {}, create: input });
}

export function mailboxAddress(from: string) {
  const trimmed = from.trim();
  const wrapped = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (wrapped ? wrapped[2] : trimmed).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("The sender must be an email address or Name <email>.");
  return address;
}

export function messageIdDomain(from: string) {
  return mailboxAddress(from).split("@")[1]?.replace(/[>\s]/g, "") || "kneadedloaves.com";
}

/**
 * Connection settings for the Resend SMTP relay. Everything is fixed except the password,
 * which is RESEND_API_KEY. Throws EmailNotConfiguredError when the key is not set.
 */
export function mailerSettings(env: Record<string, string | undefined> = process.env) {
  const apiKey = resendApiKey(env);
  if (!apiKey) throw new EmailNotConfiguredError();
  return {
    from: RESEND_EMAIL_FROM,
    options: {
      host: RESEND_SMTP_HOST,
      port: RESEND_SMTP_PORT,
      secure: true,
      requireTLS: false,
      auth: { user: RESEND_SMTP_USER, pass: apiKey },
      connectionTimeout: 10000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true
    }
  };
}

export type MailMessage = { from: string; to: string; subject: string; text: string; html?: string; replyTo?: string; messageId?: string };

/**
 * The site sender (Resend). `sendMail` refuses (PreviewRecipientBlockedError) on any non-production
 * deployment when a recipient is off the preview allowlist, before anything leaves the server.
 */
export async function mailTransport(createTransport: (options: ReturnType<typeof mailerSettings>["options"]) => { sendMail: (message: MailMessage) => Promise<unknown> } = nodemailer.createTransport, env: Record<string, string | undefined> = process.env) {
  const settings = mailerSettings(env);
  const transport = createTransport(settings.options);
  return {
    from: settings.from,
    sendMail: async (message: MailMessage) => {
      assertPreviewRecipients(message, env);
      return transport.sendMail(message);
    }
  };
}

export function emailDeliveryMessage(job: { id: string; to: string; subject: string; body: string; html?: string | null }, from: string) {
  const message: { from: string; to: string; replyTo: string; subject: string; text: string; html?: string; messageId: string } = {
    from,
    to: job.to,
    replyTo: EMAIL_REPLY_TO,
    subject: job.subject,
    text: job.body,
    messageId: `<${job.id}@${messageIdDomain(from)}>`
  };
  if (job.html) message.html = job.html;
  return message;
}

export function emailJobIsClaimable(job: { status: string; availableAt: Date; lockedUntil: Date | null; attempts: number }, now = new Date()) {
  if (job.attempts >= 5) return false;
  if (job.status === "PENDING") return job.availableAt.getTime() <= now.getTime();
  if (job.status === "SENDING") return Boolean(job.lockedUntil && job.lockedUntil.getTime() < now.getTime());
  return false;
}

/** LIKE pattern for one order's dedupe keys. `_` and `%` are escaped so they stay literal. */
export function emailDedupeLike(suffix: string) {
  if (suffix && !/^:[\w-]+$/.test(suffix)) throw new Error("Invalid email filter.");
  return `%${suffix.replace(/[\\%_]/g, (char) => `\\${char}`)}`;
}

export async function processEmailQueue(options?: { dedupeSuffix?: string }) {
  const like = emailDedupeLike(options?.dedupeSuffix ?? "");
  // Claim with SKIP LOCKED so several worker processes cannot send the same job concurrently.
  // The WHERE clause matches emailJobIsClaimable: pending and due, or a stale send lock, under 5 attempts.
  const jobs = await prisma.$queryRaw<{ id: string; to: string; subject: string; body: string; html: string | null; attempts: number }[]>`
    UPDATE "EmailJob" SET "status" = 'SENDING', "lockedUntil" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '2 minutes', "attempts" = "attempts" + 1
    WHERE "id" IN (SELECT "id" FROM "EmailJob" WHERE
      (("status" = 'PENDING' AND "availableAt" <= (NOW() AT TIME ZONE 'UTC')) OR ("status" = 'SENDING' AND "lockedUntil" < (NOW() AT TIME ZONE 'UTC')))
      AND "attempts" < 5 AND "dedupeKey" LIKE ${like} ESCAPE '\\' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING "id", "to", "subject", "body", "html", "attempts"`;
  for (const job of jobs) {
    try {
      const { from, sendMail } = await mailTransport();
      await sendMail(emailDeliveryMessage(job, from));
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, lockedUntil: null } });
    } catch (error) {
      if (error instanceof PreviewRecipientBlockedError) {
        // Preview copy of the queue: never retried, never sent to a real customer.
        await prisma.emailJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: error.message, lockedUntil: null } });
        continue;
      }
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: job.attempts >= 5 ? "FAILED" : "PENDING", lastError: error instanceof EmailNotConfiguredError ? error.message : "Delivery failed. Check RESEND_API_KEY and the Resend logs.", availableAt: new Date(Date.now() + 60000 * 2 ** job.attempts), lockedUntil: null } });
    }
  }
  await prisma.emailJob.updateMany({ where: { status: "SENDING", attempts: { gte: 5 }, lockedUntil: { lt: new Date() } }, data: { status: "FAILED", lastError: "Worker interrupted; delivery may have occurred. Check provider before retrying." } });
  return jobs.length;
}
