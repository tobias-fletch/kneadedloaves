import { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getAppConfigValues } from "@/lib/app-config";
import { EMAIL_REPLY_TO, PreviewRecipientBlockedError, RESEND_SMTP_HOST, SENDING_DOMAIN, assertPreviewRecipients, mailProvider } from "@/lib/mail-provider";

export async function queueEmail(input: { dedupeKey: string; to: string; subject: string; body: string; html?: string | null }, tx: Prisma.TransactionClient = prisma) {
  return tx.emailJob.upsert({ where: { dedupeKey: input.dedupeKey }, update: {}, create: input });
}

export function mailboxAddress(from: string) {
  const trimmed = from.trim();
  const wrapped = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (wrapped ? wrapped[2] : trimmed).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("EMAIL_FROM must be an email address or Name <email>.");
  return address;
}

export function messageIdDomain(from: string) {
  return mailboxAddress(from).split("@")[1]?.replace(/[>\s]/g, "") || "kneadedloaves.com";
}

export function mailerSettings(config: { SMTP_HOST: string; SMTP_PORT: string; SMTP_USER: string; SMTP_PASSWORD: string; EMAIL_FROM: string }) {
  if (Object.values(config).some(value => !value)) throw new Error("SMTP configuration is incomplete.");
  const port = Number(config.SMTP_PORT);
  if (![465, 587, 2525].includes(port)) throw new Error("Use an authenticated TLS SMTP port (465, 587 or 2525).");
  const fromAddress = mailboxAddress(config.EMAIL_FROM);
  const host = config.SMTP_HOST.trim().toLowerCase().replace(/\.$/, "");
  if (host === "smtp.gmail.com" && fromAddress.toLowerCase() !== config.SMTP_USER.trim().toLowerCase()) {
    throw new Error("Gmail requires the EMAIL_FROM address to match SMTP_USER.");
  }
  if (host === RESEND_SMTP_HOST && !fromAddress.toLowerCase().endsWith(`@${SENDING_DOMAIN}`)) {
    throw new Error(`Resend requires the EMAIL_FROM address to be on ${SENDING_DOMAIN}.`);
  }
  const secure = port === 465;
  const password = host === "smtp.gmail.com" ? config.SMTP_PASSWORD.replace(/\s+/g, "") : config.SMTP_PASSWORD;
  if (!password) throw new Error("SMTP configuration is incomplete.");
  return {
    from: config.EMAIL_FROM.trim(),
    options: {
      host: config.SMTP_HOST,
      port,
      secure,
      requireTLS: !secure,
      auth: { user: config.SMTP_USER, pass: password },
      connectionTimeout: 10000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true
    }
  };
}

export type MailMessage = { from: string; to: string; subject: string; text: string; html?: string; replyTo?: string; messageId?: string };

/**
 * The configured sender. `sendMail` refuses (PreviewRecipientBlockedError) on any non-production
 * deployment when a recipient is off the preview allowlist, before anything leaves the server.
 */
export async function smtpTransport(createTransport: (options: ReturnType<typeof mailerSettings>["options"]) => { sendMail: (message: MailMessage) => Promise<unknown> } = nodemailer.createTransport) {
  const config = await getAppConfigValues(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]);
  const settings = mailerSettings(config);
  const transport = createTransport(settings.options);
  return {
    from: settings.from,
    provider: mailProvider(),
    sendMail: async (message: MailMessage) => {
      assertPreviewRecipients(message);
      return transport.sendMail(message);
    }
  };
}

export async function verifySmtpConnection(config: { SMTP_HOST: string; SMTP_PORT: string; SMTP_USER: string; SMTP_PASSWORD: string; EMAIL_FROM: string }, createTransport: (options: object) => { verify: () => Promise<unknown> } = nodemailer.createTransport) {
  const settings = mailerSettings(config);
  await createTransport(settings.options).verify();
  return { ok: true as const };
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
      const { from, sendMail } = await smtpTransport();
      await sendMail(emailDeliveryMessage(job, from));
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, lockedUntil: null } });
    } catch (error) {
      if (error instanceof PreviewRecipientBlockedError) {
        // Preview copy of the queue: never retried, never sent to a real customer.
        await prisma.emailJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: error.message, lockedUntil: null } });
        continue;
      }
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: job.attempts >= 5 ? "FAILED" : "PENDING", lastError: "Delivery failed. Verify SMTP settings and provider logs.", availableAt: new Date(Date.now() + 60000 * 2 ** job.attempts), lockedUntil: null } });
    }
  }
  await prisma.emailJob.updateMany({ where: { status: "SENDING", attempts: { gte: 5 }, lockedUntil: { lt: new Date() } }, data: { status: "FAILED", lastError: "Worker interrupted; delivery may have occurred. Check provider before retrying." } });
  return jobs.length;
}
