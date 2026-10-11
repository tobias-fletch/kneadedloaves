"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Field = {
  key: string;
  label: string;
  group: string;
  secret: boolean;
  input?: "checkbox";
  optional?: boolean;
  configured: boolean;
  savedInAdmin: boolean;
  envConfigured: boolean;
  value: string;
};

export function SetupSettingsForm({ fields }: { fields: Field[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    setMessage("");
    const values = fields.map((field) => ({
      key: field.key,
      value: field.input === "checkbox" ? (formData.get(field.key) === "on" ? "true" : "false") : String(formData.get(field.key) ?? ""),
      clear: formData.get(`${field.key}_clear`) === "on"
    }));

    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    const body = await response.json();
    setMessage(response.ok ? "Setup settings saved." : body.error ?? "Could not save setup settings.");
    if (response.ok) router.refresh();
  }

  const groups = Array.from(new Set(fields.map((field) => field.group)));

  return (
    <form action={submit} className="space-y-5">
      {groups.map((group) => (
        <section className="panel p-4" key={group}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">{group}</h2>
              <p className="mt-1 text-sm text-ink/70">Save setup values here so the shop can use them without code edits.</p>
            </div>
            <span className="badge bg-crumb text-ink">
              {fields.filter((field) => field.group === group && field.configured).length}/
              {fields.filter((field) => field.group === group).length}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {fields.filter((field) => field.group === group).map((field) => (
              <label className="space-y-1" key={field.key}>
                <span className="flex items-center justify-between gap-2">
                  <span>{field.label}</span>
                  <span className={`badge ${field.configured ? "bg-sage text-white" : "bg-crumb text-ink"}`}>
                    {field.input === "checkbox" ? (field.value === "true" ? "On" : "Off") : field.configured ? "Set" : "Missing"}
                  </span>
                </span>
                {field.input === "checkbox" ? (
                  <span className="flex min-h-10 items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                    <input className="h-4 w-4" defaultChecked={field.value === "true"} name={field.key} type="checkbox" />
                    {field.label}
                  </span>
                ) : (
                  <input
                    autoComplete="off"
                    defaultValue={field.secret ? "" : field.value}
                    name={field.key}
                    placeholder={field.secret && field.configured ? "Saved, leave blank to keep" : field.label}
                    type={field.secret ? "password" : "text"}
                  />
                )}
                <span className="block text-xs text-ink/60">
                  {field.envConfigured ? "Using environment value (takes precedence over admin settings)." : field.savedInAdmin ? "Saved in admin." : "Not configured yet."}
                </span>
                {field.savedInAdmin ? (
                  <span className="flex items-center gap-2 text-xs font-semibold text-ink/70">
                    <input className="h-4 w-4" name={`${field.key}_clear`} type="checkbox" />
                    Clear saved admin value
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </section>
      ))}
      <button className="btn-primary">Save setup settings</button>
      {message ? <p className="text-sm font-semibold text-sage">{message}</p> : null}
    </form>
  );
}
