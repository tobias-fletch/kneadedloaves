import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HISTORICAL_MIGRATIONS, migrationHistorySql, readMigrationPlan, runBuild } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = "postgresql://synthetic:do-not-log-this@127.0.0.1:55499/build_guard";
const wrongProject = "postgresql://wrong:never-use-this@wrong.example.invalid/other_project";
function harness(env, failAt = -1, failure = {}) {
  const calls = [], logs = [];
  const invoke = () => runBuild({ root, env, log: message => logs.push(message), run: (command, args, options) => {
    calls.push({ command, args, options });
    return calls.length === failAt ? { status: 1, stdout: "", stderr: "", ...failure } : { status: 0, stdout: "", stderr: "" };
  } });
  return { calls, logs, invoke };
}
test("local, preview, development and misspelled production builds never run database commands", () => {
  for (const VERCEL_ENV of [undefined, "preview", "development", "Production", " production"]) {
    const h = harness({ VERCEL_ENV, DATABASE_URL: databaseUrl });h.invoke();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls.map(call => call.args.slice(1)), [["generate", "--schema", "prisma/schema.prisma"], ["build"]]);
    assert.ok(h.calls.every(call => call.options.input === undefined));
  }
});
test("Netlify production context runs the same database-guarded deploy", () => {
  const h = harness({ NETLIFY: "true", CONTEXT: "production", DATABASE_URL: databaseUrl });h.invoke();
  assert.deepEqual(h.calls.map(call => call.args.slice(1, 3)), [["db", "execute"], ["migrate", "deploy"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
  assert.ok(h.calls.every(call => call.options.env.DATABASE_URL === databaseUrl));
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
  assert.ok(h.calls.every(call => call.options.env.DATABASE_URL === databaseUrl));
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
