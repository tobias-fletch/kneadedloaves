import type { Prisma } from "@prisma/client";

// Explicit allowlist: never export nested sales, customer or configuration data.
export const catalogProductSelect = {
  id: true, name: true, slug: true, description: true, priceCents: true,
  ingredients: true, allergens: true, inventoryLimit: true, soldOut: true,
  active: true, availableFrom: true, availableTo: true, categoryId: true,
  images: { select: { url: true, alt: true, sortOrder: true }, orderBy: { sortOrder: "asc" as const } }
} satisfies Prisma.ProductSelect;

export async function exportCatalog(db: Pick<Prisma.TransactionClient, "product" | "category">) {
  const [categories, products] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, slug: true }, orderBy: { slug: "asc" } }),
    db.product.findMany({ select: catalogProductSelect, orderBy: { slug: "asc" } })
  ]);
  return { format: "kneaded-loaves-catalog", version: 1, exportedAt: new Date().toISOString(), currency: "USD", categories, products };
}
