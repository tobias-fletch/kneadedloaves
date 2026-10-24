import Link from "next/link";
import { formatEasternDateTime, formatEasternMonthDay } from "@/lib/format-datetime";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSetupChecklist } from "@/lib/setup-checklist";
import { summarizeOrders } from "@/lib/admin-metrics";
import { SetupChecklistClient } from "@/components/SetupChecklistClient";
import { orderStatusTone } from "@/lib/admin-status";

export default async function AdminPage() {
  const [recent, products, windows, setup] = await Promise.all([
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 6 }).catch(() => []),
    prisma.product.count({ where: { active: true } }).catch(() => 0),
    prisma.orderWindow.findMany({ orderBy: { opensAt: "desc" }, take: 3 }).catch(() => []),
    getSetupChecklist().catch(() => ({ completeCount: 0, totalCount: 0, incomplete: [] }))
  ]);
  const current = windows[0];
  const windowOrders = current
    ? await prisma.order.findMany({ where: { orderWindowId: current.id }, select: { status: true, paymentState: true, totalCents: true } }).catch(() => [])
    : [];
  const summary = summarizeOrders(windowOrders);

  return (
    <div className="space-y-5">
      <section aria-label={current ? `This window: ${current.name}` : "This window"} className="space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-ink/70">{current ? `This window · ${current.name}` : "No order window yet"}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Orders" value={String(summary.orders)} />
          <Metric label="Verified revenue" value={formatMoney(summary.verifiedCents)} />
          <Metric label="Awaiting payment" value={String(summary.awaitingPayment)} href="/admin/orders?status=PENDING" highlight={summary.awaitingPayment > 0} />
          <Metric label="Customer says paid" value={String(summary.needsReview)} href="/admin/orders?payment=REVIEW" highlight={summary.needsReview > 0} />
        </div>
      </section>

      <SetupChecklistClient completeCount={setup.completeCount} items={setup.incomplete} totalCount={setup.totalCount} />

      <section className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="panel p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-black">Latest orders</h2>
            <Link className="text-xs font-black uppercase tracking-wide underline" href="/admin/orders">All orders</Link>
          </div>
          {recent.length ? (
            <ul className="mt-3 divide-y-2 divide-ink/10">
              {recent.map((order) => (
                <li className="flex items-center justify-between gap-3 py-2" key={order.id}>
                  <div className="min-w-0">
                    <p className="truncate font-bold">{order.customerName}</p>
                    <p className="text-xs text-ink/70">{order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} · {formatEasternDateTime(order.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-black">{formatMoney(order.totalCents)}</p>
                    <span className={`badge mt-1 px-1.5 py-0.5 text-[10px] ${orderStatusTone(order.status)}`}>{order.status === "PENDING" ? "Awaiting payment" : order.status.replaceAll("_", " ")}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm">No orders yet.</p>}
        </div>

        <div className="panel p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-black">Order windows</h2>
            <Link className="text-xs font-black uppercase tracking-wide underline" href="/admin/windows">Manage</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {windows.map((window) => (
              <li className="border-2 border-ink bg-crumb p-3 text-sm" key={window.id}>
                <p className="font-black">{window.name}</p>
                <p className="mt-0.5 text-ink/80">Closes {formatEasternDateTime(window.closesAt)} · fulfills {formatEasternMonthDay(window.fulfillmentDate)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink/70">{products} products on the menu · <Link className="underline" href="/admin/products">edit menu</Link></p>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, href, highlight = false }: { label: string; value: string; href?: string; highlight?: boolean }) {
  const body = (
    <>
      <p className="text-[11px] font-black uppercase tracking-widest text-ink/70">{label}</p>
      <p className="mt-1 text-2xl font-black sm:text-3xl">{value}</p>
    </>
  );
  const className = `panel block p-3 sm:p-4 ${highlight ? "bg-butter" : ""}`;
  return href ? <Link className={className} href={href}>{body}</Link> : <div className={className}>{body}</div>;
}
