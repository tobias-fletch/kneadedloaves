"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/admin", "Overview"],
  ["/admin/orders", "Orders"],
  ["/admin/windows", "Windows"],
  ["/admin/products", "Products"],
  ["/admin/customers", "Customers"],
  ["/admin/events", "Events"],
  ["/admin/email", "Email"],
  ["/admin/setup", "Setup"],
  ["/admin/test-checkout", "Test checkout"]
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2 print:hidden">
      {links.map(([href, label]) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname?.startsWith(href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`border-2 border-ink px-2 py-1.5 text-center text-[11px] font-black uppercase tracking-wide sm:px-3 sm:text-xs ${active ? "bg-ink text-page" : "bg-crumb text-ink hover:bg-butter"}`}
            href={href}
            key={href}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
