import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const links = [
  ["/admin", "Overview"],
  ["/admin/products", "Products"],
  ["/admin/orders", "Orders"],
  ["/admin/windows", "Windows"],
  ["/admin/events", "Events"],
  ["/admin/customers", "Customers"],
  ["/admin/email", "Email"],
  ["/admin/social", "Social"],
  ["/admin/setup", "Setup"]
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <main className="section space-y-5">
      <div>
        <h1 className="text-3xl font-black">Bakery control panel</h1>
        <p className="mt-1 text-sm text-ink/70">Manage menu, orders, windows, customers, events, and social planning.</p>
      </div>
      <nav className="flex gap-2 overflow-x-auto pb-2">
        {links.map(([href, label]) => (
          <Link className="btn-secondary whitespace-nowrap" href={href} key={href}>{label}</Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
