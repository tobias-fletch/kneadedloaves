import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  await prisma.popupEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
