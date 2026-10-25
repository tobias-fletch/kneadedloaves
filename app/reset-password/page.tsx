import { AccountForm } from "@/components/AccountForm";
export const metadata = { title: "Reset password | Kneaded Loaves", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; return <main className="section"><AccountForm action="reset-password" token={token} /></main>; }
