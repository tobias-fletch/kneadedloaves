import { DeleteWindowButton } from "@/components/DeleteWindowButton";
import { EditWindowForm } from "@/components/EditWindowForm";
import { formatEasternDateTime, formatEasternDay, toEasternDateTimeLocal } from "@/lib/format-datetime";
import { prisma } from "@/lib/prisma";

export default async function AdminWindowsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const windows = await prisma.orderWindow.findMany({ include: { orders: true }, orderBy: { opensAt: "desc" } }).catch(() => []);
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form className="panel space-y-3 p-4" action="/api/admin/windows" method="post">
        <h2 className="text-lg font-black">Create window</h2>
        <p className="text-sm text-ink/70">All times are Eastern Time (ET).</p>
        {error ? <p className="text-sm font-semibold text-jam" role="alert">{error}</p> : null}
        <input name="name" placeholder="Weekly Bake" required />
        <label>Opens (Eastern Time)</label>
        <input name="opensAt" type="datetime-local" required />
        <label>Closes (Eastern Time)</label>
        <input name="closesAt" type="datetime-local" required />
        <label>Delivery/pickup date (Eastern Time)</label>
        <input name="fulfillmentDate" type="datetime-local" required />
        <input name="maxOrders" placeholder="Max orders" type="number" />
        <button className="btn-primary w-full">Create</button>
      </form>
      <section className="space-y-3">
        {windows.map((window) => (
          <div className="panel p-4" key={window.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-black">{window.name}</h2>
              <span className="badge bg-crumb text-ink">{window.orders.length}/{window.maxOrders ?? "∞"} orders</span>
            </div>
            <p className="mt-2 text-sm text-ink/70">Open {formatEasternDateTime(window.opensAt)} to {formatEasternDateTime(window.closesAt)}</p>
            <p className="text-sm font-semibold text-jam">Fulfillment {formatEasternDay(window.fulfillmentDate)}</p>
            <EditWindowForm
              windowId={window.id}
              opensAt={toEasternDateTimeLocal(window.opensAt)}
              closesAt={toEasternDateTimeLocal(window.closesAt)}
              fulfillmentDate={toEasternDateTimeLocal(window.fulfillmentDate)}
              maxOrders={window.maxOrders}
            />
            <div className="mt-3">
              <DeleteWindowButton windowId={window.id} windowName={window.name} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
