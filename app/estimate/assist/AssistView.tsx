"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerScopeBundle } from "@/lib/wizard/customer-scope";
import type { UiState } from "@/lib/agent/session";
import type { Gap } from "@/lib/agent/schemas";
import ScopeEditor from "../scope/ScopeEditor";
import SidesEditor from "../scope/SidesEditor";
import Wordmark from "@/app/wizard/Wordmark";

type Msg = { id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string };

const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

export default function AssistView({ conversationId, estimateId, disclosure, assistantName, logoUrl, initialTranscript, initialUi, initialBundle }: {
  conversationId: string;
  estimateId: string;
  disclosure: string;
  assistantName: string;
  logoUrl: string | null;
  initialTranscript: Msg[];
  initialUi: UiState;
  initialBundle: CustomerScopeBundle | null;
}) {
  const [transcript, setTranscript] = useState<Msg[]>(initialTranscript);
  const [ui, setUi] = useState<UiState>(initialUi);
  const [bundle, setBundle] = useState<CustomerScopeBundle | null>(initialBundle);
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<"chat" | "estimate">("chat");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [transcript.length, busy]);

  async function send(message: string, answer: { key: string; value: unknown } | null) {
    if (busy) return;
    setBusy(true); setError(null);
    const shown = message.trim() || answerLabel(answer);
    setTranscript((t) => [...t, { id: `local-${Date.now()}`, role: "user", text: shown, createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/agent/turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: message.trim(), answer }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn't go through — try again."); return; }
      setTranscript(j.transcript ?? []);
      setUi(j.ui);
      if (j.bundle) { setBundle(j.bundle); setVersion((v) => v + 1); }
    } catch {
      setError("That didn't go through — check the connection and try again.");
    } finally {
      setBusy(false);
      setText("");
    }
  }

  const gap = ui.nextGap;
  const price = ui.price;
  const th = ui.thresholds;
  const finished = ui.built && !gap;
  const cta = finished && th ? (th.outcome === "self_serve" ? "Accept estimate" : "Confirm my price — book the visit") : null;

  return (
    <div className="as-shell" data-pane={pane}>
      <header className="wz-top as-top">
        <Wordmark logoUrl={logoUrl} />
        <nav className="as-nav">
          <button type="button" className={pane === "chat" ? "on" : ""} onClick={() => setPane("chat")}>Chat</button>
          <button type="button" className={pane === "estimate" ? "on" : ""} onClick={() => setPane("estimate")}>My estimate</button>
          <a className="as-switch" href={`/estimate/scope?id=${estimateId}`}>Fill it in instead</a>
        </nav>
      </header>

      <section className="as-chat" aria-label={assistantName}>
        <p className="as-disclosure">{disclosure}</p>
        <div className="as-log" data-testid="as-log">
          {transcript.map((m) => (
            <div key={m.id} className={`as-msg as-${m.role}`} data-testid={`as-msg-${m.role}`}>
              <p>{m.text}</p>
            </div>
          ))}
          {busy && <div className="as-msg as-assistant as-typing"><p>…</p></div>}
          <div ref={endRef} />
        </div>

        {gap && !busy && !gap.key.startsWith("stop.") && (
          <div className="as-chips" data-gap={gap.key} data-testid="as-chips">
            <Chips gap={gap} onAnswer={(value, label) => send(label ?? "", { key: gap.key, value })} />
          </div>
        )}

        <form className="as-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text, null); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type here…" aria-label="Message" disabled={busy} />
          <button type="submit" disabled={busy || !text.trim()}>Send</button>
          <button type="button" className="as-person" disabled={busy} onClick={() => send("I'd like to talk to a person, please.", null)}>Talk to a person</button>
        </form>
        {error && <p className="as-err" role="alert">{error}</p>}

        <div className="as-range" data-testid="as-range" data-shown={price?.showNumber ? "1" : "0"}>
          {price?.showNumber ? (
            <>
              <small>ESTIMATE · INCL. GST</small>
              <strong>{fmt(price.loCents)} – {fmt(price.hiCents)}</strong>
              {price.assumptions.length > 0 && (
                <ul className="as-chipsline" aria-label="Assumptions">
                  {price.assumptions.map((a) => (
                    <li key={a.key}><button type="button" onClick={() => send(`Let's settle: ${a.label.replace(/^Assumed: /, "")}`, null)}>{a.label}</button></li>
                  ))}
                </ul>
              )}
            </>
          ) : ui.built ? (
            <small>Your range appears once every area is confirmed — {price?.confirmedAreaIds.length ?? 0} confirmed so far.</small>
          ) : (
            <small>Your estimate builds here as you answer.</small>
          )}
          {cta && (
            <button type="button" className="sc-btn il-cta as-cta" data-testid="as-cta" onClick={() => { setPane("estimate"); setTimeout(() => document.querySelector(".sc-stick")?.scrollIntoView({ behavior: "smooth", block: "end" }), 80); }}>
              {cta}
            </button>
          )}
        </div>
      </section>

      <section className="as-editor" aria-label="Your estimate">
        {!bundle && <div className="as-empty"><p>Your estimate builds here as you answer.</p></div>}
        {bundle?.kind === "holding" && <div className="as-empty" data-testid="as-holding"><p>{bundle.line}</p></div>}
        {bundle?.kind === "sides" && (
          <SidesEditor key={version} estimateId={bundle.estimateId} initial={bundle.initial} initialSides={bundle.initialSides} initialExterior={bundle.initialExterior} initialLadder={bundle.initialLadder} docs={bundle.docs} logoUrl={bundle.logoUrl} />
        )}
        {bundle?.kind === "rooms" && (
          <ScopeEditor key={version} estimateId={bundle.estimateId} initial={bundle.initial} initialRooms={bundle.initialRooms} initialSides={bundle.initialSides} initialExterior={bundle.initialExterior} initialLadder={bundle.initialLadder} initialInteriorLoop={bundle.initialInteriorLoop} roomTypes={bundle.roomTypes} liveRange={bundle.liveRange} docs={bundle.docs} logoUrl={bundle.logoUrl} />
        )}
      </section>
    </div>
  );
}

