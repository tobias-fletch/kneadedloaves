import { dispatchQueuedEmail } from "@/lib/email-dispatch";
import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSession, verifyPassword } from "@/lib/auth";
import { readJson, rateLimit } from "@/lib/request";
import { queueEmail, smtpTransport } from "@/lib/email-queue";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72 && !["admin12345", "customer12345"].includes(value));
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!["register", "forgot-password", "reset-password", "change-password"].includes(action)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!await rateLimit(request, `auth:${action}`, 10)) return NextResponse.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });
  const body = await readJson(request);
  if (action === "register") {
    const parsed = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(2).max(120) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter your name, a valid email and a password of 12–72 characters (at most 72 UTF-8 bytes)." }, { status: 400 });
    const passwordHash = await hashPassword(parsed.data.password);
    // Do not reveal whether this email already has an account.
    await prisma.user.upsert({ where: { email: parsed.data.email }, update: {}, create: { email: parsed.data.email, name: parsed.data.name, passwordHash, role: "CUSTOMER" } });
    return NextResponse.json({ message: "You can now sign in. If you already had an account, use your existing password or reset it." });
  }
  if (action === "forgot-password") {
    const parsed = emailSchema.safeParse(body.email);
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    try { await smtpTransport(); } catch { return NextResponse.json({ error: "Password recovery email is unavailable. Please contact the bakery." }, { status: 503 }); }
    const user = await prisma.user.findUnique({ where: { email: parsed.data } });
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
      await prisma.$transaction(async tx => {
        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
        await tx.passwordReset.create({ data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
        await queueEmail({ dedupeKey: `reset:${tokenHash}`, to: user.email, subject: "Reset your Kneaded Loaves password", body: `Use this private link within one hour to reset your password:\n${base}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.` }, tx);
      });
    }
    dispatchQueuedEmail();
    return NextResponse.json({ message: "If that address has an account, a password reset email will be sent." });
  }
  const password = passwordSchema.safeParse(body.password);
  if (!password.success) return NextResponse.json({ error: "Use 12–72 characters (at most 72 UTF-8 bytes) for your new password." }, { status: 400 });
  const passwordHash = await hashPassword(password.data);
  if (action === "change-password") {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.sub } });
    if (!await verifyPassword(String(body.currentPassword || ""), user.passwordHash)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  } else {
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
    const tokenHash = createHash("sha256").update(body.token).digest("hex");
    const changed = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))`;
      const reset = await tx.passwordReset.findUnique({ where: { tokenHash } });
      if (!reset || reset.expiresAt <= new Date()) return false;
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await tx.passwordReset.deleteMany({ where: { userId: reset.userId } });
      return true;
    });
    if (!changed) return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
  }
  return NextResponse.json({ message: "Password changed. Sign in again with your new password." });
}
