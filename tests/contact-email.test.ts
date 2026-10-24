import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import nodemailer from "nodemailer";
import { ContactForm, validateContactForm } from "../components/ContactForm";
import { ContactFooter } from "../components/ContactFooter";
import {
  buildOwnerNotification,
  buildSenderConfirmation,
  claimDailyConfirmation,
  contactDeliveryMode,
  CONTACT_IP_LIMITS,
  CONTACT_MAILBOX,
  deliverContactMessage,
  easternDateKey,
  formatContactTimestamp,
  type OutgoingMail
} from "../lib/contact-message";
import { contactClientIp, handleContactPost, submittedTooFast, type ContactRouteDeps } from "../lib/contact-route";

const submittedAt = new Date("2026-10-23T22:11:00Z"); // 6:11 PM EDT
const message = { name: "Ada Lovelace", email: "ada@example.org", message: "Do you have rye loaves this Sunday?\nThanks!", website: "" };
const contact = { bakeryName: "Kneaded Loaves", email: "kneadedloaves@gmail.com", phone: "", phoneHref: "", instagramHandle: "kneadedloaves" };

/** A fake nodemailer-style transport that records mail and never touches the network. */
function mockTransport() {
  const sent: OutgoingMail[] = [];
  return { sent, sendMail: async (mail: OutgoingMail) => { sent.push(mail); return { messageId: "mock" }; } };
}

/** In-memory stand-in for the RateLimit table. */
function memoryStore() {
  const rows = new Map<string, number>();
  return {
    rows,
    rateLimit: {
      upsert: async ({ where, create }: { where: { key: string }; create: { count: number } }) => {
        const count = (rows.get(where.key) ?? 0) + (rows.has(where.key) ? 1 : create.count);
        rows.set(where.key, count);
        return { count };
      }
    }
  };
}

/** A human-paced submission: the form rendered 20 seconds before submittedAt. */
const humanStart = submittedAt.getTime() - 20_000;

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://kneadedloaves.com/api/contact", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ startedAt: humanStart, ...body }) });
}

function routeDeps(overrides: Partial<ContactRouteDeps> = {}) {
  const transport = mockTransport();
  const store = memoryStore();
  const logs: string[] = [];
  const deps: ContactRouteDeps = {
    env: { VERCEL_ENV: "production", CONTACT_LIVE_SEND: "true", CONTACT_EMAIL: "tobias-private@kneadedloaves.com" },
    limit: async () => true,
    transport: async () => ({ from: "Kneaded Loaves <kneadedloaves@gmail.com>", sendMail: transport.sendMail }),
    claim: (email, now, mode) => claimDailyConfirmation(email, now, mode, store),
    log: (line) => logs.push(line),
    now: () => submittedAt,
    ...overrides
  };
  return { deps, transport, store, logs };
}

test("timestamps and the daily key use Eastern Time", () => {
  assert.equal(formatContactTimestamp(submittedAt), "Friday, Oct 23, 2026, 6:11 PM ET");
  assert.equal(easternDateKey(new Date("2026-10-24T03:30:00Z")), "2026-10-23"); // 11:30 PM ET
  assert.equal(easternDateKey(new Date("2026-10-24T04:30:00Z")), "2026-10-24");
});

test("owner notification has Reply-To, subject, name, email, message and ET timestamp", () => {
  const mail = buildOwnerNotification(message, submittedAt, { from: "Kneaded Loaves <kneadedloaves@gmail.com>", to: "owner@kneadedloaves.com" });
  assert.equal(mail.to, "owner@kneadedloaves.com");
  assert.equal(mail.replyTo, "ada@example.org");
  assert.equal(mail.subject, "New message from kneadedloaves.com: Ada Lovelace");
  assert.match(mail.text, /Name: Ada Lovelace/);
  assert.match(mail.text, /Email: ada@example\.org/);
  assert.match(mail.text, /Sent: Friday, Oct 23, 2026, 6:11 PM ET/);
  assert.match(mail.text, /Do you have rye loaves this Sunday\?\nThanks!/);
  assert.doesNotMatch(mail.text, /Phone:/);
});

