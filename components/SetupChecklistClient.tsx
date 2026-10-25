"use client";

import { useEffect, useState } from "react";

type ChecklistItem = {
  id: string;
  title: string;
  detail: string;
  href?: string;
  group: string;
};

export function SetupChecklistClient({
  completeCount,
  totalCount,
  items
}: {
  completeCount: number;
  totalCount: number;
  items: ChecklistItem[];
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("dismissed-checklist");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(id => typeof id === "string")) setDismissed([...new Set(parsed)]);
      }
    } catch {}
    setLoaded(true);
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem("dismissed-checklist", JSON.stringify(next));
    } catch {}
  }

  // Subscribers are optional (nothing is imported or sent), so that reminder can be hidden too.
  const required = (item: ChecklistItem) => item.id !== "email-list" && ["Payments", "Manual Venmo", "Launch", "Notifications"].includes(item.group);
  const visible = items.filter((item) => required(item) || !dismissed.includes(item.id));
  const doneCount = completeCount;

  // Every item is complete or hidden: nothing left to do here.
  if (!loaded || !visible.length) return null;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Shop setup checklist</h2>
          <p className="mt-1 text-sm text-ink/70">
            {doneCount}/{totalCount} complete. Finished items disappear from this list automatically.
          </p>
        </div>
        <span className="badge bg-crumb text-ink">{doneCount === totalCount ? "Ready" : `${totalCount - doneCount} incomplete`}</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {visible.map((item) => (
          <div
            className="border-2 border-ink bg-page p-3"
            key={item.id}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase text-sage">{item.group}</p>
              {!required(item) ? <button
                onClick={() => dismiss(item.id)}
                className="rounded border border-ink/20 px-2 py-0.5 text-xs font-bold text-ink/60 hover:border-jam hover:text-jam"
                title="Hide this reminder without marking it complete"
              >
                Hide
              </button> : null}
            </div>
            <h3 className="mt-2 font-black">{item.title}</h3>
            <p className="mt-1 text-sm leading-5 text-ink/70">{item.detail}</p>
            {item.href && (
              <a href={item.href} className="mt-2 inline-block text-sm font-bold text-jam underline">
                Go to {item.href.replace("/admin/", "")} →
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
