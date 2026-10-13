"use client";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
type Field = { key: string; label: string; group: string; secret: boolean; input?: "checkbox"; optional?: boolean; configured: boolean; savedInAdmin: boolean; envConfigured: boolean; value: string };
export function SetupSettingsForm({ fields }: { fields: Field[] }) {
  const router = useRouter(), submittingRef = useRef(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, field.secret ? "" : field.value])));
  function update(key: string, value: string) {
    setValues(previous => ({ ...previous, [key]: value, ...(["VENMO_HANDLE", "VENMO_DESTINATION"].includes(key) ? { VENMO_DESTINATION_VERIFIED: "false" } : {}) }));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current) return;
    const form = new FormData(event.currentTarget);
    submittingRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: fields.filter(field => !field.envConfigured).map(field => ({ key: field.key, value: values[field.key] ?? (field.input === "checkbox" ? "false" : ""), clear: form.get(`${field.key}_clear`) === "on" })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save setup settings.");
      setMessage("Setup settings saved. Check the readiness panel before accepting orders.");
      setValues(previous => Object.fromEntries(fields.map(field => [field.key, field.secret ? "" : previous[field.key] ?? ""])));
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save setup settings. Please try again."); }
    finally { submittingRef.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
    {Array.from(new Set(fields.map(field => field.group))).map(group => <section className="panel p-4" key={group}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">{group}</h2><p className="mt-1 text-sm text-ink/70">Save setup values here so the shop can use them without code edits.</p></div></div>
      {fields.some(field => field.group === group && field.key.startsWith("VENMO_")) ? <p className="mt-3 border-2 border-ink bg-crumb p-3 text-sm">Manual Venmo checkout stays off until all readiness checks pass. Use the bakery’s actual business receiving destination. A public profile alone does not verify business eligibility or receipt of payment. Changing the handle or receiving link requires a fresh destination check.</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{fields.filter(field => field.group === group).map(field => <div className="space-y-1" key={field.key}>
        <label htmlFor={`setup-${field.key}`} className="flex items-center justify-between gap-2"><span>{field.label}</span><span className="badge bg-crumb">{field.input === "checkbox" ? (values[field.key] === "true" ? "On" : "Off") : (field.secret ? field.envConfigured || field.savedInAdmin : Boolean(values[field.key]?.trim())) ? "Set" : "Missing"}</span></label>
        {field.input === "checkbox" ? <label className="flex min-h-11 items-start gap-3 border-2 border-ink bg-page p-3 text-sm normal-case tracking-normal"><input id={`setup-${field.key}`} className="mt-1 h-4 w-4 shrink-0" name={field.key} type="checkbox" checked={values[field.key] === "true"} onChange={event => update(field.key, event.target.checked ? "true" : "false")} disabled={field.envConfigured} /><span>{field.key === "VENMO_DESTINATION_VERIFIED" ? "I checked this exact handle and copied receiving link in the bakery’s Venmo business account." : field.label}</span></label> : <input id={`setup-${field.key}`} autoComplete="off" name={field.key} value={values[field.key] ?? ""} onChange={event => update(field.key, event.target.value)} placeholder={field.secret && (field.envConfigured || field.savedInAdmin) ? "Saved, leave blank to keep" : field.key === "VENMO_DESTINATION" ? "Paste the verified receiving link" : field.label} type={field.secret ? "password" : field.key === "PAYMENT_HOLD_MINUTES" ? "number" : "text"} min={field.key === "PAYMENT_HOLD_MINUTES" ? 1 : undefined} max={field.key === "PAYMENT_HOLD_MINUTES" ? 10080 : undefined} step={field.key === "PAYMENT_HOLD_MINUTES" ? 1 : undefined} disabled={field.envConfigured} />}
        <p className="text-xs text-ink/70">{field.envConfigured ? "Managed by the deployment environment; edit it there. It takes precedence over admin settings." : field.savedInAdmin ? "Saved in admin." : "Not configured yet."}</p>
        {field.key === "PAYMENT_HOLD_MINUTES" ? <p className="text-xs">Payment must be independently verified within this reservation window. Review requests do not extend it.</p> : null}
        {field.savedInAdmin && !field.envConfigured ? <label className="flex items-center gap-2 text-xs normal-case tracking-normal"><input className="h-4 w-4" name={`${field.key}_clear`} type="checkbox" onChange={event => { if (event.target.checked && ["VENMO_HANDLE", "VENMO_DESTINATION"].includes(field.key)) update("VENMO_DESTINATION_VERIFIED", "false"); }} />Clear saved admin value</label> : null}
      </div>)}</div>
    </section>)}
    <button className="btn-primary" type="submit">{busy ? "Saving setup..." : "Save setup settings"}</button>
  </fieldset>{message ? <p role="status" className="border-2 border-ink bg-crumb p-3 text-sm font-bold">{message}</p> : null}</form>;
}
