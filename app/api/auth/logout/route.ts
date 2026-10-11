import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (session) await prisma.user.update({ where: { id: session.sub }, data: { sessionVersion: { increment: 1 } } });
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
