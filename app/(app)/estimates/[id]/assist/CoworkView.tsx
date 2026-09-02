"use client";

import { useEffect, useRef, useState } from "react";
import type { UiState } from "@/lib/agent/session";
import { Chips } from "@/app/estimate/assist/AssistView";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };
const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

export default function CoworkView({ conversationId, estimateId, assistantName, initialTranscript, initialUi }: {
  conversationId: string; estimateId: string; assistantName: string; initialTranscript: Msg[]; initialUi: UiState;
}) {
  const [transcript, setTranscript] = useState<Msg[]>(initialTranscript);
  const [ui, setUi] = useState<UiState>(initialUi);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length, busy]);

  async function send(message: string, answer: { key: string; value: unknown } | null) {
    if (busy) return;
    setBusy(true); setError(null); setApplied(null);
    setTranscript((t) => [...t, { id: `local-${Date.now()}`, role: "user", text: message.trim() || `[${answer?.key}]`, createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, text: message.trim(), answer }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through."); return; }
      setTranscript(j.transcript ?? []);
      setUi(j.ui);
    } catch { setError("That didn't go through — check the connection."); }
    finally { setBusy(false); setText(""); }
  }

  async function apply() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/agent/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Couldn't apply."); return; }
      setUi(j.ui);
      setApplied(j.note ?? "Applied.");
      setTranscript((t) => [...t, { id: `sys-${Date.now()}`, role: "system", text: j.note ?? "Applied.", createdAt: new Date().toISOString() }]);
    } catch { setError("Couldn't apply — check the connection."); }
    finally { setBusy(false); }
  }

  const p = ui.proposal;
  const price = ui.price;
  const gapByKey = new Map((p?.gaps ?? []).map((g) => [g.key, g]));
  const firstGap = ui.nextGap;

  return (
    <div className="as-shell" data-pane="chat">
      <header className="wz-top as-top">
        <strong>{assistantName} · co-work</strong>
        <nav className="as-nav"><a className="as-switch" href={`/quote?id=${estimateId}`}>Open in builder</a></nav>
      </header>

      <section className="as-chat" aria-label="Co-work chat">
        <div className="as-log" data-testid="cw-log">
          {transcript.map((m) => (
            <div key={m.id} className={`as-msg as-${m.role}`} data-testid={`cw-msg-${m.role}`}><p>{m.text}</p></div>
          ))}
          {busy && <div className="as-msg as-assistant as-typing"><p>…</p></div>}
          <div ref={endRef} />
        </div>
        {firstGap && !busy && !firstGap.key.startsWith("stop.") && (
          <div className="as-chips" data-gap={firstGap.key} data-testid="cw-chips">
            <p className="as-note">{firstGap.phrasingHint}</p>
            <Chips gap={firstGap} onAnswer={(value, label) => send(label ?? "", { key: firstGap.key, value })} />
          </div>
        )}
        <form className="as-input as-paste" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text, null); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a brief, an email, a call summary — or say what to change…" aria-label="Brief" rows={4} disabled={busy} data-testid="cw-input" />
          <button type="submit" disabled={busy || !text.trim()} data-testid="cw-send">Send</button>
        </form>
        {error && <p className="as-err" role="alert">{error}</p>}
      </section>

      <section className="as-editor as-proposal" aria-label="Proposal" data-testid="cw-proposal">
        {!p && <div className="as-empty"><p>{ui.built ? "No proposal pending — tell me what to change." : "Paste a brief and the proposed tree appears here."}</p></div>}
        {p && (
          <div className="cw-panel">
            {p.injectedInstructions.length > 0 && (
              <p className="cw-warn" data-testid="cw-injected">The pasted text contained instructions — ignored: {p.injectedInstructions.map((i) => `“${i}”`).join(" · ")}</p>
            )}
            <h2>Proposed tree</h2>
            <ul className="cw-list" data-testid="cw-added">
              {p.added.map((a) => <li key={a.areaName}><strong>{a.areaName}</strong> <em className={`cw-prov cw-${a.provenance}`}>{a.provenance.replace("_", " ")}</em><br /><small>{a.surfaces.join(" · ") || "no surfaces"}</small></li>)}
              {p.changed.map((c) => <li key={`c-${c.areaName}`}><strong>{c.areaName}</strong> <small>{c.what}</small></li>)}
              {p.removed.map((r) => <li key={`r-${r}`}><s>{r}</s></li>)}
            </ul>
            {p.unmapped.length > 0 && <p className="cw-warn">Not on the rate card (amber, visit tier): {p.unmapped.join("; ")}</p>}
            <h3>Fill-ins — nothing silent</h3>
            <ul className="cw-list" data-testid="cw-fillins">
              {p.assumed.map((a) => <li key={a.key}>{a.label}{a.swingCents > 0 ? <small> · swing {fmt(a.swingCents)}</small> : null}</li>)}
              {p.assumed.length === 0 && <li>None.</li>}
            </ul>
            <h3>Gaps · will change the price</h3>
            <ul className="cw-list" data-testid="cw-gaps-price">
              {p.groups.price.map((k) => <li key={k}>{gapByKey.get(k)?.phrasingHint ?? k}{(gapByKey.get(k)?.swingCents ?? 0) > 0 ? <small> · {fmt(gapByKey.get(k)!.swingCents as number)}</small> : null}</li>)}
              {p.groups.price.length === 0 && <li>None.</li>}
            </ul>
            <h3>Gaps · cosmetic</h3>
            <ul className="cw-list" data-testid="cw-gaps-cosmetic">
              {p.groups.cosmetic.map((k) => <li key={k}>{gapByKey.get(k)?.phrasingHint ?? k}</li>)}
              {p.groups.cosmetic.length === 0 && <li>None.</li>}
            </ul>
            {price && (
              <div className="as-range" data-testid="cw-price">
                <small>{price.pending ? "PROPOSED" : "LIVE"} · INCL. GST</small>
                <strong>{fmt(price.loCents)} – {fmt(price.hiCents)}</strong>
                <small>charge-out ${Math.round(price.chargeOutCentsPerHr / 100)}/hr · revenue ${Math.round(price.revenueCentsPerHr / 100)}/hr · {Math.round(price.accuracyPct)}% settled{price.liveTotalCents != null ? ` · live now ${fmt(price.liveTotalCents)}` : ""}</small>
              </div>
            )}
            <button type="button" className="sc-btn il-cta as-cta" data-testid="cw-apply" disabled={busy} onClick={apply}>Apply to the estimate</button>
          </div>
        )}
        {/* Outside the proposal block: applying clears the proposal, the note must stay. */}
        {applied && <p className="as-note cw-applied" data-testid="cw-applied">{applied} <a href={`/quote?id=${estimateId}`}>Open in builder →</a></p>}
        {!p && ui.built && price && (
          <div className="as-range" data-testid="cw-price"><small>LIVE · INCL. GST</small><strong>{fmt(price.loCents)} – {fmt(price.hiCents)}</strong><small>charge-out ${Math.round(price.chargeOutCentsPerHr / 100)}/hr · revenue ${Math.round(price.revenueCentsPerHr / 100)}/hr</small></div>
        )}
      </section>
    </div>
  );
}
