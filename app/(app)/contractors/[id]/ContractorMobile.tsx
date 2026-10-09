"use client";

import { useState, useTransition } from "react";
import { setContractorMobileAction } from "../actions";

/**
 * The painter's mobile, editable by the office (Tom, 7 Oct 2026). Shows the
 * number as a tap-to-call link; Edit opens an inline field, Save writes it
 * through the server action. "Not given" is amber because every text to this
 * painter — offers, variations, work-order reminders — is skipped until it is.
 */
export default function ContractorMobile({ id, phone }: { id: string; phone: string | null }) {
  const [current, setCurrent] = useState(phone?.trim() || "");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await setContractorMobileAction({ id, phone: value }).catch(() => ({ ok: false, message: "That didn't work — try again." }));
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setCurrent(("phone" in r ? r.phone : null) ?? ""); setEditing(false); }
    });
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-2" data-testid="mobile-row">
        {current
          ? <a href={`tel:${current.replace(/\s+/g, "")}`} className="text-sky-700 hover:underline" data-testid="mobile-value">{current}</a>
          : <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800" data-testid="mobile-missing">not given — no texts reach them</span>}
        <button type="button" onClick={() => { setValue(current); setMsg(null); setEditing(true); }}
          className="text-xs text-gray-500 underline hover:text-gray-800" data-testid="mobile-edit">
          {current ? "Edit" : "Add mobile"}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="mobile-msg">{msg.text}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1" data-testid="mobile-row">
      <span className="flex items-center gap-2">
        <input type="tel" value={value} onChange={(e) => setValue(e.target.value)} placeholder="04xx xxx xxx" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm" data-testid="mobile-input" />
        <button type="button" disabled={pending} onClick={save}
          className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="mobile-save">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
      </span>
      {msg && !msg.ok && <span className="text-xs text-red-700" data-testid="mobile-msg">{msg.text}</span>}
    </span>
  );
}
