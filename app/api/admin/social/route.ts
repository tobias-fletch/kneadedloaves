import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { socialPostSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  const parsed = socialPostSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid post." }, { status: 400 });
  const post = await prisma.socialPost.create({
    data: {
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      productId: parsed.data.productId || undefined,
      popupEventId: parsed.data.popupEventId || undefined,
      authorId: admin.sub
    }
  });
  return NextResponse.json(post);
}
