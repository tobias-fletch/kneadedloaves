import { ProductForm } from "@/components/AdminForm";
import { AdminMaintenancePanel } from "@/components/AdminMaintenancePanel";
import { ProductManager } from "@/components/ProductManager";
import { prisma } from "@/lib/prisma";

export default async function AdminProductsPage() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ include: { category: true, images: true }, orderBy: { createdAt: "desc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } })
  ]);
  const productIds = products.map((product) => product.id);
  const [soldToday, soldWeek, soldMonth, soldYear, soldTotal] = await Promise.all([
    soldCounts(productIds, startOfDay),
    soldCounts(productIds, startOfWeek),
    soldCounts(productIds, startOfMonth),
    soldCounts(productIds, startOfYear),
    soldCounts(productIds)
  ]);

  return (
    <div className="space-y-5">
      <InventoryCounts
        rows={products.map((product) => ({
          id: product.id,
          name: product.name,
          available: product.inventoryLimit,
          today: soldToday.get(product.id) ?? 0,
          week: soldWeek.get(product.id) ?? 0,
          month: soldMonth.get(product.id) ?? 0,
          year: soldYear.get(product.id) ?? 0,
          total: soldTotal.get(product.id) ?? 0
        }))}
      />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <ProductForm categories={categories} />
          <AdminMaintenancePanel products={products.map((product) => ({ id: product.id, name: product.name, inventoryLimit: product.inventoryLimit }))} />
        </div>
        <ProductManager
          categories={categories}
          products={products.map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            priceCents: product.priceCents,
            categoryId: product.categoryId,
            categoryName: product.category?.name ?? null,
            ingredients: product.ingredients,
            allergens: product.allergens,
            inventoryLimit: product.inventoryLimit,
            soldOut: product.soldOut,
            active: product.active,
            imageId: product.images[0]?.id ?? null,
            imageUrl: product.images[0]?.url ?? null
          }))}
        />
      </div>
    </div>
  );
}

async function soldCounts(productIds: string[], since?: Date) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: productIds },
      order: since ? { createdAt: { gte: since }, status: { not: "CANCELLED" } } : { status: { not: "CANCELLED" } }
    },
    _sum: { quantity: true }
  });
  return new Map(rows.flatMap((row) => (row.productId ? [[row.productId, row._sum.quantity ?? 0] as const] : [])));
}

function InventoryCounts({
  rows
}: {
  rows: { id: string; name: string; available: number; today: number; week: number; month: number; year: number; total: number }[];
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-amber-200 p-4">
        <h2 className="text-lg font-black">Inventory counts</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-crumb text-xs uppercase text-ink/70">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Available</th>
              <th className="p-3">Today sold</th>
              <th className="p-3">Week sold</th>
              <th className="p-3">Month sold</th>
              <th className="p-3">Year sold</th>
              <th className="p-3">Total sold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="p-3 font-bold">{row.name}</td>
                <td className="p-3">{row.available}</td>
                <td className="p-3">{row.today}</td>
                <td className="p-3">{row.week}</td>
                <td className="p-3">{row.month}</td>
                <td className="p-3">{row.year}</td>
                <td className="p-3">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
