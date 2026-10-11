"use client";

import { FormEvent, useState, useTransition } from "react";
import { Check, Palette, Save, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SiteAppearance } from "@/lib/appearance";

type TextSettings = {
  bakeryName: string;
  businessDescription: string;
  orderingOpenMessage: string;
  orderingClosedMessage: string;
};

type InlineAdminPanelProps = {
  initialSettings: TextSettings;
  initialAppearance: SiteAppearance;
};

const fontOptions = [
  { label: "Clean system", value: "system-ui, sans-serif" },
  { label: "Warm serif", value: "Georgia, serif" },
  { label: "Friendly rounded", value: "'Trebuchet MS', sans-serif" },
  { label: "Bold display", value: "'Arial Black', system-ui, sans-serif" }
];

const colorFields = [
  { key: "colorPage", label: "Page" },
  { key: "colorCrumb", label: "Soft background" },
  { key: "colorInk", label: "Text" },
  { key: "colorJam", label: "Buttons" },
  { key: "colorSage", label: "Open status" },
  { key: "colorButter", label: "Highlight" },
  { key: "colorCrust", label: "Accent" }
] as const;

export function InlineAdminPanel({ initialSettings, initialAppearance }: InlineAdminPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] = useState(initialSettings);
  const [appearance, setAppearance] = useState(initialAppearance);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/admin/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, appearance })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setMessage(payload?.error ?? "Could not save changes.");
      return;
    }

    setMessage("Saved");
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        aria-label="Edit site"
        className="fixed bottom-4 right-4 z-50 inline-flex min-h-11 items-center gap-2 rounded-md border border-white/15 bg-page px-4 py-2 text-sm font-bold text-ink shadow-soft transition hover:bg-jam hover:text-white"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Settings2 size={18} />
        Edit site
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-page/70 backdrop-blur-sm">
          <form
            className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-page text-ink shadow-soft"
            onSubmit={save}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Palette size={18} />
                <div>
                  <h2 className="text-base font-black">Site editor</h2>
                  <p className="text-xs text-ink/60">Public page copy, colors, and fonts</p>
                </div>
              </div>
              <button
                aria-label="Close editor"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-ink hover:bg-white/10"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              <section className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-normal text-sage">Homepage text</h3>
                <label className="block text-xs font-bold text-ink/80">
                  Bakery name
                  <input
                    className="mt-1 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setSettings((current) => ({ ...current, bakeryName: event.target.value }))}
                    value={settings.bakeryName}
                  />
                </label>
                <label className="block text-xs font-bold text-ink/80">
                  Description
                  <textarea
                    className="mt-1 min-h-24 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setSettings((current) => ({ ...current, businessDescription: event.target.value }))}
                    value={settings.businessDescription}
                  />
                </label>
                <label className="block text-xs font-bold text-ink/80">
                  Orders open message
                  <textarea
                    className="mt-1 min-h-20 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setSettings((current) => ({ ...current, orderingOpenMessage: event.target.value }))}
                    value={settings.orderingOpenMessage}
                  />
                </label>
                <label className="block text-xs font-bold text-ink/80">
                  Orders closed message
                  <textarea
                    className="mt-1 min-h-20 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setSettings((current) => ({ ...current, orderingClosedMessage: event.target.value }))}
                    value={settings.orderingClosedMessage}
                  />
                </label>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-normal text-sage">Colors</h3>
                <div className="grid grid-cols-2 gap-3">
                  {colorFields.map((field) => (
                    <label className="block text-xs font-bold text-ink/80" key={field.key}>
                      {field.label}
                      <div className="mt-1 flex items-center gap-2 rounded-md border border-white/10 bg-crumb p-2">
                        <input
                          aria-label={field.label}
                          className="h-9 w-10 shrink-0 cursor-pointer rounded border-white/20 bg-transparent p-0"
                          onChange={(event) =>
                            setAppearance((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          type="color"
                          value={appearance[field.key]}
                        />
                        <span className="truncate font-mono text-xs text-ink/70">{appearance[field.key]}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-normal text-sage">Fonts</h3>
                <label className="block text-xs font-bold text-ink/80">
                  Body
                  <select
                    className="mt-1 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setAppearance((current) => ({ ...current, fontBody: event.target.value }))}
                    value={appearance.fontBody}
                  >
                    {fontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold text-ink/80">
                  Headings
                  <select
                    className="mt-1 border-white/10 bg-crumb text-ink"
                    onChange={(event) => setAppearance((current) => ({ ...current, fontHeading: event.target.value }))}
                    value={appearance.fontHeading}
                  >
                    {fontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            </div>

            <div className="border-t border-white/10 p-4">
              {message ? (
                <p className="mb-3 flex items-center gap-2 text-sm text-ink/80">
                  {message === "Saved" ? <Check size={16} /> : null}
                  {message}
                </p>
              ) : null}
              <button className="btn-primary w-full bg-jam" disabled={isPending} type="submit">
                <Save size={16} />
                {isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
