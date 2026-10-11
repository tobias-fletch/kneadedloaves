import { DeleteWindowButton } from "@/components/DeleteWindowButton";
import { OrderWindowEditor } from "@/components/OrderWindowEditor";
import { prisma } from "@/lib/prisma";
import { formatBakeryDate, toBakeryDateTimeLocal } from "@/lib/bakery-time";
import { orderWindowConfigurationError } from "@/lib/order-rules";

export default async function AdminWindowsPage() {
  const windows = await prisma.orderWindow.findMany({ include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } } }, orderBy: { opensAt: "desc" } });
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <section className="panel space-y-3 self-start p-4">
        <h2 className="text-lg font-black">Create delivery window</h2>
        <OrderWindowEditor />
      </section>
      <section className="space-y-3">
        {!windows.length ? <div className="panel p-4 text-sm text-ink/70">Checkout stays closed until a delivery window has confirmed opening, cutoff, delivery times, and capacity.</div> : null}
        {windows.map((window) => {
          const configurationError = orderWindowConfigurationError(window);
          return (
            <div className="panel p-4" key={window.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-black">{window.name}</h2>
                <span className="badge bg-crumb text-ink">{window.orders.length}/{window.maxOrders ?? "not set"} reserved orders</span>
              </div>
              <p className="mt-2 text-sm text-ink/70">Opens {formatBakeryDate(window.opensAt)}</p>
              <p className="text-sm text-ink/70">Cutoff {formatBakeryDate(window.closesAt)}</p>
              <p className="text-sm font-semibold text-jam">Delivery {formatBakeryDate(window.fulfillmentDate)}</p>
              <p className="mt-1 text-xs font-semibold">{window.manualClosed ? "Manually closed" : window.manualOpen ? "Early opening enabled; cutoff still applies" : "Follows schedule"}</p>
              {configurationError ? <p className="mt-2 text-sm font-semibold text-jam">Checkout unavailable: {configurationError}</p> : null}
              <details className="mt-3">
                <summary className="cursor-pointer font-semibold">Edit delivery window</summary>
                <div className="mt-3">
                  <OrderWindowEditor key={window.updatedAt.toISOString()} window={{
                    id: window.id, name: window.name,
                    opensAt: toBakeryDateTimeLocal(window.opensAt),
                    closesAt: toBakeryDateTimeLocal(window.closesAt),
                    fulfillmentDate: toBakeryDateTimeLocal(window.fulfillmentDate),
                    maxOrders: window.maxOrders, manualOpen: window.manualOpen, manualClosed: window.manualClosed
                  }} />
                </div>
              </details>
              <div className="mt-3">
                <DeleteWindowButton windowId={window.id} windowName={window.name} />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
