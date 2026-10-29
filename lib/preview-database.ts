// Preview deployments must never use the production database (Hub #113).
//
// On Vercel previews the Neon integration injects a per-deployment branch
// connection (URL_POSTGRES_PRISMA_URL / URL_DATABASE_URL). The build scrubs that
// branch of customer data (scripts/build.mjs) and the app connects only to it.
// If the injected URL is missing, or its host is the production host (for
// example when branch provisioning failed and project-level URL_* values leaked
// through), the app refuses to connect at all.
//
// Production is identified by a committed, non-secret fingerprint of its host
// (PRODUCTION_DB_HOST_FINGERPRINTS), so Preview needs no production settings:
// no PRODUCTION_DB_HOST and no production credentials. PRODUCTION_DB_HOST and
// DATABASE_URL, when present, are still added to the refusal list.
//
// Keep in sync with previewDatabaseUrl() in scripts/build.mjs (tests compare both).
import { createHash } from "node:crypto";

type Env = Record<string, string | undefined>;

/**
 * sha256(normalized production host), first 10 hex chars. Not a secret: it is a
 * one-way digest of a hostname. A random match only makes a preview refuse to
 * connect (fails safe); it can never let a preview through to production.
 * If production moves to a new Neon endpoint, add its fingerprint here (the
 * production build log prints it) before removing the old one.
 */
export const PRODUCTION_DB_HOST_FINGERPRINTS: readonly string[] = Object.freeze(["e542c8ef81"]);

/** Neon pooled and direct endpoints share one database: compare without "-pooler". */
export function normalizeDatabaseHost(host: string): string {
  const [endpoint, ...domain] = host.trim().toLowerCase().split(".");
  return [endpoint.replace(/-pooler$/, ""), ...domain].join(".");
}

/** Short non-reversible fingerprint of a database host, safe for build logs. */
export function hostFingerprint(host: string): string {
  return createHash("sha256").update(String(host)).digest("hex").slice(0, 10);
}

function hostOf(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try { return normalizeDatabaseHost(new URL(value.trim()).hostname) || undefined; } catch { return undefined; }
}

/** Hosts that belong to production, when known here: PRODUCTION_DB_HOST (comma-separated) and DATABASE_URL. */
export function productionDatabaseHosts(env: Env): string[] {
  const listed = (env.PRODUCTION_DB_HOST || "").split(",").map(h => h.trim()).filter(Boolean).map(normalizeDatabaseHost);
  const fromUrl = hostOf(env.DATABASE_URL);
  return [...new Set([...listed, ...(fromUrl ? [fromUrl] : [])])];
}

/** Fingerprints a preview must never connect to: the committed list plus any production host in env. */
export function productionHostFingerprints(env: Env, known: readonly string[] = PRODUCTION_DB_HOST_FINGERPRINTS): string[] {
  return [...new Set([...known.map(f => f.trim().toLowerCase()).filter(Boolean), ...productionDatabaseHosts(env).map(hostFingerprint)])];
}

export class PreviewDatabaseError extends Error {}

/** The isolated preview database URL, or throw. Never returns a production connection. */
export function previewDatabaseUrl(env: Env, known: readonly string[] = PRODUCTION_DB_HOST_FINGERPRINTS): string {
  const candidate = [env.URL_POSTGRES_PRISMA_URL, env.URL_DATABASE_URL].map(v => v?.trim()).find(Boolean);
  if (!candidate) throw new PreviewDatabaseError("Preview database is not configured (no Neon preview branch connection); refusing to fall back to production.");
  const host = hostOf(candidate);
  if (!host) throw new PreviewDatabaseError("Preview database connection is invalid.");
  const production = productionHostFingerprints(env, known);
  if (production.length === 0) throw new PreviewDatabaseError("Cannot verify the preview database is not production (no production host fingerprint); refusing to connect.");
  if (production.includes(hostFingerprint(host))) throw new PreviewDatabaseError("Preview deployment is pointed at the production database; refusing to connect.");
  return candidate;
}

/** Datasource override for the Prisma client: only on Vercel previews. Production/local unchanged. */
export function prismaDatasourceUrl(env: Env): string | undefined {
  return env.VERCEL_ENV === "preview" ? previewDatabaseUrl(env) : undefined;
}
