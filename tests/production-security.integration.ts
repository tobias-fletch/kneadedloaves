import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "55498");
assert.equal(database.pathname, "/kneaded_loaves_production_security_test"); assert.equal(process.env.NODE_ENV, "production");
const base = process.env.TEST_APP_URL || "http://127.0.0.1:3318"; assert.equal(base, "http://127.0.0.1:3318");
const canonical = process.env.TEST_CANONICAL_ORIGIN || "https://bakery.security.example"; assert.equal(canonical, "https://bakery.security.example");
const host = new URL(canonical).host;
const prisma = new PrismaClient();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const ownerHash = (owner: { userId: string } | { sessionId: string }, key: string) => digest(`${JSON.stringify(owner)}:${key.toLowerCase()}`);
const requestHash = (key: string) => digest(`checkout-request:${key.toLowerCase()}`);
// Native HTTP preserves the test's exact proxy-facing Host header. Fetch may replace it.
function localHttp(path: string, options: { method: string; headers: Record<string, string>; body?: string }) {
  return new Promise<Response>((resolve, reject) => {
    const headers = { ...options.headers, ...(options.body !== undefined ? { "Content-Length": String(Buffer.byteLength(options.body)) } : {}) };
    const req = httpRequest(`${base}${path}`, { method: options.method, headers, agent: false }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk))); response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(key, item)); else if (value !== undefined) headers.set(key, value);
        }
        const status = response.statusCode || 500;
        resolve(new Response([204, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error("Synthetic request timed out"))); req.on("error", reject); req.end(options.body);
  });
}
async function request(path: string, options: { body?: unknown; cookie?: string; origin?: string | null; requestHost?: string; headers?: Record<string, string>; method?: string } = {}) {
  const headers: Record<string, string> = { Host: options.requestHost || host, "X-Forwarded-Proto": "https", ...options.headers };
  if (options.origin !== null) headers.Origin = options.origin ?? canonical;
  if (options.cookie) headers.Cookie = options.cookie;
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return localHttp(path, { method: options.method || "POST", headers, body });
}
async function login(email: string, password: string, extra: Record<string, string> = {}, expectedPath = "/account") {
  const response = await localHttp("/api/auth/login", { method: "POST", headers: { Host: host, Origin: canonical, "X-Forwarded-Proto": "https", "Content-Type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams({ email, password }).toString() });
  assert.equal(response.status, 303, await response.clone().text());
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.pathname, expectedPath); assert.equal(location.protocol, "https:"); assert.equal(location.hostname, host);
  const cookie = response.headers.get("set-cookie") || "";
  for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=lax/i]) assert.match(cookie, attribute);
  return cookie.split(";")[0];
}
const pass = (message: string) => console.log(`PASS: ${message}`);
async function main() {
  if (process.env.TEST_SECURITY_MODE === "missing-origin-config") {
    assert.equal(process.env.APP_URL, undefined); assert.equal(process.env.NEXT_PUBLIC_APP_URL, undefined);
    for (const path of ["/api/cart", "/api/checkout", "/api/checkout/recover", "/api/auth/login", "/api/auth/logout", "/api/contact"]) {
      const response = await request(path, { body: {} }); assert.equal(response.status, 503, `${path}: ${await response.text()}`);
    }
    assert.equal((await request("/api/health", { method: "GET" })).status, 200);
    pass("production mutations fail closed without canonical configuration; health remains readable"); return;
  }
  assert.equal(process.env.TEST_SECURITY_MODE, "configured");
  // Launch migrations seed destination settings. This isolated database must
  // begin with no configuration so default-off tests remain meaningful.
  await prisma.appConfig.deleteMany();
  for (const path of ["/api/cart", "/api/checkout", "/api/checkout/recover", "/api/contact", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password", "/api/admin/setup", "/api/admin/uploads"]) {
    for (const origin of [null, "null", "https://attacker.example"]) assert.equal((await request(path, { body: {}, origin })).status, 403, `${path}: ${origin}`);
    assert.equal((await request(path, { body: {}, requestHost: "attacker.example" })).status, 403, path);
    assert.equal((await request(path, { body: {}, requestHost: "attacker.example", origin: "https://attacker.example" })).status, 403, path);
  }
  assert.equal((await request("/api/cart", { body: {}, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await request("/api/admin/products/not-a-product", { method, body: {}, origin: "https://attacker.example" })).status, 403, method);
  pass("production mutations reject missing/null/foreign Origin, forged Host, and cross-site metadata");
  const oversized = await request("/api/cart", { body: { padding: "x".repeat(70000) } }); assert.equal(oversized.status, 413, await oversized.text());
  assert.equal((await localHttp("/api/admin/uploads", { method: "POST", headers: { Host: host, Origin: canonical, "Content-Type": "application/octet-stream" }, body: "x".repeat(6 * 1024 * 1024 + 1) })).status, 413);
  pass("production JSON and upload byte limits are enforced");
  const checkout = () => request("/api/checkout", { body: { customerName: "Synthetic customer", customerEmail: "test@example.invalid", fulfillmentType: "PICKUP", pickupLocationId: "synthetic-pickup" }, headers: { "Idempotency-Key": randomUUID() } });
  assert.equal(await prisma.order.count(), 0); assert.equal((await checkout()).status, 503);
  await prisma.appConfig.create({ data: { key: "VENMO_CHECKOUT_ENABLED", value: "true", secret: false } });
  assert.equal((await checkout()).status, 503); await prisma.appConfig.delete({ where: { key: "VENMO_CHECKOUT_ENABLED" } });
  assert.equal(await prisma.order.count(), 0); assert.equal(await prisma.emailJob.count(), 0);
  pass("production checkout is disabled by default and rejects incomplete payment configuration without writes");
  const password = "Synthetic-production-security-password-2026";
  const user = await prisma.user.create({ data: { email: `security-${randomUUID()}@example.invalid`, passwordHash: await bcrypt.hash(password, 12), role: "CUSTOMER" } });
  const known = await request("/api/auth/forgot-password", { body: { email: user.email } });
  const unknown = await request("/api/auth/forgot-password", { body: { email: `unknown-${randomUUID()}@example.invalid` } });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  const recovery = await known.json(); assert.deepEqual(recovery, await unknown.json()); assert.deepEqual(Object.keys(recovery), ["message"]);
  assert.doesNotMatch(JSON.stringify(recovery), /resetUrl|token=|[a-f0-9]{64}/); assert.equal(await prisma.passwordReset.count(), 0); assert.equal(await prisma.emailJob.count(), 0);
  pass("SMTP outage reveals neither account existence nor a reset token and queues no email");
  const oldCookie = await login(user.email, password);
  const forwardedCookie = await login(user.email, password, { "X-Forwarded-Host": "attacker.example" });
  const replacement = "Synthetic-replacement-password-2026";
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: digest(randomBytes(32).toString("hex")), expiresAt: new Date(Date.now() + 60000) } });
  const changed = await request("/api/auth/change-password", { cookie: oldCookie, body: { currentPassword: password, password: replacement } });
  assert.equal(changed.status, 200, await changed.clone().text()); assert.match(changed.headers.get("set-cookie") || "", /bakery_session=;/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 1); assert.equal(await prisma.passwordReset.count(), 0);
  for (const cookie of [oldCookie, forwardedCookie]) assert.equal((await request("/api/auth/change-password", { cookie, body: { currentPassword: replacement, password } })).status, 401);
  pass("secure production login and password change revoke existing sessions and reset links");
  const freshCookie = await login(user.email, replacement); const resetToken = randomBytes(32).toString("hex");
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: digest(resetToken), expiresAt: new Date(Date.now() + 60000) } });
  const reset = () => request("/api/auth/reset-password", { body: { token: resetToken, password } });
  assert.equal((await reset()).status, 200); assert.equal((await reset()).status, 400);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 2);
  assert.equal((await request("/api/auth/change-password", { cookie: freshCookie, body: { currentPassword: password, password: replacement } })).status, 401);
  pass("production password reset is one-use and revokes another signed-in session");
  const logoutCookie = await login(user.email, password); const logout = await request("/api/auth/logout", { cookie: logoutCookie });
  assert.equal(logout.status, 303); assert.equal(logout.headers.get("location"), `${canonical}/`);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 3);
  assert.equal((await request("/api/auth/change-password", { cookie: logoutCookie, body: { currentPassword: password, password: replacement } })).status, 401);
  const admin = await prisma.user.create({ data: { email: `admin-security-${randomUUID()}@example.invalid`, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN" } });
  const adminCookie = await login(admin.email, password, {}, "/admin");
  const retry = await localHttp("/api/admin/email/retry", { method: "POST", headers: { Host: host, Origin: canonical, Cookie: adminCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id: "synthetic-nonexistent-email-job" }).toString() });
  assert.equal(retry.status, 303); assert.equal(retry.headers.get("location"), `${canonical}/admin/email`); assert.equal(await prisma.emailJob.count(), 0);
  pass("logout revokes its session and login/logout/admin form redirects use canonical HTTPS");
  // These records exercise receipt recovery while checkout and SMTP stay disabled.
  const accountCookie = await login(user.email, password); const guestId = randomUUID(); const guestCookie = `bakery_cart=${guestId}`; const guestKey = randomUUID();
  const guestOwnerHash = ownerHash({ sessionId: guestId }, guestKey);
  const oldToken = createHmac("sha256", "old-synthetic-receipt-secret-before-rotation-2026").update(`receipt:${guestOwnerHash}`).digest("hex");
  const guestOrder = await prisma.order.create({ data: { customerEmail: "recovery@example.invalid", customerName: "Synthetic recovery customer", totalCents: 1000, fulfillmentType: "PICKUP", status: "CANCELLED", paymentMethod: "VENMO", paymentState: "REVIEW", inventoryRestored: true, checkoutRequestHash: requestHash(guestKey), checkoutKeyHash: guestOwnerHash, receiptTokenHash: digest(oldToken) } });
  const recover = (idempotencyKey: unknown, cookie?: string) => request("/api/checkout/recover", { cookie, body: { idempotencyKey } });
  async function rejectsRecovery(response: Response, status: number) {
    assert.equal(response.status, status, await response.clone().text()); const body = await response.json();
    assert.equal(body.url, undefined); assert.equal(body.orderId, undefined); assert.doesNotMatch(JSON.stringify(body), /token=[a-f0-9]{64}/);
  }
  for (const key of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000", 42, null]) await rejectsRecovery(await recover(key, guestCookie), 404);
  await rejectsRecovery(await recover(guestKey), 404); await rejectsRecovery(await recover(guestKey, "bakery_cart=malformed"), 404);
  await rejectsRecovery(await recover(guestKey, `bakery_cart=${randomUUID()}`), 503); await rejectsRecovery(await recover(guestKey, accountCookie), 503); await rejectsRecovery(await recover(randomUUID(), guestCookie), 404);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: guestOrder.id } })).receiptTokenHash, guestOrder.receiptTokenHash);
  assert.equal((await request(`/orders/${guestOrder.id}?token=${oldToken}`, { method: "GET" })).status, 200);
  pass("recovery requires a valid attempt key plus its original owner and denies disclosure to other browsers/accounts");
  const recovered = await recover(guestKey, guestCookie); assert.equal(recovered.status, 200, await recovered.clone().text()); assert.match(recovered.headers.get("cache-control") || "", /no-store/);
  const receipt = await recovered.json(); assert.equal(receipt.orderId, guestOrder.id);
  const recoveredToken = new URL(receipt.url, canonical).searchParams.get("token")!; assert.match(recoveredToken, /^[a-f0-9]{64}$/); assert.notEqual(recoveredToken, oldToken);
  assert.equal((await request(`/orders/${guestOrder.id}?token=${oldToken}`, { method: "GET" })).status, 404); assert.equal((await request(receipt.url, { method: "GET" })).status, 200);
  assert.deepEqual(await (await recover(guestKey.toUpperCase(), guestCookie)).json(), receipt); assert.deepEqual(await (await recover(guestKey, `${accountCookie}; ${guestCookie}`)).json(), receipt);
  const guestAfter = await prisma.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
  assert.equal(guestAfter.receiptTokenHash, digest(recoveredToken)); assert.equal(guestAfter.status, "CANCELLED"); assert.equal(guestAfter.paymentState, "REVIEW"); assert.equal(guestAfter.inventoryRestored, true);
  pass("owner recovery revokes the old receipt, normalizes keys, survives sign-in, and preserves payment/inventory state");
  const accountKey = randomUUID();
  const accountOrder = await prisma.order.create({ data: { userId: user.id, customerEmail: user.email, customerName: "Synthetic account recovery", totalCents: 2000, fulfillmentType: "PICKUP", checkoutRequestHash: requestHash(accountKey), checkoutKeyHash: ownerHash({ userId: user.id }, accountKey) } });
  await rejectsRecovery(await recover(accountKey), 404); await rejectsRecovery(await recover(accountKey, guestCookie), 503); await rejectsRecovery(await recover(accountKey, adminCookie), 503);
  const accountRecovered = await recover(accountKey, accountCookie); assert.equal(accountRecovered.status, 200, await accountRecovered.clone().text()); assert.equal((await accountRecovered.json()).orderId, accountOrder.id);
  assert.equal(await prisma.order.count(), 2); assert.equal(await prisma.paymentEvent.count(), 0); assert.equal(await prisma.emailJob.count(), 0);
  pass("account recovery rejects unrelated accounts and guest cookies without creating orders, events, or email");
  // Fully configured checkout must work in production after the launch release.
  // All credentials below are local synthetic fixtures;
  // the harness never starts an email worker or contacts a payment provider.
  const enabledHandle = "@synthetic-bakery";
  const enabledDestination = "https://venmo.com/synthetic-bakery";
  const enabledConfig = {
    VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: enabledHandle, VENMO_DESTINATION: enabledDestination,
    VENMO_DESTINATION_VERIFIED: "true", VENMO_VERIFIED_FINGERPRINT: digest(JSON.stringify([enabledHandle, enabledDestination])),
    PAYMENT_HOLD_MINUTES: "60", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true",
    APP_URL: canonical, JWT_SECRET: "isolated-production-security-session-secret-not-for-real-use-2026",
    SMTP_HOST: "127.0.0.1", SMTP_PORT: "465", SMTP_USER: "synthetic-smtp-user", SMTP_PASSWORD: "synthetic-smtp-password",
    EMAIL_FROM: "synthetic-bakery@example.invalid"
  };
  await prisma.appConfig.createMany({ data: Object.entries(enabledConfig).map(([key, value]) => ({ key, value, secret: false })) });
  try {
    const product = await prisma.product.create({ data: { name: "Synthetic production loaf", slug: randomUUID(), description: "QA only", priceCents: 1200, inventoryLimit: 2 } });
    await prisma.pickupLocation.create({ data: { id: "synthetic-pickup", name: "Synthetic pickup", address: "QA only" } });
    await prisma.orderWindow.create({ data: { name: "Synthetic window", opensAt: new Date(Date.now() - 60000), closesAt: new Date(Date.now() + 3600000), fulfillmentDate: new Date(Date.now() + 86400000), maxOrders: 2 } });
    const cart = await request("/api/cart", { body: { productId: product.id, quantity: 1 } });
    assert.equal(cart.status, 200, await cart.clone().text());
    const cartCookie = cart.headers.get("set-cookie")!.split(";")[0];
    const key = randomUUID();
    const reserve = () => request("/api/checkout", { cookie: cartCookie, body: { customerName: "Synthetic customer", customerEmail: "test@example.invalid", fulfillmentType: "PICKUP", pickupLocationId: "synthetic-pickup" }, headers: { "Idempotency-Key": key } });
    // A missing operational gate still blocks a real, populated cart.
    await prisma.appConfig.update({ where: { key: "PAYMENT_WORKERS_READY" }, data: { value: "false" } });
    assert.equal((await reserve()).status, 503);
    assert.equal(await prisma.order.count(), 2);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).inventoryLimit, 2);
    await prisma.appConfig.update({ where: { key: "PAYMENT_WORKERS_READY" }, data: { value: "true" } });
    const placed = await reserve();
    assert.equal(placed.status, 200, await placed.clone().text());
    const placedReceipt = await placed.json();
    const repeated = await reserve();
    assert.equal(repeated.status, 200, await repeated.clone().text());
    assert.deepEqual(await repeated.json(), placedReceipt);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placedReceipt.orderId } });
    assert.equal(order.paymentState, "UNPAID"); assert.equal(order.status, "PENDING");
    assert.equal(order.totalCents, 1200); assert.equal(order.paymentVerifiedAt, null);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).inventoryLimit, 1);
    for (const cookie of [undefined, accountCookie]) {
      assert.notEqual((await request("/api/admin/products/export", { method: "GET", cookie })).status, 200);
    }
    const exported = await request("/api/admin/products/export", { method: "GET", cookie: adminCookie });
    assert.equal(exported.status, 200, await exported.clone().text());
    assert.match(exported.headers.get("content-disposition") || "", /attachment/);
    assert.match(exported.headers.get("cache-control") || "", /no-store/);
    const catalog = await exported.json();
    assert.equal(catalog.format, "kneaded-loaves-catalog"); assert.equal(catalog.version, 1);
    assert.equal(catalog.products.length, 1); assert.equal(catalog.products[0].priceCents, 1200);
    assert.equal(catalog.products[0].inventoryLimit, 1);
    assert.deepEqual(Object.keys(catalog).sort(), ["categories", "currency", "exportedAt", "format", "products", "version"]);
    assert.doesNotMatch(JSON.stringify(catalog), /customerEmail|passwordHash|SMTP_|paymentReference|sessionVersion|orderItems/);
    pass("catalog download is admin-only, uncached and excludes customer/order/payment data");
    const stillRecoverable = await recover(guestKey, guestCookie);
    assert.equal(stillRecoverable.status, 200, await stillRecoverable.clone().text());
    assert.deepEqual(await stillRecoverable.json(), receipt);
    assert.equal(await prisma.order.count(), 3); assert.equal(await prisma.paymentEvent.count(), 0); assert.equal(await prisma.emailJob.count(), 1);
    const pausedGuest = await prisma.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(pausedGuest.status, "CANCELLED"); assert.equal(pausedGuest.paymentState, "REVIEW"); assert.equal(pausedGuest.inventoryRestored, true);
    assert.equal(pausedGuest.receiptTokenHash, digest(recoveredToken));
  } finally {
    await prisma.appConfig.deleteMany({ where: { key: { in: Object.keys(enabledConfig) } } });
  }
  pass("production checkout requires operational gates, reserves once when enabled, stays unpaid, and preserves existing recovery");
  await prisma.$executeRawUnsafe('ALTER TABLE "RateLimit" RENAME TO "RateLimit_security_unavailable"');
  try { assert.equal((await request("/api/auth/forgot-password", { body: { email: user.email } })).status, 429); assert.equal(await prisma.passwordReset.count(), 0); }
  finally { await prisma.$executeRawUnsafe('ALTER TABLE "RateLimit_security_unavailable" RENAME TO "RateLimit"'); }
  pass("production authentication fails closed during a rate-limit storage outage");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
