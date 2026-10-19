// This test mutates synthetic schemas only. Remote URLs and other ports/databases
// are rejected before a client is created. Generation and Next build are mocked.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { HISTORICAL_MIGRATIONS, readMigrationPlan, runBuild } from "../scripts/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = new URL(process.env.BUILD_GUARD_TEST_DATABASE_URL || "http://invalid");
assert.equal(url.hostname, "127.0.0.1");assert.equal(url.port, "55499");assert.equal(url.pathname, "/postgres");
const schema = `guard_${randomUUID().replaceAll("-", "")}`;
url.searchParams.set("schema", schema);
const databaseUrl = url.toString();
const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl.replace(`schema=${schema}`, "schema=public") } } });
const plan = readMigrationPlan(root), candidate = "20261012230000_manual_venmo_payments";
const releaseMigrationCount = Object.keys(plan).length;
assert.ok(plan[candidate], "restore the candidate migration before integration testing");
const env = { ...process.env, DATABASE_URL: databaseUrl, VERCEL_ENV: "production" };
const prisma = path.join(root, "node_modules/prisma/build/index.js");
const fixture = mkdtempSync(path.join(os.tmpdir(), "kneaded-guard-fixture-"));
let passed = 0;
const pass = label => { passed++;console.log(`PASS: ${label}`); };
const migrationCount = async () => Number((await client.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations"'))[0].count);
function guarded() {
  const calls = [], logs = [];
  const invoke = () => runBuild({ root, env, log: message => logs.push(message), run: (command, args, options) => {
    calls.push(args.slice(1));
    if (args[1] === "generate" || args[1] === "build") return { status: 0, stdout: "", stderr: "" };
    return spawnSync(command, args, options);
  } });
  return { invoke, calls, logs };
}
async function rejected(label, pattern) {
  const before = await migrationCount(), h = guarded();
  assert.throws(h.invoke, pattern);assert.equal(h.calls.length, 1, "rejected preflight must not reach migrate deploy");
  assert.equal(await migrationCount(), before, "rejected preflight must not mutate history");
  assert.ok(!h.logs.join("\n").includes(databaseUrl));pass(label);
}
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const empty = guarded();assert.throws(empty.invoke, /no Prisma migration history/);assert.equal(empty.calls.length, 1);
  assert.equal(Number((await client.$queryRawUnsafe("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()"))[0].count), 0);
  pass("empty database rejected without creating history or application tables");
  await client.$executeRawUnsafe('CREATE TABLE "Product" ("id" TEXT)');
  const unbaselined = guarded();assert.throws(unbaselined.invoke, /no Prisma migration history/);assert.equal(unbaselined.calls.length, 1);
  pass("nonempty unbaselined database rejected before writes");
  await client.$executeRawUnsafe('CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "checksum" TEXT, "started_at" TIMESTAMPTZ, "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ)');
  await rejected("empty migration history with application table rejected before writes", /history is empty/);
  await client.$executeRawUnsafe('DROP TABLE "_prisma_migrations"');await client.$executeRawUnsafe('DROP TABLE "Product"');

  mkdirSync(path.join(fixture, "migrations"));
  cpSync(path.join(root, "prisma/schema.prisma"), path.join(fixture, "schema.prisma"));
  cpSync(path.join(root, "prisma/migrations/migration_lock.toml"), path.join(fixture, "migrations/migration_lock.toml"));
  const initial = HISTORICAL_MIGRATIONS[0];
  // Positive release fixture: real Prisma deployment of the initial migration.
  // Never fabricate completed records for migrations that have not run.
  cpSync(path.join(root, "prisma/migrations", initial), path.join(fixture, "migrations", initial), { recursive: true });
  const initialBaseline = spawnSync(process.execPath, [prisma, "migrate", "deploy", "--schema", path.join(fixture, "schema.prisma")], { env, cwd: root, encoding: "utf8" });
  assert.equal(initialBaseline.status, 0);assert.equal(await migrationCount(), 1);
  await client.$executeRawUnsafe(`INSERT INTO "User" ("id","email","passwordHash","role","updatedAt") VALUES ('prefix-user','prefix@example.invalid','synthetic-unused-hash','CUSTOMER',NOW())`);
  await client.$executeRawUnsafe(`INSERT INTO "Product" ("id","name","slug","description","priceCents","inventoryLimit","updatedAt") VALUES ('prefix-product','Existing loaf','existing-loaf','Preserved fixture',2400,17,NOW())`);
  await client.$executeRawUnsafe(`INSERT INTO "Order" ("id","customerEmail","customerName","status","totalCents","fulfillmentType","updatedAt") VALUES ('prefix-order','prefix@example.invalid','Existing synthetic customer','PENDING',4800,'PICKUP',NOW())`);
  await client.$executeRawUnsafe(`INSERT INTO "OrderItem" ("id","orderId","productId","quantity","unitPriceCents","productName") VALUES ('prefix-item','prefix-order','prefix-product',2,2400,'Existing loaf')`);
  const snapshot = async () => ({
    users: await client.$queryRawUnsafe('SELECT "id","email","passwordHash","role","createdAt","updatedAt" FROM "User"'),
    products: await client.$queryRawUnsafe('SELECT "id","name","slug","description","priceCents","inventoryLimit","createdAt","updatedAt" FROM "Product"'),
    orders: await client.$queryRawUnsafe('SELECT "id","customerEmail","customerName","status","totalCents","fulfillmentType","createdAt","updatedAt" FROM "Order"'),
    items: await client.$queryRawUnsafe('SELECT * FROM "OrderItem"')
  });
  const beforeUpgrade = await snapshot();
  for (const table of ["AppConfig", "EmailJob", "RateLimit", "PasswordReset"]) {
    await client.$executeRawUnsafe(`CREATE TABLE "${table}" ("fixture" TEXT)`);
    await rejected(`unrecorded future ${table} table rejected before writes`, /historical schema effects/);
    await client.$executeRawUnsafe(`DROP TABLE "${table}"`);
  }
  for (const [table, column] of [["User", "sessionVersion"], ["Order", "receiptTokenHash"], ["Order", "inventoryRestored"]]) {
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" TEXT`);
    await rejected(`unrecorded future ${table}.${column} column rejected before writes`, /historical schema effects/);
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  }
  const initialOnly = guarded();initialOnly.invoke();assert.equal(initialOnly.calls.length, 5);
  assert.equal(await migrationCount(), releaseMigrationCount);assert.deepEqual(await snapshot(), beforeUpgrade);
  const upgraded = (await client.$queryRawUnsafe('SELECT "paymentMethod","paymentState","paymentVerifiedAt","inventoryRestored" FROM "Order" WHERE "id" = $1', 'prefix-order'))[0];
  assert.deepEqual(upgraded, { paymentMethod: null, paymentState: 'UNPAID', paymentVerifiedAt: null, inventoryRestored: false });
  assert.equal((await client.$queryRawUnsafe('SELECT "sessionVersion" FROM "User" WHERE "id" = $1', 'prefix-user'))[0].sessionVersion, 0);
  pass("initial-only real Prisma baseline applies all pending migrations and preserves user/product/order/item fixtures");
  guarded().invoke();assert.equal(await migrationCount(), releaseMigrationCount);assert.deepEqual(await snapshot(), beforeUpgrade);
  pass("initial-only upgrade is idempotent and preserves existing fixture data on replay");

  // Reset only this random disposable schema for deliberately corrupted-history
  // negative cases. No production history is edited or resolved by this test.
  await client.$disconnect();await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for (const name of HISTORICAL_MIGRATIONS) cpSync(path.join(root, "prisma/migrations", name), path.join(fixture, "migrations", name), { recursive: true });
  const baseline = spawnSync(process.execPath, [prisma, "migrate", "deploy", "--schema", path.join(fixture, "schema.prisma")], { env, cwd: root, encoding: "utf8" });
  assert.equal(baseline.status, 0, "isolated fixture must replay historical migrations");assert.equal(await migrationCount(), 4);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2', "0".repeat(64), initial);
  await rejected("checksum drift rejected with no history writes", /checksum differs/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2', plan[initial], initial);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET migration_name = $1 WHERE migration_name = $2', "20990101000000_unknown", initial);
  await rejected("unknown migration rejected before writes", /absent from this release/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET migration_name = $1 WHERE migration_name = $2', initial, "20990101000000_unknown");
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1', initial);
  await rejected("unresolved failed migration rejected before writes", /failed or unfinished/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = $1', initial);
  await rejected("history missing its initial completed migration rejected before writes", /contiguous, correctly ordered prefix/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET rolled_back_at = NULL, finished_at = NOW() WHERE migration_name = $1', initial);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = $1', initial);
  await rejected("invalid finished-and-rolled-back history rejected before writes", /invalid finished-and-rolled-back/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE migration_name = $1', initial);
  const duplicateId = randomUUID();
  await client.$executeRawUnsafe('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) SELECT $1, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count FROM "_prisma_migrations" WHERE migration_name = $2', duplicateId, initial);
  await rejected("duplicate completed migration rejected before writes", /duplicate completed/);
  await client.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE id = $1', duplicateId);
  const second = HISTORICAL_MIGRATIONS[1];
  const secondRecord = (await client.$queryRawUnsafe('SELECT started_at, finished_at FROM "_prisma_migrations" WHERE migration_name = $1', second))[0];
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET finished_at = NULL, rolled_back_at = NOW() WHERE migration_name = $1', second);
  await rejected("gap in completed migration prefix rejected before writes", /contiguous, correctly ordered prefix/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET finished_at = $1, rolled_back_at = NULL WHERE migration_name = $2', secondRecord.finished_at, second);
  const firstStarted = (await client.$queryRawUnsafe('SELECT started_at FROM "_prisma_migrations" WHERE migration_name = $1', initial))[0].started_at;
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET started_at = $1, finished_at = $2 WHERE migration_name = $3', new Date(firstStarted.getTime() - 2000), new Date(firstStarted.getTime() - 1000), second);
  await rejected("out-of-order completed migration timestamps rejected before writes", /contiguous, correctly ordered prefix/);
  await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET started_at = $1, finished_at = $2 WHERE migration_name = $3', secondRecord.started_at, secondRecord.finished_at, second);
  await client.$executeRawUnsafe('ALTER TABLE "Cart" RENAME TO "UnexpectedCart"');
  await rejected("renamed core table rejected before writes", /required application table/);
  await client.$executeRawUnsafe('ALTER TABLE "UnexpectedCart" RENAME TO "Cart"');
  await client.$executeRawUnsafe('ALTER TABLE "Product" RENAME COLUMN "priceCents" TO "unexpectedPrice"');
  await rejected("renamed core column rejected before writes", /required application column/);
  await client.$executeRawUnsafe('ALTER TABLE "Product" RENAME COLUMN "unexpectedPrice" TO "priceCents"');
  await client.$executeRawUnsafe('ALTER TABLE "Order" ADD COLUMN "paymentState" TEXT');
  await rejected("unrecorded partial manual-payment schema rejected before writes", /partial or unrecorded/);
  await client.$executeRawUnsafe('ALTER TABLE "Order" DROP COLUMN "paymentState"');
  const clean = guarded();clean.invoke();assert.equal(clean.calls.length, 5);assert.equal(await migrationCount(), releaseMigrationCount);
  assert.equal((await client.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1', candidate))[0].checksum, plan[candidate]);
  pass("valid baseline applies migration and verifies history/schema before mocked build");
  guarded().invoke();assert.equal(await migrationCount(), releaseMigrationCount);pass("already-applied release is idempotent");
  await client.$executeRawUnsafe('ALTER TABLE "PaymentEvent" RENAME TO "UnexpectedPaymentEvent"');
  await rejected("recorded migration with missing PaymentEvent rejected before writes", /required application table/);
  await client.$executeRawUnsafe('ALTER TABLE "UnexpectedPaymentEvent" RENAME TO "PaymentEvent"');
  await client.$executeRawUnsafe('ALTER TABLE "Order" RENAME COLUMN "checkoutKeyHash" TO "unexpectedCheckoutKey"');
  await rejected("recorded migration with missing manual-payment column rejected before writes", /required application column/);
  await client.$executeRawUnsafe('ALTER TABLE "Order" RENAME COLUMN "unexpectedCheckoutKey" TO "checkoutKeyHash"');
  console.log(`Build guard PostgreSQL integration: ${passed} checks passed.`);
} finally {
  await client.$disconnect();await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.$disconnect();
  rmSync(fixture, { recursive: true, force: true });
}
