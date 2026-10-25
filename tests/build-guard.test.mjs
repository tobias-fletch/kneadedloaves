import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HISTORICAL_MIGRATIONS, MIGRATE_RETRY_DELAYS_MS, migrationDatabaseUrl, migrationHistorySql, prismaErrorCode, readMigrationPlan, redactDiagnostics, runBuild } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = "postgresql://synthetic:do-not-log-this@127.0.0.1:55499/build_guard";
const wrongProject = "postgresql://wrong:never-use-this@wrong.example.invalid/other_project";
function harness(env, failAt = -1, failure = {}) {
  const calls = [], logs = [], diagnostics = [], sleeps = [];
  const fails = new Set([failAt].flat());
  const invoke = () => runBuild({ root, env, log: message => logs.push(message), diagnostic: message => diagnostics.push(message), sleep: ms => sleeps.push(ms), run: (command, args, options) => {
    calls.push({ command, args, options });
    return fails.has(calls.length) ? { status: 1, stdout: "", stderr: "", ...failure } : { status: 0, stdout: "", stderr: "" };
  } });
  return { calls, logs, diagnostics, sleeps, invoke };
}
const dbUrl = migrationDatabaseUrl(databaseUrl);
test("local, development and misspelled production builds never run database commands", () => {
  for (const VERCEL_ENV of [undefined, "development", "Preview", "Production", " production"]) {
    const h = harness({ VERCEL_ENV, DATABASE_URL: databaseUrl });h.invoke();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls.map(call => call.args.slice(1)), [["generate", "--schema", "prisma/schema.prisma"], ["build"]]);
    assert.ok(h.calls.every(call => call.options.input === undefined));
  }
});
test("Netlify production context runs the same database-guarded deploy", () => {
  const h = harness({ NETLIFY: "true", CONTEXT: "production", DATABASE_URL: databaseUrl });h.invoke();
  assert.deepEqual(h.calls.map(call => call.args.slice(1, 3)), [["db", "execute"], ["migrate", "deploy"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
  assert.deepEqual(h.calls.map(call => call.options.env.DATABASE_URL), [dbUrl, dbUrl, dbUrl, databaseUrl, databaseUrl]);
});
test("Netlify preview and branch contexts never run database commands", () => {
  for (const CONTEXT of ["deploy-preview", "branch-deploy", "dev"]) {
    const h = harness({ NETLIFY: "true", CONTEXT, DATABASE_URL: databaseUrl });h.invoke();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls.map(call => call.args.slice(1)), [["generate", "--schema", "prisma/schema.prisma"], ["build"]]);
  }
});
test("production checks history, deploys, rechecks all migrations, then generates and builds", () => {
  const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: wrongProject, URL_DATABASE_URL_UNPOOLED: wrongProject, URL_POSTGRES_URL_NON_POOLING: wrongProject });h.invoke();
  assert.deepEqual(h.calls.map(call => call.args.slice(1, 3)), [["db", "execute"], ["migrate", "deploy"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
  assert.ok(h.calls.every(call => call.command === process.execPath && call.options.shell === false));
  assert.deepEqual(h.calls.map(call => call.options.env.DATABASE_URL), [dbUrl, dbUrl, dbUrl, databaseUrl, databaseUrl]);
  assert.ok(h.calls.every(call => !call.args.some(arg => arg.includes("postgresql://"))));
  assert.match(h.calls[0].options.input, /^BEGIN READ ONLY;/);
  assert.match(h.calls[2].options.input, /20261012230000_manual_venmo_payments/);
  assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
});
test("production never falls back to an unrelated nonpooled connection", () => {
  for (const DATABASE_URL of [undefined, "", "  ", "not-a-url", "https://wrong.example.invalid"]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL, DATABASE_URL_UNPOOLED: wrongProject, URL_DATABASE_URL_UNPOOLED: wrongProject });
    assert.throws(h.invoke, /database connection|DATABASE_URL/);assert.equal(h.calls.length, 0);
  }
});
test("every unsafe preflight result stops before any migration write", () => {
  for (const code of ["MISSING", "EMPTY", "PREFIX", "UNKNOWN", "CHECKSUM", "FAILED", "INVALID", "TIMING", "DUPLICATE", "INCOMPLETE"]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, 1, { stderr: `secret ${databaseUrl} KNEADED_HISTORY_${code}` });
    assert.throws(h.invoke, error => !error.message.includes("do-not-log-this") && !error.message.includes("postgresql://"));
    assert.equal(h.calls.length, 1);assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
  }
});
test("unknown CLI errors, signals, and spawn errors fail closed without leaking diagnostics", () => {
  for (const failure of [{ status: 1, stderr: databaseUrl }, { status: null, signal: "SIGTERM" }, { status: 0, error: new Error(databaseUrl) }]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, 1, failure);
    assert.throws(h.invoke, /release was stopped/);assert.equal(h.calls.length, 1);assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
  }
});
test("schema preflight failures stop before writes and only expose fixed messages", () => {
  for (const code of ["TABLE", "COLUMN", "PARTIAL", "HISTORICAL_PARTIAL"]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, 1, { stderr: `KNEADED_SCHEMA_${code} ${databaseUrl}` });
    assert.throws(h.invoke, error => /table|column|schema/.test(error.message) && !error.message.includes("do-not-log-this"));assert.equal(h.calls.length, 1);
  }
});
test("failed migration or postcheck cannot proceed to generate or build", () => {
  for (const failAt of [2, 3]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, failAt, { stderr: databaseUrl });
    assert.throws(h.invoke, /release was stopped/);assert.equal(h.calls.length, failAt);assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
  }
});
test("failed generation never starts Next.js and build failures propagate", () => {
  for (const failAt of [1, 2]) { const h = harness({}, failAt);assert.throws(h.invoke, /release was stopped/);assert.equal(h.calls.length, failAt); }
});
test("migration plan hashes all SQL and retains the historical repository files", () => {
  const plan = readMigrationPlan(root);
  for (const historical of HISTORICAL_MIGRATIONS) assert.match(plan[historical], /^[a-f0-9]{64}$/);
  for (const [name, checksum] of Object.entries(plan)) assert.equal(checksum, createHash("sha256").update(readFileSync(path.join(root, "prisma/migrations", name, "migration.sql"))).digest("hex"));
  const sql = migrationHistorySql(plan);assert.match(sql, /BEGIN READ ONLY/);assert.match(sql, /current_schema\(\)/);assert.match(sql, /checksum IS DISTINCT FROM/);
  assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/);
});
test("preflight accepts nonempty prefixes while postcheck requires all migrations", () => {
  const plan = readMigrationPlan(root), preflight = migrationHistorySql(plan), postcheck = migrationHistorySql(plan, true);
  assert.match(preflight, /completed_count = 0/);
  assert.match(preflight, /migration_name IS DISTINCT FROM expected_names\[completed_count\]/);
  assert.match(preflight, /ORDER BY started_at/);
  assert.match(preflight, /IF FALSE AND completed_count <> cardinality\(expected_names\)/);
  assert.match(postcheck, /IF TRUE AND completed_count <> cardinality\(expected_names\)/);
  assert.match(preflight, /IF completed \? '20260706215755_admin_setup_config' THEN/);
  assert.match(preflight, /IF completed \? '20260914030000_production_hardening' THEN/);
  assert.doesNotMatch(preflight, /required_names/);
});
test("database steps never print diagnostics, even when they fail", () => {
  for (const failAt of [1, 2, 3]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, failAt === 2 ? [2, 3, 4] : failAt, { stdout: "migration log", stderr: `P1001 ${databaseUrl}` });
    assert.throws(h.invoke, /release was stopped|owner|migration/);assert.deepEqual(h.diagnostics, []);
    assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
  }
});
test("a failed Next.js build prints a redacted tail of its output", () => {
  const jwt = "jwt-secret-value-that-must-not-leak-0123456789";
  const env = { VERCEL_ENV: "development", DATABASE_URL: databaseUrl, JWT_SECRET: jwt, URL_POSTGRES_PRISMA_URL: wrongProject, NODE_ENV: "production" };
  const stderr = [
    "Failed to compile.", "./app/layout.tsx", "Type error: Property 'x' does not exist.",
    `Can't reach database server via ${databaseUrl}`, `other ${wrongProject} and postgres://u:p@h.example/db`,
    `token ${jwt}`, "https://user:hunter2@example.com/path"
  ].join("\n");
  const h = harness(env, 2, { stdout: "Creating an optimized production build ...", stderr });
  assert.throws(h.invoke, /Building Next\.js failed/);
  assert.equal(h.diagnostics.length, 1);
  const out = h.diagnostics[0];
  assert.match(out, /Building Next\.js output \(redacted/);
  assert.match(out, /Failed to compile\./);assert.match(out, /Type error: Property 'x' does not exist\./);
  for (const leak of ["do-not-log-this", "never-use-this", jwt, "hunter2", "u:p@", "synthetic:"]) assert.ok(!out.includes(leak), leak);
  assert.ok(!h.logs.join("\n").includes("do-not-log-this"));
});
test("a failed Prisma generate prints redacted diagnostics and never starts Next.js", () => {
  const h = harness({ DATABASE_URL: databaseUrl }, 1, { stderr: `Error: engine download failed for ${databaseUrl}` });
  assert.throws(h.invoke, /Generating Prisma client failed/);assert.equal(h.calls.length, 1);
  assert.match(h.diagnostics[0], /engine download failed/);assert.ok(!h.diagnostics[0].includes("do-not-log-this"));
});
test("successful steps print no diagnostics", () => {
  const h = harness({ VERCEL_ENV: "preview", DATABASE_URL: databaseUrl, URL_POSTGRES_PRISMA_URL: wrongProject });h.invoke();assert.deepEqual(h.diagnostics, []);
});
test("redactDiagnostics keeps only the tail and bounds its size", () => {
  const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const out = redactDiagnostics(many, {});
  assert.equal(out.split("\n").length, 80);assert.match(out, /line 499$/);assert.ok(!out.includes("line 419\n"));
  assert.ok(redactDiagnostics("x".repeat(50000), {}).length <= 12000);
  assert.equal(redactDiagnostics("", {}), "");
  assert.equal(redactDiagnostics("\u001b[31mType error\u001b[39m", {}), "Type error");
});
test("migrations use the same Neon endpoint without the pooler and a cold-start connect timeout", () => {
  const pooled = "postgresql://app:do-not-log-this@ep-cool-name-a1b2c3d4-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
  const direct = new URL(migrationDatabaseUrl(pooled));
  assert.equal(direct.hostname, "ep-cool-name-a1b2c3d4.us-east-1.aws.neon.tech");
  assert.equal(direct.username, "app");assert.equal(direct.password, "do-not-log-this");assert.equal(direct.pathname, "/neondb");
  assert.equal(direct.searchParams.get("sslmode"), "require");assert.equal(direct.searchParams.get("pgbouncer"), null);
  assert.equal(direct.searchParams.get("connect_timeout"), "30");
  // Non-Neon or already-direct hosts are untouched; an explicit timeout is kept.
  assert.equal(new URL(migrationDatabaseUrl("postgresql://u:p@db-pooler.example.com/x")).hostname, "db-pooler.example.com");
  assert.equal(new URL(migrationDatabaseUrl("postgresql://u:p@ep-x.us-east-2.aws.neon.tech/x?connect_timeout=5")).searchParams.get("connect_timeout"), "5");
});
test("migrate deploy retries advisory-lock and connection timeouts with backoff, then succeeds", () => {
  for (const code of ["P1002", "P1001", "P1017"]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, [2, 3], { stderr: `Error: ${code} Timed out ${databaseUrl}` });
    h.invoke();
    assert.deepEqual(h.calls.map(call => call.args.slice(1, 3)), [["db", "execute"], ["migrate", "deploy"], ["migrate", "deploy"], ["migrate", "deploy"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
    assert.deepEqual(h.sleeps, [...MIGRATE_RETRY_DELAYS_MS]);
    assert.ok(h.logs.some(line => line.includes(code) && /retrying/.test(line)));
    assert.ok(!h.logs.join("\n").includes("do-not-log-this"));assert.deepEqual(h.diagnostics, []);
  }
});
test("migrate deploy gives up after its retries and reports only the Prisma code", () => {
  const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, [2, 3, 4], { stderr: `P1002 ${databaseUrl}` });
  assert.throws(h.invoke, error => /Prisma P1002/.test(error.message) && !error.message.includes("do-not-log-this"));
  assert.equal(h.calls.length, 4);assert.equal(h.sleeps.length, MIGRATE_RETRY_DELAYS_MS.length);
});
test("real migration failures and read-only checks are never retried", () => {
  for (const stderr of ["P3009 failed migrations", "P3018 a migration failed to apply", "no code"]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, 2, { stderr });
    assert.throws(h.invoke, /release was stopped/);assert.equal(h.calls.length, 2);assert.deepEqual(h.sleeps, []);
  }
  for (const failAt of [1, 3]) {
    const h = harness({ VERCEL_ENV: "production", DATABASE_URL: databaseUrl }, failAt, { stderr: "P1002" });
    assert.throws(h.invoke);assert.equal(h.calls.length, failAt);assert.deepEqual(h.sleeps, []);
  }
  assert.equal(prismaErrorCode(`x ${databaseUrl} P1002 y`), "P1002");assert.equal(prismaErrorCode("none"), undefined);
});
