"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOwner, updateDetails, type DetailsResult } from "../../recordActions";

/**
 * P2 — the head of the record: name, phone (tap to call), email, and who owns
 * it, all editable in place. Before P2 the phone and email were fetched and
 * never rendered, and nothing in the CRM could change them.
 */
export type StaffOption = { id: string; name: string };
/** Tom, 8 Sep: the contact address sits with the phone and email, top-left. */
export type RecordAddress = { text: string; more: number };

export default function RecordDetails({ account, staff, initials, address = null }: {
  account: { id: string; name: string | null; email: string | null; phone: string | null; account_type: string; owner_id: string | null };
  staff: StaffOption[];
  initials: string;
  address?: RecordAddress | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name ?? "");
  const [email, setEmail] = useState(account.email ?? "");
  const [phone, setPhone] = useState(account.phone ?? "");
  const [said, setSaid] = useState<DetailsResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const save = () => start(async () => {
    const r = await updateDetails(account.id, { name, email, phone });
    setSaid(r);
    if (r.ok) { setEditing(false); router.refresh(); }
  });

  const changeOwner = (ownerId: string) => start(async () => {
    const r = await setOwner(account.id, ownerId || null);
    setSaid(r);
    if (r.ok) router.refresh();
  });

  const telHref = account.phone ? `tel:${account.phone.replace(/[^0-9+]/g, "")}` : null;

  return (
    <div className="head rhead">
      <span className="avatar">{initials}</span>
      {editing ? (
        <div className="redit" data-testid="record-edit">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus />
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone" inputMode="tel" />
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" inputMode="email" />
          <div className="row">
            <button className="go" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className="chip" disabled={busy} onClick={() => { setEditing(false); setName(account.name ?? ""); setEmail(account.email ?? ""); setPhone(account.phone ?? ""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="rmain">
          <span className="hname">{account.name || account.email || account.phone || "Unnamed"}</span>
          <span className="rcontact">
            {telHref ? <a href={telHref} className="rlink" data-testid="tel-link">{account.phone}</a> : <span className="rmiss">no phone</span>}
            <span className="rsep">·</span>
            {account.email ? <a href={`mailto:${account.email}`} className="rlink">{account.email}</a> : <span className="rmiss">no email</span>}
            <span className="rsep">·</span>
            <span>{account.account_type === "trade" ? "Trade" : "Residential"}</span>
          </span>
          <span className="raddr" data-testid="record-address">
            {address
              ? <>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(address.text)}`} className="rlink" target="_blank" rel="noreferrer" title="Open in Google Maps">{address.text}</a>
                  {address.more > 0 && <><span className="rsep">·</span><a href="#properties" className="rmore">+{address.more} more</a></>}
                </>
              : <span className="rmiss">no address yet</span>}
          </span>
          <span className="rtools">
            <button className="chip sm" onClick={() => setEditing(true)} data-testid="edit-details">Edit details</button>
            <label className="rowner">
              <span>Owner</span>
              <select className="field sm" value={account.owner_id ?? ""} disabled={busy} onChange={(e) => changeOwner(e.target.value)} aria-label="Owner">
                <option value="">Nobody yet</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </span>
        </div>
      )}
      {said && (
        <p className={`said ${said.ok ? "" : "bad"}`} style={{ width: "100%" }}>
          {said.message}
          {!said.ok && said.otherAccountId && <> — <Link href={`/crm/customers/${said.otherAccountId}`}>open that record</Link></>}
        </p>
      )}
    </div>
  );
}
