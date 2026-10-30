import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSession, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { readJson, rateLimit } from "@/lib/request";
import { queueEmail } from "@/lib/email-queue";
import { resendConfigured } from "@/lib/mail-provider";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72 && !["admin12345", "customer12345"].includes(value));
const resetMessage = "If that address has an account, a password reset email will be sent.";
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    if (!["register", "forgot-password", "reset-password", "change-password"].includes(action)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!await rateLimit(request, `auth:${action}`, 10)) return NextResponse.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });
    const body = await readJson(request);
    if (action === "register") {
      const parsed = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(2).max(120) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Enter your name, a valid email and a password of 12–72 characters (at most 72 UTF-8 bytes)." }, { status: 400 });
      const passwordHash = await hashPassword(parsed.data.password);
      await prisma.user.upsert({ where: { email: parsed.data.email }, update: {}, create: { email: parsed.data.email, name: parsed.data.name, passwordHash, role: "CUSTOMER" } });
      return NextResponse.json({ message: "You can now sign in. If you already had an account, use your existing password or reset it." });
    }
    if (action === "forgot-password") {
      const parsed = emailSchema.safeParse(body.email);
      if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
      if (!resendConfigured()) {
        // Never expose a recovery credential to an unauthenticated caller.
        console.error("Password recovery email is unavailable: site email (Resend) is not configured.");
        return NextResponse.json({ message: resetMessage });
      }
      const user = await prisma.user.findUnique({ where: { email: parsed.data } });
      if (user) {
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const base = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : "");
        const resetUrl = new URL("/reset-password", base);
        if (!["http:", "https:"].includes(resetUrl.protocol) || resetUrl.username || resetUrl.password || (process.env.NODE_ENV === "production" && resetUrl.protocol !== "https:")) throw new Error("Invalid recovery URL configuration.");
        resetUrl.searchParams.set("token", token);
        await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password:${user.id}`}))`;
          await tx.passwordReset.deleteMany({ where: { userId: user.id } });
          await tx.passwordReset.create({ data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
          await queueEmail({ dedupeKey: `reset:${tokenHash}`, to: user.email, subject: "Reset your Kneaded Loaves password", body: `Use this private link within one hour to reset your password:\n${resetUrl}\n\nIf you did not request this, ignore this email.` }, tx);
        });
      }
      return NextResponse.json({ message: resetMessage });
    }
    const password = passwordSchema.safeParse(body.password);
    if (!password.success) return NextResponse.json({ error: "Use 12–72 characters (at most 72 UTF-8 bytes) for your new password." }, { status: 400 });
    if (action === "change-password") {
      const session = await getSession();
      if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.sub } });
      if (user.sessionVersion !== session.version) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
      if (!await verifyPassword(String(body.currentPassword || ""), user.passwordHash)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
      const passwordHash = await hashPassword(password.data);
      const changed = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password:${user.id}`}))`;
        // Compare-and-swap prevents a delayed request overwriting a newer password.
        const result = await tx.user.updateMany({ where: { id: user.id, sessionVersion: session.version, passwordHash: user.passwordHash }, data: { passwordHash, sessionVersion: { increment: 1 } } });
        if (result.count !== 1) return false;
        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
        return true;
      });
      if (!changed) return NextResponse.json({ error: "Sign in again before changing your password." }, { status: 401 });
    } else {
      if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
      const tokenHash = createHash("sha256").update(body.token).digest("hex");
      const passwordHash = await hashPassword(password.data);
      const changed = await prisma.$transaction(async tx => {
        const candidate = await tx.passwordReset.findUnique({ where: { tokenHash } });
        if (!candidate) return false;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password:${candidate.userId}`}))`;
        const reset = await tx.passwordReset.findUnique({ where: { tokenHash } });
        if (!reset || reset.expiresAt <= new Date()) return false;
        await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
        await tx.passwordReset.deleteMany({ where: { userId: reset.userId } });
        return true;
      });
      if (!changed) return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
    }
    const response = NextResponse.json({ message: "Password changed. Sign in again with your new password." });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    // Database errors can embed query arguments. Do not log passwords or tokens.
    console.error("Authentication request failed.");
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
