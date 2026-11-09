import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readSharedPayment, toPublicCorrectionError } from "@/lib/admin-order-corrections";
import { recordAdminPayment } from "@/lib/admin-order-corrections-db";
import { prisma } from "@/lib/prisma";
import { readJson } from "@/lib/request";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  const body = await readJson(request);
  try {
    const payment = readSharedPayment(body);
    const result = await prisma.$transaction(tx => recordAdminPayment(tx, {
      ...payment,
      actor: { id: admin.sub, email: admin.email, name: admin.name ?? null },
      now: new Date()
    }));
    return NextResponse.json(result);
  } catch (error) {
    const failure = toPublicCorrectionError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
