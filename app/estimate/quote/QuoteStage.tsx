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

export default function QuoteStage({ brand, estimateId, initial, initialRooms, initialCornices, initialAccess, logoUrl, estimator, companyPhone, customerSuburb }: {
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
}) {
  const router = useRouter();
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
