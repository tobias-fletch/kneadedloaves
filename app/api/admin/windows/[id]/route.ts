import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertWindowOrder, parseMaxOrders, parseWindowTimes } from "@/lib/order-window-input";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await request.json();
  let times: ReturnType<typeof parseWindowTimes>;
  let maxOrders: number | null | undefined;
  try {
    // Admin date-times are typed in Eastern Time; store the matching instant.
    times = parseWindowTimes(body, false);
    if (times.opensAt || times.closesAt) {
      const existing = await prisma.orderWindow.findUnique({ where: { id }, select: { opensAt: true, closesAt: true } });
      if (!existing) return NextResponse.json({ error: "Window not found." }, { status: 404 });
      assertWindowOrder(times.opensAt ?? existing.opensAt, times.closesAt ?? existing.closesAt);
    }
    maxOrders = parseMaxOrders(body.maxOrders);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Check the window times." }, { status: 400 });
  }
  const window = await prisma.orderWindow.update({
    where: { id },
    data: {
      manualOpen: body.manualOpen,
      manualClosed: body.manualClosed,
      opensAt: times.opensAt,
      closesAt: times.closesAt,
      fulfillmentDate: times.fulfillmentDate,
      maxOrders
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
