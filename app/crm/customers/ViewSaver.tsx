"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteView, saveView } from "./viewActions";

/**
 * P4 — "Save this view": the current filters, sort and search under a name
 * the whole office sees (deep dive §4.4.5). Views are a Settings row, so a
 * filter set nobody needs any more is one click to remove.
 */
export default function ViewSaver({ params, activeKey }: { params: Record<string, string>; activeKey: string }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  const [msg, setMsg] = useState("");

  const save = () => {
    const name = window.prompt("Name this view — e.g. “My hot leads quoted this month”");
    if (!name?.trim()) return;
    start(async () => {
      const r = await saveView(name.trim(), params);
      setMsg(r.ok ? "Saved." : r.message);
      if (r.ok) router.push(`/crm/customers?${new URLSearchParams({ ...params, v: r.key ?? "" }).toString()}`);
    });
  };
  const remove = () => start(async () => {
    if (!window.confirm("Remove this saved view?")) return;
    const r = await deleteView(activeKey);
    setMsg(r.ok ? "Removed." : r.message);
    if (r.ok) router.push("/crm/customers");
  });

  return (
    <span className="chips" style={{ marginLeft: "auto" }}>
      <button type="button" className="chip sm" disabled={busy} onClick={save} data-testid="save-view">Save this view</button>
      {activeKey && <button type="button" className="chip sm ghost" disabled={busy} onClick={remove} data-testid="delete-view">Remove view</button>}
      {msg && <span className="said">{msg}</span>}
    </span>
  );
}
