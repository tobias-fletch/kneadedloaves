import { publicRedirectUrl } from "@/lib/public-origin";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAutomatedDraft } from "@/lib/social";
import { assertWindowOrder, parseMaxOrders, parseWindowTimes } from "@/lib/order-window-input";

export async function POST(request: Request) {
  await requireAdmin();
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries((await request.formData()).entries());
  const isJson = contentType.includes("application/json");
  let times: ReturnType<typeof parseWindowTimes>;
  let maxOrders: number | null;
  try {
    // Admin date-times are typed in Eastern Time; store the matching instant.
    times = parseWindowTimes(body, true);
    assertWindowOrder(times.opensAt!, times.closesAt!);
    maxOrders = parseMaxOrders(body.maxOrders) ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check the window times.";
    if (isJson) return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.redirect(publicRedirectUrl(request, `/admin/windows?error=${encodeURIComponent(message)}`), { status: 303 });
  }
  const window = await prisma.orderWindow.create({
    data: {
      name: String(body.name),
      opensAt: times.opensAt!,
      closesAt: times.closesAt!,
      fulfillmentDate: times.fulfillmentDate!,
      maxOrders,
      manualOpen: Boolean(body.manualOpen),
      manualClosed: Boolean(body.manualClosed)
    }
  });
  await createAutomatedDraft({ title: window.name, trigger: "Order window opening soon", orderWindowId: window.id });
  if (!isJson) {
    return NextResponse.redirect(publicRedirectUrl(request, "/admin/windows"), { status: 303 });
  }
  return NextResponse.json(window);
}
