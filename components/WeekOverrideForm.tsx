"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { weekKey: string; opensAt: string; closesAt: string; fulfillmentDate: string; skip: boolean; message: string; hasOverride: boolean };

/** One-week change: custom times (Eastern Time), or skip the week, with an optional customer message. */
export function WeekOverrideForm(props: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function send(method: "PUT" | "DELETE", body?: Record<string, unknown>) {
    setSaving(true);
    setStatus("");
    const response = await fetch(`/api/admin/weekly-window/weeks/${props.weekKey}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (response.ok) {
      setStatus(method === "DELETE" ? "Back to the weekly schedule." : "Saved.");
      router.refresh();
    } else {
      setStatus(result.error ?? "Could not save this week.");
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send("PUT", {
      opensAt: data.get("opensAt"),
      closesAt: data.get("closesAt"),
      fulfillmentDate: data.get("fulfillmentDate"),
      skip: data.get("skip") === "on",
      message: data.get("message")
    });
  }

  const id = (name: string) => `${name}-${props.weekKey}`;
  return (
    <details className="mt-3 border-t-2 border-ink pt-3">
      <summary className="cursor-pointer text-sm font-black uppercase tracking-wide">Change this week only</summary>
      <form className="mt-3 space-y-2" onSubmit={save}>
        <label htmlFor={id("opensAt")}>Opens (Eastern Time)</label>
        <input id={id("opensAt")} name="opensAt" type="datetime-local" defaultValue={props.opensAt} required />
        <label htmlFor={id("closesAt")}>Closes (Eastern Time)</label>
        <input id={id("closesAt")} name="closesAt" type="datetime-local" defaultValue={props.closesAt} required />
        <label htmlFor={id("fulfillmentDate")}>Delivery/pickup date (Eastern Time)</label>
        <input id={id("fulfillmentDate")} name="fulfillmentDate" type="datetime-local" defaultValue={props.fulfillmentDate} required />
        <label className="flex items-center gap-2 font-black"><input className="w-auto" name="skip" type="checkbox" defaultChecked={props.skip} /> No orders this week</label>
        <label htmlFor={id("message")}>Message for customers (optional)</label>
        <input id={id("message")} name="message" defaultValue={props.message} placeholder="Closed for the holiday" />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={saving} type="submit">{saving ? "Saving..." : "Save this week"}</button>
          {props.hasOverride ? <button className="btn-secondary" disabled={saving} type="button" onClick={() => void send("DELETE")}>Use weekly schedule</button> : null}
        </div>
        {status ? <p className="text-sm font-semibold text-jam" role="status">{status}</p> : null}
      </form>
    </details>
  );
}
