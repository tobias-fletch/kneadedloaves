import { formatBakeryDate } from "@/lib/bakery-time";
import { encryptSecret } from "@/lib/secrets";
import { providerRequestSnapshot } from "@/lib/provider-request";
import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { orderSchema } from "@/lib/validation";
import { acceptsOrders } from "@/lib/order-rules";
import { receiptTokenFor } from "@/lib/payment-checkout";
import { priceOrder, pricingConfiguration } from "@/lib/pricing";
import { getAppConfigValue, getAppConfigValues } from "@/lib/app-config";

export async function reserveCheckout(input: z.infer<typeof orderSchema>, cartId: string, userId?: string) {
  const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const pricing = pricingConfiguration(await getAppConfigValues(["TAX_RATE_BPS", "TAX_DELIVERY_FEE"]));
  if (!pricing) throw new Error("Tax handling must be confirmed before checkout.");
  const appUrl = await getAppConfigValue("APP_URL");
  const receiptSecret = await getAppConfigValue("JWT_SECRET");
  return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cartId}))`;
      const existing = await tx.order.findUnique({ where: { checkoutKey: input.checkoutKey } });
      if (existing) {
        if (existing.checkoutCartId !== cartId || existing.checkoutPayloadHash !== payloadHash) throw new Error("This checkout attempt already belongs to different details. Please reopen checkout.");
        return existing.id;
      }
      const pending = await tx.order.findFirst({ where: { checkoutCartId: cartId, paymentState: { in: ["PENDING", "REVIEW"] }, status: "PENDING" } });
      if (pending) throw new Error("A checkout is already in progress for this cart. Use the original checkout or wait for it to expire.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`window:${input.orderWindowId}`}))`;
      const window = await tx.orderWindow.findUnique({ where: { id: input.orderWindowId } });
      const count = await tx.order.count({ where: { orderWindowId: input.orderWindowId, status: { not: "CANCELLED" } } });
      if (!window || !acceptsOrders(window, count)) throw new Error("This order window is closed or full.");
      const now = new Date();
      const lockedCart = await tx.cart.findUnique({ where: { id: cartId }, include: { items: { include: { product: true } } } });
      if (!lockedCart?.items.length) throw new Error("Your cart is empty.");
      const zone = input.fulfillmentType === "DELIVERY" && input.deliveryZoneId ? await tx.deliveryZone.findUnique({ where: { id: input.deliveryZoneId } }) : null;
      const pickup = input.fulfillmentType === "PICKUP" && input.pickupLocationId ? await tx.pickupLocation.findUnique({ where: { id: input.pickupLocationId } }) : null;
      if (input.fulfillmentType === "DELIVERY" && (!zone?.active || !zone.zipCodes.length || !zone.zipCodes.includes(input.deliveryZip || "") || !Number.isSafeInteger(zone.feeCents) || zone.feeCents < 0 || !zone.instructions?.trim())) throw new Error("Delivery is not configured for this ZIP code. Please contact the bakery.");
      if (input.fulfillmentType === "PICKUP" && (!pickup?.active || !pickup.address.trim() || !pickup.instructions?.trim())) throw new Error("Choose a configured pickup location.");
      const { totalCents, taxCents, deliveryFeeCents } = priceOrder(lockedCart.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0), zone?.feeCents || 0, pricing);
      if (!Number.isSafeInteger(totalCents) || totalCents < 50 || totalCents > 99999999) throw new Error("The order total is invalid.");
      for (const item of [...lockedCart.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.product.priceCents <= 0) throw new Error("An item is unavailable.");
        const changed = await tx.product.updateMany({ where: { id: item.productId, active: true, soldOut: false, inventoryLimit: { gte: item.quantity }, AND: [{ OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] }, { OR: [{ availableTo: null }, { availableTo: { gte: now } }] }] }, data: { inventoryLimit: { decrement: item.quantity } } });
        if (changed.count !== 1) throw new Error(`${item.product.name} is no longer available in that quantity.`);
        await tx.product.updateMany({ where: { id: item.productId, inventoryLimit: { lte: 0 } }, data: { soldOut: true } });
      }
      const order = await tx.order.create({ data: {
        userId: userId, customerEmail: input.customerEmail, customerName: input.customerName, customerPhone: input.customerPhone,
        fulfillmentType: input.fulfillmentType, deliveryZoneId: zone?.id, pickupLocationId: pickup?.id,
        deliveryAddress: zone ? `${input.deliveryAddress}\n${input.deliveryZip}` : undefined,
        fulfillmentInstructions: `${formatBakeryDate(window.fulfillmentDate, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}\n${zone?.instructions || (pickup ? `${pickup.address}\n${pickup.instructions}` : "")}`,
        totalCents, taxCents, deliveryFeeCents, orderWindowId: window.id, paymentProvider: input.paymentProvider,
        checkoutKey: input.checkoutKey, checkoutPayloadHash: payloadHash, checkoutCartId: cartId,
        reservationExpiresAt: new Date(Date.now() + 35 * 60000),
        items: { create: lockedCart.items.map(item => ({ productId: item.productId, quantity: item.quantity, unitPriceCents: item.product.priceCents, productName: item.product.name })) }
      } });
      const token = await receiptTokenFor(order.id, receiptSecret);
      const snapshotOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      await tx.order.update({ where: { id: order.id }, data: { receiptTokenHash: createHash("sha256").update(token).digest("hex"), providerRequest: encryptSecret(JSON.stringify(providerRequestSnapshot(snapshotOrder, token, appUrl))) } });
      return order.id;
    }, { timeout: 15000 });
}
