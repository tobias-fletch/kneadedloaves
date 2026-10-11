import { formatBakeryDate } from "@/lib/bakery-time";
import { ReconcilePaymentsButton } from "@/components/ReconcilePaymentsButton";
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
  });

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap gap-2 p-4 print:hidden">
        {["PENDING", "PAID", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"].map((status) => (
          <a className="btn-secondary" href={`/admin/orders?status=${status}`} key={status}>{status.replaceAll("_", " ")}</a>
        ))}
        <span className="btn-primary">Use browser print/export</span>
        <ReconcilePaymentsButton />
      </div>
      <div className="grid gap-4">
        {orders.map((order) => (
          <article className="panel p-4" key={order.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">{order.customerName}</h2>
                <p className="text-xs">Order {order.id}</p>
                {order.deliveryAddress ? <p className="mt-2 whitespace-pre-line text-sm">Deliver to: {order.deliveryAddress}</p> : null}
                <p className="text-sm text-ink/70">{order.customerEmail} · {order.customerPhone}</p>
                <p className="text-sm font-semibold text-jam">{order.fulfillmentType} · {order.deliveryZone?.name ?? order.pickupLocation?.name}</p>
              </div>
              <div className="text-right">
                <span className="badge bg-crumb text-ink">{order.status.replaceAll("_", " ")}</span>
                <p className="mt-1 text-xs">{order.stripeCheckoutSessionId || order.paypalOrderId || "No provider session recorded"}</p>
                {order.providerPaymentId ? <p className="text-xs">Payment reference: {order.providerPaymentId}</p> : null}
                {order.paymentReviewReason ? <p className="text-sm text-jam">Review: {order.paymentReviewReason.replaceAll("_", " ")}</p> : null}
                <p className="mt-1 text-sm">Payment: {order.paymentState.replaceAll("_", " ")} · {order.paymentProvider || "Legacy"}</p>
                {order.refundedCents ? <p className="text-sm">Refunded: {formatMoney(order.refundedCents)}</p> : null}
                <p className="mt-2 font-black">{formatMoney(order.totalCents)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink/60">{formatBakeryDate(order.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} · Window: {order.orderWindow?.name ?? "None"}</p>
            <ul className="mt-3 grid gap-1 text-sm">
              {order.items.map((item) => <li key={item.id}>{item.quantity} x {item.productName}</li>)}
            </ul>
            <p className="mt-3 whitespace-pre-line rounded-md bg-crumb p-3 text-sm">{order.fulfillmentInstructions ?? "No special instructions."}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
