import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAutomatedDraft } from "@/lib/social";
import { parseOrderWindowInput } from "@/lib/order-rules";
import { readJson } from "@/lib/request";

export async function POST(request: Request) {
  await requireAdmin();
  const contentType = request.headers.get("content-type") ?? "";
  let data;
  try {
    const body = contentType.includes("application/json")
      ? await readJson(request)
      : Object.fromEntries((await request.formData()).entries());
    data = parseOrderWindowInput(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid order window." }, { status: 400 });
  }
  const window = await prisma.orderWindow.create({ data });
  let warning: string | undefined;
  try {
    await createAutomatedDraft({ title: window.name, trigger: "Order window opening soon", orderWindowId: window.id });
  } catch {
    // A draft failure must not disguise a successful save and invite duplicate windows.
    warning = "Window created. Its social draft could not be created; you can make that draft separately.";
  }
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/admin/windows", request.url), { status: 303 });
  }
  return NextResponse.json({ ...window, ...(warning ? { warning } : {}) }, { status: 201 });
}
