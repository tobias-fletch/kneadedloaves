import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { attemptPublish } from "@/lib/social";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const post = await attemptPublish(id);
  return NextResponse.json(post);
}
