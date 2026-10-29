import { NextResponse } from "next/server";
import { getAppConfigValues } from "@/lib/app-config";
import { requireAdmin } from "@/lib/auth";
import { verifySmtpConnection } from "@/lib/email-queue";

export const dynamic = "force-dynamic";

function navigationError(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_");
}

export async function POST() {
  try {
    await requireAdmin();
    const config = await getAppConfigValues(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]);
    await verifySmtpConnection(config);
    return NextResponse.json({ ok: true, message: "SMTP connection succeeded. No message was sent." });
  } catch (error) {
    if (navigationError(error)) throw error;
    console.error("SMTP verify failed.", error instanceof Error ? error.name : "Error");
    const safe = error instanceof Error && /SMTP configuration is incomplete|EMAIL_FROM|Gmail requires the EMAIL_FROM|Resend requires the EMAIL_FROM|authenticated TLS SMTP port/.test(error.message)
      ? error.message
      : "SMTP connection could not be verified. No message was sent.";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
