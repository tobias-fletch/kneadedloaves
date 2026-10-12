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
      if (stored) setDismissed(JSON.parse(stored));
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

  const visible = items.filter((item) => !dismissed.includes(item.id));
  const doneCount = completeCount + dismissed.length;

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
        <span className="badge bg-crumb text-ink">{visible.length ? `${visible.length} left` : "Ready"}</span>
      </div>
      {visible.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visible.map((item) => (
            <div
              className="rounded-lg border border-amber-200 bg-[#fffaf3] p-3"
              key={item.id}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase text-sage">{item.group}</p>
                <button
                  onClick={() => dismiss(item.id)}
                  className="rounded border border-ink/20 px-2 py-0.5 text-xs font-bold text-ink/60 hover:border-jam hover:text-jam"
                  title="Dismiss this item"
                >
                  ✓ Done
                </button>
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
          <p className="font-bold">All setup checks are complete.</p>
          <p className="mt-1 text-sm text-ink/70">
            You can keep tuning products, windows, events, and content from the admin tabs.
          </p>
        </div>
      )}
    </section>
  );
}
