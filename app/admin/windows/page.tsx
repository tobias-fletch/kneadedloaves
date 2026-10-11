import { format } from "date-fns";
import { DeleteWindowButton } from "@/components/DeleteWindowButton";
import { prisma } from "@/lib/prisma";

export default async function AdminWindowsPage() {
  const windows = await prisma.orderWindow.findMany({ include: { orders: true }, orderBy: { opensAt: "desc" } });
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form className="panel space-y-3 p-4" action="/api/admin/windows" method="post">
        <h2 className="text-lg font-black">Create window</h2>
        <input name="name" placeholder="Weekly Bake" required />
        <label>Opens</label>
        <input name="opensAt" type="datetime-local" required />
        <label>Closes</label>
        <input name="closesAt" type="datetime-local" required />
        <label>Delivery/pickup date</label>
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
            <p className="mt-2 text-sm text-ink/70">Open {format(window.opensAt, "MMM d, h:mm a")} to {format(window.closesAt, "MMM d, h:mm a")}</p>
            <p className="text-sm font-semibold text-jam">Fulfillment {format(window.fulfillmentDate, "EEEE, MMM d")}</p>
            <div className="mt-3">
              <DeleteWindowButton windowId={window.id} windowName={window.name} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
