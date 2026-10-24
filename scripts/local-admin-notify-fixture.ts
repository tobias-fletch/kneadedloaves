// LOCAL ONLY helper for scripts/local-admin-notify-e2e.sh. Refuses any non-127.0.0.1 database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { destinationFingerprint } from "../lib/manual-payment-config";

const db = new URL(process.env.DATABASE_URL || "http://invalid");
assert.equal(db.hostname, "127.0.0.1", "local database only");
const p = new PrismaClient();
const base = process.env.APP_URL!;
const MENU = [["Artisan Bread", 1200], ["Bagels (6 pack)", 800], ["Cookies (6 pack)", 600], ["Herbal Focaccia", 1050], ["Plain Focaccia", 1000]] as const;

async function setup() {
  const config: Record<string, string> = { VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@kneadedloaves-local", VENMO_DESTINATION: "https://venmo.com/kneadedloaves-local", VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "30", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true", APP_URL: base, SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_USER: "local", SMTP_PASSWORD: "local", EMAIL_FROM: "Kneaded Loaves <local-store@example.invalid>" };
  config.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(config.VENMO_HANDLE, config.VENMO_DESTINATION);
  for (const [key, value] of Object.entries(config)) await p.appConfig.upsert({ where: { key }, update: { value, secret: false }, create: { key, value, secret: false } });
  for (const [name, priceCents] of MENU) await p.product.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: "local", priceCents, inventoryLimit: 50, allergens: [], ingredients: [] } });
  await p.pickupLocation.create({ data: { name: "S Portland Ave & Atlantic Ave", address: "S Portland Ave & Atlantic Ave, Brooklyn, NY 11217" } });
  await p.orderWindow.create({ data: { name: "Local window", opensAt: new Date(Date.now() - 60000), closesAt: new Date(Date.now() + 3600000), fulfillmentDate: new Date(Date.now() + 86400000), maxOrders: 100 } });
  // Production-like settings row: notifications OFF (schema default / seed value).
  await p.adminSettings.create({ data: { id: "default", bakeryName: "Kneaded Loaves", businessDescription: "x", deliveryRules: "x", pickupRules: "x", defaultHashtags: [], orderingOpenMessage: "x", orderingClosedMessage: "x", emailNotificationsEnabled: false, notificationEmail: null } });
  console.log("setup: menu", MENU.map(([n, c]) => `${n} $${(c / 100).toFixed(2)}`).join(", "));
}

async function order(label: string) {
  const products = await p.product.findMany({ where: { name: { in: ["Artisan Bread", "Bagels (6 pack)"] } } });
  let cookie = "";
  for (const product of products) {
    const r = await fetch(base + "/api/cart", { method: "POST", headers: { Origin: base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ productId: product.id, quantity: 1 }) });
    assert.equal(r.status, 200, await r.text());
    cookie ||= r.headers.get("set-cookie")!.split(";")[0];
  }
  const pickup = await p.pickupLocation.findFirstOrThrow();
  const r = await fetch(base + "/api/checkout", { method: "POST", headers: { Origin: base, "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": randomUUID() }, body: JSON.stringify({ customerName: `Local customer ${label}`, customerEmail: `customer-${label.toLowerCase()}@example.invalid`, fulfillmentType: "PICKUP", pickupLocationId: pickup.id }) });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  const jobs = await p.emailJob.findMany({ where: { dedupeKey: { endsWith: `:${body.orderId}` } }, select: { dedupeKey: true, to: true, status: true } });
  console.log(`order ${label}: ${body.orderId} total=$20.00 queued jobs:`, jobs.map((j) => `${j.dedupeKey.split(":")[0]} -> ${j.to}`).join("; "));
}

async function report(dir: string) {
  const jobs = await p.emailJob.findMany({ orderBy: { createdAt: "asc" }, select: { dedupeKey: true, to: true, status: true, attempts: true } });
  console.log("EmailJob table:"); for (const j of jobs) console.log(`  ${j.dedupeKey.split(":")[0].padEnd(15)} to=${j.to} status=${j.status} attempts=${j.attempts}`);
  const mail = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  console.log("SMTP catcher received:"); for (const m of mail) console.log(`  to=${m.to} subject="${m.subject}" tls=${m.tls}`);
  const expected = process.env.ADMIN_NOTIFY_EMAIL?.trim() || null;
  const adminJobs = jobs.filter((j) => j.dedupeKey.startsWith("admin-order:"));
  const admin = mail.filter((m) => /New bakery reservation awaiting payment/.test(m.subject));
  assert.equal(mail.filter((m) => /customer-a@/.test(m.to)).length, 1, "customer confirmation sent");
  if (expected) {
    assert.equal(adminJobs.length, 1, "exactly one admin job");
    assert.equal(admin.length, 1, "exactly one admin email caught");
    assert.equal(admin[0].to, expected);
    assert.match(admin[0].text, /Local customer A/);
    console.log(`PASS: DB setting OFF + ADMIN_NOTIFY_EMAIL=${expected} -> admin email delivered to ${expected}`);
  } else {
    assert.equal(adminJobs.length, 0, "no admin job without the env var");
    assert.equal(admin.length, 0, "no admin email without the env var");
    console.log("PASS: DB setting OFF + ADMIN_NOTIFY_EMAIL unset -> customer email only (unchanged behavior)");
  }
}

const [cmd, a] = process.argv.slice(2);
(cmd === "setup" ? setup() : cmd === "order" ? order(a) : report(a))
  .catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
