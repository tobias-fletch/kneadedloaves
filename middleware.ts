import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();
  const origin = request.headers.get("origin");
  const expected = process.env.NODE_ENV === "production" ? process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin : `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(expected).origin)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (!origin && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "An Origin header is required." }, { status: 403 });
  }
  const limit = request.nextUrl.pathname === "/api/admin/uploads" ? 6 * 1024 * 1024 : 64 * 1024;
  if (Number(request.headers.get("content-length") || 0) > limit) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  if (request.nextUrl.pathname !== "/api/admin/uploads") {
    const reader = request.clone().body?.getReader();
    let bytes = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel();
        return NextResponse.json({ error: "Request is too large." }, { status: 413 });
      }
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
