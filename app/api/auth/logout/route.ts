import { publicRedirectUrl } from "@/lib/public-origin";
import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function POST(request: Request) {
  const session = await getSession(true);
  if (session) await prisma.user.update({ where: { id: session.sub }, data: { sessionVersion: { increment: 1 } } });
  const response = NextResponse.redirect(publicRedirectUrl(request, "/"), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
