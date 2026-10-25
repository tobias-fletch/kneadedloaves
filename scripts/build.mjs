import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HISTORICAL_MIGRATIONS = Object.freeze([
  "20260627144100_initial",
  "20260628003443_allow_product_delete_with_order_history",
  "20260706215755_admin_setup_config",
  "20260914030000_production_hardening"
]);

// Scoped structural checks, not a full schema-drift comparison: required table
// and column presence is checked; types, constraints, indexes and data are not.
const initialColumns = {
  User: ["id", "email", "passwordHash", "role"],
  CustomerProfile: ["id", "userId"], Category: ["id", "name", "slug"],
  Product: ["id", "name", "slug", "priceCents", "inventoryLimit", "active"],
  ProductImage: ["id", "productId", "url"], Cart: ["id", "userId", "sessionId"],
  CartItem: ["id", "cartId", "productId", "quantity"],
  Order: ["id", "customerEmail", "status", "totalCents", "fulfillmentType", "orderWindowId"],
  OrderItem: ["id", "orderId", "productId", "quantity", "unitPriceCents", "productName"],
  OrderWindow: ["id", "opensAt", "closesAt", "maxOrders", "manualOpen", "manualClosed"],
  DeliveryZone: ["id", "zipCodes", "feeCents", "active"], PickupLocation: ["id", "name", "address", "active"],
  AdminSettings: ["id", "bakeryName"]
};
const hardeningColumns = {
  EmailJob: ["id", "dedupeKey", "to", "subject", "body", "attempts", "status", "availableAt", "lockedUntil", "sentAt"],
  RateLimit: ["key", "count", "expiresAt"], PasswordReset: ["tokenHash", "userId", "expiresAt"]
};
const manualMigration = "20261012230000_manual_venmo_payments";
const manualColumns = {
  Order: ["checkoutRequestHash", "checkoutKeyHash", "checkoutPayloadHash", "currency", "deliveryFeeCents", "fulfillmentLocation", "paymentDestination", "paymentDueAt", "paymentHandle", "paymentMethod", "paymentReference", "paymentReviewRequestedAt", "paymentState", "paymentVerifiedAt", "paymentVerifiedBy", "providerTransactionId", "verifiedAmountCents"],
  PaymentEvent: ["id", "orderId", "type", "actorId", "amountCents", "currency", "providerTransactionId", "receivedAt", "note", "restock", "createdAt"]
};

export function readMigrationPlan(root) {
  const directory = path.join(root, "prisma", "migrations");
  const plan = Object.fromEntries(readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
      if (!/^\d{14}_[a-z0-9_]+$/.test(entry.name)) throw new Error("Unexpected migration directory; review the release migration files.");
      return [entry.name, createHash("sha256").update(readFileSync(path.join(directory, entry.name, "migration.sql"))).digest("hex")];
    }));
  if (HISTORICAL_MIGRATIONS.some(name => !plan[name])) throw new Error("Historical migration files are missing; restore the reviewed migration history before releasing.");
  return plan;
}

