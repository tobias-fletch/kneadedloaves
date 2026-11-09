import { formatMoney } from "@/lib/money";

/** Pickup windows used for orders typed in from customer texts. Display only; nothing writes these rows. */
export const TEXT_ORDER_WINDOW_IDS = ["kl-text-window-20261108", "kl-text-window-20261113"] as const;

export const MAX_LINE_QUANTITY = 1000;
export const MAX_PAYMENT_ORDERS = 20;
export const MAX_AMOUNT_CENTS = 100_000_000;

export const ADMIN_PAYMENT_METHODS = [
  { value: "VENMO", label: "Venmo" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" }
] as const;

export type AdminPaymentMethod = (typeof ADMIN_PAYMENT_METHODS)[number]["value"];
export type AdminActor = { id: string; email: string | null; name: string | null };

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionError";
  }
}

export class PaymentMismatchError extends CorrectionError {
  readonly receivedCents: number;
  readonly expectedCents: number;
  constructor(receivedCents: number, expectedCents: number) {
    super(paymentMismatchMessage(receivedCents, expectedCents));
    this.name = "PaymentMismatchError";
    this.receivedCents = receivedCents;
    this.expectedCents = expectedCents;
  }
}

export function isTextOrderWindow(orderWindowId: string | null | undefined) {
  return typeof orderWindowId === "string" && (TEXT_ORDER_WINDOW_IDS as readonly string[]).includes(orderWindowId);
}

export function paymentMethodLabel(method: string) {
  return ADMIN_PAYMENT_METHODS.find(item => item.value === method)?.label ?? method;
}

export function paymentMismatchMessage(receivedCents: number, expectedCents: number) {
  return `Payment amount does not match the selected orders. Received ${formatMoney(receivedCents)}; the orders total ${formatMoney(expectedCents)}. Nothing was marked paid.`;
}

