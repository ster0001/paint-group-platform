"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import PhotoZoom from "./PhotoZoom";
import { track, type MarketingEventName } from "@/lib/analytics";
import { showcaseMediaUrl } from "@/lib/showcase/format";

/**
 * §4.5 — four selectable rows (role=tab) and one dark panel (role=tabpanel)
 * with the artefact for the selected promise, ported from the prototype's
 * P[] array. Arrow keys move between rows; the panel is announced
 * (aria-live). Approving the variation flips the pill, disables the button
 * and shows the prototype's toast copy. Nothing here mentions remote or
 * absent sign-off (ruling: never advertised). Default row is 0.
 *
 * Layout (Tom, 5 Sep): the panel is rendered straight after the SELECTED
 * row, so on a phone it opens under the row you tapped (an accordion) and
 * the other rows stay within reach. On desktop the grid places the panel in
 * the right-hand column spanning all four rows, whatever its DOM position,
 * so the two-column look of the prototype is unchanged.
 */
const ROWS = [
  { b: "No surprises on the invoice", s: "Extra work is priced and approved by you before it starts." },
  { b: "A price a person signs off with you", s: "Your range tightens as you go, then we confirm it together before anything is booked." },
  { b: "You sign off before you pay", s: "The final invoice waits for your walkthrough." },
  { b: "2-year warranty, $20M insured", s: "Both documents sit in your portal from day one." },
];

const H = [
  "Your painter finds rotten timber behind the fascia. Here's what happens next.",
  "Your range gets tighter with every answer. Then we sign it off together.",
  "The last day on site is a walkthrough with you, area by area.",
  "Both documents are in your portal the day you accept.",
];
const NOTE = [
  "Declined variations are recorded on your completion report. Nothing lands on the invoice that you didn't tap Approve on.",
  "Every price is signed off by one of our people before it's booked: a call for apartments, units and smaller jobs, a visit for larger or older homes. What we sign off together is what goes on the invoice.",
  "The walkthrough is done with you, on site. Flagged items are fixed first; the invoice follows your signature.",
  "Six months from now you'll want to know which white is on the hallway. It's here.",
];

const muted = { color: "var(--color-muted)" } as const;

