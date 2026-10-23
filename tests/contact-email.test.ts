import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import nodemailer from "nodemailer";
import { ContactButton, validateContactForm } from "../components/ContactButton";
import { ContactFooter } from "../components/ContactFooter";
import {
  buildOwnerNotification,
  buildSenderConfirmation,
  claimDailyConfirmation,
  contactDeliveryMode,
  contactNotificationEmail,
  deliverContactMessage,
  easternDateKey,
  formatContactTimestamp,
  type OutgoingMail
} from "../lib/contact-message";
import { handleContactPost, type ContactRouteDeps } from "../lib/contact-route";

const submittedAt = new Date("2026-10-23T22:11:00Z"); // 6:11 PM EDT
const message = { name: "Ada Lovelace", email: "ada@example.org", phone: "", message: "Do you have rye loaves this Sunday?\nThanks!", website: "" };
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

function request(body: unknown) {
  return new Request("https://kneadedloaves.com/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function routeDeps(overrides: Partial<ContactRouteDeps> = {}) {
  const transport = mockTransport();
  const store = memoryStore();
  const logs: string[] = [];
  const deps: ContactRouteDeps = {
    env: { VERCEL_ENV: "production", CONTACT_EMAIL: "tobias-private@kneadedloaves.com" },
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

test("notification recipient is CONTACT_EMAIL with the bakery mailbox as fallback", () => {
  assert.equal(contactNotificationEmail({ CONTACT_EMAIL: "tobias@kneadedloaves.com" }), "tobias@kneadedloaves.com");
  assert.equal(contactNotificationEmail({}), "kneadedloaves@gmail.com");
  assert.equal(contactNotificationEmail({ CONTACT_EMAIL: "not an email" }), "kneadedloaves@gmail.com");
});

test("dry-run guard: only production sends unless CONTACT_LIVE_SEND overrides", () => {
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production" }), "live");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "preview" }), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "development" }), "dry-run");
  assert.equal(contactDeliveryMode({}), "dry-run");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "preview", CONTACT_LIVE_SEND: "true" }), "live");
  assert.equal(contactDeliveryMode({ VERCEL_ENV: "production", CONTACT_LIVE_SEND: "false" }), "dry-run");
});

test("one confirmation per sender per Eastern day; notification always sends", async () => {
  const transport = mockTransport();
  const store = memoryStore();
  const deliver = (email: string, now: Date) => deliverContactMessage({ ...message, email }, {
    mode: "live", notifyTo: "owner@kneadedloaves.com", configuredFrom: "kneadedloaves@gmail.com", sendMail: transport.sendMail,
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
    mode: "live", notifyTo: "owner@kneadedloaves.com", configuredFrom: "kneadedloaves@gmail.com", sendMail: transport.sendMail,
    claimConfirmation: (email, now) => claimDailyConfirmation(email, now, "live", { rateLimit: { upsert: async () => { throw new Error("db down"); } } }),
    now: submittedAt
  });
  assert.deepEqual(result, { ok: true, confirmationSent: false, dryRun: false });
  assert.equal(transport.sent.length, 1);
});

test("a failed owner notification is reported and no confirmation is sent", async () => {
  let claims = 0;
  const result = await deliverContactMessage(message, {
    mode: "live", notifyTo: "owner@kneadedloaves.com", configuredFrom: "kneadedloaves@gmail.com",
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
    mode: "live", notifyTo: "owner@kneadedloaves.com", configuredFrom: "Kneaded Loaves <kneadedloaves@gmail.com>",
    sendMail: async (mail) => { const info = await transport.sendMail(mail); raw.push(String(info.message)); },
    claimConfirmation: async () => true, now: submittedAt
  });
  const notification = JSON.parse(raw[0]);
  assert.deepEqual(notification.replyTo, [{ address: "ada@example.org", name: "" }]);
  assert.equal(notification.subject, "New message from kneadedloaves.com: Ada Lovelace");
  assert.deepEqual(JSON.parse(raw[1]).from, { address: "kneadedloaves@gmail.com", name: "Kneaded Loaves" });
});

test("route: production sends notification + confirmation through the mocked transport", async () => {
  const { deps, transport } = routeDeps();
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, confirmationSent: true });
  assert.equal(transport.sent.length, 2);
  assert.equal(transport.sent[0].to, "tobias-private@kneadedloaves.com");
  assert.equal(transport.sent[0].replyTo, "ada@example.org");
  assert.equal(transport.sent[1].to, "ada@example.org");
});

test("route: preview deployments log instead of sending and never build a transport", async () => {
  let transportBuilt = false;
  const { deps, transport, logs } = routeDeps({
    env: { VERCEL_ENV: "preview" },
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

test("route: invalid input returns field errors", async () => {
  const { deps, transport } = routeDeps();
  const response = await handleContactPost(request({ name: "", email: "nope", message: "hi" }), deps);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.fieldErrors.name && body.fieldErrors.email && body.fieldErrors.message);
  assert.equal(transport.sent.length, 0);
});

test("route: rate limits return 429 with an email fallback", async () => {
  const { deps, transport } = routeDeps({ limit: async (_request, scope) => scope !== "contact-sender" });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 429);
  assert.match((await response.json()).mailtoUrl, /^mailto:kneadedloaves@gmail\.com/);
  assert.equal(transport.sent.length, 0);
  const blocked = routeDeps({ limit: async () => false });
  assert.equal((await handleContactPost(request(message), blocked.deps)).status, 429);
});

test("route: missing SMTP config in production returns a friendly 503", async () => {
  const { deps } = routeDeps({ transport: async () => { throw new Error("SMTP configuration is incomplete."); } });
  const response = await handleContactPost(request(message), deps);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.doesNotMatch(body.error, /SMTP/);
  assert.match(body.mailtoUrl, /kneadedloaves@gmail\.com/);
});

test("form validation mirrors the server rules", () => {
  assert.deepEqual(validateContactForm({ name: "Ada", email: "ada@example.org", phone: "", message: "Hello there friend" }), {});
  const errors = validateContactForm({ name: " ", email: "x", phone: "", message: "short" });
  assert.ok(errors.name && errors.email && errors.message);
});

test("footer shows only the public bakery address and an accessible contact trigger", () => {
  const html = renderToStaticMarkup(React.createElement(ContactFooter, { contact }));
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /tobias-private/);
  assert.ok(renderToStaticMarkup(React.createElement(ContactButton, { contact })).includes("Contact"));
});
