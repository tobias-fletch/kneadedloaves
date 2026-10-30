import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { previewDatabaseUrl, prismaDatasourceUrl, normalizeDatabaseHost, hostFingerprint, PRODUCTION_DB_HOST_FINGERPRINTS } from "../lib/preview-database";
// @ts-expect-error -- plain ESM build script without type declarations
import * as build from "../scripts/build.mjs";

const prod = "postgresql://u:prod-secret@ep-prod-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const prodDirect = "postgresql://u:prod-secret@ep-prod-123.us-east-1.aws.neon.tech/neondb?sslmode=require";
const branch = "postgresql://u:branch-secret@ep-branch-456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const impls = [["lib/preview-database.ts", previewDatabaseUrl], ["scripts/build.mjs", build.previewDatabaseUrl]] as const;
// Stand-in for the committed production fingerprint, computed from the fake production host above.
const prodFingerprint = hostFingerprint("ep-prod-123.us-east-1.aws.neon.tech");

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
    assert.throws(() => resolve({ URL_POSTGRES_PRISMA_URL: branch }, []), /Cannot verify/);
    assert.throws(() => resolve({ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: "not a url" }), /invalid/);
  });
  test(`${name}: errors never contain connection details`, () => {
    for (const [env, known] of [[{ DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: prodDirect }, undefined], [{ URL_POSTGRES_PRISMA_URL: branch }, []], [{ URL_DATABASE_URL: prod }, [prodFingerprint]]] as const) {
      try { resolve(env, known); assert.fail("expected throw"); } catch (e) { const m = String((e as Error).message); for (const leak of ["secret", "ep-", "neon.tech"]) assert.ok(!m.includes(leak), leak); }
    }
  });
}
for (const [name, resolve] of impls) {
  test(`${name}: preview needs no production settings (no PRODUCTION_DB_HOST, no DATABASE_URL)`, () => {
    assert.equal(resolve({ VERCEL_ENV: "preview", URL_POSTGRES_PRISMA_URL: branch }), branch);
    assert.equal(resolve({ URL_DATABASE_URL: branch }, [prodFingerprint]), branch);
  });
  test(`${name}: committed fingerprint alone refuses production, pooled or direct, upper-case too`, () => {
    for (const url of [prod, prodDirect, prod.replace("ep-prod-123-pooler", "EP-PROD-123-POOLER")]) {
      assert.throws(() => resolve({ URL_POSTGRES_PRISMA_URL: url }, [prodFingerprint]), /production database/);
      assert.throws(() => resolve({ URL_DATABASE_URL: url }, [prodFingerprint.toUpperCase()]), /production database/);
    }
  });
  test(`${name}: env production hosts still refuse even when the committed list does not match`, () => {
    assert.throws(() => resolve({ PRODUCTION_DB_HOST: "ep-prod-123.us-east-1.aws.neon.tech", URL_POSTGRES_PRISMA_URL: prod }, ["0000000000"]), /production database/);
    assert.throws(() => resolve({ DATABASE_URL: prodDirect, URL_POSTGRES_PRISMA_URL: prod }, ["0000000000"]), /production database/);
  });
}
test("committed production fingerprint list: same in both implementations, non-empty, 10 hex chars, no host text", () => {
  assert.deepEqual([...PRODUCTION_DB_HOST_FINGERPRINTS], [...build.PRODUCTION_DB_HOST_FINGERPRINTS]);
  assert.ok(PRODUCTION_DB_HOST_FINGERPRINTS.length > 0);
  for (const f of PRODUCTION_DB_HOST_FINGERPRINTS) assert.match(f, /^[0-9a-f]{10}$/);
  for (const h of ["ep-a.x.neon.tech", "localhost"]) assert.equal(hostFingerprint(h), build.hostFingerprint(h));
});
test("preview build with no production settings in env: runs on the branch; refuses a production URL before any command", () => {
  const calls: { args: string[]; env: Record<string, string> }[] = []; const logs: string[] = [];
  const opts = { root: path.resolve(__dirname, ".."), log: (m: string) => logs.push(m), diagnostic: () => {}, sleep: () => {}, productionFingerprints: [prodFingerprint],
    run: (_c: string, args: string[], o: { env: Record<string, string> }) => { calls.push({ args, env: o.env }); return { status: 0, stdout: "", stderr: "" }; } };
  build.runBuild({ ...opts, env: { VERCEL_ENV: "preview", URL_POSTGRES_PRISMA_URL: branch } });
  assert.equal(calls.length, 6); assert.match(calls[0].env.DATABASE_URL, /ep-branch-456\./);
  const out = logs.join("\n"); assert.match(out, new RegExp(`own Neon branch .*production host\\(s\\) ${prodFingerprint}; not production`));
  for (const leak of ["secret", "ep-branch", "ep-prod", "neon.tech"]) assert.ok(!out.includes(leak), leak);
  calls.length = 0;
  assert.throws(() => build.runBuild({ ...opts, env: { VERCEL_ENV: "preview", URL_POSTGRES_PRISMA_URL: prodDirect } }), /production database/);
  assert.equal(calls.length, 0);
});
test("production build logs only the host fingerprint and whether it is in the committed list", () => {
  const logs: string[] = [];
  try {
    build.runBuild({ root: path.resolve(__dirname, ".."), env: { VERCEL_ENV: "production", DATABASE_URL: prod }, log: (m: string) => logs.push(m), diagnostic: () => {}, sleep: () => {},
      run: () => ({ status: 1, stdout: "", stderr: "" }) });
  } catch { /* the stubbed database step fails; only the log line matters here */ }
  const out = logs.join("\n");
  assert.match(out, new RegExp(`Production database host fingerprint ${prodFingerprint} \\(NOT in the committed preview guard list\\)`));
  for (const leak of ["secret", "ep-prod", "neon.tech"]) assert.ok(!out.includes(leak), leak);
});
test("host normalisation matches in both implementations", () => {
  for (const h of ["ep-a-pooler.x.neon.tech", "EP-A.X.NEON.TECH", "localhost"]) assert.equal(normalizeDatabaseHost(h), build.normalizeDatabaseHost(h));
});
test("preview build: guard, scrub, migrate on the branch only; never the production URL", () => {
  const calls: { args: string[]; env: Record<string, string>; input?: string }[] = []; const logs: string[] = [];
  build.runBuild({ root: path.resolve(__dirname, ".."), env: { VERCEL_ENV: "preview", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: branch }, log: (m: string) => logs.push(m), diagnostic: () => {}, sleep: () => {},
    run: (_c: string, args: string[], o: { env: Record<string, string>; input?: string }) => { calls.push({ args, env: o.env, input: o.input }); return { status: 0, stdout: "", stderr: "" }; } });
  assert.deepEqual(calls.map(c => c.args.slice(1, 3)), [["migrate", "deploy"], ["db", "execute"], ["db", "execute"], ["db", "execute"], ["generate", "--schema"], ["build"]]);
  for (const c of calls.slice(0, 4)) { assert.match(c.env.DATABASE_URL, /ep-branch-456\./); assert.ok(!c.env.DATABASE_URL.includes("ep-prod-123")); }
  const scrub = calls[1].input ?? "";
  for (const t of ["OrderItem", "Order", "User", "EmailJob", "CustomerProfile", "PaymentEvent"]) assert.ok(scrub.includes(`'${t}'`), t);
  assert.doesNotMatch(scrub, /'Product'|'Category'|'ProductImage'|DROP /);
  const menu = calls[2].input ?? "";
  assert.match(menu, /IF NOT EXISTS \(SELECT 1 FROM "Product"\)/);
  for (const name of ["Artisan Bread", "Bagels (6 pack)", "Cookies (6 pack)", "Herbal Focaccia", "Plain Focaccia"]) assert.ok(menu.includes(`'${name}'`), name);
  const photos = calls[3].input ?? "";
  assert.match(photos, /UPDATE "ProductImage"/);
  assert.doesNotMatch(photos, /DELETE |DROP |TRUNCATE |INSERT /);
  const out = logs.join("\n"); for (const leak of ["secret", "ep-branch", "ep-prod"]) assert.ok(!out.includes(leak), leak);
  assert.match(out, /own Neon branch/);
});
test("preview build pointed at production stops before any command", () => {
  const calls: unknown[] = [];
  assert.throws(() => build.runBuild({ root: path.resolve(__dirname, ".."), env: { VERCEL_ENV: "preview", DATABASE_URL: prod, URL_POSTGRES_PRISMA_URL: prodDirect }, log: () => {}, diagnostic: () => {}, sleep: () => {}, run: (...a: unknown[]) => { calls.push(a); return { status: 0 }; } }), /production database/);
  assert.equal(calls.length, 0);
});