test("sender confirmation is warm, from Kneaded Loaves and quotes their message", () => {
  const mail = buildSenderConfirmation(message, submittedAt, { from: "Kneaded Loaves <kneadedloaves@gmail.com>", replyTo: "kneadedloaves@gmail.com" });
  assert.equal(mail.from, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.equal(mail.to, "ada@example.org");
  assert.match(mail.text, /^Hi Ada,/);
  assert.match(mail.text, /Thanks so much/);
  assert.match(mail.text, /> Do you have rye loaves this Sunday\?\n> Thanks!/);
});

test("the contact form always uses the kneadedloaves@gmail.com mailbox", () => {
  assert.equal(CONTACT_MAILBOX, "kneadedloaves@gmail.com");
});

test("dry-run guard: sends only in production with CONTACT_LIVE_SEND=true", () => {
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production", CONTACT_LIVE_SEND: "true" }), "live");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production", CONTACT_LIVE_SEND: " TRUE " }), "live");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production" }), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production", CONTACT_LIVE_SEND: "false" }), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production", CONTACT_LIVE_SEND: "1" }), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "preview", CONTACT_LIVE_SEND: "true" }), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "development", CONTACT_LIVE_SEND: "true" }), "dry-run");
  assert.equal(contactDeliveryMode({ CONTACT_LIVE_SEND: "true" }), "dry-run");
  assert.equal(contactDeliveryMode({}), "dry-run");
});

test("one confirmation per sender per Eastern day; notification always sends", async () => {
  const transport = mockTransport();
  const store = memoryStore();
  const deliver = (email: string, now: Date) => deliverContactMessage({ ...message, email }, {
    mode: "live", notifyTo: "owner@kneadedloaves.com", sendMail: transport.sendMail,
    claimConfirmation: (address, at) => claimDailyConfirmation(address, at, "live", store), now
  });
  assert.deepEqual(await deliver("ada@example.org", submittedAt), { ok: true, confirmationSent: true, dryRun: false });
  assert.deepEqual(await deliver("ADA@example.org", new Date(submittedAt.getTime() + 60_000)), { ok: true, confirmationSent: false, dryRun: false });
  assert.deepEqual(await deliver("grace@example.org", submittedAt), { ok: true, confirmationSent: true, dryRun: false });
  assert.deepEqual(await deliver("ada@example.org", new Date("2026-10-24T14:00:00Z")), { ok: true, confirmationSent: true, dryRun: false });
  const notifications = transport.sent.filter((mail) => mail.to === "owner@kneadedloaves.com");
  const confirmations = transport.sent.filter((mail) => mail.to !== "owner@kneadedloaves.com");
  assert.equal(notifications.length, 4);
  assert.equal(confirmations.length, 3);
  for (const mail of transport.sent) assert.equal(mail.from, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.ok([...store.rows.keys()].every((key) => /^[0-9a-f]{64}$/.test(key)), "sender addresses are stored only as hashes");
});

test("a confirmation-store outage skips the confirmation but still notifies the owner", async () => {
  const transport = mockTransport();
  const result = await deliverContactMessage(message, {
    mode: "live", notifyTo: "owner@kneadedloaves.com", sendMail: transport.sendMail,
    claimConfirmation: (email, now) => claimDailyConfirmation(email, now, "live", { rateLimit: { upsert: async () => { throw new Error("db down"); } } }),
    now: submittedAt
  });
  assert.deepEqual(result, { ok: true, confirmationSent: false, dryRun: false });
  assert.equal(transport.sent.length, 1);
});

test("a failed owner notification is reported and no confirmation is sent", async () => {
  let claims = 0;
  const result = await deliverContactMessage(message, {
    mode: "live", notifyTo: "owner@kneadedloaves.com",
    sendMail: async () => { throw new Error("smtp down"); },
    claimConfirmation: async () => { claims += 1; return true; },
    now: submittedAt
  });
  assert.deepEqual(result, { ok: false, reason: "notification-failed" });
  assert.equal(claims, 0);
});

test("works with a real nodemailer JSON transport (no network)", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const raw: string[] = [];
  await deliverContactMessage(message, {
    mode: "live", notifyTo: "owner@kneadedloaves.com",
    sendMail: async (mail) => { const info = await transport.sendMail(mail); raw.push(String(info.message)); },
    claimConfirmation: async () => true, now: submittedAt
  });
  const notification = JSON.parse(raw[0]);
  assert.deepEqual(notification.replyTo, [{ address: "ada@example.org", name: "" }]);
  assert.equal(notification.subject, "New message from kneadedloaves.com: Ada Lovelace");
  assert.deepEqual(JSON.parse(raw[1]).from, { address: "kneadedloaves@gmail.com", name: "Kneaded Loaves" });
});

test("route: live production sends the notification TO kneadedloaves@gmail.com and a confirmation FROM it", async () => {
  const { deps, transport } = routeDeps();
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, confirmationSent: true });
  assert.equal(transport.sent.length, 2);
  assert.equal(transport.sent[0].to, "kneadedloaves@gmail.com", "CONTACT_EMAIL does not redirect notifications");
  assert.equal(transport.sent[0].replyTo, "ada@example.org");
  assert.equal(transport.sent[1].to, "ada@example.org");
  assert.match(transport.sent[1].text, /> Do you have rye loaves this Sunday\?/);
  for (const mail of transport.sent) assert.equal(mail.from, "Kneaded Loaves <kneadedloaves@gmail.com>");
});

