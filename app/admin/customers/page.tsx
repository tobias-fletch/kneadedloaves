import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";

export default async function AdminCustomersPage() {
  const customers = await prisma.user.findMany({
    where: { role: "CUSTOMER" },
    include: { customerProfile: true, orders: true },
    orderBy: { createdAt: "desc" }
  });
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-amber-200 p-4">
        <h2 className="text-lg font-black">Customers</h2>
        <p className="text-sm text-ink/70">Use browser print or select/copy for email export.</p>
      </div>
      <div className="divide-y divide-amber-100">
        {customers.map((customer) => (
          <div className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]" key={customer.id}>
            <div>
              <p className="font-black">{customer.name ?? customer.email}</p>
              <p className="text-sm text-ink/70">{customer.email} · {customer.customerProfile?.phone ?? "No phone"}</p>
              <p className="text-sm text-ink/60">{customer.customerProfile?.notes ?? "No notes yet"}</p>
            </div>
            <div className="text-sm font-bold text-jam">
              {customer.orders.length} orders · {formatMoney(customer.orders.reduce((sum, order) => sum + order.totalCents, 0))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
