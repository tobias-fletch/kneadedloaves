import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage, type RequestStore } from "next/dist/server/app-render/work-unit-async-storage.external";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { SESSION_COOKIE, signSession } from "../lib/auth";
import { OrderCorrectionForms, SharedPaymentForm } from "../components/AdminOrderCorrections";
import {
  PaymentMismatchError,
  canCorrectOrder,
  describePaymentMatch,
  parseDollarToCents,
  parseLineQuantity,
  readQuantityChange,
  readSharedPayment,
  recalculatedOrderTotal,
  toPublicCorrectionError
} from "../lib/admin-order-corrections";
import { changeOrderItemQuantity, recordAdminPayment } from "../lib/admin-order-corrections-db";
import { PATCH as patchQuantity } from "../app/api/admin/orders/[id]/items/route";
import { POST as markPaid } from "../app/api/admin/orders/[id]/mark-paid/route";
import { POST as recordPayments } from "../app/api/admin/orders/payments/route";

const now = new Date("2026-11-09T15:00:00Z");
const actor = { id: "admin-1", email: "admin@bakery.local", name: "Toby" };
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const routes = [
  ["PATCH", patchQuantity, "/api/admin/orders/order-a/items", { itemId: "order-a-item", quantity: 2 }],
  ["POST", markPaid, "/api/admin/orders/order-a/mark-paid", { method: "CASH" }],
  ["POST", recordPayments, "/api/admin/orders/payments", { orderIds: ["order-a", "order-b"], amountCents: 4000, method: "VENMO" }]
] as const;

type Item = { id: string; orderId: string; productId: string | null; productName: string; quantity: number; unitPriceCents: number };
type FakeOrder = {
  id: string; status: string; paymentState: string; paymentMethod: string | null; totalCents: number; deliveryFeeCents: number;
  currency: string; verifiedAmountCents: number | null; inventoryRestored: boolean; providerTransactionId: string | null;
  paymentDueAt: Date | null; orderWindowId: string | null; items: Item[]; adminPaymentLink: { orderId: string; paymentId: string } | null;
};
type Bag = { audits: Record<string, unknown>[]; payments: Record<string, unknown>[]; links: Record<string, unknown>[]; orderUpdates: { id: string; data: Record<string, unknown> }[]; itemUpdates: { id: string; data: Record<string, unknown> }[]; emails: number };

function textOrder(id: string, windowId: string, quantity = 1, totalCents = quantity * 1000): FakeOrder {
  return {
    id, status: "PENDING", paymentState: "UNPAID", paymentMethod: null, totalCents, deliveryFeeCents: 0, currency: "USD",
    verifiedAmountCents: null, inventoryRestored: false, providerTransactionId: null, paymentDueAt: new Date("2026-11-01T00:00:00Z"),
    orderWindowId: windowId, adminPaymentLink: null,
    items: [{ id: `${id}-item`, orderId: id, productId: "plain-focaccia", productName: "Plain Focaccia", quantity, unitPriceCents: 1000 }]
  };
}
function memory(orders: FakeOrder[], knownEvents: string[] = []) {
  const bag: Bag = { audits: [], payments: [], links: [], orderUpdates: [], itemUpdates: [], emails: 0 };
  const tx = {
    $executeRaw: async () => 1,
    order: {
      findUnique: async ({ where }: { where: { id?: string; providerTransactionId?: string } }) => {
        const order = orders.find(item => where.id ? item.id === where.id : item.providerTransactionId === where.providerTransactionId);
        return order ? structuredClone(order) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        bag.orderUpdates.push({ id: where.id, data: { ...data } });
        const order = orders.find(item => item.id === where.id);
        if (!order) throw new Error("missing order");
        Object.assign(order, data);
        return structuredClone(order);
      }
    },
    orderItem: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        bag.itemUpdates.push({ id: where.id, data: { ...data } });
        for (const order of orders) {
          const item = order.items.find(entry => entry.id === where.id);
          if (!item) continue;
          Object.assign(item, data);
          return structuredClone(item);
        }
        throw new Error("missing item");
      }
    },
    adminOrderAudit: { create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `audit-${bag.audits.length + 1}`, ...data }; bag.audits.push(row); return row; } },
    adminPayment: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `pay-${bag.payments.length + 1}`, ...data }; bag.payments.push(row); return row; },
      findUnique: async ({ where }: { where: { providerTransactionId?: string } }) => bag.payments.find(item => item.providerTransactionId === where.providerTransactionId) ?? null
    },
    adminPaymentOrder: {
      create: async ({ data }: { data: { orderId: string; paymentId: string; amountCents: number } }) => {
        bag.links.push(data);
        const order = orders.find(item => item.id === data.orderId);
        if (order) order.adminPaymentLink = { orderId: data.orderId, paymentId: data.paymentId };
        return data;
      }
    },
    paymentEvent: { findUnique: async ({ where }: { where: { providerTransactionId?: string } }) => knownEvents.includes(where.providerTransactionId ?? "") ? { id: "existing-event" } : null },
    emailJob: { create: async () => { bag.emails += 1; throw new Error("email"); }, upsert: async () => { bag.emails += 1; throw new Error("email"); } }
  };
  return { orders, bag, tx: tx as unknown as Prisma.TransactionClient };
}

