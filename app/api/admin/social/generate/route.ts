import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { generateContentIdeas } from "@/lib/social";

export async function POST(request: Request) {
  await requireAdmin();
  const body = await request.json();
  return NextResponse.json(generateContentIdeas({
    type: String(body.type ?? "general"),
    subject: String(body.subject ?? "weekly menu"),
    defaultHashtags: Array.isArray(body.defaultHashtags) ? body.defaultHashtags : []
  }));
}
