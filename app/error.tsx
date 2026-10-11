"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="section"><h1 className="text-2xl font-black">We could not load this page</h1><p>Please try again in a moment.</p><button className="btn-primary mt-4" onClick={reset}>Try again</button></main>;
}