// This transaction cannot change data or schema. Every recorded checksum must
// match this checkout before migrate deploy is allowed to run.
export function migrationHistorySql(plan, requireComplete = false) {
  const json = JSON.stringify(plan).replaceAll("'", "''");
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';
DO $migration_guard$
DECLARE
  expected jsonb := '${json}'::jsonb;
  expected_names text[] := ARRAY(SELECT jsonb_object_keys('${json}'::jsonb) ORDER BY 1);
  history regclass := to_regclass(format('%I.%I', current_schema(), '_prisma_migrations'));
  row_record record;
  completed jsonb := '{}'::jsonb;
  completed_count integer := 0;
  table_record record;
  required_column text;
  structure jsonb := '${JSON.stringify(initialColumns)}'::jsonb;
  manual_structure jsonb := '${JSON.stringify(manualColumns)}'::jsonb;
  table_oid oid;
BEGIN
  IF history IS NULL THEN RAISE EXCEPTION 'KNEADED_HISTORY_MISSING'; END IF;
  FOR row_record IN EXECUTE format('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at FROM %s ORDER BY started_at NULLS FIRST, finished_at NULLS FIRST, migration_name', history) LOOP
    IF NOT expected ? row_record.migration_name THEN RAISE EXCEPTION 'KNEADED_HISTORY_UNKNOWN'; END IF;
    IF row_record.checksum IS DISTINCT FROM expected ->> row_record.migration_name THEN RAISE EXCEPTION 'KNEADED_HISTORY_CHECKSUM'; END IF;
    IF row_record.finished_at IS NULL AND row_record.rolled_back_at IS NULL THEN RAISE EXCEPTION 'KNEADED_HISTORY_FAILED'; END IF;
    IF row_record.finished_at IS NOT NULL AND row_record.rolled_back_at IS NOT NULL THEN RAISE EXCEPTION 'KNEADED_HISTORY_INVALID'; END IF;
    IF row_record.started_at IS NULL OR row_record.finished_at < row_record.started_at THEN RAISE EXCEPTION 'KNEADED_HISTORY_TIMING'; END IF;
    IF row_record.finished_at IS NOT NULL AND row_record.rolled_back_at IS NULL THEN
      IF completed ? row_record.migration_name THEN RAISE EXCEPTION 'KNEADED_HISTORY_DUPLICATE'; END IF;
      completed_count := completed_count + 1;
      IF row_record.migration_name IS DISTINCT FROM expected_names[completed_count] THEN RAISE EXCEPTION 'KNEADED_HISTORY_PREFIX'; END IF;
      completed := completed || jsonb_build_object(row_record.migration_name, true);
    END IF;
  END LOOP;
  IF completed_count = 0 THEN RAISE EXCEPTION 'KNEADED_HISTORY_EMPTY'; END IF;
  IF ${requireComplete ? "TRUE" : "FALSE"} AND completed_count <> cardinality(expected_names) THEN RAISE EXCEPTION 'KNEADED_HISTORY_INCOMPLETE'; END IF;
  IF completed ? '20260706215755_admin_setup_config' THEN
    structure := structure || '{"AppConfig":["key","value","secret"]}'::jsonb;
  ELSIF to_regclass(format('%I.%I', current_schema(), 'AppConfig')) IS NOT NULL THEN
    RAISE EXCEPTION 'KNEADED_SCHEMA_HISTORICAL_PARTIAL';
  END IF;
  IF completed ? '20260914030000_production_hardening' THEN
    structure := jsonb_set(structure, '{User}', (structure -> 'User') || '["sessionVersion"]'::jsonb);
    structure := jsonb_set(structure, '{Order}', (structure -> 'Order') || '["receiptTokenHash","inventoryRestored"]'::jsonb)
      || '${JSON.stringify(hardeningColumns)}'::jsonb;
  ELSE
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['EmailJob','RateLimit','PasswordReset']) AS pending(table_name)
      WHERE to_regclass(format('%I.%I', current_schema(), pending.table_name)) IS NOT NULL)
      OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = current_schema()
        AND ((c.table_name = 'User' AND c.column_name = 'sessionVersion')
          OR (c.table_name = 'Order' AND c.column_name IN ('receiptTokenHash','inventoryRestored'))))
      THEN RAISE EXCEPTION 'KNEADED_SCHEMA_HISTORICAL_PARTIAL'; END IF;
  END IF;
  IF completed ? '${manualMigration}' THEN
    structure := jsonb_set(structure, '{Order}', (structure -> 'Order') || (manual_structure -> 'Order'))
      || jsonb_build_object('PaymentEvent', manual_structure -> 'PaymentEvent');
  ELSE
    IF to_regclass(format('%I.%I', current_schema(), 'PaymentEvent')) IS NOT NULL THEN RAISE EXCEPTION 'KNEADED_SCHEMA_PARTIAL'; END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = current_schema() AND c.table_name = 'Order'
        AND c.column_name IN (SELECT jsonb_array_elements_text(manual_structure -> 'Order')))
      THEN RAISE EXCEPTION 'KNEADED_SCHEMA_PARTIAL'; END IF;
  END IF;
  FOR table_record IN SELECT key, value FROM jsonb_each(structure) LOOP
    table_oid := to_regclass(format('%I.%I', current_schema(), table_record.key));
    IF table_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = table_oid AND relkind IN ('r', 'p'))
      THEN RAISE EXCEPTION 'KNEADED_SCHEMA_TABLE'; END IF;
    FOR required_column IN SELECT jsonb_array_elements_text(table_record.value) LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = current_schema()
        AND c.table_name = table_record.key AND c.column_name = required_column)
        THEN RAISE EXCEPTION 'KNEADED_SCHEMA_COLUMN'; END IF;
    END LOOP;
  END LOOP;
