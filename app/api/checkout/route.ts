import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentOrderWindow } from "@/lib/order-window";
import { prisma } from "@/lib/prisma";
import { orderSchema } from "@/lib/validation";
import { cartOwner, acceptsOrders } from "@/lib/order-rules";
import { readJson, rateLimit } from "@/lib/request";
import { queueEmail } from "@/lib/email-queue";
import { processOrderEmails } from "@/lib/email-maintenance";
import { adminCheckoutReadiness, getManualPaymentConfig, isAdminTestOrder } from "@/lib/manual-payment-config";
import { expireUnpaidOrders } from "@/lib/manual-payments";
import { formatMoney } from "@/lib/money";
import { deliveryCoverageError } from "@/lib/delivery-zone";
import { describePickup } from "@/lib/pickup-location";
import { checkoutDigest as digest, checkoutOwnerHash, checkoutOwners, checkoutRequestHash, lockCheckoutRequest, receiptForOwnedAttempt, validCheckoutKey } from "@/lib/checkout-recovery";
export async function POST(request: Request) {
  if (!await rateLimit(request, "checkout", 20)) return NextResponse.json({ error: "Please wait before trying checkout again." }, { status: 429 });
  const parsed = orderSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  const key = request.headers.get("Idempotency-Key") || "";
  if (!validCheckoutKey(key)) return NextResponse.json({ error: "A fresh checkout request ID is required. Reload checkout." }, { status: 400 });
  try {
    const config = await getManualPaymentConfig();
    const session = await getSession(true);
    const isAdmin = session?.role === "ADMIN";
    if (!adminCheckoutReadiness(config, isAdmin).ready) return NextResponse.json({ error: "Online checkout is not available yet. Please contact the bakery." }, { status: 503 });
    const sessionId = (await cookies()).get("bakery_cart")?.value;
    const owner = cartOwner(session?.sub, sessionId);
    if (!owner) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    const owners = checkoutOwners(session?.sub, sessionId);
    const checkoutKeyHash = checkoutOwnerHash(owner, key);
    const requestHash = checkoutRequestHash(key);
    const checkoutPayloadHash = digest(JSON.stringify(parsed.data));
    // Clear overdue reservations before testing window capacity, including when full.
    await expireUnpaidOrders();
    const result = await prisma.$transaction(async tx => {
      await lockCheckoutRequest(tx, key);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${'manual-payment-config'}))`;
      const freshConfig = await getManualPaymentConfig(tx);
      if (!adminCheckoutReadiness(freshConfig, isAdmin).ready || freshConfig.JWT_SECRET !== config.JWT_SECRET || freshConfig.VENMO_DESTINATION !== config.VENMO_DESTINATION || freshConfig.VENMO_HANDLE !== config.VENMO_HANDLE || freshConfig.PAYMENT_HOLD_MINUTES !== config.PAYMENT_HOLD_MINUTES) throw new Error("Payment settings changed. Review checkout and retry before sending money.");
      const retry = await tx.order.findUnique({ where: { checkoutRequestHash: requestHash } });
      if (retry) {
        if (retry.checkoutPayloadHash !== checkoutPayloadHash) throw new Error("That checkout request ID was already used with different details. Recover the existing reservation before starting another.");
        return receiptForOwnedAttempt(tx, retry, key, owners, config.JWT_SECRET);
      }
      const cart = await tx.cart.findUnique({ where: owner });
      if (!cart) throw new Error("Your cart is empty.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cart.id}))`;
      const { openWindow } = await getCurrentOrderWindow(tx);
      if (!openWindow) throw new Error("Ordering is currently closed or full.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`window:${openWindow.id}`}))`;
      const now = new Date();
      const freshWindow = await tx.orderWindow.findUniqueOrThrow({ where: { id: openWindow.id } });
      const count = await tx.order.count({ where: { orderWindowId: openWindow.id, status: { not: "CANCELLED" } } });
      if (!acceptsOrders(freshWindow, count, now)) throw new Error("This order window is closed or full.");
      const lockedCart = await tx.cart.findUnique({ where: { id: cart.id }, include: { items: { include: { product: true } } } });
      if (!lockedCart?.items.length) throw new Error("Your cart is empty.");
      const zone = parsed.data.fulfillmentType === "DELIVERY" && parsed.data.deliveryZoneId ? await tx.deliveryZone.findUnique({ where: { id: parsed.data.deliveryZoneId } }) : null;
      const pickup = parsed.data.fulfillmentType === "PICKUP" && parsed.data.pickupLocationId ? await tx.pickupLocation.findUnique({ where: { id: parsed.data.pickupLocationId } }) : null;
      // An inactive zone covers no ZIP, including a catch-all whose zipCodes array is empty.
      const deliveryError = deliveryCoverageError(zone, parsed.data.deliveryZip || "");
      if (parsed.data.fulfillmentType === "DELIVERY" && deliveryError) throw new Error(deliveryError);
      if (parsed.data.fulfillmentType === "PICKUP" && !pickup?.active) throw new Error("Choose an active pickup location.");
      const deliveryFeeCents = zone?.feeCents || 0;
      const totalCents = lockedCart.items.reduce((sum,item) => sum + item.product.priceCents * item.quantity, deliveryFeeCents);
      if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 100000000 || deliveryFeeCents < 0) throw new Error("Invalid order pricing. Please contact the bakery.");
      for (const item of [...lockedCart.items].sort((a,b) => a.productId.localeCompare(b.productId))) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1000 || item.product.priceCents <= 0) throw new Error("Invalid cart quantity or price.");
        const updated = await tx.product.updateMany({ where: { id: item.productId, active: true, soldOut: false, inventoryLimit: { gte: item.quantity }, AND: [{ OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] }, { OR: [{ availableTo: null }, { availableTo: { gte: now } }] }] }, data: { inventoryLimit: { decrement: item.quantity } } });
        if (updated.count !== 1) throw new Error(`${item.product.name} is no longer available in that quantity.`);
        // soldOut is owner-controlled; inventoryLimit independently represents reserved stock.
      }
      const paymentReference = `${isAdminTestOrder(config, isAdmin) ? "KL-ADMIN-TEST-" : "KL-"}${randomUUID().toUpperCase()}`;
      const paymentDueAt = new Date(Math.min(now.getTime() + config.holdMinutes * 60000, freshWindow.manualOpen ? Infinity : freshWindow.closesAt.getTime()));
      const fulfillmentLocation = zone ? `${parsed.data.deliveryAddress}\n${parsed.data.deliveryZip}` : describePickup(pickup!).text;
      const created = await tx.order.create({ data: {
        userId: session?.sub, checkoutRequestHash: requestHash, checkoutKeyHash, checkoutPayloadHash,
        customerEmail: parsed.data.customerEmail, customerName: parsed.data.customerName, customerPhone: parsed.data.customerPhone,
        fulfillmentType: parsed.data.fulfillmentType, deliveryZoneId: zone?.id, pickupLocationId: pickup?.id,
        deliveryAddress: zone ? fulfillmentLocation : undefined, fulfillmentLocation,
        fulfillmentInstructions: zone?.instructions || pickup?.instructions,
        totalCents, deliveryFeeCents, orderWindowId: openWindow.id,
        paymentMethod: "VENMO", paymentReference, currency: "USD", paymentDestination: config.VENMO_DESTINATION, paymentHandle: config.VENMO_HANDLE, paymentDueAt,
        items: { create: lockedCart.items.map(item => ({ productId: item.productId, quantity: item.quantity, unitPriceCents: item.product.priceCents, productName: item.product.name })) }
      } });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await queueEmail({ dedupeKey: `order-received:${created.id}`, to: created.customerEmail, subject: "Bakery reservation received — awaiting payment", body: `Hi ${created.customerName},\n\nYour reservation ${paymentReference} is awaiting payment. It is not paid or scheduled for fulfillment yet.\n\n${lockedCart.items.map(item => `${item.quantity} x ${item.product.name}: ${formatMoney(item.product.priceCents * item.quantity)}`).join("\n")}\nDelivery fee: ${formatMoney(deliveryFeeCents)}\nExact total: ${formatMoney(totalCents)} USD\n\nPay ${config.VENMO_HANDLE} using the verified business destination: ${config.VENMO_DESTINATION}\nUse only reference ${paymentReference} in the payment note; do not include your address or other private details.\nPayment must be independently verified by ${paymentDueAt.toISOString()}. If already paid, request review from your private receipt.\nKeep the private receipt link shown after checkout. Signed-in customers can also find orders in their account.\n\n${fulfillmentLocation}\n${created.fulfillmentInstructions || ""}\nExpired reservations are not automatically restored by a late payment. Contact the bakery if you have paid after expiry.` }, tx);
      const settings = await tx.adminSettings.findFirst();
      if (settings?.emailNotificationsEnabled && settings.notificationEmail) await queueEmail({ dedupeKey: `admin-order:${created.id}`, to: settings.notificationEmail, subject: "New bakery reservation awaiting payment", body: `Reservation ${paymentReference} received. Payment is unverified. Check admin orders before the ${paymentDueAt.toISOString()} reservation deadline.` }, tx);
      return receiptForOwnedAttempt(tx, created, key, owners, config.JWT_SECRET);
    });
    if (process.env.VERCEL) {
      const orderId = result.orderId;
      after(() => processOrderEmails(orderId).catch(() => {
        console.error("Order email could not be sent immediately; the daily email cron will retry.");
      }));
    }
    return NextResponse.json({ message: "Reservation received. Payment has not been confirmed.", ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !/prisma|database|constraint|connection/i.test(error.message) ? error.message : "Checkout could not be completed. Please retry with the same details." }, { status: 400 });
  }
}
