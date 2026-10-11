import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await request.json();
  const window = await prisma.orderWindow.update({
    where: { id },
    data: {
      manualOpen: body.manualOpen,
      manualClosed: body.manualClosed,
      opensAt: body.opensAt ? new Date(body.opensAt) : undefined,
      closesAt: body.closesAt ? new Date(body.closesAt) : undefined,
      fulfillmentDate: body.fulfillmentDate ? new Date(body.fulfillmentDate) : undefined,
      maxOrders: body.maxOrders === undefined ? undefined : Number(body.maxOrders)
    }
  });
  return NextResponse.json(window);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  await prisma.orderWindow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
