import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development menu seeding is blocked in production.");
  // Only owner-confirmed names and prices. No invented ingredients, allergens,
  // photos, inventory, delivery zones, times, accounts, or customer orders.
  const menu = [
    { slug: "artisan-loaf", name: "Artisan Loaf", priceCents: 1200 },
    { slug: "herb-focaccia-small", name: "Herb Focaccia (Small)", priceCents: 1000 },
    { slug: "herb-focaccia-large", name: "Herb Focaccia (Large)", priceCents: 1800 },
    { slug: "plain-bagel", name: "Plain Bagel", priceCents: 300 },
    { slug: "everything-bagel", name: "Everything Bagel", priceCents: 300 }
  ];
  for (const product of menu) await prisma.product.upsert({ where: { slug: product.slug }, update: {}, create: { ...product, description: `${product.name}. Product details will be confirmed before ordering opens.`, ingredients: [], allergens: [], inventoryLimit: 0, active: false, soldOut: true } });
  console.log("Created missing confirmed-menu drafts only. Existing products were preserved. Review ingredients, allergens, photos and capacity before activating them. Candies are not for sale.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
