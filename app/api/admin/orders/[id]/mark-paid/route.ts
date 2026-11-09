import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readSinglePayment, toPublicCorrectionError } from "@/lib/admin-order-corrections";
import { recordAdminPayment } from "@/lib/admin-order-corrections-db";
import { prisma } from "@/lib/prisma";
import { readJson } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await readJson(request);
  try {
    const payment = readSinglePayment(body);
    const result = await prisma.$transaction(tx => recordAdminPayment(tx, {
      ...payment,
      orderIds: [id],
      amountCents: null,
      actor: { id: admin.sub, email: admin.email, name: admin.name ?? null },
      now: new Date()
    }));
    return NextResponse.json(result);
  } catch (error) {
    const failure = toPublicCorrectionError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
