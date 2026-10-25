import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Sample data cannot be seeded in production.");
  // Sample data (incl. a default-password admin) only goes into a local database.
  const seedHost = (() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(seedHost) && process.env.ALLOW_SEED !== "1") {
    throw new Error("Refusing to seed a non-local database. Use a local Postgres, or set ALLOW_SEED=1 if you are sure.");
  }
  const admin = await prisma.user.upsert({
    where: { email: "admin@bakery.local" },
    update: {},
    create: {
      email: "admin@bakery.local",
      name: "Bakery Admin",
      role: "ADMIN",
      passwordHash: await hashPassword("admin12345")
    }
  });

  const customer = await prisma.user.upsert({
    where: { email: "customer@example.com" },
    update: {},
    create: {
      email: "customer@example.com",
      name: "Sample Customer",
      role: "CUSTOMER",
      passwordHash: await hashPassword("customer12345"),
      customerProfile: {
        create: {
          phone: "555-0100",
          address1: "12 Market Street",
          city: "Brooklyn",
          state: "NY",
          zip: "11211"
        }
      }
    }
  });

  const bread = await prisma.category.upsert({
    where: { slug: "bread" },
    update: {},
    create: { name: "Bread", slug: "bread" }
  });
  const pastry = await prisma.category.upsert({
    where: { slug: "pastry" },
    update: {},
    create: { name: "Pastry", slug: "pastry" }
  });

  const seededProducts = [
    {
      name: "Country Sourdough",
      slug: "country-sourdough",
      description: "Naturally leavened loaf with a caramelized crust and open, tender crumb.",
      priceCents: 1200,
      allergens: ["wheat"],
      ingredients: ["flour", "water", "salt", "starter"],
      inventoryLimit: 24,
      categoryId: bread.id,
      image: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=1200&q=80"
    },
    {
      name: "Cardamom Morning Buns",
      slug: "cardamom-morning-buns",
      description: "Laminated buns rolled with cardamom sugar and finished with citrus glaze.",
      priceCents: 550,
      allergens: ["wheat", "milk", "eggs"],
      ingredients: ["flour", "butter", "eggs", "cardamom", "sugar"],
      inventoryLimit: 36,
      categoryId: pastry.id,
      image: "https://images.unsplash.com/photo-1509365465985-25d11c17e812?auto=format&fit=crop&w=1200&q=80"
    },
    {
      name: "Seeded Rye Tin",
      slug: "seeded-rye-tin",
      description: "Dense, sliceable rye with toasted seeds. Built for butter, cheese, and soup.",
      priceCents: 1400,
      allergens: ["wheat", "rye", "sesame"],
      ingredients: ["rye", "bread flour", "sunflower seeds", "sesame", "salt"],
      inventoryLimit: 18,
      categoryId: bread.id,
      image: "https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=1200&q=80"
    }
  ];

  for (const product of seededProducts) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: {
        name: product.name,
        slug: product.slug,
        description: product.description,
        priceCents: product.priceCents,
        allergens: product.allergens,
        ingredients: product.ingredients,
        inventoryLimit: product.inventoryLimit,
        categoryId: product.categoryId,
        images: { create: { url: product.image, alt: product.name } }
      }
    });
  }

  const now = new Date();
  const opensAt = new Date(now.getTime() - 60 * 60 * 1000);
  const closesAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const fulfillmentDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const orderWindow = await prisma.orderWindow.upsert({
    where: { id: "seed-window" },
    update: { opensAt, closesAt, fulfillmentDate },
    create: {
      id: "seed-window",
      name: "Weekly Bake",
      opensAt,
      closesAt,
      fulfillmentDate,
      maxOrders: 40,
      manualOpen: true
    }
  });

  const delivery = await prisma.deliveryZone.upsert({
    where: { id: "dz-nearby-free" },
    update: {
      name: "Free delivery in 11217",
      zipCodes: ["11217"],
      feeCents: 0,
      instructions: "Free delivery in 11217.",
      active: true
    },
    create: {
      id: "dz-nearby-free",
      name: "Free delivery in 11217",
      zipCodes: ["11217"],
      feeCents: 0,
      instructions: "Free delivery in 11217.",
      active: true
    }
  });
  await prisma.deliveryZone.updateMany({
    where: { id: { not: delivery.id }, active: true },
    data: { active: false }
  });

  const pickup = await prisma.pickupLocation.upsert({
    where: { id: "seed-pickup" },
    update: {
      name: "Brooklyn pickup",
      address: "S Portland Ave & Atlantic Ave, Brooklyn, NY 11217",
      instructions: "Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified."
    },
    create: {
      id: "seed-pickup",
      name: "Brooklyn pickup",
      address: "S Portland Ave & Atlantic Ave, Brooklyn, NY 11217",
      instructions: "Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified."
    }
  });

  await prisma.popupEvent.upsert({
    where: { id: "seed-event" },
    update: {},
    create: {
      id: "seed-event",
      title: "Saturday Market Pop-Up",
      startsAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      location: "McCarren Park Market",
      description: "A small table of breads, buns, and seasonal specials while supplies last.",
      products: { connect: [{ slug: "country-sourdough" }, { slug: "cardamom-morning-buns" }] }
    }
  });

  await prisma.adminSettings.upsert({
    where: { id: "default" },
    update: {
      pickupRules: "Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The exact handoff is confirmed after payment."
    },
    create: {
      id: "default",
      bakeryName: "Kneaded Loaves",
      businessDescription: "Small-batch breads and pastries baked for limited weekly order windows.",
      deliveryRules: "Delivery is available for approved ZIP codes only.",
      pickupRules: "Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The exact handoff is confirmed after payment.",
      instagramHandle: "@littlehearth",
      orderingOpenMessage: "Orders are open for the next bake.",
      orderingClosedMessage: "Orders are closed, but the menu is here to browse.",
      emailNotificationsEnabled: false,
      notificationEmail: "admin@bakery.local"
    }
  });

  await prisma.order.create({
    data: {
      userId: customer.id,
      customerEmail: customer.email,
      customerName: customer.name ?? "Sample Customer",
      customerPhone: "555-0100",
      status: "PAID",
      fulfillmentType: "PICKUP",
      pickupLocationId: pickup.id,
      orderWindowId: orderWindow.id,
      totalCents: 1750,
      fulfillmentInstructions: pickup.instructions,
      items: {
        create: [
          {
            product: { connect: { slug: "country-sourdough" } },
            quantity: 1,
            unitPriceCents: 1200,
            productName: "Country Sourdough"
          },
          {
            product: { connect: { slug: "cardamom-morning-buns" } },
            quantity: 1,
            unitPriceCents: 550,
            productName: "Cardamom Morning Buns"
          }
        ]
      }
    }
  });

  console.log({ admin: admin.email, customer: customer.email, delivery: delivery.name });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