export function parseLineQuantity(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_LINE_QUANTITY) {
    throw new CorrectionError(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}.`);
  }
  return value;
}

export function readNote(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CorrectionError("The note must be text.");
  const note = value.trim();
  if (note.length > 1000) throw new CorrectionError("Notes cannot be longer than 1000 characters.");
  return note.length ? note : null;
}

export function parsePaymentMethod(value: unknown): AdminPaymentMethod {
  if (typeof value !== "string") throw new CorrectionError("Choose Venmo, cash, or other.");
  const method = value.trim().toUpperCase();
  if (method !== "VENMO" && method !== "CASH" && method !== "OTHER") throw new CorrectionError("Choose Venmo, cash, or other.");
  return method;
}

export function readTransactionId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CorrectionError("The transaction ID must be text.");
  const txn = value.trim().toUpperCase();
  if (!txn) return null;
  if (!/^[A-Z0-9_-]{3,160}$/.test(txn)) throw new CorrectionError("Transaction ID must be 3 to 160 letters, numbers, underscores, or hyphens.");
  return txn;
}

export function parseAmountCents(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_AMOUNT_CENTS) {
    throw new CorrectionError("Enter the payment amount in cents as a positive whole number.");
  }
  return value;
}

export function parseDollarToCents(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

export function lineTotalCents(quantity: number, unitPriceCents: number) {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new CorrectionError("This item's stored price cannot be used to calculate a total.");
  const line = quantity * unitPriceCents;
  if (!Number.isSafeInteger(line)) throw new CorrectionError("This item's stored price cannot be used to calculate a total.");
  return line;
}

type PricedItem = { id: string; quantity: number; unitPriceCents: number };

export function orderTotalCents(items: { quantity: number; unitPriceCents: number }[], deliveryFeeCents: number) {
  if (!Number.isSafeInteger(deliveryFeeCents) || deliveryFeeCents < 0) throw new CorrectionError("This order's delivery fee cannot be used to calculate a total.");
  if (items.length < 1) throw new CorrectionError("This order has no line items.");
  let total = deliveryFeeCents;
  for (const item of items) {
    parseLineQuantity(item.quantity);
    total += lineTotalCents(item.quantity, item.unitPriceCents);
  }
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_AMOUNT_CENTS) throw new CorrectionError("The recalculated order total is not valid.");
  return total;
}

/** New order total from stored unit prices and the delivery fee already on the order. Client totals are not an input. */
export function recalculatedOrderTotal(items: PricedItem[], itemId: string, quantity: unknown, deliveryFeeCents: number) {
  const nextQuantity = parseLineQuantity(quantity);
  if (!items.some(item => item.id === itemId)) throw new CorrectionError("That line item is not on this order.");
  const next = items.map(item => item.id === itemId ? { ...item, quantity: nextQuantity } : item);
  return { items: next, totalCents: orderTotalCents(next, deliveryFeeCents) };
}

export function readQuantityChange(body: Record<string, unknown>) {
  if (typeof body.itemId !== "string" || body.itemId.trim().length < 1 || body.itemId.trim().length > 200) {
    throw new CorrectionError("Choose a line item.");
  }
  return { itemId: body.itemId.trim(), quantity: parseLineQuantity(body.quantity), note: readNote(body.note) };
}

export function readOrderIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAYMENT_ORDERS) {
    throw new CorrectionError(`Select between 1 and ${MAX_PAYMENT_ORDERS} orders.`);
  }
  const orderIds: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || id.trim().length < 1 || id.trim().length > 200) throw new CorrectionError("Choose a valid order.");
    orderIds.push(id.trim());
  }
  if (new Set(orderIds).size !== orderIds.length) throw new CorrectionError("Each order can only be selected once.");
  return orderIds;
}

/** Shared payment. amountCents is checked against the orders and is never stored unless it matches their totals. */
export function readSharedPayment(body: Record<string, unknown>) {
  return {
    orderIds: readOrderIds(body.orderIds),
    amountCents: parseAmountCents(body.amountCents),
    method: parsePaymentMethod(body.method),
    note: readNote(body.note),
    providerTransactionId: readTransactionId(body.providerTransactionId)
  };
}

/** One order. The amount is that order's stored total; a client amount is ignored. */
export function readSinglePayment(body: Record<string, unknown>) {
  return {
    method: parsePaymentMethod(body.method),
    note: readNote(body.note),
    providerTransactionId: readTransactionId(body.providerTransactionId)
  };
}

/** Payment recording only. A paid or verified order must not get a second payment. */
export function correctionBlockReason(order: { status: string; paymentState: string; inventoryRestored: boolean; hasRecordedPayment: boolean }) {
  if (order.hasRecordedPayment || order.paymentState === "VERIFIED" || order.status === "PAID") return "This order is already marked paid.";
  if (order.status === "CANCELLED") return "Cancelled orders stay closed and cannot be changed here.";
  if (order.status !== "PENDING") return "Only an unpaid order can be changed this way.";
  if (order.paymentState === "REFUNDED") return "This order was refunded and cannot be changed here.";
  if (order.inventoryRestored) return "This order's items were already returned to stock, so it cannot be changed here.";
  return null;
}

/**
 * Quantity edits are separate from payment recording. Paid and verified orders can be corrected.
 * Cancelled orders stay closed: their stock was released and this screen does not revive them.
 * Refunded orders stay closed: the refund already says the money was returned, and a quantity
 * change must not rewrite that payment record.
 */
export function quantityEditBlockReason(order: { status: string; paymentState: string }) {
  if (order.status === "CANCELLED") return "Cancelled orders stay closed and cannot be changed here.";
  if (order.paymentState === "REFUNDED") return "This order was refunded and cannot be changed here.";
  return null;
}

export function canRecordPayment(order: { status: string; paymentState: string; inventoryRestored: boolean; adminPaymentLink?: unknown | null }) {
  return correctionBlockReason({ ...order, hasRecordedPayment: Boolean(order.adminPaymentLink) }) === null;
}

export function canEditQuantity(order: { status: string; paymentState: string }) {
  return quantityEditBlockReason(order) === null;
}

/** Amount already recorded for this order, not the shared payment's combined total. */
export function recordedPaidCents(order: { verifiedAmountCents?: number | null; adminPaymentLink?: { amountCents: number } | null }) {
  if (typeof order.verifiedAmountCents === "number") return order.verifiedAmountCents;
  if (typeof order.adminPaymentLink?.amountCents === "number") return order.adminPaymentLink.amountCents;
  return null;
}

export function paymentTotalDifference(paidCents: number | null, orderTotalCents: number) {
  if (paidCents === null || paidCents === orderTotalCents) return null;
  const gap = orderTotalCents - paidCents;
  const comparison = gap > 0 ? `${formatMoney(gap)} more than the recorded payment` : `${formatMoney(Math.abs(gap))} less than the recorded payment`;
  return `Recorded as paid ${formatMoney(paidCents)}. Order total is now ${formatMoney(orderTotalCents)}, ${comparison}. The payment record was not changed.`;
}

export function describePaymentMatch(amountCents: number | null, totals: number[]) {
  const expectedCents = totals.reduce((sum, value) => sum + value, 0);
  if (!totals.length || totals.some(value => !Number.isSafeInteger(value) || value <= 0) || !Number.isSafeInteger(expectedCents)) {
    return { matches: false, expectedCents, message: "Select the orders this payment covers." };
  }
  if (amountCents === null) return { matches: false, expectedCents, message: "Enter the amount you received." };
  if (amountCents !== expectedCents) return { matches: false, expectedCents, message: paymentMismatchMessage(amountCents, expectedCents) };
  return { matches: true, expectedCents, message: `This amount matches the selected orders (${formatMoney(expectedCents)}).` };
}

export function formatAuditSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return "Not recorded";
  const record = value as Record<string, unknown>;
  if (typeof record.quantity === "number" && typeof record.unitPriceCents === "number" && typeof record.lineTotalCents === "number" && typeof record.orderTotalCents === "number") {
    const name = typeof record.productName === "string" ? record.productName : "Item";
    const paid = typeof record.recordedPaidCents === "number" ? paymentTotalDifference(record.recordedPaidCents, Number(record.orderTotalCents)) : null;
    return `${record.quantity} × ${name} at ${formatMoney(record.unitPriceCents)} · line ${formatMoney(record.lineTotalCents)} · order total ${formatMoney(record.orderTotalCents)}.${paid ? ` ${paid}` : ""}`;
  }
  if (typeof record.status === "string" && typeof record.totalCents === "number") {
    const method = typeof record.paymentMethod === "string" ? paymentMethodLabel(record.paymentMethod) : "no method";
    const state = typeof record.paymentState === "string" ? record.paymentState : "unknown";
    const payment = typeof record.paymentId === "string" ? ` · payment ${record.paymentId}` : "";
    const txn = typeof record.providerTransactionId === "string" ? ` · transaction ${record.providerTransactionId}` : "";
    return `${record.status} · ${state} · ${method} · ${formatMoney(record.totalCents)}${payment}${txn}`;
  }
  return "Recorded";
}

export function sharedPaymentSummary(payment: {
  id: string;
  amountCents: number;
  method: string;
  note: string | null;
  providerTransactionId: string | null;
  coveredOrders: { orderId: string }[];
}, orderId: string) {
  const others = payment.coveredOrders.map(item => item.orderId).filter(id => id !== orderId);
  const cover = others.length ? ` Also covers ${others.join(", ")}.` : "";
  const txn = payment.providerTransactionId ? ` Transaction ${payment.providerTransactionId}.` : "";
  const note = payment.note ? ` Note: ${payment.note}` : "";
  return `${paymentMethodLabel(payment.method)} payment ${payment.id} for ${formatMoney(payment.amountCents)}.${cover}${txn}${note}`;
}

export function toPublicCorrectionError(error: unknown) {
  if (error instanceof PaymentMismatchError) {
    return { status: 409, body: { error: error.message, expectedCents: error.expectedCents, receivedCents: error.receivedCents } };
  }
  if (error instanceof CorrectionError) return { status: 400, body: { error: error.message } };
  if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002") {
    return { status: 409, body: { error: "That order was already marked paid, or that transaction ID is already recorded." } };
  }
  return { status: 409, body: { error: "Could not save this change." } };
}
