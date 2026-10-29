import { NextResponse } from "next/server";
import {
  CONTACT_IP_LIMITS,
  CONTACT_MAILBOX,
  CONTACT_MIN_FILL_MS,
  claimDailyConfirmation,
  contactDeliveryMode,
  contactMessageSchema,
  deliverContactMessage,
  type OutgoingMail
} from "@/lib/contact-message";
import { mailboxAddress, smtpTransport } from "@/lib/email-queue";
import { allowedSenderMailbox } from "@/lib/mail-provider";
import { readJson } from "@/lib/request";
import { contactRateLimit } from "@/lib/contact-rate-limit";

/** Plain-text fallback shown in error messages. Never a mailto link. */
const EMAIL_FALLBACK = `You can also email us at ${CONTACT_MAILBOX}.`;

export type ContactRouteDeps = {
  env?: Record<string, string | undefined>;
  limit?: typeof contactRateLimit;
  transport?: () => Promise<{ from: string; sendMail: (mail: OutgoingMail) => Promise<unknown> }>;
  claim?: typeof claimDailyConfirmation;
  log?: (message: string) => void;
  now?: () => Date;
};

async function defaultTransport() {
  const { from, sendMail } = await smtpTransport();
  return { from, sendMail: (mail: OutgoingMail) => sendMail(mail) };
}

/**
 * Client IP for the per-IP contact limits. Vercel overwrites X-Forwarded-For with the
 * real client address, so it is trusted there (VERCEL=1) or when TRUST_PROXY=true.
 * Anywhere else every visitor shares one bucket, as the rest of the site does.
 */
export function contactClientIp(request: Request, env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL !== "1" && env.TRUST_PROXY !== "true") return "shared";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "shared";
}

/** True when the form was submitted implausibly fast (or without a start time), which bots do. */
export function submittedTooFast(startedAt: unknown, now: number) {
  const started = typeof startedAt === "number" ? startedAt : typeof startedAt === "string" ? Number(startedAt) : NaN;
  if (!Number.isFinite(started)) return true;
  return now - started < CONTACT_MIN_FILL_MS;
}

export async function handleContactPost(request: Request, deps: ContactRouteDeps = {}) {
  const env = deps.env ?? process.env;
  const limit = deps.limit ?? contactRateLimit;
  const now = deps.now?.() ?? new Date();
  const ip = contactClientIp(request, env);
  for (const { scope, limit: max, windowMs } of CONTACT_IP_LIMITS) {
    if (!await limit(request, scope, max, `ip:${ip}`, windowMs)) {
      const when = windowMs > 60 * 60 * 1000 ? "tomorrow" : "in about an hour";
      return NextResponse.json({ error: `Too many messages from this connection. Please try again ${when}. ${EMAIL_FALLBACK}` }, { status: 429 });
    }
  }

  const raw = await readJson(request);
  const parsed = contactMessageSchema.safeParse({
    name: typeof raw.name === "string" ? raw.name : "",
    email: typeof raw.email === "string" ? raw.email : "",
    message: typeof raw.message === "string" ? raw.message : "",
    website: typeof raw.website === "string" ? raw.website : undefined
  });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(Object.entries(parsed.error.flatten().fieldErrors).map(([key, messages]) => [key, messages?.[0] ?? "Check this field."]));
    return NextResponse.json({ error: "Please check the highlighted fields.", fieldErrors }, { status: 400 });
  }

  // Honeypot filled or submitted too fast: quiet success so bots learn nothing, and send nothing.
  if (parsed.data.website.trim() || submittedTooFast(raw.startedAt, now.getTime())) return NextResponse.json({ ok: true });

  if (!await limit(request, "contact-sender", 3, parsed.data.email.toLowerCase(), 600_000)) {
    return NextResponse.json({ error: `We've already received a few messages from this address. Please try again in about 10 minutes. ${EMAIL_FALLBACK}` }, { status: 429 });
  }

  const mode = contactDeliveryMode(env);
  let sendMail: ((mail: OutgoingMail) => Promise<unknown>) | undefined;
  let from: string | undefined;
  if (mode === "live") {
    try {
      const transport = await (deps.transport ?? defaultTransport)();
      // Contact mail goes out only as the bakery: noreply@kneadedloaves.com (Resend) or the Gmail fallback account.
      if (!allowedSenderMailbox(mailboxAddress(transport.from))) throw new Error("Sender mailbox mismatch.");
      sendMail = transport.sendMail;
      from = transport.from;
    } catch {
      console.error(`[contact] Email is not configured to send as ${CONTACT_MAILBOX} or a kneadedloaves.com address; cannot send.`);
      return NextResponse.json({ error: `Our email is having a moment. ${EMAIL_FALLBACK}` }, { status: 503 });
    }
  } else {
    (deps.log ?? console.info)(`[contact] Dry-run mode (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}); emails are logged, not sent. Live sending needs CONTACT_LIVE_SEND=true on production (or on a preview, which only emails the test allowlist).`);
  }

  const claim = deps.claim ?? claimDailyConfirmation;
  const result = await deliverContactMessage(parsed.data, {
    mode,
    notifyTo: CONTACT_MAILBOX,
    from,
    sendMail,
    claimConfirmation: (email, at) => claim(email, at, mode),
    log: deps.log,
    now
  });
  if (!result.ok) {
    return NextResponse.json({ error: `Your message couldn't be sent just now. Please try again. ${EMAIL_FALLBACK}` }, { status: 503 });
  }
  return NextResponse.json({ ok: true, confirmationSent: result.confirmationSent });
}
