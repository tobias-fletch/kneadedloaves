import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Sign in | Kneaded Loaves", robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="section flex min-h-[70vh] items-center justify-center">
      <form className="panel w-full max-w-md space-y-4 p-5" action="/api/auth/login" method="post">
        <div>
          <h1 className="font-display text-3xl uppercase tracking-wide">Sign in</h1>
          <p className="mt-1 text-sm text-ink/70">Welcome back to Kneaded Loaves.</p>
        </div>
        <div>
          <label htmlFor="login-email">Email</label>
          <input id="login-email" autoComplete="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="login-password">Password</label>
          <input id="login-password" autoComplete="current-password" name="password" type="password" required />
        </div>
        <button className="btn-primary w-full">Sign in</button>
        {error && <p role="alert">Sign-in failed. Check your email and password, or reset your password.</p>}
        <p><Link href="/register" className="underline">Create an account</Link> · <Link href="/forgot-password" className="underline">Forgot password?</Link></p>
      </form>
    </main>
  );
}
