import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readJson, rateLimit } from "@/lib/request";
import { cartMutationSchema } from "@/lib/validation";

const CART_COOKIE = "bakery_cart";
async function identity() {
  const session = await getSession();
  const existing = (await cookies()).get(CART_COOKIE)?.value;
  const sessionId = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : crypto.randomUUID();
  return { sessionId, userId: session?.sub };
}
export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) return NextResponse.json({ items: [], available: false }, { headers: { "Cache-Control": "no-store" } });
  const { sessionId, userId } = await identity();
  const cart = await prisma.cart.findUnique({ where: userId ? { userId } : { sessionId }, include: { items: { include: { product: { include: { images: true } } }, orderBy: { createdAt: "asc" } } } });
  return NextResponse.json(cart || { items: [] });
}
async function mutate(request: Request) {
  if (!process.env.DATABASE_URL?.trim()) return NextResponse.json({ error: "Online ordering is not available yet. Please check back soon." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!await rateLimit(request, "cart", 120)) return NextResponse.json({ error: "Please wait before changing your cart again." }, { status: 429 });
  const body = await readJson(request);
  const parsed = cartMutationSchema.safeParse({ ...body, quantity: request.method === "DELETE" ? 0 : body.quantity ?? 1 });
  if (!parsed.success || (request.method === "POST" && parsed.data.quantity === 0)) return NextResponse.json({ error: "Choose a whole quantity between 1 and 1000." }, { status: 400 });
  const { sessionId, userId } = await identity();
  try {
    const cart = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cart-owner:${userId || sessionId}`}))`;
      const owner = await tx.cart.upsert({ where: userId ? { userId } : { sessionId }, update: {}, create: userId ? { userId } : { sessionId } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.id}))`;
      const { productId, quantity } = parsed.data;
      if (!quantity) await tx.cartItem.deleteMany({ where: { cartId: owner.id, productId } });
      else {
        const product = await tx.product.findUnique({ where: { id: productId } });
        const now = new Date();
        if (!product || !product.active || product.soldOut || (product.availableFrom && product.availableFrom > now) || (product.availableTo && product.availableTo < now)) throw new Error("Product is not available.");
        const existing = await tx.cartItem.findUnique({ where: { cartId_productId: { cartId: owner.id, productId } } });
        const next = request.method === "POST" ? (existing?.quantity || 0) + quantity : quantity;
        if (next > product.inventoryLimit || next > 1000) throw new Error("That quantity is not available.");
        await tx.cartItem.upsert({ where: { cartId_productId: { cartId: owner.id, productId } }, update: { quantity: next }, create: { cartId: owner.id, productId, quantity: next } });
      }
      return tx.cart.findUnique({ where: { id: owner.id }, include: { items: { include: { product: { include: { images: true } } }, orderBy: { createdAt: "asc" } } } });
    });
    const response = NextResponse.json(cart);
    if (!userId) response.cookies.set(CART_COOKIE, sessionId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 2592000 });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not update cart. Check availability and try again." }, { status: 400 });
  }
}
export const POST = mutate;
export const PATCH = mutate;
export const DELETE = mutate;
