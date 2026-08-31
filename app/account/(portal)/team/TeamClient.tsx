"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember, updateNotificationPrefs } from "./actions";

/**
 * Session 6 · Team (§5.7): the invite form and each member's notification
 * routing. Everything arrives derived from the server page; this only
 * submits.
 */

export type TeamMember = {
  accountUserId: string;
  name: string;
  email: string;
  role: string;
  scopeLabel: string;
  limitLabel: string | null;
  isYou: boolean;
  digest: "default" | "on" | "off";
  digestOnByDefault: boolean;
  digestTime: string; // "17:00"
  approvalsChannel: "email" | "sms" | "both";
  invoicesEmail: string;
};

export function InviteForm({ properties }: { properties: Array<{ id: string; address: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("approver");
  const [scope, setScope] = useState<string[]>([]);
  const [limit, setLimit] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const submit = () => start(async () => {
    setMsg(null);
    const r = await inviteTeamMember({
      email, role,
      propertyIds: scope,
      approvalLimitDollars: limit === "" ? null : Number(limit),
    });
    setMsg(r.ok ? "Invited ✓ — they've been emailed a sign-in link." : r.message);
    if (r.ok) { setEmail(""); setScope([]); setLimit(""); router.refresh(); }
  });

  return (
    <div className="card" data-testid="invite-form">
      <h3 style={{ marginTop: 0 }}>Invite someone</h3>
      <label>Email
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ margin: "6px 0 10px" }} data-testid="invite-email" />
      </label>
      <label>Their access
        <select className="field" value={role} onChange={(e) => setRole(e.target.value)}
          style={{ margin: "6px 0 10px" }} data-testid="invite-role">
          <option value="admin">Admin — everything, including this screen</option>
          <option value="approver">Approver — approves estimates &amp; variations</option>
          <option value="viewer">Viewer — sees progress, approves nothing</option>
          <option value="finance">Finance — invoices and statements only</option>
        </select>
      </label>
      {role !== "finance" && properties.length > 1 && (
        <div style={{ margin: "0 0 10px" }}>
          <span className="sub" style={{ fontSize: 13 }}>Properties (none ticked = all of them)</span>
          {properties.map((p) => (
            <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 14 }}>
              <input type="checkbox" checked={scope.includes(p.id)}
                onChange={(e) => setScope((s) => e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id))}
                data-testid={`invite-scope-${p.id}`} />
              {p.address}
            </label>
          ))}
        </div>
      )}
      {(role === "approver" || role === "admin") && (
        <label>Approval limit, $ <span className="sub" style={{ fontSize: 12 }}>(blank = no limit; going over just warns)</span>
          <input className="field" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)}
            style={{ margin: "6px 0 10px" }} data-testid="invite-limit" />
        </label>
      )}
      <button className="btn btn-cyan" disabled={pending || !email} onClick={submit} data-testid="invite-go">
        Send the invite
      </button>
      {msg && <p className="note" role="status" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

export function MemberPrefs({ m }: { m: TeamMember }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState(m.digest);
  const [time, setTime] = useState(m.digestTime);
  const [channel, setChannel] = useState(m.approvalsChannel);
  const [invoicesEmail, setInvoicesEmail] = useState(m.invoicesEmail);
  const [msg, setMsg] = useState<string | null>(null);

  const save = () => start(async () => {
    setMsg(null);
    const r = await updateNotificationPrefs({
      accountUserId: m.accountUserId, digest, digestTime: time,
      approvalsChannel: channel, invoicesEmail,
    });
    setMsg(r.ok ? "Saved ✓" : r.message);
    if (r.ok) router.refresh();
  });

  if (!open) {
    return <button className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }}
      onClick={() => setOpen(true)} data-testid={`prefs-open-${m.accountUserId}`}>Updates</button>;
  }
  return (
    <div className="card" style={{ marginTop: 8, width: "100%" }} data-testid={`prefs-${m.accountUserId}`}>
      <label>Daily digest
        <select className="field" value={digest} onChange={(e) => setDigest(e.target.value as typeof digest)} style={{ margin: "6px 0 10px" }}>
          <option value="default">Default for their access ({m.digestOnByDefault ? "on, 5 pm" : "off"})</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label>Digest time
        <select className="field" value={time} onChange={(e) => setTime(e.target.value)} style={{ margin: "6px 0 10px" }}>
          {["07:00", "08:00", "12:00", "17:00", "18:00"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Approvals needed
        <select className="field" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} style={{ margin: "6px 0 10px" }}>
          <option value="email">Email, straight away</option>
          <option value="sms">SMS, straight away</option>
          <option value="both">Email + SMS</option>
        </select>
      </label>
      <label>Invoices to <span className="sub" style={{ fontSize: 12 }}>(blank = their own email)</span>
        <input className="field" type="email" value={invoicesEmail} onChange={(e) => setInvoicesEmail(e.target.value)} style={{ margin: "6px 0 10px" }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-cyan" disabled={pending} onClick={save} data-testid={`prefs-save-${m.accountUserId}`}>Save</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
      </div>
      {msg && <p className="note" role="status" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
