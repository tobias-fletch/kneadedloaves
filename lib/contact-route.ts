import { NextResponse } from "next/server";
import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";
import {
  claimDailyConfirmation,
  contactDeliveryMode,
  contactMessageSchema,
  contactNotificationEmail,
  deliverContactMessage,
  type OutgoingMail
} from "@/lib/contact-message";
import { smtpTransport } from "@/lib/email-queue";
import { buildMailtoUrl } from "@/lib/mailto";
import { rateLimit, readJson } from "@/lib/request";

const FALLBACK_MAILTO = buildMailtoUrl({ to: BAKERY_CONTACT_EMAIL, subject: "Question for Kneaded Loaves" });

export type ContactRouteDeps = {
  env?: Record<string, string | undefined>;
  limit?: typeof rateLimit;
  transport?: () => Promise<{ from: string; sendMail: (mail: OutgoingMail) => Promise<unknown> }>;
  claim?: typeof claimDailyConfirmation;
  log?: (message: string) => void;
  now?: () => Date;
};

async function defaultTransport() {
  const { from, transport } = await smtpTransport();
  return { from, sendMail: (mail: OutgoingMail) => transport.sendMail(mail) };
}

export async function handleContactPost(request: Request, deps: ContactRouteDeps = {}) {
  const env = deps.env ?? process.env;
  const limit = deps.limit ?? rateLimit;
  if (!await limit(request, "contact", 10)) {
    return NextResponse.json({ error: "Too many messages right now. Please try again in about 10 minutes, or email us directly.", mailtoUrl: FALLBACK_MAILTO }, { status: 429 });
  }

  const raw = await readJson(request);
  const parsed = contactMessageSchema.safeParse({
    name: typeof raw.name === "string" ? raw.name : "",
    email: typeof raw.email === "string" ? raw.email : "",
    phone: typeof raw.phone === "string" ? raw.phone : undefined,
    message: typeof raw.message === "string" ? raw.message : "",
    website: typeof raw.website === "string" ? raw.website : undefined
  });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(Object.entries(parsed.error.flatten().fieldErrors).map(([key, messages]) => [key, messages?.[0] ?? "Check this field."]));
    return NextResponse.json({ error: "Please check the highlighted fields.", fieldErrors }, { status: 400 });
  }

  // Honeypot filled: pretend success so bots learn nothing, and send nothing.
  if (parsed.data.website.trim()) return NextResponse.json({ ok: true });

  if (!await limit(request, "contact-sender", 3, parsed.data.email.toLowerCase())) {
    return NextResponse.json({ error: "We've already received a few messages from this address. Please try again in about 10 minutes.", mailtoUrl: FALLBACK_MAILTO }, { status: 429 });
  }

  const mode = contactDeliveryMode(env);
  let configuredFrom: string | undefined;
  let sendMail: ((mail: OutgoingMail) => Promise<unknown>) | undefined;
  if (mode === "live") {
    try {
      const transport = await (deps.transport ?? defaultTransport)();
      configuredFrom = transport.from;
      sendMail = transport.sendMail;
    } catch {
      console.error("[contact] SMTP is not configured; cannot send.");
      return NextResponse.json({ error: "Our email is having a moment. Please email us directly instead.", mailtoUrl: FALLBACK_MAILTO }, { status: 503 });
    }
  } else {
    (deps.log ?? console.info)(`[contact] Dry-run mode (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}); emails are logged, not sent. Set CONTACT_LIVE_SEND=true to send.`);
  }

  const claim = deps.claim ?? claimDailyConfirmation;
  const result = await deliverContactMessage(parsed.data, {
    mode,
    notifyTo: contactNotificationEmail(env),
    configuredFrom,
    sendMail,
    claimConfirmation: (email, now) => claim(email, now, mode),
    log: deps.log,
    now: deps.now?.()
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Your message couldn't be sent just now. Please try again, or email us directly.", mailtoUrl: FALLBACK_MAILTO }, { status: 503 });
  }
  return NextResponse.json({ ok: true, confirmationSent: result.confirmationSent });
}