export default function PromiseExplorer({ variationPhotos = [] }: { variationPhotos?: string[] }) {
  const [i, setI] = useState(0);
  const [approved, setApproved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Phone only, and only after a TAP (never on first paint — that scrolled
  // the whole page down to this section on load): the panel sits under the
  // row; if its top or bottom is off-screen, nudge it into view by the
  // nearest edge, so the row you tapped stays put.
  const nudge = useRef(false);
  useEffect(() => {
    if (!nudge.current) return;
    nudge.current = false;
    if (typeof window === "undefined" || window.innerWidth >= 900) return;
    const el = panelRef.current;
    if (!el) return;
    const t = window.setTimeout(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [i]);

  function select(n: number, focus = false) {
    nudge.current = true;
    setI(n);
    track(`promise_${n}` as MarketingEventName);
    if (focus) tabs.current[n]?.focus();
  }
  function onKey(e: React.KeyboardEvent, n: number) {
    const last = ROWS.length - 1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); select(n === last ? 0 : n + 1, true); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(n === 0 ? last : n - 1, true); }
    else if (e.key === "Home") { e.preventDefault(); select(0, true); }
    else if (e.key === "End") { e.preventDefault(); select(last, true); }
  }
  function showToast(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }
  function approve() {
    setApproved(true);
    showToast("Approved. Felipe gets the go-ahead and $486 is added to your fixed price.");
  }

  const cards: ReactNode[] = [
    <>
      <div className="row"><span className="mono" style={muted}>Variation #2 · 12 Elm St</span><span className={`pill${approved ? " green" : ""}`} data-testid="variation-pill">{approved ? "Approved" : "Waiting for you"}</span></div>
      <b>Replace 2.4 m of rotten fascia board, prime and paint to match</b>
      <div className="ph">
        {[0, 1].map((i) => variationPhotos[i]
          ? <PhotoZoom key={i} className="ph-img" src={showcaseMediaUrl(variationPhotos[i])} alt={`Variation photo ${i + 1}`} width={120} height={84} />
          : <i key={i} data-todo="site-photos" />)}
      </div>
      <div className="row"><span><span className="mono" style={muted}>Extra, inc. GST</span><br /><span className="money">+ $486</span></span><span style={{ color: "var(--color-muted)", fontSize: 14 }}>Work won&rsquo;t start until you approve</span></div>
      <div className="btns">
        <button type="button" className={`btn btn-cyan${approved ? " approved" : ""}`} onClick={approve} disabled={approved} data-testid="approve-variation">{approved ? "Approved ✓" : "Approve $486"}</button>
        <button type="button" className="btn btn-ghost">Ask a question</button>
      </div>
    </>,
    <>
      <div className="row"><span className="mono" style={muted}>Estimate · 12 Elm St</span><span className="pill">Ready to confirm</span></div>
      <div style={{ display: "grid", gap: 8, fontSize: 15 }}>
        <div className="row"><span style={muted}>After your address</span><span className="mono" style={muted}>$6,000 – $12,000</span></div>
        <div className="row"><span style={muted}>After room sizes</span><span className="mono" style={muted}>$8,000 – $10,400</span></div>
        <div className="row"><span>After doors, windows and photos</span><span className="money">$8,400 – $9,600</span></div>
      </div>
      <span style={{ color: "var(--color-muted)", fontSize: 14 }}>4 rooms + hallway · walls, ceilings, trim · 2 coats · apartment. We can confirm this one on the phone</span>
      <div className="btns"><button type="button" className="btn btn-cyan">Confirm my price. Book a call</button></div>
    </>,
    <>
      <div className="row"><span className="mono" style={muted}>Walkthrough · Fri 5 Sep</span><span className="pill">In progress</span></div>
      <div style={{ display: "grid", gap: 6, fontSize: 15 }}>
        <div className="row"><span>Living room</span><span className="done">Approved</span></div>
        <div className="row"><span>Hallway</span><span className="done">Approved</span></div>
        <div className="row"><span>Main bedroom</span><span style={{ color: "var(--color-amber)" }}>Flagged · scuff by door</span></div>
        <div className="row"><span>Bedroom 2 · Kitchen</span><span style={muted}>Not yet checked</span></div>
      </div>
      <span style={{ color: "var(--color-muted)", fontSize: 14 }}>Flagged items are fixed before you sign. Final invoice is issued only after your signature.</span>
      <div className="btns"><button type="button" className="btn btn-ghost" disabled style={{ opacity: .5 }}>Sign off (1 item open)</button></div>
    </>,
    <>
      <div className="row"><span className="mono" style={muted}>Documents · 12 Elm St</span></div>
      <div style={{ display: "grid", gap: 8, fontSize: 15 }}>
        <div className="row"><span>Workmanship warranty · 2 years from sign-off</span><span className="mono" style={{ color: "var(--color-cyan)" }}>PDF</span></div>
        <div className="row"><span>Public liability certificate · $20M</span><span className="mono" style={{ color: "var(--color-cyan)" }}>PDF</span></div>
        <div className="row"><span>Colour schedule · what went where</span><span className="mono" style={{ color: "var(--color-cyan)" }}>PDF</span></div>
        <div className="row"><span>Completion report · signed</span><span className="pill grey">After sign-off</span></div>
      </div>
    </>,
  ];

  const panel = (
    <div ref={panelRef} className="panel" id="promise-panel" role="tabpanel" aria-labelledby={`promise-tab-${i}`} aria-live="polite" data-testid="promise-panel">
      <span className="mono" style={{ color: "var(--color-cyan)" }}>What this looks like in your job</span>
      <h3>{H[i]}</h3>
      <div className="pcard">{cards[i]}</div>
      <p className="note">{NOTE[i]}</p>
    </div>
  );

  return (
    <div className="promise" role="tablist" aria-label="Our promise" aria-orientation="vertical">
      {ROWS.map((r, n) => (
        <Fragment key={r.b}>
          <button
            ref={(el) => { tabs.current[n] = el; }} type="button" role="tab" id={`promise-tab-${n}`}
            aria-selected={i === n} aria-controls="promise-panel" tabIndex={i === n ? 0 : -1}
            className="prow" data-p={n} data-ev={`promise_${n}`} style={{ gridRow: n + 1 }}
            onClick={() => select(n)} onKeyDown={(e) => onKey(e, n)}
          >
            <span className="bar" /><span className="t"><b>{r.b}</b><small>{r.s}</small></span>
          </button>
          {i === n && panel}
        </Fragment>
      ))}
      <div className={`toast${toast ? " on" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
