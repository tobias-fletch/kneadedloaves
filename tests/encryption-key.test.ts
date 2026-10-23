import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { GET as health } from "../app/api/health/route";
import { handleSetupPost } from "../lib/setup-save";
import { readSetupSaveError, SetupSettingsForm } from "../components/SetupSettingsForm";
import { getSetupConfigSummary } from "../lib/app-config";
import { ENCRYPTION_KEY_MISCONFIGURED_MESSAGE } from "../lib/config-messages";
import { prisma } from "../lib/prisma";
import { assertConfigEncryptionKey, configEncryptionKeyStatus, decryptSecret, encryptSecret } from "../lib/secrets";
import { getSetupChecklist } from "../lib/setup-checklist";

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as AppRouterInstance;
const hex = "ab".repeat(32);

function restore(t: { after: (fn: () => void) => void }, key: string) {
  const previous = process.env[key];
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

test("encryption key and setup save failures stay JSON and never echo the key", async (t) => {
  restore(t, "CONFIG_ENCRYPTION_KEY");
  restore(t, "SMTP_HOST");

  await t.test("padded and quoted keys encrypt, and a bad key reports length without its value", () => {
    for (const value of [hex, `  ${hex}\n`, `"${hex}"`, `'${hex}'`, `  " ${hex} "  `]) {
      process.env.CONFIG_ENCRYPTION_KEY = value;
      assert.equal(configEncryptionKeyStatus().valid, true);
      assert.equal(decryptSecret(encryptSecret("stored-secret")), "stored-secret");
    }
    const bad = "zz-not-a-key-zz";
    process.env.CONFIG_ENCRYPTION_KEY = bad;
    assert.throws(() => assertConfigEncryptionKey(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`Observed length ${bad.length}; characters are not hexadecimal`));
      assert.doesNotMatch(error.message, /zz-not-a-key-zz/);
      return true;
    });
    process.env.CONFIG_ENCRYPTION_KEY = `${"ab".repeat(31)}gg`;
    assert.throws(() => encryptSecret("x"), /Observed length 64; characters are not hexadecimal/);
    process.env.CONFIG_ENCRYPTION_KEY = "ab".repeat(16);
    assert.throws(() => encryptSecret("x"), /Observed length 32; characters are hexadecimal/);
    process.env.CONFIG_ENCRYPTION_KEY = `""${hex}""`;
    assert.equal(configEncryptionKeyStatus().valid, false);
  });

  await t.test("setup route returns JSON 500 and writes nothing when the key cannot encrypt", async () => {
    const bad = "quoted-bad-key";
    process.env.CONFIG_ENCRYPTION_KEY = bad;
    delete process.env.SMTP_HOST;
    let writes = 0;
    const transaction = prisma.$transaction;
    const upsert = prisma.appConfig.upsert;
    Reflect.set(prisma, "$transaction", async () => { writes += 1; });
    Reflect.set(prisma.appConfig, "upsert", async () => { writes += 1; });
    const logs: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    t.after(() => {
      Reflect.set(prisma, "$transaction", transaction);
      Reflect.set(prisma.appConfig, "upsert", upsert);
      console.error = original;
    });
    const response = await handleSetupPost(new Request("https://kneadedloaves.com/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ values: [{ key: "SMTP_PASSWORD", value: "abcd efgh ijkl mnop" }, { key: "SMTP_HOST", value: "smtp.gmail.com" }] })
    }), async () => ({ role: "ADMIN" }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: ENCRYPTION_KEY_MISCONFIGURED_MESSAGE });
    assert.equal(writes, 0);
    assert.match(logs.join("\n"), new RegExp(`CONFIG_ENCRYPTION_KEY is misconfigured. Observed length ${bad.length}; characters are not hexadecimal`));
    assert.doesNotMatch(logs.join("\n"), /quoted-bad-key|abcd efgh/);
  });

  await t.test("gmail app password spaces are removed before the secret is stored", async () => {
    process.env.CONFIG_ENCRYPTION_KEY = hex;
    delete process.env.SMTP_HOST;
    const saved: { key: string; value: string }[] = [];
    const transaction = prisma.$transaction;
    Reflect.set(prisma, "$transaction", async (run: (tx: { $executeRaw: () => Promise<void>; appConfig: { findMany: () => Promise<unknown[]>; deleteMany: () => Promise<void>; upsert: (args: { where: { key: string }; create: { value: string } }) => Promise<void> } }) => Promise<unknown>) => run({
      $executeRaw: async () => undefined,
      appConfig: {
        findMany: async () => [],
        deleteMany: async () => undefined,
        upsert: async (args) => { saved.push({ key: args.where.key, value: args.create.value }); }
      }
    }));
    t.after(() => { Reflect.set(prisma, "$transaction", transaction); });
    const response = await handleSetupPost(new Request("https://kneadedloaves.com/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ values: [{ key: "SMTP_HOST", value: "smtp.gmail.com" }, { key: "SMTP_PASSWORD", value: "abcd efgh ijkl mnop" }] })
    }), async () => ({ role: "ADMIN" }));
    assert.equal(response.status, 200);
    const password = saved.find(item => item.key === "SMTP_PASSWORD");
    assert.ok(password);
    assert.equal(decryptSecret(password.value), "abcdefghijklmnop");
    assert.equal(saved.find(item => item.key === "SMTP_HOST")?.value, "smtp.gmail.com");
  });

  await t.test("the setup form shows the server error, including a non-JSON response", async () => {
    assert.equal(await readSetupSaveError(Response.json({ error: ENCRYPTION_KEY_MISCONFIGURED_MESSAGE }, { status: 500 })), ENCRYPTION_KEY_MISCONFIGURED_MESSAGE);
    assert.equal(await readSetupSaveError(new Response("<html>unavailable</html>", { status: 502, headers: { "content-type": "text/html" } })), "Save failed (HTTP 502)");
  });

  await t.test("health and the setup checklist report an invalid encryption key without revealing it", async () => {
    const bad = "health-key-is-invalid";
    process.env.CONFIG_ENCRYPTION_KEY = bad;
    const query = prisma.$queryRaw;
    const findMany = prisma.appConfig.findMany;
    const findFirst = prisma.adminSettings.findFirst;
    Reflect.set(prisma, "$queryRaw", async () => [{ ok: 1 }]);
    Reflect.set(prisma.appConfig, "findMany", async () => []);
    Reflect.set(prisma.adminSettings, "findFirst", async () => null);
    for (const target of [prisma.product, prisma.productImage, prisma.orderWindow, prisma.deliveryZone, prisma.pickupLocation, prisma.socialPlatformAccount, prisma.emailSubscriber]) {
      const original = Reflect.get(target, "count");
      Reflect.set(target, "count", async () => 0);
      t.after(() => { Reflect.set(target, "count", original); });
    }
    t.after(() => {
      Reflect.set(prisma, "$queryRaw", query);
      Reflect.set(prisma.appConfig, "findMany", findMany);
      Reflect.set(prisma.adminSettings, "findFirst", findFirst);
    });
    const ok = await health();
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { status: "ok", encryptionKeyValid: false });
    const checklist = await getSetupChecklist();
    const item = checklist.incomplete.find(entry => entry.id === "encryption-key");
    assert.ok(item);
    assert.match(item.detail, /64 hex characters/);
    assert.match(item.detail, /Vercel environment variable/);
    assert.doesNotMatch(JSON.stringify(checklist), /health-key-is-invalid/);
    const summary = await getSetupConfigSummary();
    assert.equal(summary.find(field => field.key === "SMTP_PASSWORD")?.encryptionKeyValid, false);
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(SetupSettingsForm, { fields: summary })));
    assert.match(html, /CONFIG_ENCRYPTION_KEY must be 64 hex characters/);
    assert.match(html, /Check SMTP connection/);
    assert.match(html, /does not send a message/);
    assert.doesNotMatch(html, /health-key-is-invalid/);
    process.env.CONFIG_ENCRYPTION_KEY = hex;
    assert.equal((await health().then(response => response.json())).encryptionKeyValid, true);
  });
});
