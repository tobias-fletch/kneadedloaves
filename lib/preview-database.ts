// Preview deployments must never use the production database (Hub #113).
//
// On Vercel previews the Neon integration injects a per-deployment branch
// connection (URL_POSTGRES_PRISMA_URL / URL_DATABASE_URL). The build scrubs that
// branch of customer data (scripts/build.mjs) and the app connects only to it.
// If the injected URL is missing, or points at the production host (for example
// when branch provisioning failed and the project-level URL_* values leaked
// through), the app refuses to connect at all. Fails closed: if the production
// host cannot be determined, previews refuse to connect too.
//
// Keep in sync with previewDatabaseUrl() in scripts/build.mjs (tests compare both).

type Env = Record<string, string | undefined>;

/** Neon pooled and direct endpoints share one database: compare without "-pooler". */
export function normalizeDatabaseHost(host: string): string {
  const [endpoint, ...domain] = host.trim().toLowerCase().split(".");
  return [endpoint.replace(/-pooler$/, ""), ...domain].join(".");
}

function hostOf(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try { return normalizeDatabaseHost(new URL(value.trim()).hostname) || undefined; } catch { return undefined; }
}

/** Hosts that belong to production: PRODUCTION_DB_HOST (comma-separated hostnames) and DATABASE_URL. */
export function productionDatabaseHosts(env: Env): string[] {
  const listed = (env.PRODUCTION_DB_HOST || "").split(",").map(h => h.trim()).filter(Boolean).map(normalizeDatabaseHost);
  const fromUrl = hostOf(env.DATABASE_URL);
  return [...new Set([...listed, ...(fromUrl ? [fromUrl] : [])])];
}

export class PreviewDatabaseError extends Error {}

/** The isolated preview database URL, or throw. Never returns a production connection. */
export function previewDatabaseUrl(env: Env): string {
  const candidate = [env.URL_POSTGRES_PRISMA_URL, env.URL_DATABASE_URL].map(v => v?.trim()).find(Boolean);
  if (!candidate) throw new PreviewDatabaseError("Preview database is not configured (no Neon preview branch connection); refusing to fall back to production.");
  const host = hostOf(candidate);
  if (!host) throw new PreviewDatabaseError("Preview database connection is invalid.");
  const production = productionDatabaseHosts(env);
  if (production.length === 0) throw new PreviewDatabaseError("Cannot verify the preview database is not production (set PRODUCTION_DB_HOST); refusing to connect.");
  if (production.includes(host)) throw new PreviewDatabaseError("Preview deployment is pointed at the production database; refusing to connect.");
  return candidate;
}

/** Datasource override for the Prisma client: only on Vercel previews. Production/local unchanged. */
export function prismaDatasourceUrl(env: Env): string | undefined {
  return env.VERCEL_ENV === "preview" ? previewDatabaseUrl(env) : undefined;
}
