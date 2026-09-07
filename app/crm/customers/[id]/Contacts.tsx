"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeContact, saveContact, type ContactInput } from "../../recordActions";
import { CONTACT_ROLES } from "../../recordTypes";
import type { CrmResult } from "../../actions";

/**
 * P2 — everyone on the account. The primary row is the account itself (edited
 * in the head); the rest are the partner, the agent, the tenant, the site
 * contact. Matched by email and phone, so a reply from any of them lands here.
 */
export type ContactRow = {
  id: string; name: string | null; role: string; email: string | null; phone: string | null;
  preferred_channel: string | null; is_primary: boolean; notes: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  primary: "Primary", partner: "Partner", tenant: "Tenant", agent: "Agent", site: "Site contact", accounts: "Accounts", other: "Other",
};

const blank: ContactInput = { id: null, name: "", role: "partner", email: "", phone: "", preferred: "", notes: "" };

export default function Contacts({ accountId, contacts }: { accountId: string; contacts: ContactRow[] }) {
  const [form, setForm] = useState<ContactInput | null>(null);
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const submit = () => start(async () => {
    if (!form) return;
    const r = await saveContact(accountId, form);
    setSaid(r);
    if (r.ok) { setForm(null); router.refresh(); }
  });
  const remove = (id: string) => start(async () => {
    if (!window.confirm("Remove this contact?")) return;
    const r = await removeContact(accountId, id);
    setSaid(r);
    if (r.ok) router.refresh();
  });

  return (
    <div className="contacts" data-testid="contacts">
      {contacts.map((c) => (
        <div key={c.id} className="crow">
          <span className="cwho">
            <b>{c.name || c.email || c.phone || "Unnamed"}</b>
            <i className="cchip">{ROLE_LABEL[c.role] ?? c.role}</i>
            {c.preferred_channel && <i className="cchip">prefers {c.preferred_channel}</i>}
          </span>
          <span className="chow">
            {c.phone && <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="rlink">{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="rlink">{c.email}</a>}
            {c.notes && <span className="cnotes">{c.notes}</span>}
          </span>
          {!c.is_primary && (
            <span className="cact">
              <button className="chip sm" disabled={busy} onClick={() => setForm({ id: c.id, name: c.name ?? "", role: c.role, email: c.email ?? "", phone: c.phone ?? "", preferred: (c.preferred_channel as ContactInput["preferred"]) ?? "", notes: c.notes ?? "" })}>Edit</button>
              <button className="chip sm ghost" disabled={busy} onClick={() => remove(c.id)}>Remove</button>
            </span>
          )}
        </div>
      ))}

      {form ? (
        <div className="cform" data-testid="contact-form">
          <input className="field" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Contact name" autoFocus />
          <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
            {CONTACT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input className="field" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-label="Contact phone" inputMode="tel" />
          <input className="field" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Contact email" inputMode="email" />
          <select className="field" value={form.preferred} onChange={(e) => setForm({ ...form, preferred: e.target.value as ContactInput["preferred"] })} aria-label="Preferred channel">
            <option value="">Any channel</option>
            <option value="phone">Prefers phone</option>
            <option value="sms">Prefers SMS</option>
            <option value="email">Prefers email</option>
          </select>
          <input className="field" placeholder="Notes — e.g. only after 5pm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} aria-label="Contact notes" />
          <div className="row">
            <button className="go" disabled={busy} onClick={submit}>{busy ? "Saving…" : form.id ? "Save" : "Add"}</button>
            <button className="chip" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="chip" onClick={() => setForm({ ...blank })} data-testid="add-contact">+ Another person on this account</button>
      )}
      {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
    </div>
  );
}