function answerLabel(a: { key: string; value: unknown } | null): string {
  if (!a) return "";
  const v = a.value;
  if (typeof v === "string") return v.replace(/_/g, " ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(String).join(", ") || "None";
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== "" && x != null).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return "Done";
}

// ---- the chips: one component, keyed by the gap's pattern ---------------------------

type ChipsProps = { gap: Gap; onAnswer: (value: unknown, label?: string) => void };

export function Chips({ gap, onAnswer }: ChipsProps) {
  const k = gap.key;
  const one = (opts: Array<[string, unknown]>) => (
    <div className="wz-seg">
      {opts.map(([label, value]) => <button type="button" key={label} onClick={() => onAnswer(value, label)}>{label}</button>)}
    </div>
  );
  if (k === "q.job_type") return one([["Inside", "interior"], ["Outside", "exterior"], ["Both", "both"]]);
  if (k === "q.account_type") return one([["My home", "residential"], ["Business or trade", "trade"]]);
  if (k === "q.property_type") return one([["House", "house"], ["Townhouse", "townhouse"], ["Unit / apartment", "unit_apartment"], ["Commercial", "commercial"]]);
  if (k === "q.storeys" || k === "ext.storeys") return one([["Single storey", "single"], ["Double storey", "double"]]);
  if (k === "q.timing") return one([["Soon", "soon"], ["In the next few months", "1-3 months"], ["Just pricing for now", "just pricing"]]);
  if (k === "q.email") return <TextForm fields={[["email", "you@example.com", "email"]]} submit="Done" onSubmit={(v) => onAnswer(v.email, v.email)} />;
  if (k === "q.address") return <TextForm fields={[["street", "Street", "text"], ["suburb", "Suburb", "text"], ["postcode", "Postcode", "text"]]} submit="Done" onSubmit={(v) => onAnswer(v, `${v.street}, ${v.suburb} ${v.postcode}`)} />;
  if (k === "q.property_flags") return <FlagsForm onSubmit={(v) => onAnswer(v, "Done")} />;
  if (k === "job.surfaces") return <MultiChips options={[["Walls", "walls"], ["Ceilings", "ceilings"], ["Cornices", "cornices"], ["Doors", "doors"], ["Architraves", "architraves"], ["Skirting", "skirting"], ["Windows", "windows"]]} preset={["walls", "ceilings", "doors", "architraves", "skirting"]} onSubmit={(v) => onAnswer(v, v.join(", "))} />;
  if (k === "condition.tier") return one([["Freshen up (same colour)", "fresh"], ["Change of colour", "change"], ["Dark to light", "dark_to_light"]]);
  if (k === "condition.damage") return one([["None", 0], ["A few minor cracks or marks", 1], ["A few areas of concern", 2], ["In real need of repair", 3]]);
  if (k === "condition.photos") return <p className="as-note">Add photos in your estimate (the Plan &amp; photos panel) — then I&apos;ll carry on.</p>;
  if (k === "rooms") return <RoomsForm onSubmit={(v) => onAnswer(v, `${v.bedrooms} bedroom${v.bedrooms === 1 ? "" : "s"}`)} />;
  if (k === "occupied") return one([["Yes, we'll be there", true], ["No, it'll be empty", false]]);
  if (k === "paint.brand") return <MultiChips options={[["Dulux", "dulux"], ["Haymes", "haymes"], ["Taubmans", "taubmans"], ["Porters", "porters"], ["Wattyl", "wattyl"], ["No preference", "unsure"]]} onSubmit={(v) => onAnswer(v, v.join(", "))} />;
  if (k === "paint.colours") return one([["I know the colours", "known"], ["Match what's there / advice", "advice"]]);
  if (k === "door_style") return one([["Flat", "flat"], ["Panelled", "panel"], ["Not sure", "unsure"]]);
  if (k === "window_style") return one([["Casement", "casement"], ["Sash", "sash"], ["Colonial", "colonial"], ["Winder", "winder"], ["Not sure", "unsure"]]);
  if (k === "ceiling_height") return one([["2.4 m", "2.4"], ["2.7 m", "2.7"], ["3.0 m", "3.0"], ["Not sure", "unsure"]]);
  if (/^room\.\d+\.size$/.test(k)) return <SizeForm labels={["Length (m)", "Width (m)"]} keys={["lengthM", "widthM"]} onAnswer={onAnswer} />;
  if (/^room\.\d+\.(cupboards|cupboard_interiors)$/.test(k)) return one([["Yes", true], ["No", false]]);
  if (/^room\.\d+\.anything_else$/.test(k)) return <TextForm fields={[["text", "Anything else in this room?", "text"]]} submit="Add" extra={[["Nothing else", "no"]]} onSubmit={(v) => onAnswer(v.text, v.text)} onExtra={(v) => onAnswer(v, "Nothing else")} />;
  if (/^room\.\d+\.surfaces$/.test(k)) return one([["Looks right", true]]);
  if (/^room\.\d+\.confirm$/.test(k)) return one([["Confirm", true]]);
  if (k === "sweep.dw_totals" || k === "sweep.ext_dw_totals") return one([["Yes, that's right", true], ["Not quite", false]]);
  if (k === "sweep.missed_rooms" || k === "sweep.ext_missed") return <TextForm fields={[["add", "Name what we missed", "text"]]} submit="Add" extra={[["Nothing missed", "none"]]} onSubmit={(v) => onAnswer({ add: v.add }, v.add)} onExtra={(v) => onAnswer(v, "Nothing missed")} />;
  if (k === "ext.photos") return one([["No photos to hand", "none"]]);
  if (k === "ext.substrates") return <MultiChips options={[["Weatherboards", "weatherboards"], ["Render", "render"], ["Brick", "brick"], ["Concrete", "concrete"]]} onSubmit={(v) => onAnswer(v, v.join(", "))} />;
  if (k === "ext.painting") return <PaintingForm onSubmit={(v) => onAnswer(v, "Done")} />;
  if (k === "ext.condition") return one([["Good", "good"], ["Weathered", "weathered"], ["Peeling", "peeling"]]);
  if (k === "ext.access") return <MultiChips options={[["Steep block", "steep"], ["Tight sides", "tight"], ["High", "high"]]} noneLabel="None" onSubmit={(v) => onAnswer(v, v.length ? v.join(", ") : "None")} />;
  if (/^side\.\w+\.include$/.test(k)) return one([["Yes", true], ["No, skip this side", false]]);
  if (/^side\.\w+\.size$/.test(k)) return <SizeForm labels={["Length (m)", "Height (m)"]} keys={["lengthM", "heightM"]} onAnswer={onAnswer} />;
  if (/^side\.\w+\.wall_mix$/.test(k)) return <p className="as-note">Set the wall mix on that side in your estimate on the right, then tell me &quot;done&quot;.</p>;
  if (/^side\.\w+\.confirm$/.test(k)) return one([["Confirm", true]]);
  if (k === "ext.cond_card") return <CondForm onSubmit={(v) => onAnswer(v, "Done")} />;
  if (k === "ext.freestanding") return <MultiChips options={[["Deck", "deck"], ["Fence", "fence"], ["Pergola", "pergola"], ["Balustrade", "balustrade"]]} noneLabel="None" onSubmit={(v) => onAnswer(v.length ? v : "none", v.length ? v.join(", ") : "None")} />;
  if (k.startsWith("stop.")) return null;
  return null;
}