test("route: production without CONTACT_LIVE_SEND=true is a dry run", async () => {
  let transportBuilt = false;
  const { deps, transport, logs } = routeDeps({
    env: { VERCEL_ENV: "production" },
    transport: async () => { transportBuilt = true; throw new Error("must not be called"); }
  });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 200);
  assert.equal(transportBuilt, false);
  assert.equal(transport.sent.length, 0);
  assert.ok(logs.some((line) => /DRY RUN/.test(line)));
});

test("route: refuses to send when SMTP is set up for a different mailbox", async () => {
  const other = mockTransport();
  const { deps } = routeDeps({ transport: async () => ({ from: "Someone <someone@example.org>", sendMail: other.sendMail }) });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 503);
  assert.equal(other.sent.length, 0);
  assert.doesNotMatch(JSON.stringify(await response.json()), /mailto:/);
});

test("route: preview deployments log instead of sending and never build a transport", async () => {
  let transportBuilt = false;
  const { deps, transport, logs } = routeDeps({
    env: { VERCEL_ENV: "preview", CONTACT_LIVE_SEND: "true" },
    transport: async () => { transportBuilt = true; throw new Error("must not be called"); }
  });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 200);
  assert.equal(transportBuilt, false);
  assert.equal(transport.sent.length, 0);
  assert.ok(logs.some((line) => /DRY RUN, not sending owner notification: to=k\*\*\*@gmail\.com/.test(line)));
  assert.ok(logs.some((line) => /DRY RUN, not sending sender confirmation: to=a\*\*\*@example\.org/.test(line)));
  assert.ok(logs.every((line) => !line.includes("rye loaves")), "message bodies are not logged");
});

test("route: honeypot submissions get a quiet success and send nothing", async () => {
  const { deps, transport } = routeDeps();
  const response = await handleContactPost(request({ ...message, website: "http://spam.example" }), deps);
  assert.equal(response.status, 200);
  assert.equal(transport.sent.length, 0);
});

test("route: submissions faster than the minimum fill time, or without a start time, get a quiet success and send nothing", async () => {
  const { deps, transport } = routeDeps();
  const fast = await handleContactPost(request({ ...message, startedAt: submittedAt.getTime() - 1_000 }), deps);
  assert.equal(fast.status, 200);
  const missing = await handleContactPost(request({ ...message, startedAt: null }), deps);
  assert.equal(missing.status, 200);
  assert.equal(transport.sent.length, 0);
  assert.equal(submittedTooFast(humanStart, submittedAt.getTime()), false);
  assert.equal(submittedTooFast(submittedAt.getTime() - 2_999, submittedAt.getTime()), true);
  assert.equal(submittedTooFast("abc", submittedAt.getTime()), true);
});

test("route: invalid input returns field errors", async () => {
  const { deps, transport } = routeDeps();
  const response = await handleContactPost(request({ name: "", email: "nope", message: "hi" }), deps);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.fieldErrors.name && body.fieldErrors.email && body.fieldErrors.message);
  assert.equal(transport.sent.length, 0);
});

