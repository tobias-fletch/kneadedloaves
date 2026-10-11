import { changeOrderStatus } from "@/lib/order-status";
import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await request.json();
  if (!Object.values(OrderStatus).includes(body.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  try {
    const order = await prisma.$transaction(tx => changeOrderStatus(tx, id, body.status));
    return NextResponse.json(order);
  } catch { return NextResponse.json({ error: "This status change is not allowed. Verify payment or cancellation first." }, { status: 400 }); }
}
