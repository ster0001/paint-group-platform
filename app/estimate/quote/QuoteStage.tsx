"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPayload } from "@/lib/wizard/view";
import type { RoomLoopView } from "@/lib/wizard/rooms-loop";
import type { SiteAccess } from "@/lib/wizard/site-access";
import type { Estimator } from "@/lib/wizard/estimator";
import type { WizardBrand } from "@/lib/wizard/brand";
import { assertCustomerShape } from "@/lib/wizard/contract";
import { breakpointNow, sendWizardEvent } from "@/lib/wizard/wizardEvents";
import { quoteCards, quoteProgress, typicalRoomNames, type GeneralAnswers, type GeneralCard, type MeasureCard, type QuoteRoom } from "@/lib/quote/cards";
import { quoteDocument, quoteSummary, type PreparedFor, type QuoteDocument, type QuoteLine } from "@/lib/quote/quote";
import { useRollerSweep } from "@/app/wizard/pictures/rollerSweep";
import { DOOR_DRAWINGS, WINDOW_DRAWINGS } from "@/app/estimate/scope/StyleTiles";
import Wordmark from "@/app/wizard/Wordmark";
import MobileContact from "@/app/wizard/MobileContact";

/**
 * QUOTE STAGE v10 — the shell and the cards (brief §2 mobile, §3; the
 * prototype wins). Session 1 — the skeleton: header (back · logo · Contact),
 * the bar from 55% to 100%, the whole-house cards (single choices advancing
 * themselves ~300ms after the tap, the door and window drawings on their
 * tiles), the measure card per room (typed numbers over greyed typicals —
 * R2; "That's the size" writes `room_dims`, "Not sure" writes
 * `room_size_ok`), a first done screen (the range, which rooms stayed
 * typical, Book <estimator>), and the events of §7. Every answer is one of
 * the scope page's own `wizard-edit` actions (R0): the server re-prices and
 * answers with the same customer payload the scope page draws; this file
 * computes nothing about money. The quote document, the price band, the
 * three other room cards, the drawing, the floorplan and the desktop
 * format are sessions 2–6.
 */
type Payload = CustomerPayload & { interiorLoop?: { rooms: RoomLoopView[] } | null; error?: string; outcome?: string; message?: string };
const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
const DRAWING: Record<NonNullable<GeneralCard["options"][number]["drawing"]>, ReactNode> = {
  "door-panel": DOOR_DRAWINGS.panel, "door-flat": DOOR_DRAWINGS.flat,
  "win-casement": WINDOW_DRAWINGS.casement, "win-sash": WINDOW_DRAWINGS.sash, "win-colonial": WINDOW_DRAWINGS.colonial, "win-winder": WINDOW_DRAWINGS.winder,
};

