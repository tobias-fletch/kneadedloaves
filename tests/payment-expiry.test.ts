import assert from "node:assert/strict";
import test from "node:test";
import { expireUnpaidOrders } from "../lib/manual-payments";
import { prisma } from "../lib/prisma";

test("overlapping expiry checks share one batch", async (t) => {
  const orders = prisma.order.findMany;
  const transaction = prisma.$transaction;
  let calls = 0;
  Reflect.set(prisma.order, "findMany", async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return [];
  });
  Reflect.set(prisma, "$transaction", async () => false);
  t.after(() => {
    Reflect.set(prisma.order, "findMany", orders);
    Reflect.set(prisma, "$transaction", transaction);
  });
  const [first, second] = await Promise.all([expireUnpaidOrders(), expireUnpaidOrders()]);
  assert.equal(first, 0);
  assert.equal(second, 0);
  assert.equal(calls, 1);
});
