"use client";

import { useMemo, useState, useTransition } from "react";
import {
  BLOCK_MENU, blankBlock, renderEmail, templateWarnings,
  type Block, type BlockKind, type Template,
} from "@/lib/campaigns/blocks";
import { approveTemplate, saveTemplate, sendTestEmail, writeWithAi } from "../../actions";

/**
 * The studio (session 3.5).
 *
 * Two columns: what you are writing, and what it will look like. The preview is
 * the REAL renderer in an iframe, not an approximation — an email builder whose
 * preview lies is worse than no preview, because it is believed.
 *
 * Nothing here can send. The only outward-facing action is "mark as read", and
 * even that just stamps a column the sending session will check.
 */
export default function Studio({ id, initialName, initialTemplate, approvedAt, segment, brand }: {
  id: string;
  initialName: string;
  initialTemplate: Template;
  approvedAt: string | null;
  segment: { key: string; name: string; description: string } | null;
  brand: { companyName: string; logoUrl: string | null };
}) {
  const [name, setName] = useState(initialName);
  const [t, setT] = useState<Template>(initialTemplate);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [approved, setApproved] = useState<string | null>(approvedAt);
  const [busy, start] = useTransition();
  const [showAi, setShowAi] = useState(t.blocks.length === 0);

  // The AI panel's inputs.
  const [goal, setGoal] = useState("");
  const [facts, setFacts] = useState("");
  const [ctaUrl, setCtaUrl] = useState("https://paintgroup.com.au/estimate");
  const [tone, setTone] = useState<"warm" | "plain" | "brief">("warm");

  const html = useMemo(() => renderEmail(t, {
    ink: "#12161A", text: "#333B42", muted: "#6B747C", line: "#E4E8EB",
    paper: "#FFFFFF", wash: "#F6F8F9", accent: "#2FB9CB", onAccent: "#FFFFFF",
    companyName: brand.companyName, logoUrl: brand.logoUrl,
  }), [t, brand]);

  const warnings = useMemo(() => templateWarnings(t), [t]);

  const patch = (i: number, next: Partial<Block>) =>
    setT((cur) => ({ ...cur, blocks: cur.blocks.map((b, n) => (n === i ? { ...b, ...next } as Block : b)) }));
  const move = (i: number, by: number) => setT((cur) => {
    const to = i + by;
    if (to < 0 || to >= cur.blocks.length) return cur;
    const blocks = [...cur.blocks];
    [blocks[i], blocks[to]] = [blocks[to], blocks[i]];
    return { ...cur, blocks };
  });
  const remove = (i: number) => setT((cur) => ({ ...cur, blocks: cur.blocks.filter((_, n) => n !== i) }));
  const add = (kind: BlockKind) => setT((cur) => ({ ...cur, blocks: [...cur.blocks, blankBlock(kind)] }));

  const field = (label: string, value: string, onChange: (v: string) => void, long = false) => (
    <label className="bfield">
      <span>{label}</span>
      {long
        ? <textarea className="field" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className="field" value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );

  const editor = (b: Block, i: number) => {
    switch (b.kind) {
      case "hero": return (<>
        {field("Headline", b.headline, (v) => patch(i, { headline: v }))}
        {field("Underneath", b.sub, (v) => patch(i, { sub: v }))}
      </>);
      case "text": return field("Words", b.body, (v) => patch(i, { body: v }), true);
      case "photo": return (<>
        {field("Photo link", b.imageUrl, (v) => patch(i, { imageUrl: v }))}
        {field("Caption", b.caption, (v) => patch(i, { caption: v }))}
      </>);
      case "beforeAfter": return (<>
        {field("Before photo", b.beforeUrl, (v) => patch(i, { beforeUrl: v }))}
        {field("After photo", b.afterUrl, (v) => patch(i, { afterUrl: v }))}
        {field("Caption", b.caption, (v) => patch(i, { caption: v }))}
      </>);
      case "bullets": return (<>
        {field("Heading", b.heading, (v) => patch(i, { heading: v }))}
        {b.items.map((item, n) => (
          <div className="row" key={n} style={{ marginTop: 6 }}>
            <input className="field" value={item} placeholder={`Point ${n + 1}`}
              onChange={(e) => patch(i, { items: b.items.map((x, m) => (m === n ? e.target.value : x)) })} />
            {b.items.length > 1 && (
              <button className="chip" onClick={() => patch(i, { items: b.items.filter((_, m) => m !== n) })}>Remove</button>
            )}
          </div>
        ))}
        <button className="chip" style={{ marginTop: 7 }} onClick={() => patch(i, { items: [...b.items, ""] })}>+ Another point</button>
      </>);
      case "quote": return (<>
        {field("What they said", b.body, (v) => patch(i, { body: v }), true)}
        {field("Who said it", b.attribution, (v) => patch(i, { attribution: v }))}
      </>);
      case "button": return (<>
        {field("Button says", b.label, (v) => patch(i, { label: v }))}
        {field("Goes to", b.url, (v) => patch(i, { url: v }))}
        {field("Small print under it", b.note, (v) => patch(i, { note: v }))}
      </>);
      case "offer": return (<>
        {field("The offer", b.headline, (v) => patch(i, { headline: v }))}
        {field("Detail", b.detail, (v) => patch(i, { detail: v }), true)}
        {field("Ends on", b.expiresOn, (v) => patch(i, { expiresOn: v }))}
      </>);
      case "signoff": return (<>
        {field("Sign-off", b.body, (v) => patch(i, { body: v }), true)}
        {field("From", b.name, (v) => patch(i, { name: v }))}
      </>);
      case "divider": return <p className="bhint">A line and some space. Nothing to fill in.</p>;
    }
  };

  return (
    <div className="studio">
      <div className="studioside">
        <div className="row">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this email" />
          <button className="go" disabled={busy} onClick={() => start(async () => setSaid(await saveTemplate(id, name, t)))}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {segment && <p className="bhint" style={{ marginTop: 8 }}>Writing to: <b>{segment.name}</b> — {segment.description}</p>}

        <div className="panel" style={{ marginTop: 14 }}>
          <p className="plabel">The inbox line</p>
          {field("Subject", t.subject, (v) => setT({ ...t, subject: v }))}
          {field("Preview text", t.preheader, (v) => setT({ ...t, preheader: v }))}
        </div>

        <button className="aitoggle" onClick={() => setShowAi((s) => !s)}>
          {showAi ? "Hide the writer" : "✎ Have it written for me"}
        </button>

        {showAi && (
          <div className="panel ai">
            <p className="plabel">Write it for me</p>
            {field("What is this email for?", goal, setGoal, true)}
            <label className="bfield">
              <span>Facts it may use — one per line. It cannot say anything that isn&rsquo;t here.</span>
              <textarea className="field" rows={3} value={facts} onChange={(e) => setFacts(e.target.value)}
                placeholder={"Seven-year warranty on exterior work\nWe've painted in Malvern since 2015"} />
            </label>
            {field("Button goes to", ctaUrl, setCtaUrl)}
            <div className="chips" style={{ marginTop: 8 }}>
              {(["warm", "plain", "brief"] as const).map((v) => (
                <button key={v} className={`chip ${tone === v ? "on" : ""}`} onClick={() => setTone(v)}>{v}</button>
              ))}
            </div>
            <button
              className="go"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() => start(async () => {
                const r = await writeWithAi({ goal, segmentKey: segment?.key ?? null, facts, ctaUrl, tone, existing: t.blocks.length ? t : null });
                setSaid(r);
                if (r.ok && r.data) {
                  setT(r.data.template);
                  setAiWarnings(r.data.warnings);
                  setShowAi(false);
                }
              })}
            >
              {busy ? "Writing…" : t.blocks.length ? "Rewrite this draft" : "Write a draft"}
            </button>
            <p className="bhint" style={{ marginTop: 8 }}>
              It fills the same blocks you would. Nothing is saved until you press Save.
            </p>
          </div>
        )}

        {aiWarnings.length > 0 && (
          <div className="partial" style={{ marginTop: 14 }}>
            <b>Check these before this goes anywhere:</b>
            <ul>{aiWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <p className="plabel" style={{ marginTop: 18 }}>The email</p>
        {t.blocks.length === 0 && <p className="empty">Empty. Add a block below, or have it written.</p>}

        {t.blocks.map((b, i) => (
          <div className="bcard" key={i}>
            <div className="bhead">
              <span className="bkind">{BLOCK_MENU.find((m) => m.kind === b.kind)?.label ?? b.kind}</span>
              <button className="bbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="bbtn" onClick={() => move(i, 1)} disabled={i === t.blocks.length - 1} aria-label="Move down">↓</button>
              <button className="bbtn" onClick={() => remove(i)} aria-label="Remove">×</button>
            </div>
            {editor(b, i)}
          </div>
        ))}

        <p className="plabel" style={{ marginTop: 16 }}>Add</p>
        <div className="chips">
          {BLOCK_MENU.map((m) => (
            <button key={m.kind} className="chip" title={m.hint} onClick={() => add(m.kind)}>+ {m.label}</button>
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="partial" style={{ marginTop: 16 }}>
            <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="go" disabled={busy} onClick={() => start(async () => setSaid(await saveTemplate(id, name, t)))}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="chip" disabled={busy} onClick={() => start(async () => {
            setSaid(await sendTestEmail(id));
          })}>
            Send a test to me
          </button>
          <button className="chip" disabled={busy} onClick={() => start(async () => {
            const r = await approveTemplate(id);
            setSaid(r);
            if (r.ok) setApproved(new Date().toISOString());
          })}>
            {approved ? "Approved ✓" : "I've read it — approve"}
          </button>
        </div>
        {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
      </div>

      <div className="studiopreview">
        <p className="plabel">What they&rsquo;ll see</p>
        <iframe title="Email preview" className="preview" srcDoc={html} sandbox="" />
        <p className="bhint">
          The real renderer, not an impression of it — this is the HTML that would be sent.
        </p>
      </div>
    </div>
  );
}
