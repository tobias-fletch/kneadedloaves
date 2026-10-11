import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { hasReceiptAccess } from "@/lib/payment-rules";
import { PaymentStatus } from "@/components/PaymentStatus";
import { formatBakeryDate } from "@/lib/bakery-time";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ receipt?: string; token?: string; paypal?: string; cancelled?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const token = query.receipt || query.token || "";
  const session = await getSession();
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, orderWindow: true } });
  const validToken = hasReceiptAccess(token, order?.receiptTokenHash || null);
  if (!order || (!validToken && session?.sub !== order.userId && session?.role !== "ADMIN")) notFound();
  return <main className="section"><div className="panel p-5"><h1 className="text-2xl font-black">Your order</h1>
    <p>Order #{order.id.slice(-6).toUpperCase()} · {order.status.replaceAll("_", " ")}</p>
    <p>Payment: {order.paymentState.replaceAll("_", " ")}</p>
    {order.paymentState === "PENDING" ? <p>Payment has not been confirmed. Your order is reserved while checkout is in progress. Please do not place a second order.</p> : null}
    {order.paymentState === "REVIEW" ? <p>The bakery needs to review this payment before confirming fulfillment. Please contact us with your order number.</p> : null}
    {query.cancelled && order.paymentState === "PENDING" ? <p>You left checkout before confirmation. You can resume the same payment below. An abandoned reservation is released after the provider confirms expiry.</p> : null}
    {order.orderWindow ? <p className="mt-3">{formatBakeryDate(order.orderWindow.fulfillmentDate, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p> : null}
    <ul className="my-4">{order.items.map(item => <li key={item.id}>{item.quantity} × {item.productName}</li>)}</ul>
    <p>Total: {formatMoney(order.totalCents)}</p>{order.refundedCents ? <p>Refunded: {formatMoney(order.refundedCents)}</p> : null}
    <p>{order.fulfillmentInstructions}</p>
    {order.paymentState === "PENDING" && order.paymentUrl && (!order.reservationExpiresAt || order.reservationExpiresAt > new Date()) ? <a className="btn-primary mt-4" href={order.paymentUrl} rel="noreferrer">Resume secure payment</a> : null}
    {validToken ? <PaymentStatus orderId={order.id} receiptToken={token} paypalApproved={query.paypal === "approved" && order.paymentProvider === "PAYPAL"} pending={order.paymentState === "PENDING"} /> : null}
    <p className="mt-4 text-sm">Keep this private link to check your order status.</p>
  </div></main>;
}
