import { formatEasternDateTime, formatEasternMonthDay } from "@/lib/format-datetime";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSetupChecklist } from "@/lib/setup-checklist";
import { SetupChecklistClient } from "@/components/SetupChecklistClient";

export default async function AdminPage() {
  const [orders, products, posts, windows, setup] = await Promise.all([
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 6 }).catch(() => []),
    prisma.product.count().catch(() => 0),
    prisma.socialPost.groupBy({ by: ["status"], _count: true }).catch(() => []),
    prisma.orderWindow.findMany({ orderBy: { opensAt: "desc" }, take: 3 }).catch(() => []),
    getSetupChecklist().catch(() => ({ completeCount: 0, totalCount: 0, incomplete: [] }))
  ]);
  const revenue = orders.reduce((sum, order) => sum + order.totalCents, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Recent revenue" value={formatMoney(revenue)} />
        <Metric label="Products" value={String(products)} />
        <Metric label="Recent orders" value={String(orders.length)} />
      </div>

      <SetupChecklistClient completeCount={setup.completeCount} items={setup.incomplete} totalCount={setup.totalCount} />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="text-lg font-black">Latest orders</h2>
          <div className="mt-3 space-y-2">
            {orders.map((order) => (
              <div className="rounded-md bg-crumb p-3" key={order.id}>
                <p className="font-bold">{order.customerName} | {formatMoney(order.totalCents)}</p>
                <p className="text-xs text-ink/60">
                  {order.status.replaceAll("_", " ")} | {formatEasternDateTime(order.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="text-lg font-black">Social workflow</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {posts.map((post) => (
              <Metric key={post.status} label={post.status.replaceAll("_", " ")} value={String(post._count)} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="text-lg font-black">Order windows</h2>
        <div className="mt-3 grid gap-2">
          {windows.map((window) => (
            <p className="rounded-md border border-amber-200 p-3 text-sm" key={window.id}>
              <strong>{window.name}</strong> opens {formatEasternDateTime(window.opensAt)} and fulfills{" "}
              {formatEasternMonthDay(window.fulfillmentDate)}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}


function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-bold uppercase text-sage">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
