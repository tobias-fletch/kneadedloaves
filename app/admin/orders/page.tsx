import { format } from "date-fns";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; fulfillment?: string }> }) {
  const params = await searchParams;
  const orders = await prisma.order.findMany({
    where: {
      status: params.status as never,
      fulfillmentType: params.fulfillment as never
    },
    include: { items: true, orderWindow: true, deliveryZone: true, pickupLocation: true },
    orderBy: { createdAt: "desc" }
  }).catch(() => []);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap gap-2 p-4 print:hidden">
        {["PAID", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"].map((status) => (
          <a className="btn-secondary" href={`/admin/orders?status=${status}`} key={status}>{status.replaceAll("_", " ")}</a>
        ))}
        <span className="btn-primary">Use browser print/export</span>
      </div>
      <div className="grid gap-4">
        {orders.map((order) => (
          <article className="panel p-4" key={order.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">{order.customerName}</h2>
                <p className="text-sm text-ink/70">{order.customerEmail} · {order.customerPhone}</p>
                <p className="text-sm font-semibold text-jam">{order.fulfillmentType} · {order.deliveryZone?.name ?? order.pickupLocation?.name}</p>
              </div>
              <div className="text-right">
                <span className="badge bg-crumb text-ink">{order.status.replaceAll("_", " ")}</span>
                <p className="mt-2 font-black">{formatMoney(order.totalCents)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink/60">{format(order.createdAt, "MMM d, h:mm a")} · Window: {order.orderWindow?.name ?? "None"}</p>
            <ul className="mt-3 grid gap-1 text-sm">
              {order.items.map((item) => <li key={item.id}>{item.quantity} x {item.productName}</li>)}
            </ul>
            <p className="mt-3 rounded-md bg-crumb p-3 text-sm">{order.fulfillmentInstructions ?? "No special instructions."}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
