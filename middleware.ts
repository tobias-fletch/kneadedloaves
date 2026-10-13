import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();
  try {
    // Never derive the production allowlist from Host or forwarding headers.
    const configuredUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!configuredUrl && process.env.NODE_ENV === "production") return NextResponse.json({ error: "Request validation is unavailable." }, { status: 503 });
    const expected = new URL(configuredUrl || request.nextUrl.origin);
    if (!["http:", "https:"].includes(expected.protocol) || expected.username || expected.password || (process.env.NODE_ENV === "production" && expected.protocol !== "https:")) return NextResponse.json({ error: "Request validation is unavailable." }, { status: 503 });
    if (process.env.NODE_ENV === "production" && (request.headers.get("host") || request.nextUrl.host).toLowerCase() !== expected.host.toLowerCase()) return NextResponse.json({ error: "Request host is not allowed." }, { status: 403 });
    const origin = request.headers.get("origin");
    if (!origin || origin !== expected.origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
    const isUpload = request.nextUrl.pathname.replace(/\/$/, "") === "/api/admin/uploads";
    const limit = isUpload ? 6 * 1024 * 1024 : 64 * 1024;
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) return NextResponse.json({ error: "Invalid request length." }, { status: 400 });
    if (Number(contentLength || 0) > limit) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    // Content-Length is optional; stream-check multipart and chunked bodies too.
    const reader = request.clone().body?.getReader();
    let bytes = 0;
    try {
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          // A tee cancellation may wait for the original branch, so do not await it.
          void reader.cancel().catch(() => undefined);
          return NextResponse.json({ error: "Request is too large." }, { status: 413 });
        }
      }
    } catch {
      return NextResponse.json({ error: "Request body could not be validated." }, { status: 400 });
    } finally { reader?.releaseLock(); }
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: "Request validation is unavailable." }, { status: 503 });
  }
}
export const config = { matcher: "/api/:path*" };
