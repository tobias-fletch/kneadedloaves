import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAutomatedDraft } from "@/lib/social";

export async function POST(request: Request) {
  await requireAdmin();
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries((await request.formData()).entries());
  const window = await prisma.orderWindow.create({
    data: {
      name: String(body.name),
      opensAt: new Date(body.opensAt),
      closesAt: new Date(body.closesAt),
      fulfillmentDate: new Date(body.fulfillmentDate),
      maxOrders: body.maxOrders ? Number(body.maxOrders) : null,
      manualOpen: Boolean(body.manualOpen),
      manualClosed: Boolean(body.manualClosed)
    }
  });
  await createAutomatedDraft({ title: window.name, trigger: "Order window opening soon", orderWindowId: window.id });
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/admin/windows", request.url), { status: 303 });
  }
  return NextResponse.json(window);
}