END;
$migration_guard$;
COMMIT;
`;
}

const historyErrors = {
  KNEADED_SCHEMA_HISTORICAL_PARTIAL: "Later historical schema effects exist without their completed migration record. Have the owner reconcile the partial or unrecorded schema before retrying.",
  KNEADED_SCHEMA_TABLE: "A required application table is absent or renamed. Verify this is the intended live database and have the owner investigate its schema before retrying.",
  KNEADED_SCHEMA_COLUMN: "A required application column is absent or renamed. Have the owner investigate schema drift before retrying; this build will not repair the baseline.",
  KNEADED_SCHEMA_PARTIAL: "Manual-payment schema exists without its completed migration record. Have the owner reconcile this partial or unrecorded change before retrying.",
  KNEADED_HISTORY_MISSING: "The database has no Prisma migration history. Have the owner review and baseline the existing schema separately; this build will not baseline it.",
  KNEADED_HISTORY_UNKNOWN: "The database contains a migration absent from this release. Use the matching release history or reconcile it with the owner first.",
  KNEADED_HISTORY_CHECKSUM: "A stored migration checksum differs from this release. Restore the original migration SQL or have the owner investigate the drift.",
  KNEADED_HISTORY_FAILED: "A failed or unfinished migration is unresolved. Have the owner investigate and resolve it separately before retrying.",
  KNEADED_HISTORY_INVALID: "Migration history contains an invalid finished-and-rolled-back record. Have the owner investigate before retrying.",
  KNEADED_HISTORY_DUPLICATE: "Migration history contains duplicate completed records. Have the owner reconcile the history before retrying.",
  KNEADED_HISTORY_TIMING: "Migration history contains invalid execution timestamps. Have the owner investigate before retrying.",
  KNEADED_HISTORY_EMPTY: "The migration history is empty. Have the owner review and baseline the existing schema separately; this build will not baseline it.",
  KNEADED_HISTORY_PREFIX: "Completed migrations do not form a contiguous, correctly ordered prefix of this release. Have the owner investigate gaps or out-of-order history before retrying.",
  KNEADED_HISTORY_INCOMPLETE: "The deployment did not complete every repository migration. Investigate the incomplete migration history before retrying."
};

export const DIAGNOSTIC_MAX_LINES = 80;
const DIAGNOSTIC_MAX_CHARS = 12000;
// Env keys whose values must never reach build logs, even inside compiler or
// prerender output. Matching is deliberately broad; over-redaction is fine.
const SENSITIVE_ENV_KEY = /SECRET|PASSWORD|PASSWD|PASS$|TOKEN|KEY|DATABASE|POSTGRES|^PG|URL|URI|DSN|SMTP|STRIPE|VENMO|CREDENTIAL|AUTH|PRIVATE|SALT|FINGERPRINT|LATLNG|HANDLE|DESTINATION|EMAIL|NEON|COOKIE|SESSION/i;

/**
 * Make failed non-database build output safe to print: drop known sensitive env
 * values, URL credentials and any database connection strings, then keep only
 * the tail (where Next.js reports the actual error).
 */
export function redactDiagnostics(output, env = {}) {
  // Strip ANSI colour codes so the Vercel log stays readable.
  let text = String(output || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const secrets = Object.entries(env)
    .filter(([key, value]) => typeof value === "string" && SENSITIVE_ENV_KEY.test(key))
    .flatMap(([, value]) => [value, value.trim()])
    .filter(value => value.length >= 6)
    .sort((a, b) => b.length - a.length);
  for (const secret of new Set(secrets)) text = text.split(secret).join("[redacted]");
  text = text
    .replace(/\b(postgres(?:ql)?|prisma(?:\+postgres)?|mysql|mongodb(?:\+srv)?|redis(?:s)?):\/\/[^\s'"`<>]+/gi, "$1://[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"`<>]+@/gi, "$1[redacted]@");
  const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean).slice(-DIAGNOSTIC_MAX_LINES);
  let excerpt = lines.join("\n");
  if (excerpt.length > DIAGNOSTIC_MAX_CHARS) excerpt = excerpt.slice(-DIAGNOSTIC_MAX_CHARS);
  return excerpt;
}

// Prisma error codes that mean "try again shortly", never "the migration is bad":
// P1001 can't reach the server (Neon compute waking), P1002 timed out (including
// migrate's 10s pg_advisory_lock wait), P1017 the server closed the connection.
export const TRANSIENT_MIGRATE_ERRORS = Object.freeze(["P1001", "P1002", "P1017"]);
export const MIGRATE_RETRY_DELAYS_MS = Object.freeze([5000, 15000]);

/** Only the Prisma error code (e.g. P1002) is ever surfaced from a database step. */
export function prismaErrorCode(output) {
  return String(output || "").match(/\bP[0-9]{4}\b/)?.[0];
}

/**
 * Same database, same credentials, direct (session) endpoint. Neon's pooler
 * runs PgBouncer in transaction mode, which cannot hold the session-level
 * advisory lock that `prisma migrate deploy` takes: the lock can be left on a
 * pooled server connection and the next deploy waits 10s and fails (P1002).
 * Only the "-pooler" suffix of a Neon endpoint host is removed; any other URL is
 * returned unchanged. connect_timeout is raised so a suspended compute can wake.
 */
export function migrationDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const [endpoint, ...domain] = url.hostname.split(".");
  if (endpoint.endsWith("-pooler") && /(^|\.)neon\.tech$/.test(domain.join("."))) {
    url.hostname = [endpoint.slice(0, -"-pooler".length), ...domain].join(".");
    url.searchParams.delete("pgbouncer");
  }
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
  return url.toString();
}


// ---- Preview database isolation (Hub #113) --------------------------------
// Keep in sync with lib/preview-database.ts (tests compare both).
export function normalizeDatabaseHost(host) {
  const [endpoint, ...domain] = String(host).trim().toLowerCase().split(".");
  return [endpoint.replace(/-pooler$/, ""), ...domain].join(".");
}
function databaseHostOf(value) {
  if (!value?.trim()) return undefined;
  try { return normalizeDatabaseHost(new URL(value.trim()).hostname) || undefined; } catch { return undefined; }
}
export function productionDatabaseHosts(env) {
  const listed = String(env.PRODUCTION_DB_HOST || "").split(",").map(h => h.trim()).filter(Boolean).map(normalizeDatabaseHost);
  const fromUrl = databaseHostOf(env.DATABASE_URL);
  return [...new Set([...listed, ...(fromUrl ? [fromUrl] : [])])];
}
/** The Neon preview-branch URL for this deployment, or throw. Never a production connection. */
export function previewDatabaseUrl(env) {
  const candidate = [env.URL_POSTGRES_PRISMA_URL, env.URL_DATABASE_URL].map(v => v?.trim()).find(Boolean);
  if (!candidate) throw new Error("Preview database is not configured (no Neon preview branch connection); refusing to fall back to production.");
  const host = databaseHostOf(candidate);
  if (!host) throw new Error("Preview database connection is invalid.");
  const production = productionDatabaseHosts(env);
  if (production.length === 0) throw new Error("Cannot verify the preview database is not production (set PRODUCTION_DB_HOST); refusing to connect.");
  if (production.includes(host)) throw new Error("Preview deployment is pointed at the production database; refusing to connect.");
  return candidate;
}
/** Short non-reversible fingerprint of a database host, safe for build logs. */
export function hostFingerprint(host) {
  return createHash("sha256").update(String(host)).digest("hex").slice(0, 10);
}
// Customer/personal data and secrets removed from every preview branch. The menu
// (Category, Product, ProductImage), order windows, delivery zones, pickup
// locations, events, templates, admin settings and non-secret config stay.
export const PREVIEW_SCRUB_TABLES = Object.freeze([
  "OrderItem", "PaymentEvent", "EmailJob", "Order", "CartItem", "Cart", "CustomerProfile",
  "PasswordReset", "RateLimit", "EmailSubscriber", "SocialPostAsset", "SocialPost", "SocialPlatformAccount", "User"
]);
export const PREVIEW_SCRUB_SQL = `BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
TRUNCATE ${PREVIEW_SCRUB_TABLES.map(t => `"${t}"`).join(", ")};
DELETE FROM "AppConfig" WHERE "secret" = true;
DO $scrub_check$ BEGIN
  IF EXISTS (SELECT 1 FROM "Order") OR EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "EmailJob") THEN RAISE EXCEPTION 'KNEADED_SCRUB_INCOMPLETE'; END IF;
