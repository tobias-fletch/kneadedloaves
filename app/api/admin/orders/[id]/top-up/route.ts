import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readTopUpPayment, toPublicCorrectionError } from "@/lib/admin-order-corrections";
import { recordAdminTopUp } from "@/lib/admin-order-corrections-db";
import { prisma } from "@/lib/prisma";
import { readJson } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await readJson(request);
  try {
    const payment = readTopUpPayment(body);
    const result = await prisma.$transaction(tx => recordAdminTopUp(tx, {
      ...payment,
      orderId: id,
      actor: { id: admin.sub, email: admin.email, name: admin.name ?? null },
      now: new Date()
    }));
    return NextResponse.json(result);
  } catch (error) {
    const failure = toPublicCorrectionError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
