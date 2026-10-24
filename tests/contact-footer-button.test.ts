import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactFooterButton } from "../components/ContactFooterButton";
import { CONTACT_FORM_ID } from "../lib/contact-form-anchor";

test("footer Contact button still renders a link to /contact", () => {
  const html = renderToStaticMarkup(React.createElement(ContactFooterButton, { href: "/contact" }));
  assert.match(html, /<a[^>]*href="\/contact"[^>]*>.*Contact<\/a>/);
});

test("on /contact the footer button targets the form section instead of re-navigating", () => {
  const button = readFileSync("components/ContactFooterButton.tsx", "utf8");
  assert.match(button, /^"use client";/);
  assert.match(button, /usePathname\(\)/);
  assert.match(button, /pathname !== href/);
  assert.match(button, /event\.preventDefault\(\)/);
  assert.match(button, /window\.scrollTo\(/);
  assert.match(button, /\.focus\(/);
  const page = readFileSync("app/contact/page.tsx", "utf8");
  assert.match(page, /<section id=\{CONTACT_FORM_ID\}/);
  assert.equal(CONTACT_FORM_ID, "contact-form");
});
