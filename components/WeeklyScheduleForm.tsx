"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WEEKDAYS, type WeeklySettings } from "@/lib/weekly-window";

/** The recurring weekly order window. Days and times are Eastern Time (America/New_York). */
export function WeeklyScheduleForm({ settings, available }: { settings: WeeklySettings; available: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/admin/weekly-window", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: data.get("enabled") === "on",
        windowName: data.get("windowName"),
        openWeekday: data.get("openWeekday"),
        openTime: data.get("openTime"),
        closeWeekday: data.get("closeWeekday"),
        closeTime: data.get("closeTime"),
        fulfillmentWeekday: data.get("fulfillmentWeekday"),
        maxOrders: data.get("maxOrders"),
        paused: data.get("paused") === "on",
        pauseMessage: data.get("pauseMessage")
      })
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (response.ok) {
      setMessage("Saved.");
      router.refresh();
    } else {
      setMessage(body.error ?? "Could not save the weekly window.");
    }
  }

  const day = (name: string, value: number) => (
    <select id={name} name={name} defaultValue={value}>
      {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
    </select>
  );

  return (
    <form className="panel space-y-3 p-4" onSubmit={save} data-testid="weekly-schedule-form">
      <h2 className="text-lg font-black">Weekly order window</h2>
      <p className="text-sm text-ink/70">Repeats every week, in Eastern Time (ET). After it closes, the next week&apos;s window is set up automatically.</p>
      {!available ? <p className="text-sm font-semibold text-jam" role="alert">The database update for weekly windows hasn&apos;t been applied yet. It runs with the next production deploy.</p> : null}
      <label className="flex items-center gap-2 font-black"><input className="w-auto" name="enabled" type="checkbox" defaultChecked={settings.enabled} /> Use the weekly schedule</label>
      <p className="text-xs text-ink/70">While this is off, ordering uses the one-off windows below, exactly as before.</p>
      <label htmlFor="windowName">Window name</label>
      <input id="windowName" name="windowName" defaultValue={settings.windowName} required />
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor="openWeekday">Opens (day)</label>{day("openWeekday", settings.openWeekday)}</div>
        <div><label htmlFor="openTime">Opens (time, ET)</label><input id="openTime" name="openTime" type="time" defaultValue={settings.openTime} required /></div>
        <div><label htmlFor="closeWeekday">Closes (day)</label>{day("closeWeekday", settings.closeWeekday)}</div>
        <div><label htmlFor="closeTime">Closes (time, ET)</label><input id="closeTime" name="closeTime" type="time" defaultValue={settings.closeTime} required /></div>
      </div>
      <label htmlFor="fulfillmentWeekday">Pickup/delivery day (first one on or after the close)</label>
      {day("fulfillmentWeekday", settings.fulfillmentWeekday)}
      <label htmlFor="weeklyMaxOrders">Max orders per week (blank for no limit)</label>
      <input id="weeklyMaxOrders" name="maxOrders" type="number" min={1} defaultValue={settings.maxOrders ?? ""} />
      <label className="flex items-center gap-2 font-black"><input className="w-auto" name="paused" type="checkbox" defaultChecked={settings.paused} /> Pause ordering</label>
      <label htmlFor="pauseMessage">Message shown while paused (optional)</label>
      <textarea id="pauseMessage" name="pauseMessage" rows={2} defaultValue={settings.pauseMessage ?? ""} placeholder="Taking a break, back soon!" />
      <button className="btn-primary w-full" disabled={saving || !available} type="submit">{saving ? "Saving..." : "Save weekly window"}</button>
      {message ? <p className="text-sm font-semibold text-jam" role="status">{message}</p> : null}
    </form>
  );
}
