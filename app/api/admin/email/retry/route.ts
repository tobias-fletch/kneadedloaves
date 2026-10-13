import { publicRedirectUrl } from "@/lib/public-origin";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  await prisma.emailJob.updateMany({ where: { id: String(form.get("id")), status: "FAILED" }, data: { status: "PENDING", attempts: 0, availableAt: new Date(), lockedUntil: null } });
  return NextResponse.redirect(publicRedirectUrl(request, "/admin/email"), 303);
}
