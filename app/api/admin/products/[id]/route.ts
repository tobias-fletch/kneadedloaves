import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const body = await request.json();
  const product = await prisma.product.update({
    where: { id },
    data: {
      name: body.name,
      slug: body.slug,
      description: body.description,
      priceCents: Number(body.priceCents),
      categoryId: body.categoryId || null,
      ingredients: Array.isArray(body.ingredients) ? body.ingredients : [],
      allergens: Array.isArray(body.allergens) ? body.allergens : [],
      inventoryLimit: Number(body.inventoryLimit),
      soldOut: Boolean(body.soldOut),
      active: Boolean(body.active),
      images: body.imageUrl
        ? {
            upsert: {
              where: { id: body.imageId || "new-image" },
              update: { url: body.imageUrl, alt: body.name },
              create: { url: body.imageUrl, alt: body.name }
            }
          }
        : undefined
    }
  });
  return NextResponse.json(product);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  try {
    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { productId: id } }),
      // Legacy social posts are kept in the database; detach them so the product can still be deleted.
      prisma.socialPost.updateMany({ where: { productId: id }, data: { productId: null } }),
      prisma.orderItem.updateMany({ where: { productId: id }, data: { productId: null } }),
      prisma.product.delete({ where: { id } })
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "This product has related records. Mark it inactive instead of deleting it." },
      { status: 409 }
    );
  }
}
