import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Contact-form-only rate limiter. Self-contained so the shared lib/request.ts
 * rateLimit (used by cart, checkout and auth) is untouched. Uses the existing
 * RateLimit table with a "contact-rl:" key prefix and its own window length.
 * Fails closed: a storage error counts as over the limit.
 */
export async function contactRateLimit(
  _request: Request,
  scope: string,
  limit: number,
  identifier: string,
  windowMs = 600_000,
  now = Date.now()
): Promise<boolean> {
  const bucket = Math.floor(now / windowMs);
  const key = createHash("sha256").update(`contact-rl:${scope}:${windowMs}:${identifier}:${bucket}`).digest("hex");
  try {
    const result = await prisma.rateLimit.upsert({
      where: { key },
      update: { count: { increment: 1 } },
      create: { key, count: 1, expiresAt: new Date((bucket + 1) * windowMs) }
    });
    return result.count <= limit;
  } catch {
    return false;
  }
}
