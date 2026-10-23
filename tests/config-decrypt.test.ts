import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SetupSettingsForm } from "../components/SetupSettingsForm";
import { getAppConfigValues, getSetupConfigSummary, readStoredConfig, setupConfigKeys } from "../lib/app-config";
import { UNDECRYPTABLE_SETTING_MESSAGE } from "../lib/config-messages";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/secrets";
import { getSetupChecklist } from "../lib/setup-checklist";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("an undecryptable stored secret is unset, warned, and overridden by the environment", async (t) => {
  const previousKey = process.env.CONFIG_ENCRYPTION_KEY;
  const previousJwt = process.env.JWT_SECRET;
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  delete process.env.JWT_SECRET;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => { warnings.push(String(message)); };
  t.after(() => {
    console.warn = originalWarn;
    if (previousKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY; else process.env.CONFIG_ENCRYPTION_KEY = previousKey;
    if (previousJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwt;
  });
  const ciphertext = `enc:v1:${"00".repeat(12)}:${"11".repeat(16)}:${"22".repeat(8)}`;
  const read = readStoredConfig("JWT_SECRET", { value: ciphertext, secret: true });
  assert.equal(read.value, "");
  assert.equal(read.undecryptable, true);
  assert.match(warnings.join("\n"), /JWT_SECRET/);
  assert.match(warnings.join("\n"), /can't be decrypted/);
  assert.doesNotMatch(warnings.join("\n"), /enc:v1|CONFIG_ENCRYPTION_KEY=/);
  process.env.JWT_SECRET = "environment-session-secret-over-32-chars";
  const overridden = readStoredConfig("JWT_SECRET", { value: ciphertext, secret: true });
  assert.equal(overridden.value, process.env.JWT_SECRET);
  assert.equal(overridden.undecryptable, false);
  stub(t, prisma.appConfig, "findMany", async () => [{ key: "JWT_SECRET", value: ciphertext, secret: true }]);
  delete process.env.JWT_SECRET;
  assert.equal((await getAppConfigValues(["JWT_SECRET"])).JWT_SECRET, "");
  process.env.JWT_SECRET = "environment-session-secret-over-32-chars";
  assert.equal((await getAppConfigValues(["JWT_SECRET"])).JWT_SECRET, process.env.JWT_SECRET);
});

test("setup checklist and form tell the owner to re-enter a stored value that cannot be decrypted", async (t) => {
  const previousKey = process.env.CONFIG_ENCRYPTION_KEY;
  const previousJwt = process.env.JWT_SECRET;
  process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  delete process.env.JWT_SECRET;
  for (const key of [...setupConfigKeys, "VENMO_VERIFIED_FINGERPRINT"]) {
    if (key === "JWT_SECRET") continue;
    const before = process.env[key];
    delete process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  t.after(() => {
    if (previousKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY; else process.env.CONFIG_ENCRYPTION_KEY = previousKey;
    if (previousJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwt;
  });
  const usable = encryptSecret("fixture-session-secret-over-32-characters");
  const broken = `enc:v1:${"ab".repeat(12)}:${"cd".repeat(16)}:${"ef".repeat(8)}`;
  assert.notEqual(usable, broken);
  stub(t, prisma.appConfig, "findMany", async () => [{ key: "JWT_SECRET", value: broken, secret: true }]);
  stub(t, prisma.adminSettings, "findFirst", async () => null);
  for (const target of [prisma.product, prisma.productImage, prisma.orderWindow, prisma.deliveryZone, prisma.pickupLocation, prisma.socialPlatformAccount, prisma.emailSubscriber]) {
    stub(t, target, "count", async () => 0);
  }
  const checklist = await getSetupChecklist();
  const item = checklist.incomplete.find(entry => entry.id === "undecryptable-settings");
  assert.ok(item);
  assert.match(item.detail, new RegExp(UNDECRYPTABLE_SETTING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(item.detail, /JWT_SECRET/);
  assert.doesNotMatch(JSON.stringify(checklist), new RegExp(broken));
  const summary = await getSetupConfigSummary();
  const field = summary.find(entry => entry.key === "JWT_SECRET");
  assert.equal(field?.undecryptable, true);
  assert.equal(field?.value, "");
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(SetupSettingsForm, { fields: summary })));
  assert.match(html, /stored value can(?:'|&#x27;)t be decrypted, re-enter it/);
  assert.doesNotMatch(html, new RegExp(broken));
});
