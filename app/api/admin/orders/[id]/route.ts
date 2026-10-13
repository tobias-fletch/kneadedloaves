import { changeOrderStatus } from "@/lib/order-status";
import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { readJson } from "@/lib/request";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await readJson(request);
  if (typeof body?.status !== "string" || !Object.values(OrderStatus).includes(body.status as OrderStatus)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  try {
    const order = await prisma.$transaction(tx => changeOrderStatus(tx, id, body.status as OrderStatus, admin.sub));
    return NextResponse.json(order);
  } catch { return NextResponse.json({ error: "This status change is not allowed. Verify payment or cancellation first." }, { status: 400 }); }
}
