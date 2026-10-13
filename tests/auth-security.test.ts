import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage, type RequestStore } from "next/dist/server/app-render/work-unit-async-storage.external";
import { prisma } from "../lib/prisma";
import { hashPassword, sessionFromToken, signSession, SESSION_COOKIE, verifyPassword } from "../lib/auth";
import { rateLimit } from "../lib/request";
import { POST as authAction } from "../app/api/auth/[action]/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { middleware, config } from "../middleware";

type MethodArguments<T> = T extends (...args: infer Args) => unknown ? Args : never;
function stub<T extends object, K extends keyof T, R>(t: TestContext, target: T, key: K, implementation: (...args: MethodArguments<T[K]>) => R) {
  const original = target[key];
  const mocked = t.mock.fn(implementation);
  Reflect.set(target, key, mocked);
  t.after(() => { Reflect.set(target, key, original); });
  return mocked;
}
const origin = "https://bakery.example";
const jwtSecret = "test-only-session-secret-with-at-least-32-characters";
function environment(t: TestContext, values: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ NODE_ENV: "production", APP_URL: origin, NEXT_PUBLIC_APP_URL: undefined, JWT_SECRET: jwtSecret, ...values })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function fakeStorage(t: TestContext) {
  const user = { id: "test-user", email: "customer@example.invalid", name: "Test Customer", role: "CUSTOMER" as const, passwordHash: "unused", sessionVersion: 0, createdAt: new Date(), updatedAt: new Date() };
  stub(t, prisma.appConfig, "findUnique", async () => null);
  stub(t, prisma.rateLimit, "upsert", async () => ({ count: 1 }));
  stub(t, prisma.user, "findUnique", async () => user);
  stub(t, prisma.user, "findUniqueOrThrow", async () => user);
  stub(t, prisma, "$transaction", async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
  stub(t, prisma, "$executeRaw", async () => 1);
  return user;
}
function requestContext(t: TestContext, token: string) {
  stub(t, workAsyncStorage, "getStore", () => ({ route: "/api/auth/change-password" }) as WorkStore);
  stub(t, workUnitAsyncStorage, "getStore", () => ({ type: "request", phase: "render", cookies: new RequestCookies(new Headers({ Cookie: `${SESSION_COOKIE}=${token}` })) }) as unknown as RequestStore);
}
async function action(name: string, body: unknown) {
  return authAction(new Request(`${origin}/api/auth/${name}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ action: name }) });
}

test("all API mutations require canonical origin and host, never spoofed forwarding headers", async t => {
  environment(t);
  assert.equal(config.matcher, "/api/:path*");
  for (const path of ["/api/cart", "/api/checkout", "/api/checkout/recover", "/api/contact", "/api/auth/login", "/api/auth/logout", "/api/auth/reset-password", "/api/admin/setup", "/api/admin/uploads"]) {
    for (const supplied of [undefined, "null", "https://attacker.example"]) {
      const headers: Record<string, string> = { host: "bakery.example" };
      if (supplied) headers.origin = supplied;
      assert.equal((await middleware(new NextRequest(`${origin}${path}`, { method: "POST", headers }))).status, 403);
    }
    assert.equal((await middleware(new NextRequest(`http://internal:3000${path}`, { method: "POST", headers: { Origin: origin, Host: "bakery.example" } }))).status, 200);
    assert.equal((await middleware(new NextRequest(`${origin}${path}`, { method: "POST", headers: { Origin: origin, Host: "attacker.example", "X-Forwarded-Host": "bakery.example" } }))).status, 403);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await middleware(new NextRequest(`${origin}/api/cart`, { method, headers: { Origin: "https://attacker.example" } }))).status, 403);
  assert.equal((await middleware(new NextRequest(`${origin}/api/cart`, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  assert.equal((await middleware(new NextRequest(`${origin}/api/cart`))).status, 200);
});

test("production origin configuration errors fail closed", async t => {
  environment(t, { APP_URL: undefined });
  const request = () => new NextRequest(`${origin}/api/cart`, { method: "POST", headers: { Origin: origin } });
  assert.equal((await middleware(request())).status, 503);
  for (const value of ["not-a-url", "http://bakery.example", "https://user:pass@bakery.example", "data:text/plain,hello"]) {
    process.env.APP_URL = value;
    assert.equal((await middleware(request())).status, 503);
  }
});

test("streamed body limits cover JSON, uploads, dishonest lengths, and interrupted reads", async t => {
  environment(t);
  const check = (path: string, body: string, headers: Record<string, string> = {}) => middleware(new NextRequest(`${origin}${path}`, { method: "POST", headers: { Origin: origin, ...headers }, body }));
  assert.equal((await check("/api/cart", "x".repeat(65537))).status, 413);
  assert.equal((await check("/api/cart", "x".repeat(65537), { "content-length": "1" })).status, 413);
  assert.equal((await check("/api/cart", "{}", { "content-length": "-1" })).status, 400);
  assert.equal((await check("/api/admin/uploads", "x".repeat(70000), { "content-type": "multipart/form-data; boundary=test" })).status, 200);
  assert.equal((await check("/api/admin/uploads", "x".repeat(6 * 1024 * 1024 + 1))).status, 413);
  const valid = new NextRequest(`${origin}/api/cart`, { method: "POST", headers: { Origin: origin }, body: '{"quantity":1}' });
  assert.equal((await middleware(valid)).status, 200);
  assert.deepEqual(await valid.json(), { quantity: 1 });
  const broken = new ReadableStream({ start(controller) { controller.error(new Error("interrupted body")); } });
  assert.equal((await middleware(new NextRequest(`${origin}/api/cart`, { method: "POST", headers: { Origin: origin }, body: broken }))).status, 400);
});

test("rate-limit storage failures reject attempts", async t => {
  stub(t, prisma.rateLimit, "upsert", async () => { throw new Error("storage unavailable"); });
  assert.equal(await rateLimit(new Request(origin), "login", 20), false);
  assert.equal((await action("forgot-password", { email: "customer@example.invalid" })).status, 429);
});

test("SMTP failure reveals no reset link or account existence and issues no token", async t => {
  environment(t, { SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined, EMAIL_FROM: undefined });
  fakeStorage(t);
  stub(t, prisma.appConfig, "findMany", async () => []);
  const create = stub(t, prisma.passwordReset, "create", async () => { throw new Error("must not issue token"); });
  const known = await action("forgot-password", { email: "customer@example.invalid" });
  const unknown = await action("forgot-password", { email: "unknown@example.invalid" });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  const response = await known.json();
  assert.deepEqual(response, await unknown.json());
  assert.deepEqual(Object.keys(response), ["message"]);
  assert.equal(create.mock.callCount(), 0);
  assert.doesNotMatch(JSON.stringify(response), /resetUrl|token=|[a-f0-9]{64}/);
});

test("recovery credentials are queued only to the owner and never returned in HTTP", async t => {
  environment(t, { SMTP_HOST: "smtp.example.invalid", SMTP_PORT: "587", SMTP_USER: "test", SMTP_PASSWORD: "test", EMAIL_FROM: "test@example.invalid" });
  const user = fakeStorage(t);
  stub(t, prisma.appConfig, "findMany", async () => []);
  stub(t, prisma.passwordReset, "deleteMany", async () => ({ count: 1 }));
  const create = stub(t, prisma.passwordReset, "create", async () => ({}));
  const email = stub(t, prisma.emailJob, "upsert", async () => ({}));
  const response = await action("forgot-password", { email: user.email });
  assert.equal(response.status, 200); assert.deepEqual(Object.keys(await response.json()), ["message"]);
  const queued = email.mock.calls[0].arguments[0].create;
  assert.equal(queued.to, user.email);
  assert.match(queued.body, /https:\/\/bakery.example\/reset-password\?token=[a-f0-9]{64}/);
  const token = queued.body.match(/token=([a-f0-9]{64})/)![1];
  assert.equal(create.mock.calls[0].arguments[0].data.tokenHash, createHash("sha256").update(token).digest("hex"));
});

test("sessions require a matching server version and use the database role", async t => {
  environment(t);
  const user = fakeStorage(t);
  const claims = { sub: user.id, email: user.email, role: "ADMIN" as const, version: 0 };
  const token = await signSession(claims);
  assert.equal((await sessionFromToken(token))?.role, "CUSTOMER");
  user.sessionVersion++;
  assert.equal(await sessionFromToken(token), null);
  for (const version of [undefined, -1, 0.5, "1"]) assert.equal(await sessionFromToken(jwt.sign({ sub: user.id, version }, jwtSecret)), null);
  assert.equal(await sessionFromToken(jwt.sign({ ...claims, version: 1 }, jwtSecret, { algorithm: "HS384" })), null);
  assert.equal(await sessionFromToken("invalid"), null);
});

test("password reset is one-use and revokes old sessions", async t => {
  environment(t); const user = fakeStorage(t);
  let reset: { userId: string; expiresAt: Date } | null = { userId: user.id, expiresAt: new Date(Date.now() + 60000) };
  stub(t, prisma.passwordReset, "findUnique", async () => reset);
  stub(t, prisma.passwordReset, "deleteMany", async () => { reset = null; return { count: 1 }; });
  stub(t, prisma.user, "update", async ({ data }) => { assert.deepEqual(data.sessionVersion, { increment: 1 }); user.sessionVersion++; user.passwordHash = data.passwordHash as string; return user; });
  const old = await signSession({ sub: user.id, email: user.email, role: user.role, version: 0 });
  const response = await action("reset-password", { token: "a".repeat(64), password: "A-strong-replacement-password" });
  assert.equal(response.status, 200); assert.match(response.headers.get("set-cookie") || "", /bakery_session=;/);
  assert.equal(user.sessionVersion, 1); assert.equal(await verifyPassword("A-strong-replacement-password", user.passwordHash), true);
  assert.equal(await sessionFromToken(old), null);
  assert.equal((await action("reset-password", { token: "a".repeat(64), password: "Another-strong-password" })).status, 400);
});

test("password change revokes sessions and pending reset links atomically", async t => {
  environment(t); const user = fakeStorage(t); user.passwordHash = await hashPassword("Current-strong-password");
  const token = await signSession({ sub: user.id, email: user.email, role: user.role, version: 0 }); requestContext(t, token);
  const update = stub(t, prisma.user, "updateMany", async ({ where, data }) => {
    assert.equal(where?.sessionVersion, 0); assert.equal(where?.passwordHash, user.passwordHash); assert.deepEqual(data.sessionVersion, { increment: 1 });
    user.sessionVersion++; user.passwordHash = data.passwordHash as string; return { count: 1 };
  });
  const remove = stub(t, prisma.passwordReset, "deleteMany", async () => ({ count: 1 }));
  assert.equal((await action("change-password", { currentPassword: "Current-strong-password", password: "Replacement-strong-password" })).status, 200);
  assert.equal(update.mock.callCount(), 1); assert.equal(remove.mock.callCount(), 1); assert.equal(await sessionFromToken(token), null);
  assert.equal((await action("change-password", { currentPassword: "Replacement-strong-password", password: "Another-strong-password" })).status, 401);
});

test("concurrent password changes cannot overwrite newer credentials", async t => {
  environment(t); const user = fakeStorage(t); user.passwordHash = await hashPassword("Current-strong-password");
  requestContext(t, await signSession({ sub: user.id, email: user.email, role: user.role, version: 0 }));
  stub(t, prisma.user, "updateMany", async () => ({ count: 0 }));
  const remove = stub(t, prisma.passwordReset, "deleteMany", async () => ({ count: 1 }));
  assert.equal((await action("change-password", { currentPassword: "Current-strong-password", password: "Replacement-strong-password" })).status, 401);
  assert.equal(remove.mock.callCount(), 0);
});

test("expired reset links cannot alter credentials", async t => {
  environment(t); const user = fakeStorage(t);
  stub(t, prisma.passwordReset, "findUnique", async () => ({ userId: user.id, expiresAt: new Date(0) }));
  const update = stub(t, prisma.user, "update", async () => { throw new Error("must not update"); });
  assert.equal((await action("reset-password", { token: "b".repeat(64), password: "Replacement-strong-password" })).status, 400);
  assert.equal(update.mock.callCount(), 0);
});

test("logout revokes its signed session before clearing the cookie", async t => {
  environment(t); const user = fakeStorage(t);
  const token = await signSession({ sub: user.id, email: user.email, role: user.role, version: 0 }); requestContext(t, token);
  stub(t, prisma.user, "update", async ({ data }) => { assert.deepEqual(data.sessionVersion, { increment: 1 }); user.sessionVersion++; return user; });
  const response = await logout(new Request(`${origin}/api/auth/logout`, { method: "POST" }));
  assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `${origin}/`);
  assert.match(response.headers.get("set-cookie") || "", /bakery_session=;/);
  assert.equal(await sessionFromToken(token), null);
});

test("strict session lookup distinguishes storage outages from invalid credentials", async t => {
  environment(t);
  stub(t, prisma.appConfig, "findUnique", async () => null);
  stub(t, prisma.user, "findUnique", async () => { throw new Error("storage unavailable"); });
  const token = await signSession({ sub: "test-user", email: "test@example.invalid", role: "CUSTOMER", version: 0 });
  assert.equal(await sessionFromToken(token), null);
  await assert.rejects(sessionFromToken(token, true), /storage unavailable/);
  assert.equal(await sessionFromToken("malformed", true), null);
  requestContext(t, token);
  await assert.rejects(logout(new Request(`${origin}/api/auth/logout`, { method: "POST" })), /storage unavailable/);
});
