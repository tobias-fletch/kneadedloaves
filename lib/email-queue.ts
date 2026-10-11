import { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getAppConfigValues } from "@/lib/app-config";

export async function queueEmail(input: { dedupeKey: string; to: string; subject: string; body: string }, tx: Prisma.TransactionClient = prisma) {
  return tx.emailJob.upsert({ where: { dedupeKey: input.dedupeKey }, update: {}, create: input });
}

export async function smtpTransport() {
  const config = await getAppConfigValues(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]);
  if (Object.values(config).some(value => !value)) throw new Error("SMTP configuration is incomplete.");
  const port = Number(config.SMTP_PORT);
  if (![465, 587, 2525].includes(port)) throw new Error("Use an authenticated TLS SMTP port (465, 587 or 2525).");
  return { from: config.EMAIL_FROM, transport: nodemailer.createTransport({ host: config.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true }) };
}

export async function processEmailQueue() {
  // Claim with SKIP LOCKED so several worker processes cannot send the same job concurrently.
  const jobs = await prisma.$queryRaw<{ id: string; to: string; subject: string; body: string; attempts: number }[]>`
    UPDATE "EmailJob" SET "status" = 'SENDING', "lockedUntil" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '2 minutes', "attempts" = "attempts" + 1
    WHERE "id" IN (SELECT "id" FROM "EmailJob" WHERE
      (("status" = 'PENDING' AND "availableAt" <= (NOW() AT TIME ZONE 'UTC')) OR ("status" = 'SENDING' AND "lockedUntil" < (NOW() AT TIME ZONE 'UTC')))
      AND "attempts" < 5 ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING "id", "to", "subject", "body", "attempts"`;
  for (const job of jobs) {
    try {
      const { from, transport } = await smtpTransport();
      await transport.sendMail({ from, to: job.to, subject: job.subject, text: job.body, messageId: `<${job.id}@${from.split("@").pop()?.replace(/[>\s]/g, "") || "kneaded-loaves.local"}>` });
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, lockedUntil: null } });
    } catch {
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: job.attempts >= 5 ? "FAILED" : "PENDING", lastError: "Delivery failed. Verify SMTP settings and provider logs.", availableAt: new Date(Date.now() + 60000 * 2 ** job.attempts), lockedUntil: null } });
    }
  }
  await prisma.emailJob.updateMany({ where: { status: "SENDING", attempts: { gte: 5 }, lockedUntil: { lt: new Date() } }, data: { status: "FAILED", lastError: "Worker interrupted; delivery may have occurred. Check provider before retrying." } });
  return jobs.length;
}