test("route: per-IP limits are 5 an hour and 20 a day, keyed by the client IP", async () => {
  assert.deepEqual(CONTACT_IP_LIMITS.map(({ limit, windowMs }) => [limit, windowMs]), [[5, 3_600_000], [20, 86_400_000]]);
  const counts = new Map<string, number>();
  const limit: ContactRouteDeps["limit"] = async (_request, scope, max = 30, identifier, windowMs) => {
    const key = `${scope}:${identifier}:${windowMs}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= max;
  };
  const { deps, transport } = routeDeps({ limit, env: { VERCEL_ENV: "production", CONTACT_LIVE_SEND: "true", VERCEL: "1" } });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    statuses.push((await handleContactPost(request({ ...message, email: `person${i}@example.org` }, { "x-forwarded-for": "203.0.113.7" }), deps)).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const other = await handleContactPost(request({ ...message, email: "z@example.org" }, { "x-forwarded-for": "198.51.100.2" }), deps);
  assert.equal(other.status, 200, "another IP has its own bucket");
  const body = await (await handleContactPost(request(message, { "x-forwarded-for": "203.0.113.7" }), deps)).json();
  assert.match(body.error, /kneadedloaves@gmail\.com/);
  assert.doesNotMatch(JSON.stringify(body), /mailto:/);
  assert.equal(transport.sent.filter((mail) => mail.to === "kneadedloaves@gmail.com").length, 6);
});

test("route: the daily IP limit and the per-sender limit also return 429", async () => {
  const daily = routeDeps({ limit: async (_request, scope) => scope !== "contact-ip-day" });
  assert.equal((await handleContactPost(request(message), daily.deps)).status, 429);
  const sender = routeDeps({ limit: async (_request, scope) => scope !== "contact-sender" });
  assert.equal((await handleContactPost(request(message), sender.deps)).status, 429);
  assert.equal(daily.transport.sent.length + sender.transport.sent.length, 0);
});

test("client IP comes from X-Forwarded-For only on Vercel or behind a trusted proxy", () => {
  const req = new Request("https://kneadedloaves.com/api/contact", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
  assert.equal(contactClientIp(req, { VERCEL: "1" }), "203.0.113.7");
  assert.equal(contactClientIp(req, { TRUST_PROXY: "true" }), "203.0.113.7");
  assert.equal(contactClientIp(req, {}), "shared");
});

test("route: missing SMTP config in production returns a friendly 503", async () => {
  const { deps } = routeDeps({ transport: async () => { throw new Error("SMTP configuration is incomplete."); } });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.doesNotMatch(body.error, /SMTP/);
  assert.match(body.error, /kneadedloaves@gmail\.com/);
  assert.doesNotMatch(JSON.stringify(body), /mailto:/);
});

test("form validation mirrors the server rules", () => {
  assert.deepEqual(validateContactForm({ name: "Ada", email: "ada@example.org", message: "Hello there friend" }), {});
  const errors = validateContactForm({ name: " ", email: "x", message: "short" });
  assert.ok(errors.name && errors.email && errors.message);
});

test("footer links to /contact and shows the bakery address as plain text", () => {
  const html = renderToStaticMarkup(React.createElement(ContactFooter, { contact }));
  assert.match(html, /<a[^>]*href="\/contact"[^>]*>.*Contact<\/a>/);
  assert.match(html, /kneadedloaves@gmail\.com/);
  assert.doesNotMatch(html, /mailto:|tobias-private/);
});

test("the /contact form has name, email, message and a hidden honeypot, and no mailto link", () => {
  const html = renderToStaticMarkup(React.createElement(ContactForm, { email: "kneadedloaves@gmail.com" }));
  for (const field of ["name", "email", "message", "website"]) assert.match(html, new RegExp(`name="${field}"`));
  assert.match(html, /aria-hidden="true"[^>]*><label[^>]*>Website<\/label><input[^>]*tabindex="-1"/i);
  assert.doesNotMatch(html, /mailto:|name="phone"/);
});

test("contactRateLimit is contact-only: own key prefix, own window, fails closed", async (t) => {
  const { prisma } = await import("../lib/prisma");
  const { contactRateLimit } = await import("../lib/contact-rate-limit");
  const counts = new Map<string, number>();
  const expiries: number[] = [];
  const delegate = prisma.rateLimit as unknown as Record<string, unknown>;
  const original = Reflect.get(delegate, "upsert");
  t.after(() => { Reflect.set(delegate, "upsert", original); });
  Reflect.set(delegate, "upsert", (async ({ where, create }: { where: { key: string }; create: { expiresAt: Date } }) => {
    const count = (counts.get(where.key) ?? 0) + 1;
    counts.set(where.key, count);
    expiries.push(create.expiresAt.getTime());
    return { key: where.key, count, expiresAt: create.expiresAt };
  }));
  const now = Date.UTC(2026, 9, 23, 12, 30);
  const req = new Request("https://kneadedloaves.com/api/contact");
  const results: boolean[] = [];
  for (let i = 0; i < 6; i += 1) results.push(await contactRateLimit(req, "contact-ip-hour", 5, "ip:203.0.113.7", 3_600_000, now));
  assert.deepEqual(results, [true, true, true, true, true, false]);
  assert.equal(await contactRateLimit(req, "contact-ip-day", 20, "ip:203.0.113.7", 86_400_000, now), true, "the day window has its own bucket");
  assert.equal(expiries[0], Date.UTC(2026, 9, 23, 13, 0));
  const { readFileSync } = await import("node:fs");
  assert.doesNotMatch(readFileSync("lib/contact-route.ts", "utf8"), /\brateLimit\b/, "the contact route does not use the shared limiter");
  Reflect.set(delegate, "upsert", async () => { throw new Error("db down"); });
  assert.equal(await contactRateLimit(req, "contact-ip-hour", 5, "ip:x", 3_600_000, now), false);
});
