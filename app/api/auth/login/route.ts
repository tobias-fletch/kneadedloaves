import { rateLimit } from "@/lib/request";
import { NextResponse } from "next/server";
import { authenticate, SESSION_COOKIE, signSession } from "@/lib/auth";

export async function POST(request: Request) {
  if (!await rateLimit(request, "login", 20)) return NextResponse.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const session = await authenticate(email, password);
  if (!session) {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), { status: 303 });
  }
  const response = NextResponse.redirect(new URL(session.role === "ADMIN" ? "/admin" : "/account", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/"
  });
  return response;
}
