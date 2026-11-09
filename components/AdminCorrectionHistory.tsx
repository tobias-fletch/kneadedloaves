import React from "react";
import { formatAuditSnapshot } from "@/lib/admin-order-corrections";

const dateTime = (date: Date) => `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date)} ET`;

export function AdminCorrectionHistory({ audits }: { audits: { id: string; action: string; createdAt: Date; actorId: string; actorEmail: string | null; actorName: string | null; note: string | null; before: unknown; after: unknown; paymentId: string | null }[] }) {
  return <details className="mt-3 border-t-2 border-ink/20 pt-2">
    <summary className="cursor-pointer text-xs font-black uppercase tracking-wide">Quantity and payment corrections ({audits.length})</summary>
    {audits.length ? <ol className="mt-3 space-y-3">{audits.map(audit => <li key={audit.id} className="border-2 border-ink bg-crumb p-3 text-sm">
      <p className="font-black">{audit.action === "QUANTITY_CHANGED" ? "Quantity changed" : audit.action === "MARKED_PAID" ? "Marked paid" : audit.action} · {dateTime(audit.createdAt)}</p>
      <p className="mt-1 break-all">Recorded by: {audit.actorName || audit.actorEmail || audit.actorId}</p>
      <p className="mt-1">Before: {formatAuditSnapshot(audit.before)}</p>
      <p className="mt-1">After: {formatAuditSnapshot(audit.after)}</p>
      <p className="mt-1 whitespace-pre-line">{audit.note ? `Note: ${audit.note}` : "Note: none"}</p>
      {audit.paymentId ? <p className="mt-1 break-all">Shared payment: {audit.paymentId}</p> : null}
    </li>)}</ol> : <p className="mt-3 text-sm">No quantity or recorded-payment corrections yet.</p>}
    </details>;
}
