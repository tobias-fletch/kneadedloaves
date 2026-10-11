import { prepareOrderEmail, getOrderEmailTemplates } from "@/lib/email";
import { createHash, randomBytes } from "crypto";
import { cartOwner, acceptsOrders } from "@/lib/order-rules";
import { readJson, rateLimit } from "@/lib/request";
import { queueEmail } from "@/lib/email-queue";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentOrderWindow } from "@/lib/order-window";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { orderSchema } from "@/lib/validation";
import { getAppConfigValue } from "@/lib/app-config";

const CART_COOKIE = "bakery_cart";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Online checkout is not available yet. Please contact the bakery." }, { status: 503 });
  if (!await rateLimit(request, "checkout", 20)) return NextResponse.json({ error: "Please wait before trying checkout again." }, { status: 429 });
  const parsed = orderSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  const { openWindow } = await getCurrentOrderWindow();
  if (!openWindow) return NextResponse.json({ error: "Ordering is currently closed." }, { status: 400 });

  const session = await getSession();
  const sessionId = (await cookies()).get(CART_COOKIE)?.value;
  const owner = cartOwner(session?.sub, sessionId);
  if (!owner) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  const cart = await prisma.cart.findUnique({ where: owner });
  if (!cart) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  const deliveryZone = parsed.data.deliveryZoneId ? await prisma.deliveryZone.findUnique({ where: { id: parsed.data.deliveryZoneId } }) : null;
  const pickupLocation = parsed.data.pickupLocationId ? await prisma.pickupLocation.findUnique({ where: { id: parsed.data.pickupLocationId } }) : null;
  if (parsed.data.fulfillmentType === "DELIVERY" && !deliveryZone?.active) {
    return NextResponse.json({ error: "Choose an active delivery zone." }, { status: 400 });
  }
  if (parsed.data.fulfillmentType === "PICKUP" && !pickupLocation?.active) {
    return NextResponse.json({ error: "Choose an active pickup location." }, { status: 400 });
  }
  if (parsed.data.fulfillmentType === "DELIVERY" && !deliveryZone?.zipCodes.includes(parsed.data.deliveryZip || "")) return NextResponse.json({ error: "We do not deliver to that ZIP code in this zone." }, { status: 400 });
  const receiptToken = randomBytes(32).toString("hex");
  let stripe;
  try {
    stripe = await getStripe();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe is not configured correctly." }, { status: 400 });
  }

  const emailTemplates = await getOrderEmailTemplates();
  let order;
  let totalCents = 0;
  let deliveryFee = 0;
  try {
    order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cart.id}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`window:${openWindow.id}`}))`;
      const freshWindow = await tx.orderWindow.findUniqueOrThrow({ where: { id: openWindow.id } });
      const orderCount = await tx.order.count({ where: { orderWindowId: openWindow.id, status: { not: "CANCELLED" } } });
      if (!acceptsOrders(freshWindow, orderCount)) throw new Error("This order window is closed or full.");
      const lockedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: { items: { include: { product: true } } }
      });
      if (!lockedCart?.items.length) {
        throw new Error("Your cart is empty.");
      }

      const now = new Date();
      const unavailable = lockedCart.items.find((item) => !item.product.active || item.product.soldOut || item.product.inventoryLimit < item.quantity || (item.product.availableFrom && item.product.availableFrom > now) || (item.product.availableTo && item.product.availableTo < now));
      if (unavailable) {
        throw new Error(`${unavailable.product.name} is no longer available in that quantity.`);
      }

      const itemsTotal = lockedCart.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
      deliveryFee = parsed.data.fulfillmentType === "DELIVERY" ? deliveryZone?.feeCents ?? 0 : 0;
      totalCents = itemsTotal + deliveryFee;

      const created = await tx.order.create({
        data: {
          userId: session?.sub,
          receiptTokenHash: createHash("sha256").update(receiptToken).digest("hex"),
          customerEmail: parsed.data.customerEmail,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
          fulfillmentType: parsed.data.fulfillmentType,
          deliveryZoneId: parsed.data.fulfillmentType === "DELIVERY" ? deliveryZone?.id : undefined,
          pickupLocationId: parsed.data.fulfillmentType === "PICKUP" ? pickupLocation?.id : undefined,
          deliveryAddress: parsed.data.fulfillmentType === "DELIVERY" ? `${parsed.data.deliveryAddress}\n${parsed.data.deliveryZip}` : undefined,
          fulfillmentInstructions: parsed.data.fulfillmentType === "DELIVERY" ? deliveryZone?.instructions : pickupLocation?.instructions,
          totalCents,
          orderWindowId: openWindow.id,
          items: {
            create: lockedCart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPriceCents: item.product.priceCents,
              productName: item.product.name
            }))
          }
        }
      });

      for (const item of [...lockedCart.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, active: true, soldOut: false, inventoryLimit: { gte: item.quantity }, AND: [{ OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] }, { OR: [{ availableTo: null }, { availableTo: { gte: now } }] }] },
          data: { inventoryLimit: { decrement: item.quantity } }
        });
        if (updated.count !== 1) {
          throw new Error(`${item.product.name} is no longer available in that quantity.`);
        }
        await tx.product.updateMany({ where: { id: item.productId, inventoryLimit: { lte: 0 } }, data: { soldOut: true } });
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      const email = prepareOrderEmail({ to: created.customerEmail, orderId: created.id, customerName: created.customerName, totalCents, fulfillmentType: created.fulfillmentType, fulfillmentInstructions: created.fulfillmentInstructions, items: lockedCart.items.map(item => ({ productName: item.product.name, quantity: item.quantity, unitPriceCents: item.product.priceCents })) }, emailTemplates);
      await queueEmail({ dedupeKey: "order-received:" + created.id, ...email }, tx);
      const settings = await tx.adminSettings.findFirst();
      if (settings?.emailNotificationsEnabled && settings.notificationEmail) await queueEmail({ dedupeKey: "admin-order:" + created.id, to: settings.notificationEmail, subject: "New bakery order", body: "Order " + created.id + " received. Payment has not been confirmed. Check the admin dashboard." }, tx);
      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not place order." }, { status: 400 });
  }

  if (!stripe) {
    return NextResponse.json({
      message: "Your order was received. Payment has not been confirmed.",
      url: `/orders/${order.id}?token=${receiptToken}`,
      orderId: order.id
    });
  }

  const appUrl = (await getAppConfigValue("APP_URL")) || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.customerEmail,
    success_url: `${appUrl}/account?checkout=success`,
    cancel_url: `${appUrl}/shop?checkout=cancelled`,
    metadata: { orderId: order.id },
    line_items: [
      ...order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: item.unitPriceCents,
          product_data: { name: item.productName }
        }
      })),
      ...(deliveryFee > 0
        ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: deliveryFee, product_data: { name: "Delivery fee" } } }]
        : [])
    ]
  });

  await prisma.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: checkout.id } });
  return NextResponse.json({ url: checkout.url });
}
