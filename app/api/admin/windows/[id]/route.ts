import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOrderWindowInput } from "@/lib/order-rules";
import { readJson } from "@/lib/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await readJson(request);
  if (!Object.keys(body).length) return NextResponse.json({ error: "Provide the window fields to update." }, { status: 400 });
  const existing = await prisma.orderWindow.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Order window not found." }, { status: 404 });

  // An admin must always be able to close a legacy window with invalid configuration.
  if (body.manualClosed === true && Object.keys(body).every((key) => key === "manualClosed")) {
    return NextResponse.json(await prisma.orderWindow.update({ where: { id }, data: { manualClosed: true, manualOpen: false } }));
  }
  let data;
  try {
    data = parseOrderWindowInput(body, existing);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid order window." }, { status: 400 });
  }
  return NextResponse.json(await prisma.orderWindow.update({ where: { id }, data }));
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  await prisma.orderWindow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
