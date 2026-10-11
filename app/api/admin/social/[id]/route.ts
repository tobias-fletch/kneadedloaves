import { NextResponse } from "next/server";
import { SocialPostStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await request.json();
  if (!Object.values(SocialPostStatus).includes(body.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  const post = await prisma.socialPost.update({ where: { id }, data: { status: body.status } });
  return NextResponse.json(post);
}