function TextForm({ fields, submit, extra = [], onSubmit, onExtra }: {
  fields: Array<[string, string, string]>; submit: string; extra?: Array<[string, unknown]>;
  onSubmit: (v: Record<string, string>) => void; onExtra?: (v: unknown) => void;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  const ready = fields.every(([name]) => (v[name] ?? "").trim());
  return (
    <form className="as-form" onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(Object.fromEntries(fields.map(([n]) => [n, (v[n] ?? "").trim()]))); }}>
      {fields.map(([name, placeholder, type]) => (
        <input key={name} type={type} placeholder={placeholder} aria-label={placeholder} value={v[name] ?? ""} onChange={(e) => setV((s) => ({ ...s, [name]: e.target.value }))} />
      ))}
      <div className="wz-seg">
        <button type="submit" disabled={!ready}>{submit}</button>
        {extra.map(([label, value]) => <button type="button" key={label} onClick={() => onExtra?.(value)}>{label}</button>)}
      </div>
    </form>
  );
}

function MultiChips({ options, preset = [], noneLabel, onSubmit }: { options: Array<[string, string]>; preset?: string[]; noneLabel?: string; onSubmit: (v: string[]) => void }) {
  const [on, setOn] = useState<Set<string>>(new Set(preset));
  return (
    <div className="as-form">
      <div className="wz-seg">
        {options.map(([label, value]) => (
          <button type="button" key={value} className={on.has(value) ? "on" : ""} aria-pressed={on.has(value)} onClick={() => setOn((s) => { const n = new Set(s); if (n.has(value)) n.delete(value); else n.add(value); return n; })}>{label}</button>
        ))}
      </div>
      <div className="wz-seg">
        <button type="button" onClick={() => onSubmit([...on])} disabled={on.size === 0 && !noneLabel}>Done</button>
        {noneLabel && <button type="button" onClick={() => onSubmit([])}>{noneLabel}</button>}
      </div>
    </div>
  );
}

