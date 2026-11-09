import type { Prisma } from "@prisma/client";
import {
  type AdminActor,
  type AdminPaymentMethod,
  CorrectionError,
  PaymentMismatchError,
  correctionBlockReason,
  orderTotalCents,
  readTransactionId,
  recalculatedOrderTotal
} from "@/lib/admin-order-corrections";

const orderInclude = {
  items: { orderBy: { id: "asc" as const } },
  adminPaymentLink: { select: { orderId: true, paymentId: true } }
} satisfies Prisma.OrderInclude;

function actorFields(actor: AdminActor) {
  const id = actor.id.trim();
  if (!id) throw new CorrectionError("The admin account could not be identified.");
  return { actorId: id, actorEmail: actor.email?.trim() || null, actorName: actor.name?.trim() || null };
}

async function lockOrder(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${id}`}))`;
}

async function loadOrder(tx: Prisma.TransactionClient, id: string) {
  const order = await tx.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new CorrectionError("That order was not found.");
  return order;
}

function assertCorrectable(order: Awaited<ReturnType<typeof loadOrder>>) {
  const reason = correctionBlockReason({
    status: order.status,
    paymentState: order.paymentState,
    inventoryRestored: order.inventoryRestored,
    hasRecordedPayment: Boolean(order.adminPaymentLink)
  });
  if (reason) throw new CorrectionError(reason);
}

function lineSnapshot(item: { id: string; productName: string; quantity: number; unitPriceCents: number }, orderTotal: number, deliveryFeeCents: number) {
  return {
    itemId: item.id,
    productName: item.productName,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.quantity * item.unitPriceCents,
    orderTotalCents: orderTotal,
    deliveryFeeCents
  };
}

export async function changeOrderItemQuantity(tx: Prisma.TransactionClient, input: {
  orderId: string;
  itemId: string;
  quantity: number;
  note: string | null;
  actor: AdminActor;
  now: Date;
}) {
  await lockOrder(tx, input.orderId);
  const order = await loadOrder(tx, input.orderId);
  assertCorrectable(order);
  const current = order.items.find(item => item.id === input.itemId);
  if (!current) throw new CorrectionError("That line item is not on this order.");
  if (current.quantity === input.quantity) throw new CorrectionError("That quantity is already saved.");
  const priced = order.items.map(item => ({ id: item.id, quantity: item.quantity, unitPriceCents: item.unitPriceCents }));
  const next = recalculatedOrderTotal(priced, input.itemId, input.quantity, order.deliveryFeeCents);
  const saved = next.items.find(item => item.id === current.id);
  if (!saved) throw new CorrectionError("That line item is not on this order.");
  const before = lineSnapshot(current, order.totalCents, order.deliveryFeeCents);
  const after = lineSnapshot({ ...current, quantity: saved.quantity }, next.totalCents, order.deliveryFeeCents);
  await tx.orderItem.update({ where: { id: current.id }, data: { quantity: saved.quantity } });
  await tx.order.update({ where: { id: order.id }, data: { totalCents: next.totalCents } });
  const audit = await tx.adminOrderAudit.create({
    data: {
      orderId: order.id,
      action: "QUANTITY_CHANGED",
      note: input.note,
      before,
      after,
      createdAt: input.now,
      ...actorFields(input.actor)
    }
  });
  return { orderId: order.id, itemId: current.id, quantity: saved.quantity, unitPriceCents: current.unitPriceCents, totalCents: next.totalCents, auditId: audit.id };
}

export async function recordAdminPayment(tx: Prisma.TransactionClient, input: {
  orderIds: string[];
  amountCents: number | null;
  method: AdminPaymentMethod;
  note: string | null;
  providerTransactionId: string | null;
  actor: AdminActor;
  now: Date;
}) {
  const orderIds = [...input.orderIds].sort();
  for (const id of orderIds) await lockOrder(tx, id);
  const orders = [];
  for (const id of orderIds) orders.push(await loadOrder(tx, id));
  for (const order of orders) {
    assertCorrectable(order);
    const computed = orderTotalCents(order.items, order.deliveryFeeCents);
    if (computed !== order.totalCents) throw new CorrectionError("This order total does not match its line items. Save the line quantities before recording a payment.");
  }
  const currencies = new Set(orders.map(order => order.currency));
  if (currencies.size !== 1) throw new CorrectionError("Selected orders must use the same currency.");
  const expectedCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
  if (!Number.isSafeInteger(expectedCents) || expectedCents <= 0) throw new CorrectionError("The selected orders do not have a valid total.");
  if (input.amountCents === null) {
    if (orders.length !== 1) throw new CorrectionError("Enter the amount received. It has to equal the total of the selected orders.");
  } else if (input.amountCents !== expectedCents) {
    throw new PaymentMismatchError(input.amountCents, expectedCents);
  }
  const txn = readTransactionId(input.providerTransactionId);
  if (txn) {
    const recorded = await tx.adminPayment.findUnique({ where: { providerTransactionId: txn }, select: { id: true } });
    const event = await tx.paymentEvent.findUnique({ where: { providerTransactionId: txn }, select: { id: true } });
    const existingOrder = await tx.order.findUnique({ where: { providerTransactionId: txn }, select: { id: true } });
    if (recorded || event || existingOrder) throw new CorrectionError("That transaction ID is already recorded.");
  }
  const currency = orders[0].currency || "USD";
  const payment = await tx.adminPayment.create({
    data: {
      amountCents: expectedCents,
      currency,
      method: input.method,
      providerTransactionId: txn,
      note: input.note,
      createdAt: input.now,
      ...actorFields(input.actor)
    }
  });
  const auditIds: string[] = [];
  for (const order of orders) {
    await tx.adminPaymentOrder.create({ data: { orderId: order.id, paymentId: payment.id, amountCents: order.totalCents } });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentState: "VERIFIED",
        paymentMethod: input.method,
        paymentVerifiedAt: input.now,
        paymentVerifiedBy: input.actor.id.trim(),
        verifiedAmountCents: order.totalCents
      }
    });
    const audit = await tx.adminOrderAudit.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        action: "MARKED_PAID",
        note: input.note,
        createdAt: input.now,
        before: {
          status: order.status,
          paymentState: order.paymentState,
          paymentMethod: order.paymentMethod,
          totalCents: order.totalCents,
          verifiedAmountCents: order.verifiedAmountCents
        },
        after: {
          status: "PAID",
          paymentState: "VERIFIED",
          paymentMethod: input.method,
          totalCents: order.totalCents,
          verifiedAmountCents: order.totalCents,
          paymentId: payment.id,
          paymentAmountCents: expectedCents,
          currency,
          providerTransactionId: txn,
          coveredOrderIds: orderIds
        },
        ...actorFields(input.actor)
      }
    });
    auditIds.push(audit.id);
  }
  return { paymentId: payment.id, orderIds, amountCents: expectedCents, currency, method: input.method, auditIds };
}
