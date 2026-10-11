import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAutomatedDraft } from "@/lib/social";

export async function POST(request: Request) {
  await requireAdmin();
  const contentType = request.headers.get("content-type") ?? "";
  const formData = contentType.includes("application/json") ? null : await request.formData();
  const body = formData ? Object.fromEntries(formData.entries()) : await request.json();
  const productIds = formData ? formData.getAll("productIds").map(String) : body.productIds;
  const event = await prisma.popupEvent.create({
    data: {
      title: String(body.title),
      startsAt: new Date(body.startsAt),
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      location: String(body.location),
      description: String(body.description),
      rsvpUrl: body.rsvpUrl || null,
      products: Array.isArray(productIds) ? { connect: productIds.map((id: string) => ({ id })) } : undefined
    }
  });
  await createAutomatedDraft({ title: event.title, trigger: "Pop-up event", popupEventId: event.id });
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/admin/events", request.url), { status: 303 });
  }
  return NextResponse.json(event);
}