function FlagsForm({ onSubmit }: { onSubmit: (v: Record<string, string>) => void }) {
  const rows: Array<[string, string]> = [["builtPre1970", "Built before 1970"], ["heritageListed", "Heritage listed"], ["bodyCorporate", "Body corporate"], ["asbestosSuspected", "Asbestos possible"]];
  const [v, setV] = useState<Record<string, string>>({});
  const ready = rows.every(([k]) => v[k]);
  return (
    <div className="as-form">
      {rows.map(([k, label]) => (
        <div key={k} className="as-row" data-flag={k}>
          <span className="wz-qhead">{label}</span>
          <div className="wz-seg">
            {(["yes", "no", "unsure"] as const).map((o) => (
              <button type="button" key={o} className={v[k] === o ? "on" : ""} onClick={() => setV((s) => ({ ...s, [k]: o }))}>{o === "yes" ? "Yes" : o === "no" ? "No" : "Not sure"}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="wz-seg"><button type="button" disabled={!ready} onClick={() => onSubmit(v)}>Done</button></div>
    </div>
  );
}

function RoomsForm({ onSubmit }: { onSubmit: (v: { bedrooms: number; openPlanKitchenLiving: boolean }) => void }) {
  const [beds, setBeds] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="as-form">
      <span className="wz-qhead">Bedrooms</span>
      <div className="wz-seg">{[1, 2, 3, 4, 5, 6].map((n) => <button type="button" key={n} className={beds === n ? "on" : ""} onClick={() => setBeds(n)}>{n}</button>)}</div>
      <div className="wz-seg"><button type="button" className={open ? "on" : ""} aria-pressed={open} onClick={() => setOpen((o) => !o)}>Open-plan kitchen / living</button></div>
      <div className="wz-seg"><button type="button" disabled={beds == null} onClick={() => beds != null && onSubmit({ bedrooms: beds, openPlanKitchenLiving: open })}>Done</button></div>
    </div>
  );
}

function SizeForm({ labels, keys, onAnswer }: { labels: [string, string]; keys: [string, string]; onAnswer: (value: unknown, label?: string) => void }) {
  const [a, setA] = useState(""); const [b, setB] = useState("");
  const ready = Number(a) > 0 && Number(b) > 0;
  return (
    <div className="as-form">
      <div className="wz-seg">
        <button type="button" onClick={() => onAnswer("looks_right", "Looks right")}>Looks right</button>
        <button type="button" onClick={() => onAnswer("not_sure", "Not sure")}>Not sure</button>
      </div>
      <form className="as-inline" onSubmit={(e) => { e.preventDefault(); if (ready) onAnswer({ [keys[0]]: Number(a), [keys[1]]: Number(b) }, `${a} × ${b} m`); }}>
        <input inputMode="decimal" placeholder={labels[0]} aria-label={labels[0]} value={a} onChange={(e) => setA(e.target.value)} />
        <input inputMode="decimal" placeholder={labels[1]} aria-label={labels[1]} value={b} onChange={(e) => setB(e.target.value)} />
        <button type="submit" disabled={!ready}>Set size</button>
      </form>
    </div>
  );
}

function PaintingForm({ onSubmit }: { onSubmit: (v: Record<string, boolean>) => void }) {
  const [v, setV] = useState<Record<string, boolean>>({ body: true, windowsDoors: true, roofline: true, garage: false });
  const rows: Array<[string, string]> = [["body", "Walls"], ["windowsDoors", "Windows & doors"], ["roofline", "Roofline"], ["garage", "Garage door"]];
  return (
    <div className="as-form">
      <div className="wz-seg">{rows.map(([k, label]) => <button type="button" key={k} className={v[k] ? "on" : ""} aria-pressed={v[k]} onClick={() => setV((s) => ({ ...s, [k]: !s[k] }))}>{label}</button>)}</div>
      <div className="wz-seg"><button type="button" onClick={() => onSubmit(v)} disabled={!Object.values(v).some(Boolean)}>Done</button></div>
    </div>
  );
}

function CondForm({ onSubmit }: { onSubmit: (v: { cond: string; rot: string; acc: string }) => void }) {
  const [v, setV] = useState<{ cond?: string; rot?: string; acc?: string }>({});
  const seg = (name: "cond" | "rot" | "acc", heading: string, opts: Array<[string, string]>) => (
    <div className="as-row" data-cond={name}>
      <span className="wz-qhead">{heading}</span>
      <div className="wz-seg">{opts.map(([label, value]) => <button type="button" key={value} className={v[name] === value ? "on" : ""} onClick={() => setV((s) => ({ ...s, [name]: value }))}>{label}</button>)}</div>
    </div>
  );
  const ready = v.cond && v.rot && v.acc;
  return (
    <div className="as-form">
      {seg("cond", "Paintwork", [["Good", "good"], ["Weathered", "weathered"], ["Peeling", "peeling"]])}
      {seg("rot", "Rot", [["No rot", "no"], ["A little", "little"], ["Lots", "lots"]])}
      {seg("acc", "Access", [["None", "none"], ["Steep", "steep"], ["Tight", "tight"], ["High", "high"]])}
      <div className="wz-seg"><button type="button" disabled={!ready} onClick={() => ready && onSubmit(v as { cond: string; rot: string; acc: string })}>Done</button></div>
    </div>
  );
}
