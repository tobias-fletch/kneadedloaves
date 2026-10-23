import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import ContactPage from "../app/contact/page";
import { ContactFooter } from "../components/ContactFooter";
import { BAKERY_INSTAGRAM_HANDLE } from "../lib/config-messages";
import { getContactDetails, instagramProfileUrl, normalizeInstagramHandle, type ContactDetails } from "../lib/contact";
import { prisma } from "../lib/prisma";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const PROFILE = "https://www.instagram.com/kneadedloaves/";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("instagram handle falls back when empty and strips @ or a profile URL", () => {
  assert.equal(BAKERY_INSTAGRAM_HANDLE, "kneadedloaves");
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(normalizeInstagramHandle(empty), "kneadedloaves");
  }
  assert.equal(normalizeInstagramHandle("@kneadedloaves"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("@@kneadedloaves"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("  @kneadedloaves  "), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("kneadedloaves"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("https://www.instagram.com/kneadedloaves/"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("https://instagram.com/kneadedloaves"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("http://www.instagram.com/kneadedloaves/?hl=en"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("https://m.instagram.com/kneadedloaves/#about"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("instagram.com/other.bakery_1/"), "other.bakery_1");
  assert.equal(normalizeInstagramHandle("@Other.Bakery"), "Other.Bakery");
  assert.equal(normalizeInstagramHandle("https://example.com/kneadedloaves"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("not a handle"), "kneadedloaves");
  assert.equal(normalizeInstagramHandle("@"), "kneadedloaves");
  assert.equal(instagramProfileUrl(""), PROFILE);
  assert.equal(instagramProfileUrl("@kneadedloaves"), PROFILE);
  assert.equal(instagramProfileUrl("https://instagram.com/kneadedloaves/"), PROFILE);
  assert.equal(instagramProfileUrl("other.bakery_1"), "https://www.instagram.com/other.bakery_1/");
});

test("contact details use the bakery instagram when admin has none", async (t) => {
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", instagramHandle: "" }));
  assert.equal((await getContactDetails()).instagramHandle, "kneadedloaves");
});

test("contact details keep a custom handle after normalization", async (t) => {
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", instagramHandle: "https://www.instagram.com/other.bakery_1/" }));
  assert.equal((await getContactDetails()).instagramHandle, "other.bakery_1");
});

test("contact page links the instagram card in a new tab", async (t) => {
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", notificationEmail: "", instagramHandle: "@kneadedloaves" }));
  const html = renderToStaticMarkup(await ContactPage());
  assert.match(html, /href="https:\/\/www\.instagram\.com\/kneadedloaves\/"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Kneaded Loaves on Instagram"/);
  assert.match(html, /@kneadedloaves/);
  assert.match(html, /hover:border-jam/);
});

test("footer shows the instagram link beside contact and links to the contact page", () => {
  const contact: ContactDetails = {
    bakeryName: "Kneaded Loaves",
    email: "kneadedloaves@gmail.com",
    phone: "",
    phoneHref: "",
    instagramHandle: "kneadedloaves"
  };
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ContactFooter, { contact })));
  assert.match(html, /href="https:\/\/www\.instagram\.com\/kneadedloaves\/"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Kneaded Loaves on Instagram"/);
  assert.match(html, /@kneadedloaves/);
  assert.match(html, /href="\/contact"/);
  assert.match(html, /All contact options/);
  assert.match(html, />Contact</);
});
