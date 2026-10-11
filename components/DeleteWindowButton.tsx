"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteWindowButton({ windowId, windowName }: { windowId: string; windowName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    if (!window.confirm(`Delete "${windowName}"? Existing orders will remain, but they will no longer be attached to this window.`)) return;
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/windows/${windowId}`, { method: "DELETE" });
    const body = await response.json();
    setLoading(false);
    if (response.ok) {
      router.refresh();
    } else {
      setMessage(body.error ?? "Could not delete window.");
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-secondary text-jam" disabled={loading} type="button" onClick={remove}>
        {loading ? "Deleting..." : "Delete window"}
      </button>
      {message ? <p className="text-sm font-semibold text-jam">{message}</p> : null}
    </div>
  );
}
