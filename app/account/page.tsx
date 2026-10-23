import { AccountForm } from "@/components/AccountForm";
import Link from "next/link";
import { format } from "date-fns";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { expireUnpaidOrdersOpportunistically } from "@/lib/manual-payments";
import { prisma } from "@/lib/prisma";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) {
    return (
      <main className="section">
        <div className="panel p-5">
          <h1 className="font-display text-3xl uppercase tracking-wide">Account</h1>
          <p className="mt-2 text-ink/70">Sign in to see order history.</p>
          <Link className="btn-primary mt-4" href="/login">Sign in</Link>
        </div>
      </main>
    );
  }

  await expireUnpaidOrdersOpportunistically();
  const orders = await prisma.order.findMany({
    where: { userId: session.sub },
    include: { items: true },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="section space-y-4">
      <h1 className="font-display text-4xl uppercase tracking-wide">Order history</h1>
      <form action="/api/auth/logout" method="post"><button className="btn-secondary">Sign out of all sessions</button></form>
      <details><summary>Change password</summary><AccountForm action="change-password" /></details>
      {orders.length ? orders.map((order) => (
        <div className="panel p-4" key={order.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-black uppercase tracking-wide">{format(order.createdAt, "MMM d, yyyy h:mm a")}</p>
              <p className="break-all text-xs font-semibold text-ink/70">Order {order.paymentReference ?? order.id}</p>
            </div>
            <span className="badge bg-crumb text-ink">{order.status.replaceAll("_", " ")}</span>
          </div>
          <p className="mt-1 text-sm text-ink/70">{order.fulfillmentType} · {formatMoney(order.totalCents)}</p>
          <ul className="mt-3 space-y-1 text-sm">
            {order.items.map((item) => <li key={item.id}>{item.quantity} x {item.productName}</li>)}
          </ul>
          <Link className="btn-secondary mt-4" href={`/orders/${order.id}`}>View order and payment details</Link>
        </div>
      )) : <div className="panel p-4 text-ink/70">No orders yet.</div>}
    </main>
  );
}
