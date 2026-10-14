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

export function runBuild({ root = process.cwd(), env = process.env, run = spawnSync, log = console.log } = {}) {
  const prisma = path.join(root, "node_modules", "prisma", "build", "index.js");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const step = (label, executable, args, commandEnv = env, input, historyCheck = false) => {
    log(label);
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
      const output = `${result?.stdout || ""}\n${result?.stderr || ""}`;
      const reason = historyCheck && Object.entries(historyErrors).find(([code]) => output.includes(code));
      throw new Error(reason ? reason[1] : `${label} failed. Check connectivity, database permissions, migration history, and the build environment in a trusted session; the release was stopped.`);
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
    const databaseEnv = { ...env, DATABASE_URL: databaseUrl };
    const plan = readMigrationPlan(root);
    const execute = ["db", "execute", "--schema", "prisma/schema.prisma", "--stdin"];
    step("Checking production migration history (read-only)", prisma, execute, databaseEnv, migrationHistorySql(plan), true);
    step("Applying reviewed production migrations", prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], databaseEnv);
    step("Verifying completed production migrations (read-only)", prisma, execute, databaseEnv, migrationHistorySql(plan, true), true);
  } else {
    log("Skipping database migrations outside a production deploy.");
  }
  step("Generating Prisma client", prisma, ["generate", "--schema", "prisma/schema.prisma"]);
  step("Building Next.js", next, ["build"]);
  log("Build completed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runBuild(); } catch (error) {
    console.error(`Build stopped: ${error instanceof Error ? error.message : "Unexpected build failure."}`);
    process.exitCode = 1;
  }
}