function stub<T extends object, K extends keyof T>(t: TestContext, target: T, key: K, implementation: T[K]) {
  const original = target[key];
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}
function environment(t: TestContext) {
  for (const [key, value] of Object.entries({ NODE_ENV: "production", JWT_SECRET: "test-only-session-secret-with-at-least-32-characters" })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function requestContext(t: TestContext, token?: string) {
  const headers = token ? new Headers({ Cookie: `${SESSION_COOKIE}=${token}` }) : new Headers();
  stub(t, workAsyncStorage, "getStore", (() => ({ route: "/api/admin/orders" }) as WorkStore) as typeof workAsyncStorage.getStore);
  stub(t, workUnitAsyncStorage, "getStore", (() => ({ type: "request", phase: "render", cookies: new RequestCookies(headers) }) as unknown as RequestStore) as typeof workUnitAsyncStorage.getStore);
}
async function rejectRedirect(run: () => Promise<unknown>, url: string) {
  await assert.rejects(run(), (error: unknown) => { assert.equal(getURLFromRedirectError(error as never), url); return true; });
}

test("quantity total is recalculated from the stored unit price and delivery fee", () => {
  const items = [{ id: "loaf", quantity: 1, unitPriceCents: 1000 }, { id: "cookie", quantity: 3, unitPriceCents: 500 }];
  const next = recalculatedOrderTotal(items, "loaf", 2, 600);
  assert.equal(next.totalCents, 2 * 1000 + 3 * 500 + 600);
  assert.equal(next.items.find(item => item.id === "cookie")?.quantity, 3);
  assert.equal(next.items.find(item => item.id === "loaf")?.unitPriceCents, 1000);
  assert.deepEqual(readQuantityChange({ itemId: "loaf", quantity: 2, totalCents: 1, unitPriceCents: 1 }), { itemId: "loaf", quantity: 2, note: null });
  for (const quantity of [0, -1, 1.5, 1001, "2", true, null]) assert.throws(() => parseLineQuantity(quantity), /whole number from 1 to 1000/);
});

test("shared payment amount must equal the selected order totals", () => {
  const mismatch = describePaymentMatch(3000, [2000, 2000]);
  assert.equal(mismatch.matches, false);
  assert.match(mismatch.message, /\$30\.00/);
  assert.match(mismatch.message, /\$40\.00/);
  assert.match(mismatch.message, /Nothing was marked paid/);
  assert.equal(describePaymentMatch(4000, [2000, 2000]).matches, true);
  assert.equal(describePaymentMatch(null, [2000, 2000]).matches, false);
  assert.equal(parseDollarToCents("40.00"), 4000);
  assert.equal(parseDollarToCents("0"), null);
  const error = new PaymentMismatchError(3000, 4000);
  const body = toPublicCorrectionError(error);
  assert.equal(body.status, 409);
  assert.equal(body.body.expectedCents, 4000);
  assert.equal(body.body.receivedCents, 3000);
  const hidden = toPublicCorrectionError({ code: "P2002", message: "Unique constraint failed on secret-constraint-detail" });
  assert.equal(hidden.status, 409);
  assert.equal(hidden.body.error.includes("secret"), false);
  assert.equal(toPublicCorrectionError(new Error("prisma the database connection string")).body.error, "Could not save this change.");
});

test("text orders: quantity fix, rejected mismatched payment, then one payment covering both", async () => {
  const first = textOrder("order-a", "kl-text-window-20261108", 1, 999);
  const second = textOrder("order-b", "kl-text-window-20261113");
  const db = memory([first, second]);
  const windows = { a: first.orderWindowId, b: second.orderWindowId, dueA: first.paymentDueAt?.toISOString(), dueB: second.paymentDueAt?.toISOString() };
  await assert.rejects(recordAdminPayment(db.tx, { orderIds: [second.id, first.id], amountCents: 4000, method: "VENMO", note: "too early", providerTransactionId: "VENMO40", actor, now }), /does not match its line items/);
  assert.equal(db.bag.audits.length, 0);
  assert.equal(db.bag.payments.length, 0);
  const change = readQuantityChange({ itemId: "order-a-item", quantity: 2, note: "texted for 2 loaves", totalCents: 1, unitPriceCents: 1 });
  const saved = await changeOrderItemQuantity(db.tx, { ...change, orderId: first.id, actor, now });
  assert.equal(saved.totalCents, 2000);
  assert.equal(saved.unitPriceCents, 1000);
  assert.deepEqual(db.bag.itemUpdates[0].data, { quantity: 2 });
  assert.deepEqual(db.bag.orderUpdates[0].data, { totalCents: 2000 });
  assert.equal(first.orderWindowId, windows.a);
  const audit = db.bag.audits[0];
  assert.equal(audit.action, "QUANTITY_CHANGED");
  assert.equal(audit.actorId, actor.id);
  assert.equal(audit.actorEmail, actor.email);
  assert.equal(audit.actorName, actor.name);
  assert.equal(audit.note, "texted for 2 loaves");
  assert.equal((audit.createdAt as Date).toISOString(), now.toISOString());
  assert.deepEqual(audit.before, { itemId: "order-a-item", productName: "Plain Focaccia", quantity: 1, unitPriceCents: 1000, lineTotalCents: 1000, orderTotalCents: 999, deliveryFeeCents: 0 });
  assert.deepEqual(audit.after, { itemId: "order-a-item", productName: "Plain Focaccia", quantity: 2, unitPriceCents: 1000, lineTotalCents: 2000, orderTotalCents: 2000, deliveryFeeCents: 0 });
  await changeOrderItemQuantity(db.tx, { orderId: second.id, itemId: "order-b-item", quantity: 2, note: null, actor, now });
  assert.equal(second.totalCents, 2000);
  await assert.rejects(recordAdminPayment(db.tx, { orderIds: [first.id, second.id], amountCents: 3000, method: "VENMO", note: "short", providerTransactionId: "VENMO40", actor, now }), (error: unknown) => {
    assert.ok(error instanceof PaymentMismatchError);
    assert.match(error.message, /\$30\.00/);
    assert.match(error.message, /\$40\.00/);
    return true;
  });
  assert.equal(db.bag.payments.length, 0);
  assert.deepEqual(db.bag.audits.map(item => item.action), ["QUANTITY_CHANGED", "QUANTITY_CHANGED"]);
  assert.equal(first.status, "PENDING");
  assert.equal(second.status, "PENDING");
  const paid = await recordAdminPayment(db.tx, { orderIds: [second.id, first.id], amountCents: 4000, method: "VENMO", note: "one Venmo for both pickups", providerTransactionId: "venmo40", actor, now });
  assert.equal(readSharedPayment({ orderIds: ["order-b", "order-a"], amountCents: 4000, method: "venmo", providerTransactionId: " venmo40 " }).providerTransactionId, "VENMO40");
  assert.equal(paid.paymentId, "pay-1");
  assert.equal(paid.amountCents, 4000);
  assert.deepEqual(paid.orderIds, ["order-a", "order-b"]);
  assert.equal(db.bag.payments[0].amountCents, 4000);
  assert.equal(db.bag.payments[0].providerTransactionId, "VENMO40");
  assert.equal(db.bag.payments[0].note, "one Venmo for both pickups");
  assert.equal(db.bag.payments[0].actorEmail, actor.email);
  assert.deepEqual(db.bag.links, [{ orderId: "order-a", paymentId: "pay-1", amountCents: 2000 }, { orderId: "order-b", paymentId: "pay-1", amountCents: 2000 }]);
  for (const order of [first, second]) {
    assert.equal(order.status, "PAID");
    assert.equal(order.paymentState, "VERIFIED");
    assert.equal(order.paymentMethod, "VENMO");
    assert.equal(order.verifiedAmountCents, 2000);
    assert.equal(order.providerTransactionId, null);
    assert.equal(order.totalCents, 2000);
  }
  assert.equal(first.orderWindowId, windows.a);
  assert.equal(second.orderWindowId, windows.b);
  assert.equal(first.paymentDueAt?.toISOString(), windows.dueA);
  assert.equal(second.paymentDueAt?.toISOString(), windows.dueB);
  const paymentAudits = db.bag.audits.filter(item => item.action === "MARKED_PAID");
  assert.equal(paymentAudits.length, 2);
  assert.deepEqual(paymentAudits.map(item => item.paymentId), ["pay-1", "pay-1"]);
  for (const row of paymentAudits) {
    assert.equal(row.actorId, actor.id);
    assert.equal(row.actorEmail, actor.email);
    assert.equal(row.note, "one Venmo for both pickups");
    assert.equal((row.createdAt as Date).toISOString(), now.toISOString());
    assert.equal((row.before as { status: string }).status, "PENDING");
    assert.equal((row.after as { paymentId: string; verifiedAmountCents: number; paymentAmountCents: number }).paymentId, "pay-1");
    assert.equal((row.after as { verifiedAmountCents: number }).verifiedAmountCents, 2000);
    assert.equal((row.after as { paymentAmountCents: number }).paymentAmountCents, 4000);
  }
  assert.equal(db.bag.emails, 0);
  assert.equal(canCorrectOrder(first), false);
  await assert.rejects(recordAdminPayment(db.tx, { orderIds: [first.id], amountCents: null, method: "CASH", note: null, providerTransactionId: null, actor, now }), /already marked paid/);
});

test("cash payment without a transaction id marks one past-deadline order paid", async () => {
  const order = textOrder("order-a", "kl-text-window-20261108", 2, 2000);
  const db = memory([order]);
  const paid = await recordAdminPayment(db.tx, { orderIds: [order.id], amountCents: null, method: "CASH", note: null, providerTransactionId: null, actor, now });
  assert.equal(paid.amountCents, 2000);
  assert.equal(db.bag.payments[0].providerTransactionId, null);
  assert.equal(db.bag.audits[0].note, null);
  assert.equal(order.status, "PAID");
  assert.equal(order.paymentDueAt?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(db.bag.emails, 0);
});

test("a transaction id already used by Venmo reconcile is refused", async () => {
  const order = textOrder("order-a", "kl-text-window-20261108", 2, 2000);
  const db = memory([order], ["EXISTING"]);
  await assert.rejects(recordAdminPayment(db.tx, { orderIds: [order.id], amountCents: 2000, method: "VENMO", note: null, providerTransactionId: "EXISTING", actor, now }), /already recorded/);
  assert.equal(db.bag.audits.length, 0);
  assert.equal(order.status, "PENDING");
});

test("cancelled orders are not revived and a client total cannot mark them paid", async () => {
  const order = textOrder("order-a", "kl-text-window-20261108");
  order.status = "CANCELLED";
  const db = memory([order]);
  await assert.rejects(recordAdminPayment(db.tx, { orderIds: [order.id], amountCents: null, method: "VENMO", note: null, providerTransactionId: null, actor, now }), /stay closed/);
  assert.equal(db.bag.audits.length, 0);
  assert.equal(order.status, "CANCELLED");
});

test("unauthenticated and non-admin requests are rejected before any write", async t => {
  environment(t);
  const user = { id: "admin-1", email: "admin@bakery.local", name: "Toby", role: "CUSTOMER" as "CUSTOMER" | "ADMIN", sessionVersion: 0 };
  stub(t, prisma.appConfig, "findUnique", (async () => null) as unknown as typeof prisma.appConfig.findUnique);
  stub(t, prisma.user, "findUnique", (async () => user) as unknown as typeof prisma.user.findUnique);
  let writes = 0;
  stub(t, prisma, "$transaction", (async () => { writes += 1; throw new Error("must not write"); }) as unknown as typeof prisma.$transaction);
  requestContext(t);
  for (const [method, handler, path, body] of routes) {
    const run = () => handler(new Request(`https://bakery.example${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "order-a" }) });
    await rejectRedirect(run, "/login");
  }
  const token = await signSession({ sub: user.id, email: user.email, role: "ADMIN", name: user.name, version: 0 });
  requestContext(t, token);
  for (const [method, handler, path, body] of routes) {
    const run = () => handler(new Request(`https://bakery.example${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "order-a" }) });
    await rejectRedirect(run, "/");
  }
  assert.equal(writes, 0);
  assert.equal(user.role, "CUSTOMER");
});

test("admin routes ignore a client total and record the admin identity", async t => {
  environment(t);
  const user = { id: actor.id, email: actor.email, name: actor.name, role: "ADMIN" as const, sessionVersion: 0 };
  stub(t, prisma.appConfig, "findUnique", (async () => null) as unknown as typeof prisma.appConfig.findUnique);
  stub(t, prisma.user, "findUnique", (async () => user) as unknown as typeof prisma.user.findUnique);
  const db = memory([textOrder("order-a", "kl-text-window-20261108", 1, 1000), textOrder("order-b", "kl-text-window-20261113", 2, 2000)]);
  stub(t, prisma, "$transaction", (async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => run(db.tx)) as unknown as typeof prisma.$transaction);
  requestContext(t, await signSession({ sub: user.id, email: user.email, role: "CUSTOMER", name: user.name, version: 0 }));
  const quantity = await patchQuantity(new Request("https://bakery.example/api/admin/orders/order-a/items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: "order-a-item", quantity: 2, note: "two loaves", totalCents: 1, unitPriceCents: 1, actorEmail: "attacker@example.com" }) }), { params: Promise.resolve({ id: "order-a" }) });
  assert.equal(quantity.status, 200);
  assert.equal((await quantity.json()).totalCents, 2000);
  assert.equal(db.orders[0].totalCents, 2000);
  assert.equal(db.bag.audits[0].actorEmail, actor.email);
  assert.equal(db.bag.audits[0].actorId, actor.id);
  assert.notEqual(db.bag.audits[0].actorEmail, "attacker@example.com");
  const single = await markPaid(new Request("https://bakery.example/api/admin/orders/order-a/mark-paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: "cash", note: "paid at pickup", amountCents: 1, totalCents: 1, orderIds: ["order-b"] }) }), { params: Promise.resolve({ id: "order-a" }) });
  assert.equal(single.status, 200);
  const singleBody = await single.json();
  assert.equal(singleBody.amountCents, 2000);
  assert.deepEqual(singleBody.orderIds, ["order-a"]);
  assert.equal(db.orders[0].status, "PAID");
  assert.equal(db.orders[1].status, "PENDING");
  assert.equal(db.orders[0].verifiedAmountCents, 2000);
  assert.equal(db.bag.payments[0].method, "CASH");
  assert.equal(db.bag.emails, 0);
});

test("admin order forms do not ask for a deadline or a required transaction id", () => {
  const single = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(OrderCorrectionForms, { orderId: "order-a", currency: "USD", totalCents: 2000, deliveryFeeCents: 0, items: [{ id: "order-a-item", productName: "Plain Focaccia", quantity: 2, unitPriceCents: 1000 }] })));
  const shared = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(SharedPaymentForm, { orders: [{ id: "order-a", customerName: "Sam", totalCents: 2000, currency: "USD", summary: "2 × Plain Focaccia", textOrder: true }, { id: "order-b", customerName: "Sam", totalCents: 2000, currency: "USD", summary: "2 × Plain Focaccia", textOrder: true }] })));
  for (const html of [single, shared]) {
    const txn = html.match(/<input[^>]*name="providerTransactionId"[^>]*>/g) ?? [];
    assert.ok(txn.length >= 1);
    for (const tag of txn) assert.equal(tag.includes("required"), false);
    assert.doesNotMatch(html, /datetime-local|paymentDueAt/);
    assert.match(html, /Venmo/);
    assert.match(html, /Cash/);
    assert.match(html, /Other/);
  }
  assert.match(single, /Save quantity/);
  assert.match(single, /does not change product stock/);
  assert.doesNotMatch(single, /name="amount"/);
  assert.match(shared, /name="amount"/);
  assert.match(shared, /Text order/);
  assert.match(shared, /Select at least two orders/);
});

test("correction routes stay behind requireAdmin and do not send mail or edit windows", () => {
  for (const file of ["app/api/admin/orders/[id]/items/route.ts", "app/api/admin/orders/[id]/mark-paid/route.ts", "app/api/admin/orders/payments/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /await requireAdmin\(\)/);
    assert.doesNotMatch(source, /queueEmail|renderOrderEmail|orderWindow/);
  }
  const db = readFileSync("lib/admin-order-corrections-db.ts", "utf8");
  assert.doesNotMatch(db, /queueEmail|renderOrderEmail|orderWindow|paymentDueAt|kl-text-window/);
  assert.match(readFileSync("app/api/admin/orders/[id]/payment/route.ts", "utf8"), /recordPaymentEvidence/);
  assert.match(readFileSync("components/AdminOrderActions.tsx", "utf8"), /Reconcile Venmo payment/);
  const sql = readFileSync("prisma/migrations/20261109010000_admin_order_corrections/migration.sql", "utf8");
  for (const table of ["AdminPayment", "AdminPaymentOrder", "AdminOrderAudit"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  assert.doesNotMatch(sql, /\bUPDATE\s+"|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|ALTER TABLE "(Order|OrderItem|OrderWindow)"/);
  const scrub = readFileSync("scripts/build.mjs", "utf8");
  for (const table of ["AdminOrderAudit", "AdminPaymentOrder", "AdminPayment"]) assert.match(scrub, new RegExp(`"${table}"`));
  assert.throws(() => readSharedPayment({ orderIds: ["a", "a"], amountCents: 100, method: "VENMO" }), /only be selected once/);
});
