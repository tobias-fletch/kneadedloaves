"use client";
import Link from "next/link";
import { useState } from "react";
export function AccountForm({ action, token }: { action: "register" | "forgot-password" | "reset-password" | "change-password"; token?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const title = { register: "Create an account", "forgot-password": "Forgot your password?", "reset-password": "Reset your password", "change-password": "Change your password" }[action];
  async function submit(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), token }) });
      const result = await response.json();
      setMessage(result.message || result.error || "Please try again.");
    } catch { setMessage("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <form action={submit} className="panel mx-auto max-w-md space-y-4 p-5"><h1 className="font-display text-3xl uppercase tracking-wide">{title}</h1>{action === "register" && <label>Name<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>}{["register", "forgot-password"].includes(action) && <label>Email<input name="email" type="email" required autoComplete="email" /></label>}{action === "change-password" && <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>}{action !== "forgot-password" && <label>New password (12–72 characters)<input name="password" type="password" minLength={12} maxLength={72} required autoComplete="new-password" /></label>}<button disabled={busy} className="btn-primary">{busy ? "Please wait…" : title}</button>{message && <p role="status">{message}</p>}<p><Link href="/login" className="underline">Sign in</Link></p></form>;
}
