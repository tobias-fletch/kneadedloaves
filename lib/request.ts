import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); return {}; }
    chunks.push(value);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return result && typeof result === "object" && !Array.isArray(result) ? result : {};
  } catch { return {}; }
}

// Only enable forwarded IPs behind a proxy that replaces the client-supplied header.
// windowMs defaults to the original 10-minute bucket; other windows (e.g. 1 hour, 1 day) get their own keys.
export async function rateLimit(request: Request, scope: string, limit = 30, identifier?: string, windowMs = 600000) {
  const ip = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : "shared";
  const bucket = Math.floor(Date.now() / windowMs);
  const window = windowMs === 600000 ? "" : `:${windowMs}`;
  const key = createHash("sha256").update(`${scope}${window}:${identifier || ip || "shared"}:${bucket}`).digest("hex");
  try {
    const result = await prisma.rateLimit.upsert({
      where: { key }, update: { count: { increment: 1 } },
      create: { key, count: 1, expiresAt: new Date((bucket + 1) * windowMs) }
    });
    return result.count <= limit;
  } catch {
    // Never permit unlimited authentication or mutations during a storage outage.
    return false;
  }
}
