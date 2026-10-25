import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { previewDatabaseUrl, prismaDatasourceUrl, normalizeDatabaseHost } from "../lib/preview-database";
// @ts-expect-error -- plain ESM build script without type declarations
import * as build from "../scripts/build.mjs";

const prod = "postgresql://u:prod-secret@ep-prod-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const prodDirect = "postgresql://u:prod-secret@ep-prod-123.us-east-1.aws.neon.tech/neondb?sslmode=require";
const branch = "postgresql://u:branch-secret@ep-branch-456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const impls = [["lib/preview-database.ts", previewDatabaseUrl], ["scripts/build.mjs", build.previewDatabaseUrl]] as const;

test("production and local builds never get a datasource override", () => {
  assert.equal(prismaDatasourceUrl({ VERCEL_ENV: "production", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: branch }), undefined);
  assert.equal(prismaDatasourceUrl({ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: branch }), undefined);
  assert.equal(prismaDatasourceUrl({ VERCEL_ENV: "development", DATABASE_URL: prod }), undefined);
});
for (const [name, resolve] of impls) {
  test(`${name}: preview uses its own Neon branch`, () => {
    assert.equal(resolve({ VERCEL_ENV: "preview", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: branch }), branch);
    assert.equal(resolve({ DATABASE_URL: prod, URL_DATABASE_URL: branch }), branch);
    assert.equal(resolve({ PRODUCTION_DB_HOST: "ep-prod-123.us-east-1.aws.neon.tech", URL_POSTGRES_PRISMA_URL: branch }), branch);
  });
  test(`${name}: preview refuses production, pooled or direct`, () => {
    for (const url of [prod, prodDirect]) {
      assert.throws(() => resolve({ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: url }), /production database/);
      assert.throws(() => resolve({ PRODUCTION_DB_HOST: "EP-PROD-123-pooler.us-east-1.aws.neon.tech", URL_DATABASE_URL: url }), /production database/);
    }
  });
  test(`${name}: preview fails closed without a branch URL or a known production host`, () => {
    assert.throws(() => resolve({ DATABASE_URL: prod }), /not configured/);
    assert.throws(() => resolve({ URL_POSTGRES_PRISMA_URL: branch }), /Cannot verify/);
    assert.throws(() => resolve({ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: "not a url" }), /invalid/);
  });
  test(`${name}: errors never contain connection details`, () => {
    for (const env of [{ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: prodDirect }, { URL_POSTGRES_PRISMA_URL: branch }]) {
      try { resolve(env); assert.fail("expected throw"); } catch (e) { const m = String((e as Error).message); for (const leak of ["secret", "ep-", "neon.tech"]) assert.ok(!m.includes(leak), leak); }
    }
  });
}
test("host normalisation matches in both implementations", () => {
  for (const h of ["ep-a-pooler.x.neon.tech", "EP-A.X.NEON.TECH", "localhost"]) assert.equal(normalizeDatabaseHost(h), build.normalizeDatabaseHost(h));
});
test("preview build: guard, scrub, migrate on the branch only; never the production URL", () => {
  const calls: { args: string[]; env: Record<string, string>; input?: string }[] = []; const logs: string[] = [];
  build.runBuild({ root: path.resolve(__dirname, ".."), env: { VERCEL_ENV: "preview", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: branch }, log: (m: string) => logs.push(m), diagnostic: () => {}, sleep: () => {},
    run: (_c: string, args: string[], o: { env: Record<string, string>; input?: string }) => { calls.push({ args, env: o.env, input: o.input }); return { status: 0, stdout: "", stderr: "" }; } });
  assert.deepEqual(calls.map(c => c.args.slice(1, 3)), [["migrate", "deploy"], ["db", "execute"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
  for (const c of calls.slice(0, 3)) { assert.match(c.env.DATABASE_URL, /ep-branch-456\./); assert.ok(!c.env.DATABASE_URL.includes("ep-prod-123")); }
  const scrub = calls[1].input ?? "";
  for (const t of ["OrderItem", "Order", "User", "EmailJob", "CustomerProfile", "PaymentEvent"]) assert.ok(scrub.includes(`'${t}'`), t);
  assert.doesNotMatch(scrub, /'Product'|'Category'|'ProductImage'|DROP /);
  const menu = calls[2].input ?? "";
  assert.match(menu, /IF NOT EXISTS \(SELECT 1 FROM "Product"\)/);
  for (const name of ["Artisan Bread", "Bagels (6 pack)", "Cookies (6 pack)", "Herbal Focaccia", "Plain Focaccia"]) assert.ok(menu.includes(`'${name}'`), name);
  const out = logs.join("\n"); for (const leak of ["secret", "ep-branch", "ep-prod"]) assert.ok(!out.includes(leak), leak);
  assert.match(out, /own Neon branch/);
});
test("preview build pointed at production stops before any command", () => {
  const calls: unknown[] = [];
  assert.throws(() => build.runBuild({ root: path.resolve(__dirname, ".."), env: { VERCEL_ENV: "preview", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: prodDirect }, log: () => {}, diagnostic: () => {}, sleep: () => {}, run: (...a: unknown[]) => { calls.push(a); return { status: 0 }; } }), /production database/);
  assert.equal(calls.length, 0);
});
