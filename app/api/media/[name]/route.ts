import { createHash } from "node:crypto";
import { isProductImageName, productImageStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isProductImageName(name)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const bytes = await productImageStorage.get(name);
    if (!bytes) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    const headers = {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": etag
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  } catch {
    // A storage outage is retryable and must not be cached as a missing image.
    console.error("Product image storage is unavailable.");
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