export default function QuoteStage({ brand, estimateId, initial, initialRooms, initialCornices, initialAccess, logoUrl, estimator, companyPhone, customerSuburb, preparedFor, quoteNo, quoteDate }: {
  brand: WizardBrand;
  estimateId: string;
  initial: CustomerPayload;
  initialRooms: QuoteRoom[];
  initialCornices: "none" | "standard" | "decorative" | null;
  initialAccess: { answers: SiteAccess; asksLift: boolean };
  logoUrl: string | null;
  estimator: Estimator;
  companyPhone: string | null;
  customerSuburb: string | null;
  /** §5: the quote document's prepared-for block, its number and its date. */
  preparedFor: PreparedFor;
  quoteNo: string;
  quoteDate: string;
}) {
  const router = useRouter();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [payload, setPayload] = useState<Payload>(initial);
  const [rooms, setRooms] = useState<QuoteRoom[]>(initialRooms);
  const [general, setGeneral] = useState<GeneralAnswers>({ cornices: initialCornices });
  const [access, setAccess] = useState<SiteAccess>(initialAccess.answers);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const cards = quoteCards({ jobKind: "interior", general, heightUnconfirmed: payload.heightUnconfirmed, access, asksLift: initialAccess.asksLift, rooms });
  const current = cards[Math.min(index, cards.length - 1)];
  const pct = quoteProgress(index, cards.length);
  const who = estimator.name?.trim().split(/\s+/)[0] ?? "your estimator";
  // §5 (R4): the quote writes itself — the document, the tile's words and the band's share, all from the server's payload.
  const generalToGo = cards.filter((c) => c.kind === "general" && c.value == null).length;
  const doc = quoteDocument({ payload, rooms, preparedFor, number: quoteNo, date: quoteDate, generalToGo });
  const summary = quoteSummary(rooms, generalToGo);
  const settled = payload.confirmedShare ?? summary.settledShare;
  const currentAreaId = current.kind === "measure" ? current.areaId : null;

  // §7: the stage viewed once, the done screen once.
  useEffect(() => { sendWizardEvent("quote_stage_viewed", { job_kind: "interior", lines: initialRooms.length, breakpoint: breakpointNow() }); }, [initialRooms.length]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [current.id]);

  /** One whitelisted action to the scope page's own route; the server's payload comes back and is the truth. */
  const act = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, view: "customer" }),
      });
      const j = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) { setError(j.error ?? "That didn't save — try again."); return false; }
      assertCustomerShape(j, "QuoteStage");
      if (typeof j.outcome === "string" && j.outcome !== "reveal") { setError(j.message ?? "That change needs one of our team — we'll be in touch."); return false; }
      setPayload(j);
      if (j.interiorLoop?.rooms) {
        const loop = j.interiorLoop.rooms;
        setRooms((rs) => rs.map((r) => { const l = loop.find((x) => x.areaId === r.areaId); return l ? { ...r, lengthM: l.lengthM, widthM: l.widthM, heightM: l.heightM, size: l.size, confirmed: l.confirmed } : r; }));
      }
      return true;
    } catch {
      setError("That didn't save — check your connection and try again.");
      return false;
    } finally { setBusy(false); }
  }, [estimateId]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const advance = () => setIndex((i) => Math.min(i + 1, cards.length - 1));
  const back = () => { if (timer.current) clearTimeout(timer.current); if (index > 0) setIndex(index - 1); else router.back(); };

  // A: a single choice — the answer is kept locally for the pre-select, written through the action, and the card moves on ~300ms later.
  const pickGeneral = (card: GeneralCard, value: string) => {
    const o = card.options.find((x) => x.value === value);
    if (!o) return;
    setGeneral((g) => ({ ...g, [card.key]: value }));
    if (o.action.action === "set_site_access") setAccess((a) => ({ ...a, [String(o.action.field)]: o.action.value }));
    void act(o.action);
    sendWizardEvent("quote_card_answered", { card: card.key, line: null, measured: false });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(advance, 300);
  };

  // F: Book <who> to confirm it — the visit page, the one door of the done screen (and Contact's).
  const book = () => { sendWizardEvent("quote_book_clicked", {}); router.push(`/estimate/visit?id=${estimateId}`); };
  useEffect(() => {
    if (current.kind !== "done") return;
    const typical = typicalRoomNames(rooms).length;
    sendWizardEvent("quote_stage_done", { settled_share: rooms.length ? (rooms.length - typical) / rooms.length : 0, typical_count: typical, range_lo: payload.rangeLoCents, range_hi: payload.rangeHiCents });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the done screen is reached
  }, [current.kind]);

  return (
    <div className="wzm wzq" data-testid="quote-stage" data-quote-card={current.id} data-estimate-id={estimateId}>
      <header className="wzm-head" data-testid="wzm-head">
        <button type="button" className="wzm-back" aria-label="Back" onClick={back} data-testid="wzm-back">‹</button>
        <span className="wzm-logo"><Wordmark logoUrl={logoUrl} brand={brand} /></span>
        <button type="button" className="wzm-contact" onClick={() => { sendWizardEvent("contact_opened", { step: current.id.slice(0, 40) }); setContactOpen(true); }} data-testid="wzm-contact">Contact</button>
      </header>
      <div className="wzm-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} data-testid="wzm-bar" /></div>

      {/* §2 — the tiles row (the quote tile; the room and plan tiles are sessions 4 and 5), the inline quote panel, the price band */}
      {current.kind !== "done" && (
        <>
          <div className="wzq-tiles" data-testid="q-tiles">
            <button type="button" className={`wzq-tile wzq-tile--quote ${quoteOpen ? "open" : ""}`} aria-expanded={quoteOpen} onClick={() => setQuoteOpen((o) => !o)} data-testid="q-tile-quote">
              <span className="thumb"><QuoteThumb lines={doc.lines} /></span>
              <span className="txt"><b data-testid="q-tile-title">{summary.toGo === 0 ? "Your quote" : `Quote · ${summary.toGo} to go`}</b><span data-testid="q-tile-sub">{summary.toGo === 0 ? "Tap to see it" : `~${summary.minutes} min · tap to see`}</span></span>
              <span className="chev" aria-hidden="true">{quoteOpen ? "▴" : "▾"}</span>
            </button>
          </div>
          <div className={`wzq-panel ${quoteOpen ? "open" : ""}`} data-testid="q-panel" data-open={quoteOpen ? "1" : "0"} aria-hidden={!quoteOpen}>
            <QuoteDoc doc={doc} brand={brand} currentAreaId={currentAreaId} />
          </div>
          <PriceBand lo={payload.rangeLoCents} hi={payload.rangeHiCents} settled={settled} />
        </>
      )}

      <main className={`wzm-main ${current.kind === "general" ? "" : "has-bar"}`}>
        <section className="wzm-screen" key={current.id}>
          <p className="wzm-stage" data-testid="q-stage">{current.stage}</p>

          {current.kind === "general" && (
            <>
              <h1 data-testid="wzm-h1">{current.question}</h1>
              {current.hint && <p className="wzm-sub" data-testid="wzm-sub">{current.hint}</p>}
              <div className={`wzm-opts ${current.columns === 2 ? "two" : current.columns === 3 ? "wzq-three" : "wzq-four"} ${current.options.some((o) => o.drawing) ? "wzq-pics" : ""}`} data-testid={`q-card-${current.key}`}>
                {current.options.map((o) => {
                  const on = current.value === o.value;
                  return (
                    <button key={o.value} type="button" className={`wzm-opt ${on ? "on" : ""}`} aria-pressed={on} data-testid={`q-opt-${current.key}-${o.value}`} onClick={() => pickGeneral(current, o.value)}>
                      {o.drawing && <span className="wzq-pimg" aria-hidden="true">{DRAWING[o.drawing]}</span>}
                      <span><span className="t">{o.label}</span>{o.hint && <span className="d">{o.hint}</span>}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {current.kind === "measure" && (
            <MeasureScreen key={current.id} card={current} busy={busy}
              onSize={async (dims) => {
                const ok = dims
                  ? await act({ action: "room_dims", areaId: current.areaId, lengthM: dims.lengthM, widthM: dims.widthM, ...(dims.heightM != null ? { heightM: dims.heightM } : {}) })
                  : await act({ action: "room_size_ok", areaId: current.areaId });
                if (!ok) return;
                sendWizardEvent("quote_card_answered", { card: "measure", line: current.areaId, measured: Boolean(dims) });
                sendWizardEvent("quote_line_settled", { line: current.areaId, state: dims ? "measured" : "typical" });
                advance();
              }} />
          )}

          {current.kind === "done" && (
            <section data-testid="q-done">
              <p className="wzm-gate-label" data-testid="gate-label">Your detailed price</p>
              <p className="wzm-gate-price" data-testid="gate-range">{fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}</p>
              <p className="wzm-gate-fine" data-testid="gate-fine">
                {typicalRoomNames(rooms).length > 0 ? `${typicalRoomNames(rooms).join(", ")} ${typicalRoomNames(rooms).length === 1 ? "is" : "are"} at the typical size. ` : "Every room measured. "}
                Repairs are allowed for and confirmed on the day. {who} confirms it with you before anything is fixed. Includes GST.
              </p>
              {/* F: the quote in full */}
              <div className="wzq-done-doc" data-testid="q-done-doc"><QuoteDoc doc={doc} brand={brand} currentAreaId={null} /></div>
              <ol className="wzm-tiles" data-testid="gate-tiles" data-at={2}>
                <li className="wzm-tile done" data-state="done"><span className="k" aria-hidden="true">✓</span><b>Your range</b>Done</li>
                <li className="wzm-tile done" data-state="done"><span className="k" aria-hidden="true">✓</span><b>Your detailed price</b>Just now</li>
                <li className="wzm-tile now" data-state="now"><span className="k" aria-hidden="true">3</span><b>{who} confirms</b>In person, 40 min</li>
              </ol>
            </section>
          )}

          {error && <div className="wz-err" data-testid="q-error">{error}</div>}
        </section>
      </main>

      {current.kind === "done" && (
        <div className="wzm-foot" data-testid="wzm-foot">
          <button type="button" className="wzm-cta wzm-cta--teal" onClick={book} data-testid="q-book">Book {who} to confirm it<small>In person · about 40 minutes</small></button>
        </div>
      )}

      <MobileContact open={contactOpen} onClose={() => setContactOpen(false)} brand={brand} estimatorName={estimator.name} suburb={customerSuburb}
        phone={estimator.phone ?? companyPhone} onBook={book} onCall={() => sendWizardEvent("quote_book_clicked", {})} />
    </div>
  );
}

/** §3 B1 — "How big is {room}?": typed numbers over greyed typicals (R2); the typical stands unless something is typed. */
function MeasureScreen({ card, busy, onSize }: { card: MeasureCard; busy: boolean; onSize: (dims: { lengthM: number; widthM: number; heightM: number | null } | null) => void }) {
  const [draft, setDraft] = useState<{ w: string; l: string; h: string }>({ w: "", l: "", h: "" });
  const typed = draft.w.trim() !== "" || draft.l.trim() !== "" || draft.h.trim() !== "";
  const num = (v: string, fallback: number) => { const n = parseFloat(v.replace(/[^0-9.]/g, "")); return isNaN(n) || n <= 0 ? fallback : n; };
  const submit = () => {
    if (!typed) { onSize(null); return; }
    onSize({ widthM: num(draft.w, card.widthM), lengthM: num(draft.l, card.lengthM), heightM: draft.h.trim() ? num(draft.h, card.heightM) : null });
  };
  const field = (key: "w" | "l" | "h", label: string, typical: number) => (
    <label className={`wzq-field ${draft[key].trim() ? "" : "typ"}`}>
      <span>{label}</span>
      <input inputMode="decimal" placeholder={String(typical)} value={draft[key]} data-testid={`q-measure-${key}`} autoFocus={key === "w"}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <em>m</em>
    </label>
  );
  return (
    <>
      <h1 data-testid="wzm-h1">How big is {card.name.toLowerCase()}?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Wall to wall, floor to ceiling. No tape? Walk it out — one large step is about a metre.</p>
      <div className="wzq-meas" data-testid="q-measure" data-measured={card.measured ? "1" : "0"}>
        {field("w", "Width", card.widthM)}{field("l", "Length", card.lengthM)}{field("h", "Ceiling", card.heightM)}
      </div>
      {!typed && <p className="wzm-note" data-testid="q-typical-note">{card.measured ? "Your numbers — type over them to change them." : "The grey numbers are typical for this room — type yours over them."}</p>}
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={submit} data-testid="q-size-ok">{busy ? "Saving…" : "That's the size"}</button>
        <p className="wzm-hint"><button type="button" className="wzm-linkish" disabled={busy} onClick={() => onSize(null)} data-testid="q-size-typical">Not sure — use the typical size for now</button></p>
      </div>
    </>
  );
}

/** §5 — the formal quote: header, prepared for, one line per room, the repairs line, the Subtotal / GST / total rows. */
function QuoteDoc({ doc, brand, currentAreaId }: { doc: QuoteDocument; brand: WizardBrand; currentAreaId: number | null }) {
  return (
    <div className="wzq-doc" data-testid="q-doc" data-title={doc.title}>
      <div className="qh">
        <div><span className="wzq-brand">{brand === "painthome" ? <>PAINT <span>HOME</span></> : <>PAINT <span>GROUP</span></>}</span><small data-testid="q-doc-title">{doc.title} · {doc.number}</small></div>
        <div className="meta"><b data-testid="q-doc-date">{doc.date}</b>{doc.validity}</div>
      </div>
      <div className="qfor" data-testid="q-doc-for">
        <b>{doc.preparedFor.name ?? "Prepared for you"}</b>
        {doc.preparedFor.address && <span>{doc.preparedFor.address}</span>}
        {(doc.preparedFor.mobile || doc.preparedFor.email) && <span>{[doc.preparedFor.mobile, doc.preparedFor.email].filter(Boolean).join(" · ")}</span>}
      </div>
      {doc.lines.map((l) => (
        <div key={l.areaId} className={`ql ${l.state} ${l.areaId === currentAreaId ? "now" : ""}`} data-testid={`q-line-${l.areaId}`} data-state={l.state}>
          <div>{l.name}<small>{l.size}{l.included ? ` · ${l.included}` : ""}</small></div>
          <div className="amt" data-testid={`q-line-${l.areaId}-amount`}>{l.amount}</div>
        </div>
      ))}
      <div className="ql sum"><div>{doc.repairsLine.split(" — ")[0]}<small>{doc.repairsLine.split(" — ")[1]}</small></div><div className="amt">—</div></div>
      {doc.subtotal && <div className="ql sum" data-testid="q-doc-subtotal"><div>Subtotal</div><div className="amt">{doc.subtotal}</div></div>}
      {doc.gst && <div className="ql sum" data-testid="q-doc-gst"><div>GST</div><div className="amt">{doc.gst}</div></div>}
      <div className="ql total" data-testid="q-doc-total"><div>{doc.totalLabel}</div><div className="amt">{doc.total}</div></div>
    </div>
  );
}

/** §5 — the mini document on the quote tile: one bar per line, grey → teal sweeping in on settle (the shared roller), mid-grey for a typical line. */
function QuoteThumb({ lines }: { lines: QuoteLine[] }) {
  const keys = lines.map((l) => String(l.areaId));
  const { rectRef, rollerRef } = useRollerSweep(keys, (k) => lines.find((l) => String(l.areaId) === k)?.state !== "todo", 30, 52);
  const step = 26 / Math.max(lines.length, 4);
  return (
    <svg viewBox="0 0 60 52" aria-hidden="true" data-testid="q-thumb">
      <rect x="10" y="4" width="40" height="44" rx="3" fill="#fff" stroke="#d5dbe1" />
      <rect x="15" y="8" width="12" height="1.5" fill="#0e7f8a" /><rect x="36" y="8" width="9" height="1.5" fill="#cfd5db" />
      {lines.map((l, k) => {
        const y = 14 + k * step;
        const id = `qth-${l.areaId}`;
        return (
          <g key={l.areaId} data-surf={String(l.areaId)} data-state={l.state}>
            <rect className="base" x="15" y={y} width="30" height="2.2" rx="1.1" fill="#e4e8ec" />
            <clipPath id={id}><rect className="cprect" x="15" y={y - 1} height="5" ref={rectRef(String(l.areaId))} /></clipPath>
            <rect x="15" y={y} width="30" height="2.2" rx="1.1" fill={l.state === "typical" ? "#c9d2d8" : "#2fd3df"} clipPath={`url(#${id})`} />
            <g className="roller" ref={rollerRef(String(l.areaId))}><rect x="-3" y="-2" width="6" height="4" rx="1" fill="#0e7f8a" /></g>
          </g>
        );
      })}
      <rect x="15" y="43" width="30" height="1.2" fill="#9aa5b0" />
    </svg>
  );
}

/** §2 / §5 — the price band: the range in mono (tweening ~1.4 s after every answer), "closing in · N% settled", the track whose open segment shrinks inward and turns teal → green. */
function PriceBand({ lo, hi, settled }: { lo: number; hi: number; settled: number }) {
  const [shown, setShown] = useState({ lo, hi });
  const from = useRef({ lo, hi });
  useEffect(() => {
    const start = { ...from.current };
    if (start.lo === lo && start.hi === hi) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 1 : 1400; // reduced motion: the first frame lands on the new range
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = { lo: Math.round(start.lo + (lo - start.lo) * e), hi: Math.round(start.hi + (hi - start.hi) * e) };
      setShown(cur);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = { lo, hi };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lo, hi]);
  const pctSettled = Math.round(Math.max(0, Math.min(1, settled)) * 100);
  const open = 1 - pctSettled / 100;
  const mix = (a: [number, number, number], b: [number, number, number], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  return (
    <div className="wzq-band" data-testid="q-band" data-lo={lo} data-hi={hi} data-settled={pctSettled}>
      <div className="row">
        <span className="p" data-testid="q-band-range">{fmt(shown.lo)} – {fmt(shown.hi)}</span>
        <span className="l" data-testid="q-band-settled">{pctSettled >= 100 ? "settled" : `closing in · ${pctSettled}% settled`}</span>
      </div>
      <div className="track" aria-hidden="true"><i style={{ width: `${Math.max(6, open * 100)}%`, marginLeft: `${(1 - Math.max(0.06, open)) * 50}%`, background: mix([47, 211, 223], [52, 199, 123], pctSettled / 100) }} /></div>
    </div>
  );
}
