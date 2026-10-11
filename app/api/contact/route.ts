import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getContactDetails } from "@/lib/contact";
import { readJson, rateLimit } from "@/lib/request";
import { queueEmail, smtpTransport } from "@/lib/email-queue";
import { buildMailtoUrl } from "@/lib/mailto";
const schema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(254), phone: z.string().max(40).optional(), message: z.string().min(10).max(5000) });
export async function POST(request: Request) {
  if (!await rateLimit(request, "contact", 5)) return NextResponse.json({ error: "Too many messages. Please try again in 10 minutes." }, { status: 429 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid name, email and message (10–5000 characters)." }, { status: 400 });
  const contact = await getContactDetails();
  const body = `From: ${parsed.data.name} <${parsed.data.email}>\nPhone: ${parsed.data.phone || ""}\n\n${parsed.data.message}`;
  const mailtoUrl = buildMailtoUrl({ to: contact.email, subject: "Bakery question", body });
  try { await smtpTransport(); } catch { return NextResponse.json({ error: "Email is currently unavailable. Please use the contact email instead.", mailtoUrl }, { status: 503 }); }
  await queueEmail({ dedupeKey: randomUUID(), to: contact.email, subject: "New bakery contact message", body });
  return NextResponse.json({ ok: true });
}
