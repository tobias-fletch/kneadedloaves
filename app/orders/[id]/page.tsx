import { createHash } from "crypto";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { customerVisibleInstructions } from "@/lib/delivery-pricing";
import { expireUnpaidOrdersOpportunistically } from "@/lib/manual-payments";
import { ManualPaymentInstructions } from "@/components/ManualPaymentInstructions";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params, { token } = await searchParams;
  await expireUnpaidOrdersOpportunistically();
  const session = await getSession();
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  const validToken = typeof token === "string" && /^[a-f0-9]{64}$/.test(token) && order?.receiptTokenHash === createHash("sha256").update(token).digest("hex");
  if (!order || (!validToken && (!session || (session.sub !== order.userId && session.role !== "ADMIN")))) notFound();
  return <main className="section"><div className="panel mx-auto max-w-3xl space-y-6 p-5 sm:p-7">
    <header><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-3xl uppercase tracking-wide">Your order</h1><span className="badge bg-crumb">{order.status.replaceAll("_", " ")}</span></div><p className="mt-2 break-all text-sm">Order {order.paymentReference ?? order.id}</p><p className="mt-2 text-sm">Keep this private link to check payment and order status. Anyone with the link can view this receipt.</p></header>
    {order.paymentMethod === "VENMO" ? <ManualPaymentInstructions orderId={order.id} token={validToken ? token : undefined} status={order.status} paymentState={order.paymentState} totalCents={order.totalCents} currency={order.currency} reference={order.paymentReference} destination={order.paymentDestination} handle={order.paymentHandle} dueAt={order.paymentDueAt?.toISOString() ?? null} deadlinePassed={Boolean(order.paymentDueAt && order.paymentDueAt.getTime() <= Date.now())} reviewRequestedAt={order.paymentReviewRequestedAt?.toISOString() ?? null} /> : order.status === "PENDING" ? <p className="border-2 border-ink bg-crumb p-4 font-bold">Payment has not been confirmed. Contact the bakery before sending a payment for this order.</p> : null}
    <section aria-labelledby="order-summary-heading"><h2 id="order-summary-heading" className="text-xl font-black uppercase">Order summary</h2><ul className="mt-3 divide-y-2 divide-ink/20">{order.items.map(item => <li className="flex justify-between gap-4 py-3" key={item.id}><span>{item.quantity} × {item.productName}</span><span className="shrink-0 font-bold">{formatMoney(item.quantity * item.unitPriceCents)}</span></li>)}</ul>{order.fulfillmentType === "DELIVERY" ? <p className="flex justify-between gap-4 py-2 text-sm"><span>Delivery</span><span>{formatMoney(order.deliveryFeeCents)}</span></p> : null}<p className="mt-2 flex justify-between gap-4 border-t-2 border-ink pt-3 text-xl font-black"><span>Total</span><span>{formatMoney(order.totalCents)} {order.currency}</span></p></section>
    <section className="border-t-2 border-ink pt-4" aria-labelledby="fulfillment-heading"><h2 id="fulfillment-heading" className="text-xl font-black uppercase">{order.fulfillmentType === "DELIVERY" ? "Delivery details" : "Pickup details"}</h2>{order.fulfillmentLocation ? <p className="mt-2 whitespace-pre-line font-bold">{order.fulfillmentLocation}</p> : null}{order.deliveryAddress && order.deliveryAddress !== order.fulfillmentLocation ? <p className="mt-2 whitespace-pre-line">{order.deliveryAddress}</p> : null}{customerVisibleInstructions(order.fulfillmentInstructions) ? <p className="mt-2 whitespace-pre-line">{customerVisibleInstructions(order.fulfillmentInstructions)}</p> : null}{order.status === "PENDING" ? <p className="mt-3 text-sm font-bold">Preparation starts only after the bakery verifies your payment.</p> : null}</section>
  </div></main>;
}
