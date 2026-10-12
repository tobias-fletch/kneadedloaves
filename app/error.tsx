"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="section">
      <div className="mx-auto max-w-2xl border-4 border-ink bg-page p-8 text-center shadow-hard sm:p-12">
        <p className="font-display text-6xl uppercase text-jam sm:text-7xl">Oven's down</p>
        <h1 className="font-display mt-4 text-2xl uppercase tracking-wide text-ink sm:text-3xl">
          Something went wrong
        </h1>
        <p className="mx-auto mt-4 max-w-md font-medium text-ink/70">
          We hit a snag loading this page. Give it another shot — if it keeps happening, reach out and we'll sort it out.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button className="btn-primary" onClick={reset} type="button">
            Try again
          </button>
          <Link className="btn-secondary" href="/">
            Back to the bakery
          </Link>
        </div>
      </div>
    </main>
  );
}
