import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ContactPage from "../app/contact/page";
import { BAKERY_CONTACT_EMAIL } from "../lib/config-messages";
import { getContactDetails, publicContactEmail, resolvePublicContactEmail } from "../lib/contact";
import { prisma } from "../lib/prisma";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("public contact email ignores placeholders and falls back to the bakery mailbox", () => {
  assert.equal(publicContactEmail("orders@example.com"), "");
  assert.equal(publicContactEmail("Kneaded Loaves <kneadedloaves@gmail.com>"), "kneadedloaves@gmail.com");
  assert.equal(publicContactEmail("admin@bakery.local"), "");
  assert.equal(resolvePublicContactEmail("orders@example.com", "admin@bakery.local", undefined), BAKERY_CONTACT_EMAIL);
  assert.equal(resolvePublicContactEmail("owner@kneadedloaves.com"), "owner@kneadedloaves.com");
});

test("contact page shows email only and never a phone hint or example.com address", async (t) => {
  const previous = {
    CONTACT_EMAIL: process.env.CONTACT_EMAIL,
    CONTACT_PHONE: process.env.CONTACT_PHONE,
    EMAIL_FROM: process.env.EMAIL_FROM
  };
  process.env.CONTACT_EMAIL = "orders@example.com";
  process.env.CONTACT_PHONE = "555-0100";
  process.env.EMAIL_FROM = "orders@example.com";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", notificationEmail: "orders@example.com", instagramHandle: "" }));
  const html = renderToStaticMarkup(await ContactPage());
  assert.match(html, /kneadedloaves@gmail\.com/);
  assert.match(html, /mailto:kneadedloaves@gmail\.com/);
  assert.doesNotMatch(html, /example\.com|555-0100|CONTACT_PHONE|Phone|tel:/);
});

test("CONTACT_EMAIL routes notifications but the public site keeps the bakery mailbox", async (t) => {
  const previous = process.env.CONTACT_EMAIL;
  process.env.CONTACT_EMAIL = "owner-private@kneadedloaves.com";
  t.after(() => { if (previous === undefined) delete process.env.CONTACT_EMAIL; else process.env.CONTACT_EMAIL = previous; });
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", notificationEmail: "someone-else@kneadedloaves.com", instagramHandle: "" }));
  assert.equal((await getContactDetails()).email, "kneadedloaves@gmail.com");
  assert.equal((await getContactDetails()).phone, "");
  assert.equal((await getContactDetails()).phoneHref, "");
  const html = renderToStaticMarkup(await ContactPage());
  assert.match(html, /kneadedloaves@gmail\.com/);
  assert.doesNotMatch(html, /owner-private|someone-else/);
});
