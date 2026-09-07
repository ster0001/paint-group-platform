"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomer } from "../recordActions";

/**
 * P2 — quick add: a name and a phone is enough (decision 8.2). The RPC finds
 * an existing record by email or phone first, so a second enquiry from the
 * same mobile opens the customer you already have instead of a duplicate.
 */
export default function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const submit = () => start(async () => {
    const r = await createCustomer({ name, email, phone });
    if (!r.ok) { setError(r.message); return; }
    router.push(`/crm/customers/${r.id}${r.existed ? "?found=1" : "?new=1"}`);
  });

  if (!open) {
    return <button className="chip" onClick={() => setOpen(true)} data-testid="quick-add">+ New customer</button>;
  }
  return (
    <div className="quickadd" data-testid="quick-add-form">
      <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <input className="field" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" inputMode="tel"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <input className="field" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" inputMode="email"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <button className="go" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add"}</button>
      <button className="chip" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
      {error && <span className="said bad">{error}</span>}
    </div>
  );
}
