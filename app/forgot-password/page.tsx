import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
export const metadata: Metadata = { title: "Forgot password | Kneaded Loaves", robots: { index: false, follow: false } };
export default function Forgot() { return <main className="section"><AccountForm action="forgot-password" /></main>; }