END $scrub_check$;
COMMIT;
`;

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function runBuild({ root = process.cwd(), env = process.env, run = spawnSync, log = console.log, diagnostic = console.error, sleep = sleepSync } = {}) {
  const prisma = path.join(root, "node_modules", "prisma", "build", "index.js");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  // Database steps (historyCheck or a dedicated databaseEnv) never forward output.
  // Only non-database steps opt in with showDiagnostics, and even then the
  // output is redacted and truncated before it is printed.
  const step = (label, executable, args, commandEnv = env, input, historyCheck = false, showDiagnostics = false, retryDelays = []) => {
    log(label);
    for (let attempt = 0; ; attempt++) {
      try {
        return runOnce(label, executable, args, commandEnv, input, historyCheck, showDiagnostics);
      } catch (error) {
        const delay = retryDelays[attempt];
        if (delay === undefined || !TRANSIENT_MIGRATE_ERRORS.includes(error.prismaCode)) throw error;
        log(`${label}: transient database error ${error.prismaCode}; retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 2} of ${retryDelays.length + 1})`);
        sleep(delay);
      }
    }
  };
  const runOnce = (label, executable, args, commandEnv, input, historyCheck, showDiagnostics) => {
    let result;
    try {
      result = run(process.execPath, [executable, ...args], {
        cwd: root, env: commandEnv, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
        shell: false, stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      throw new Error(`${label} could not start. Check the installed dependencies and build environment; the release was stopped.`);
    }
    if (!result || result.error || result.signal || result.status !== 0) {
      // Connection details can appear in Prisma diagnostics. Never forward raw
      // subprocess output, command environment values, or exception messages.
      // Non-database steps print a redacted tail so build failures are diagnosable.
      const output = `${result?.stdout || ""}\n${result?.stderr || ""}`;
      const reason = historyCheck && Object.entries(historyErrors).find(([code]) => output.includes(code));
      if (showDiagnostics && !historyCheck) {
        const excerpt = redactDiagnostics(output, commandEnv);
        if (excerpt) diagnostic(`${label} output (redacted, last ${DIAGNOSTIC_MAX_LINES} lines max):\n${excerpt}`);
      }
      const code = prismaErrorCode(output);
      const error = new Error(reason ? reason[1] : `${label} failed${code ? ` (Prisma ${code})` : ""}. Check connectivity, database permissions, migration history, and the build environment in a trusted session; the release was stopped.`);
      error.prismaCode = code;
      throw error;
    }
  };
  // Production database commands run only on a real production deploy:
  // Vercel sets VERCEL_ENV=production; Netlify sets NETLIFY=true with
  // CONTEXT=production. Any other context skips migrations entirely.
  const isProductionDeploy = env.VERCEL_ENV === "production"
    || (env.NETLIFY === "true" && env.CONTEXT === "production");
  if (isProductionDeploy) {
    // Never substitute integration-created/nonpooled URL variables: they can
    // point at another project. This must be the existing app connection.
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("Production build requires the existing DATABASE_URL; no database command was run.");
    let parsed;
    try { parsed = new URL(databaseUrl); } catch { throw new Error("The production database connection is invalid; no database command was run."); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("The production database connection must use PostgreSQL; no database command was run.");
    const databaseEnv = { ...env, DATABASE_URL: migrationDatabaseUrl(databaseUrl) };
    const plan = readMigrationPlan(root);
    const execute = ["db", "execute", "--schema", "prisma/schema.prisma", "--stdin"];
    step("Checking production migration history (read-only)", prisma, execute, databaseEnv, migrationHistorySql(plan), true);
    // migrate deploy is idempotent (applied migrations are skipped, each runs in
    // its own transaction), so only connection/lock timeouts are retried.
    step("Applying reviewed production migrations", prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], databaseEnv, undefined, false, false, MIGRATE_RETRY_DELAYS_MS);
    step("Verifying completed production migrations (read-only)", prisma, execute, databaseEnv, migrationHistorySql(plan, true), true);
  } else if (env.VERCEL_ENV === "preview") {
    // Previews use their own Neon branch only. Guard first (throws if the URL is
    // missing or is production), then scrub customer data, then bring the
    // branch schema up to this commit. Production is never touched here.
    const previewUrl = previewDatabaseUrl(env);
    const previewHost = databaseHostOf(previewUrl);
    log(`Preview database: own Neon branch (host ${hostFingerprint(previewHost)}), production host(s) ${productionDatabaseHosts(env).map(hostFingerprint).join(", ")}; not production.`);
    const previewEnv = { ...env, DATABASE_URL: migrationDatabaseUrl(previewUrl) };
    const execute = ["db", "execute", "--schema", "prisma/schema.prisma", "--stdin"];
    step("Scrubbing customer data from the preview branch", prisma, execute, previewEnv, PREVIEW_SCRUB_SQL, false, false, MIGRATE_RETRY_DELAYS_MS);
    step("Applying migrations to the preview branch", prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], previewEnv, undefined, false, false, MIGRATE_RETRY_DELAYS_MS);
  } else {
    log("Skipping database migrations outside a production deploy.");
  }
  step("Generating Prisma client", prisma, ["generate", "--schema", "prisma/schema.prisma"], env, undefined, false, true);
  step("Building Next.js", next, ["build"], env, undefined, false, true);
  log("Build completed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runBuild(); } catch (error) {
    console.error(`Build stopped: ${error instanceof Error ? error.message : "Unexpected build failure."}`);
    process.exitCode = 1;
  }
}
