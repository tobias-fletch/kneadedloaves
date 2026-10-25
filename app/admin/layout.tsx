import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <main className="section space-y-4 sm:space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-sage">Kneaded Loaves admin</p>
          <h1 className="text-2xl font-black sm:text-3xl">Bakery control panel</h1>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link className="border-2 border-ink bg-page px-3 py-1.5 text-xs font-black uppercase tracking-wide hover:bg-butter" href="/account">Account</Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="border-2 border-ink bg-page px-3 py-1.5 text-xs font-black uppercase tracking-wide hover:bg-butter">Log out</button>
          </form>
        </div>
      </header>
      <AdminNav />
      {children}
    </main>
  );
}
