import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
export const metadata: Metadata = { title: "Create an account | Kneaded Loaves", robots: { index: false, follow: false } };
export default function Register() { return <main className="section"><AccountForm action="register" /></main>; }
