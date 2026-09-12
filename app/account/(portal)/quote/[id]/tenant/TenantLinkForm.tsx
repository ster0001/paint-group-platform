"use client";

import { useState } from "react";
import { TENANT_ASKS } from "@/lib/portal/tenant-link";
import { sendTenantLink, type SendTenantLinkResult } from "./actions";

export default function TenantLinkForm({ estimateId }: { estimateId: string }) {
  const [phone, setPhone] = useState("");
  const [asks, setAsks] = useState<string[]>(["rooms", "damage"]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendTenantLinkResult | null>(null);

  const toggle = (k: string) => setAsks((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  async function send() {
    setBusy(true);
    const r = await sendTenantLink({ estimateId, phone, askedFor: asks });
    setResult(r); setBusy(false);
  }

  if (result?.ok) {
    return (
      <div className="card" data-testid="tenant-link-sent">
        <span className="chip emerald nodot">{result.smsStatus === "sent" ? "Text sent" : result.smsStatus === "not_configured" || result.smsStatus === "not_sent" ? "Link ready" : "Text not sent"}</span>
        <p className="sub" style={{ marginTop: 8 }}>
          {result.smsStatus === "sent"
            ? "The tenant has the link. Photos land on this property as they come in."
            : "Texting isn't set up on this account yet — copy the link and send it yourself."}
        </p>
        <p style={{ wordBreak: "break-all", fontSize: 13 }} data-testid="tenant-link-url">{result.url}</p>
        <details style={{ marginTop: 8 }}>
          <summary className="sub">What the message says</summary>
          <p className="sub" style={{ marginTop: 6 }} data-testid="tenant-message">{result.message}</p>
        </details>
      </div>
    );
  }

  return (
    <div className="card" data-testid="tenant-link-form">
      <label htmlFor="tenant-phone">Send to</label>
      <input id="tenant-phone" className="field" inputMode="tel" placeholder="Tenant's mobile" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        <div className="sub" style={{ marginBottom: 6 }}>Ask for</div>
        {TENANT_ASKS.map((a) => (
          <label key={a.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}>
            <input type="checkbox" checked={asks.includes(a.key)} onChange={() => toggle(a.key)} /> {a.label}
          </label>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-cyan" onClick={send} disabled={busy} data-testid="send-tenant-link">{busy ? "Sending…" : "Send the link"}</button>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>The message says who we are, why we&rsquo;re asking, and that it&rsquo;s nothing to do with their bond. You can read it before it goes.</p>
      {result && !result.ok && <p className="sub" role="alert" style={{ marginTop: 6 }}>{result.message}</p>}
    </div>
  );
}
