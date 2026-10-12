import Link from "next/link";

export default function NotFound() {
  return (
    <main className="section">
      <div className="mx-auto max-w-2xl border-4 border-ink bg-page p-8 text-center shadow-hard sm:p-12">
        <p className="font-display text-8xl text-jam sm:text-9xl">404</p>
        <h1 className="font-display mt-4 text-3xl uppercase tracking-wide text-ink sm:text-4xl">
          This page is toast
        </h1>
        <p className="mx-auto mt-4 max-w-md font-medium text-ink/70">
          The page you&rsquo;re looking for doesn&rsquo;t exist or was moved. Let&rsquo;s get you back to something delicious.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link className="btn-primary" href="/">
            Back to the bakery
          </Link>
          <Link className="btn-secondary" href="/#shop">
            Browse the menu
          </Link>
        </div>
      </div>
    </main>
  );
}
