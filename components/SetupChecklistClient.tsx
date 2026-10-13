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

  const required = (item: ChecklistItem) => ["Payments", "Manual Venmo", "Launch", "Notifications"].includes(item.group);
  const visible = items.filter((item) => required(item) || !dismissed.includes(item.id));
  const doneCount = completeCount;

  if (!loaded) return null;

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
      {visible.length ? (
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
      ) : (
        <div className="mt-4 rounded-lg bg-crumb p-4">
          <p className="font-bold">{doneCount === totalCount ? "All setup checks are complete." : "Remaining optional reminders are hidden; their checks are still incomplete."}</p>
          <p className="mt-1 text-sm text-ink/70">
            You can keep tuning products, windows, events, and content from the admin tabs.
          </p>
        </div>
      )}
    </section>
  );
}
