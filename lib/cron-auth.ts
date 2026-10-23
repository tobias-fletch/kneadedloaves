import { createHash, timingSafeEqual } from "crypto";

export function isCronAuthorized(authorization: string | null, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const actual = createHash("sha256").update(authorization ?? "", "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(actual, expected);
}
