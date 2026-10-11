import { format } from "date-fns";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSetupChecklist } from "@/lib/setup-checklist";

export default async function AdminPage() {
  const [orders, products, posts, windows, setup] = await Promise.all([
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.product.count(),
    prisma.socialPost.groupBy({ by: ["status"], _count: true }),
    prisma.orderWindow.findMany({ orderBy: { opensAt: "desc" }, take: 3 }),
    getSetupChecklist()
  ]);
  const revenue = orders.reduce((sum, order) => sum + order.totalCents, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Recent revenue" value={formatMoney(revenue)} />
        <Metric label="Products" value={String(products)} />
        <Metric label="Recent orders" value={String(orders.length)} />
      </div>

      <SetupChecklist completeCount={setup.completeCount} items={setup.incomplete} totalCount={setup.totalCount} />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="text-lg font-black">Latest orders</h2>
          <div className="mt-3 space-y-2">
            {orders.map((order) => (
              <div className="rounded-md bg-crumb p-3" key={order.id}>
                <p className="font-bold">{order.customerName} | {formatMoney(order.totalCents)}</p>
                <p className="text-xs text-ink/60">
                  {order.status.replaceAll("_", " ")} | {format(order.createdAt, "MMM d, h:mm a")}
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
              <strong>{window.name}</strong> opens {format(window.opensAt, "MMM d, h:mm a")} and fulfills{" "}
              {format(window.fulfillmentDate, "MMM d")}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function SetupChecklist({
  completeCount,
  totalCount,
  items
}: {
  completeCount: number;
  totalCount: number;
  items: Awaited<ReturnType<typeof getSetupChecklist>>["incomplete"];
}) {
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Shop setup checklist</h2>
          <p className="mt-1 text-sm text-ink/70">
            {completeCount}/{totalCount} complete. Finished items disappear from this list automatically.
          </p>
        </div>
        <span className="badge bg-crumb text-ink">{items.length ? `${items.length} left` : "Ready"}</span>
      </div>
      {items.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <a
              className="rounded-lg border border-amber-200 bg-[#fffaf3] p-3 transition hover:border-jam"
              href={item.href ?? "#"}
              key={item.id}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase text-sage">{item.group}</p>
                <span className="h-4 w-4 rounded border-2 border-jam bg-white" aria-hidden="true" />
              </div>
              <h3 className="mt-2 font-black">{item.title}</h3>
              <p className="mt-1 text-sm leading-5 text-ink/70">{item.detail}</p>
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-crumb p-4">
          <p className="font-bold">All setup checks are complete.</p>
          <p className="mt-1 text-sm text-ink/70">
            You can keep tuning products, windows, events, and content from the admin tabs.
          </p>
        </div>
      )}
    </section>
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
