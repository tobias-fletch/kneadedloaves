import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readJson } from "@/lib/request";
import { paymentEvidenceSchema, recordPaymentEvidence } from "@/lib/manual-payments";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const parsed = paymentEvidenceSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid payment evidence." }, { status: 400 });
  try {
    const { id } = await params;
    const order = await prisma.$transaction(tx => recordPaymentEvidence(tx, id, parsed.data, admin.sub));
    return NextResponse.json({ ok: true, status: order.status, paymentState: order.paymentState });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !/prisma|constraint|database/i.test(error.message) ? error.message : "Could not save evidence. The provider reference may already be recorded." }, { status: 409 });
  }
}
