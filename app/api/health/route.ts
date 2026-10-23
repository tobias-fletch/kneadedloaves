import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { configEncryptionKeyStatus } from "@/lib/secrets";
export const dynamic = "force-dynamic";
export async function GET() {
  const encryptionKeyValid = configEncryptionKeyStatus().valid;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", encryptionKeyValid }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", encryptionKeyValid }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
