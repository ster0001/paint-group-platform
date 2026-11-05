"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPayload } from "@/lib/wizard/view";
import type { RoomLoopView } from "@/lib/wizard/rooms-loop";
import type { CustomerScopeRoom, CustomerTile } from "@/lib/wizard/scope-editor";
import type { InteriorLoopView } from "@/lib/wizard/customer-scope";
import type { JobExtra } from "@/lib/wizard/extras";
import { EXTENT_LABEL, OTHER_TAG_KEY, SPOT_EXTENTS, tagsFor, type SpotExtent } from "@/lib/wizard/spots";
import { SPOT_PHOTOS_PER_ROOM, SPOT_PHOTO_MAX_BYTES, uploadSpotPhoto } from "@/lib/wizard/spotPhoto";
import { ADD_ROOM_TYPES, roomTypeForName } from "@/lib/wizard/quick-look";
import PhotoDrop from "@/app/estimate/scope/PhotoDrop";
import type { SiteAccess } from "@/lib/wizard/site-access";
import type { Estimator } from "@/lib/wizard/estimator";
import type { WizardBrand } from "@/lib/wizard/brand";
import { assertCustomerShape } from "@/lib/wizard/contract";
import { breakpointNow, sendWizardEvent } from "@/lib/wizard/wizardEvents";
import { quoteCards, quoteProgress, quoteRoomsFrom, quoteSidesFrom, typicalRoomNames, type AttentionCard, type GeneralAnswers, type GeneralCard, type JobKind, type MeasureCard, type QuoteRoom, type RobeCard, type RoomsCard, type SideAttentionCard, type SideOnCard, type SideSizeCard, type SurfacesCard } from "@/lib/quote/cards";
import type { SidesView } from "@/lib/wizard/sides";
import type { ExteriorV2 } from "@/lib/wizard/state";
import type { ExteriorTypicalRow } from "@/lib/wizard/exterior-typicals";
import Elevation from "@/app/wizard/pictures/Elevation";
import { PART_LABEL, checkSide, partsOnSide, postCount, setSideCond, setSideCounts, setSideSize, sideAddableParts, sideListParts, toggleSidePart } from "@/lib/wizard/exterior-model";
import { typicalFor } from "@/lib/wizard/exterior-typicals";
import SaveAndBookSheet from "@/app/wizard/SaveAndBookSheet";
import { quoteDocument, quoteSummary, type PreparedFor, type QuoteDocument, type QuoteLine } from "@/lib/quote/quote";
import { useRollerSweep } from "@/app/wizard/pictures/rollerSweep";
import MobilePicture from "@/app/wizard/pictures/MobilePicture";
import type { MobilePictureState } from "@/lib/wizard/mobilePicture";
import { quotePictureFrom } from "@/lib/quote/roomDrawing";
import PlanViewer from "@/app/wizard/PlanViewer";
import type { EstimateDocument } from "@/lib/wizard/documents";
import { lineState } from "@/lib/quote/quote";
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
 * computes nothing about money. Session 3 adds the three other room cards
 * (what we're painting in here, robes and cupboards, anything needing
 * attention — with the room and spot photos, D-Q5), the last checks (every
 * room? anything we haven't listed?) and the done screen's name line; the
 * drawing is session 4; session 5 adds the plan tile (R6, D-Q1: the plan
 * read has no room positions, so the sheet is the plan image with the
 * ticked room list beside it, tap-to-jump). Session 6: the desktop format
 * (R8 — drawing left · the card centre · plan + price + quote right, the
 * keyboard flow of §2), the outside path (§3 C — three cards per painted
 * side, the side drawn by `Elevation`) and the doors-and-trims path (§3 D).
 */
type RoomExtrasRow = { featureWalls: number; wallpaper: boolean; other: string };
type JobExtrasState = { on: string[]; counts: Record<string, number>; colourHelp: boolean; note: string };
type Payload = CustomerPayload & {
  interiorLoop?: { rooms: RoomLoopView[]; catalogue?: InteriorLoopView["catalogue"] } | null;
  scopeRooms?: CustomerScopeRoom[]; roomExtras?: Record<string, RoomExtrasRow>; jobExtras?: JobExtrasState; sides?: SidesView | null;
  error?: string; outcome?: string; message?: string;
};
type Act = (body: Record<string, unknown>) => Promise<Payload | null>;
const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
const DRAWING: Record<NonNullable<GeneralCard["options"][number]["drawing"]>, ReactNode> = {
  "door-panel": DOOR_DRAWINGS.panel, "door-flat": DOOR_DRAWINGS.flat,
  "win-casement": WINDOW_DRAWINGS.casement, "win-sash": WINDOW_DRAWINGS.sash, "win-colonial": WINDOW_DRAWINGS.colonial, "win-winder": WINDOW_DRAWINGS.winder,
};

export default function QuoteStage({ brand, estimateId, initial, jobKind, initialScopeRooms, initialLoop, catalogue, initialRoomExtras, initialExtras, roomTypes, plan, initialSides, v2, typicalRows, initialCornices, initialAccess, logoUrl, estimator, companyPhone, customerSuburb, preparedFor, quoteNo, quoteDate }: {
  brand: WizardBrand;
  estimateId: string;
  initial: CustomerPayload;
  /** §3: interior (A, B ×4, E), trims (D — one card per room), exterior (C — three per side). */
  jobKind: JobKind;
  /** §3 C: the sides view the sides editor reads, the drawn house (`v2`) and its typicals for `Elevation`. */
  initialSides: SidesView | null;
  v2: ExteriorV2 | null;
  typicalRows: ReadonlyArray<ExteriorTypicalRow>;
  /** The scope page's own three room views, joined here by `quoteRoomsFrom`. */
  initialScopeRooms: CustomerScopeRoom[];
  initialLoop: RoomLoopView[];
  catalogue: InteriorLoopView["catalogue"];
  initialRoomExtras: Record<string, RoomExtrasRow>;
  /** §3 E2 — the extras on offer (from the rate card) and what is on. */
  initialExtras: { offer: JobExtra[] } & JobExtrasState;
  roomTypes: string[];
  /** R6: the customer's own floorplan, when one was uploaded (signed URL from `estimateDocuments`); null = no plan tile. */
  plan: EstimateDocument | null;
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
  // the room sheet is open FOR a card: moving to another card closes it without an effect
  const [roomOpenFor, setRoomOpenFor] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false); // Tom, 5 Nov: "Save estimate — you can come back to it at any time"
  const [payload, setPayload] = useState<Payload>(initial);
  const [scopeRooms, setScopeRooms] = useState<CustomerScopeRoom[]>(initialScopeRooms);
  const [loop, setLoop] = useState<RoomLoopView[]>(initialLoop);
  const [roomExtras, setRoomExtras] = useState<Record<string, RoomExtrasRow>>(initialRoomExtras);
  const [jobExtras, setJobExtras] = useState<JobExtrasState>({ on: initialExtras.on, counts: initialExtras.counts, colourHelp: initialExtras.colourHelp, note: initialExtras.note });
  const [sidesView, setSidesView] = useState<SidesView | null>(initialSides);
  // §3 C (Tom, 2 Nov): an outside job's answers go to the ONE drawn-house model, as the walk-around's did — `ext_walk`
  // rebuilds the sides from it, so the drawing, the counts and the price follow together. Optimistic locally, the server's
  // payload (its `sides`) comes back as the truth.
  const [v2State, setV2State] = useState<ExteriorV2 | null>(v2);
  const [railQuoteOpen, setRailQuoteOpen] = useState(false); // D-Q6: the desktop quote starts collapsed
  const rooms = useMemo(() => (jobKind === "exterior" ? quoteSidesFrom(sidesView) : quoteRoomsFrom(scopeRooms, loop, roomExtras)), [jobKind, sidesView, scopeRooms, loop, roomExtras]);
  const [general, setGeneral] = useState<GeneralAnswers>({ cornices: initialCornices });
  const [access, setAccess] = useState<SiteAccess>(initialAccess.answers);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const cards = quoteCards({ jobKind, general, heightUnconfirmed: payload.heightUnconfirmed, access, asksLift: initialAccess.asksLift, rooms });
  const current = cards[Math.min(index, cards.length - 1)];
  const pct = quoteProgress(index, cards.length);
  const who = estimator.name?.trim().split(/\s+/)[0] ?? "your estimator";
  // §5 (R4): the quote writes itself — the document, the tile's words and the band's share, all from the server's payload.
  const generalToGo = cards.filter((c) => c.kind === "general" && c.value == null).length;
  const doc = quoteDocument({ payload, rooms, preparedFor, number: quoteNo, date: quoteDate, generalToGo });
  const summary = quoteSummary(rooms, generalToGo);
  // The band's "N% settled" is the QUOTE's share — lines settled over lines (the S1 proof on C1: the engine's
  // `confirmedShare` is the tree's confirm-loop share and does not move when a room is sized).
  const settled = summary.settledShare;
  const currentAreaId = "areaId" in current ? current.areaId : null;
  // §4 (R5): the room tile — the one picture, drawn from the one room model, redrawn with every answer.
  const currentRoom = currentAreaId != null ? rooms.find((r) => r.areaId === currentAreaId) ?? null : null;
  const picture = currentRoom && currentRoom.kind !== "side" ? quotePictureFrom(currentRoom) : null;
  const currentSideKey = currentRoom?.kind === "side" ? currentRoom.sideKey ?? null : null;
  /** The one picture for the current line: the room (S4) or the side (`Elevation`, as the walk-around draws it). */
  const linePicture = (testId: string) => currentSideKey && v2State
    ? <Elevation v2={v2State} side={currentSideKey} rows={typicalRows} sweep />
    : picture ? <MobilePicture state={picState} quote={picture} testId={testId} /> : null;
  const picState: MobilePictureState = { kind: "room", property: "house", two: false, colour: "deciding", condition: "good", painted: null };
  const roomOpen = roomOpenFor === current.id && currentRoom != null;
  useEffect(() => {
    if (!roomOpen && !planOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setRoomOpenFor(null); setPlanOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomOpen, planOpen]);
  const firstName = preparedFor.name?.trim().split(/\s+/)[0] ?? null;

  // §7: the stage viewed once, the done screen once.
  useEffect(() => { sendWizardEvent("quote_stage_viewed", { job_kind: jobKind, lines: jobKind === "exterior" ? (initialSides?.sides.length ?? 0) : initialScopeRooms.length, breakpoint: breakpointNow() }); }, [jobKind, initialScopeRooms.length, initialSides]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [current.id]);

  /** One whitelisted action to the scope page's own route; the server's payload comes back and is the truth. */
  const post = async (body: Record<string, unknown>): Promise<Payload | null> => {
    setBusy(true); setError(null);
    // a request that never answers (a dropped connection) must not leave the card on "Saving…" for good: 45 s, then the
    // connection message and the button back (the C1 proof of 5 Nov sat on a hung ext_walk for five minutes)
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, view: "customer" }), signal: ctl.signal,
      });
      const j = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) { setError(j.error ?? "That didn't save — try again."); return null; }
      assertCustomerShape(j, "QuoteStage");
      if (typeof j.outcome === "string" && j.outcome !== "reveal") { setError(j.message ?? "That change needs one of our team — we'll be in touch."); return null; }
      setPayload(j);
      if (j.scopeRooms) setScopeRooms(j.scopeRooms);
      if (j.interiorLoop?.rooms) setLoop(j.interiorLoop.rooms);
      if (j.roomExtras) setRoomExtras(j.roomExtras);
      if (j.jobExtras) setJobExtras(j.jobExtras);
      if (j.sides !== undefined) setSidesView(j.sides ?? null);
      return j;
    } catch {
      setError("That didn't save — check your connection and try again.");
      return null;
    } finally { clearTimeout(timer); setBusy(false); }
  };
  // Independent check (S7, defect 2): the route reads and rewrites ONE builder_state row with no lock, so two taps in
  // flight would race (last writer wins). Every post waits for the one before it — the same serialisation the scope
  // editor's queue gave it. A body of `{ actions: [...] }` is the route's batch shape and rides the same chain.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const act = useCallback<Act>((body) => {
    const run = chain.current.then(() => post(body));
    chain.current = run.catch(() => undefined);
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` only closes over state setters and the estimate id
  }, [estimateId]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const advance = () => setIndex((i) => Math.min(i + 1, cards.length - 1));
  /** F: a typical or open line on the done screen jumps back to that room's size card; E1's new room opens on its size card. */
  const jumpTo = (id: string) => { const k = cards.findIndex((c) => c.id === id); if (k >= 0) setIndex(k); };
  const answered = (card: string, line: number | null) => sendWizardEvent("quote_card_answered", { card, line, measured: false });
  // a card that posts on its way out (a side's attention card) must leave ONCE — a second Next while it is leaving is ignored
  const leaving = useRef(false);
  const walk = (next: ExteriorV2) => { setV2State(next); return act({ action: "ext_walk", v2: next }); };
  const back = () => { if (timer.current) clearTimeout(timer.current); if (index > 0) setIndex(index - 1); else router.back(); };
  // §2 desktop — the keyboard flow: 1–4 pick an option, Enter = next, ← = back (never while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing) return; // a field's own Enter handler submits it (defect 12: never twice)
      if (e.key === "Enter") {
        const next = document.querySelector<HTMLButtonElement>("[data-testid='q-next'], [data-testid='q-prep-add'], [data-testid='q-size-ok'], [data-testid='q-book']");
        if (next && !next.disabled) { e.preventDefault(); next.click(); }
        return;
      }
      if (e.key === "ArrowLeft") { back(); return; }
      if (/^[1-4]$/.test(e.key)) {
        const opts = Array.from(document.querySelectorAll<HTMLButtonElement>(".wzq-card .wzm-opts .wzm-opt"));
        const b = opts[Number(e.key) - 1];
        if (b && !b.disabled) b.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `back` reads the live index through state setters
  }, [index]);

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
  const prepRooms = rooms.filter((r) => r.spots.length > 0 || r.extras.featureWalls > 0 || r.extras.wallpaper).length;
  useEffect(() => {
    if (current.kind !== "done") return;
    const typical = typicalRoomNames(rooms).length;
    sendWizardEvent("quote_stage_done", { settled_share: summary.settledShare, typical_count: typical, range_lo: payload.rangeLoCents, range_hi: payload.rangeHiCents });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the done screen is reached
  }, [current.kind]);

  return (
    <div className={`wzm wzq wzq--${jobKind}`} data-testid="quote-stage" data-quote-card={current.id} data-estimate-id={estimateId} data-job-kind={jobKind} data-busy={busy ? "1" : "0"}>
      <header className="wzm-head" data-testid="wzm-head">
        <button type="button" className="wzm-back" aria-label="Back" onClick={back} data-testid="wzm-back">‹</button>
        <span className="wzm-logo"><Wordmark logoUrl={logoUrl} brand={brand} /></span>
        <button type="button" className="wzm-contact" onClick={() => { sendWizardEvent("contact_opened", { step: current.id.slice(0, 40) }); setContactOpen(true); }} data-testid="wzm-contact">Contact</button>
      </header>
      {/* Tom, 5 Nov 2026: the quote, the house and the moving price are FROZEN at the top while the card scrolls; the logo scrolls away */}
      <div className={`wzq-sticky ${current.kind === "done" ? "" : "on"}`} data-testid="q-sticky">
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
            {currentRoom && (picture || (currentSideKey && v2State)) && (
              <button type="button" className="wzq-tile wzq-tile--room" onClick={() => setRoomOpenFor(current.id)} data-testid="q-tile-room" aria-label={`${currentRoom.name}. Updates as you answer.`}>
                <span className="thumb">{linePicture("q-room-pic")}</span>
                <span className="txt"><b data-testid="q-tile-room-name">{currentRoom.name}</b><span>Updates as you answer</span></span>
              </button>
            )}
            {plan && (
              <button type="button" className="wzq-tile wzq-tile--plan" onClick={() => setPlanOpen(true)} data-testid="q-tile-plan" aria-label="Your floorplan. Tap a room to jump to it.">
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL from the private bucket; next/image cannot optimise it */}
                <span className="thumb"><img src={plan.url} alt="" /></span>
                <span className="txt"><b>Plan</b></span>
              </button>
            )}
          </div>
          <div className={`wzq-panel ${quoteOpen ? "open" : ""}`} data-testid="q-panel" data-open={quoteOpen ? "1" : "0"} aria-hidden={!quoteOpen}>
            <QuoteDoc doc={doc} brand={brand} currentAreaId={currentAreaId} />
          </div>
          <PriceBand lo={payload.rangeLoCents} hi={payload.rangeHiCents} settled={settled} />
        </>
      )}
      </div>

      {/* §2 desktop (R8) — the left rail: the current line's drawing; shown at ≥ 900px by CSS, the tiles row and band hide there */}
      <aside className="wzq-rail wzq-rail--left" data-testid="q-rail-left" aria-hidden={!currentRoom}>
        {currentRoom && (
          <>
            <p className="wzq-rl-h" data-testid="q-rail-room-name">{currentRoom.name}</p>
            <div className="wzm-bigpic wzq-rail-pic" data-testid="q-rail-room">{linePicture("q-rail-room-pic")}</div>
            <p className="wzq-rl-cap">Updates as you answer</p>
          </>
        )}
      </aside>
      <aside className="wzq-rail wzq-rail--right" data-testid="q-rail-right">
        {plan && (
          <>
            <p className="wzq-rl-h">Your floorplan</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL from the private bucket */}
            <button type="button" className="wzq-rail-plan" onClick={() => setPlanOpen(true)} data-testid="q-rail-plan" aria-label="Your floorplan. Tap a room to jump to it."><img src={plan.url} alt="" /></button>
          </>
        )}
        {current.kind !== "done" && <PriceBand lo={payload.rangeLoCents} hi={payload.rangeHiCents} settled={settled} testId="q-rail-band" />}
        <button type="button" className={`wzq-rail-qh ${railQuoteOpen ? "open" : ""}`} aria-expanded={railQuoteOpen} onClick={() => setRailQuoteOpen((o) => !o)} data-testid="q-rail-quote-toggle">
          <b>{doc.title} · {doc.number}</b><span>{summary.toGo === 0 ? "every line settled" : `${summary.toGo} to go`}</span><span className="chev" aria-hidden="true">{railQuoteOpen ? "▴" : "▾"}</span>
        </button>
        <div className={`wzq-rail-quote ${railQuoteOpen ? "open" : ""}`} data-testid="q-rail-quote" data-open={railQuoteOpen ? "1" : "0"}>
          <QuoteDoc doc={doc} brand={brand} currentAreaId={currentAreaId} />
        </div>
      </aside>

      <main className={`wzm-main ${current.kind === "general" ? "" : "has-bar"}`}>
        <section className="wzm-screen wzq-card" key={current.id}>
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
            <MeasureScreen key={current.id} card={current} busy={busy} estimateId={estimateId}
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

          {current.kind === "surfaces" && (
            <SurfacesScreen key={current.id} card={current} busy={busy} act={act} catalogue={catalogue} onNext={() => { answered("surfaces", current.areaId); advance(); }} />
          )}
          {current.kind === "robe" && (
            <RobeScreen key={current.id} card={current} busy={busy} act={act} onNext={() => { answered("robe", current.areaId); advance(); }} />
          )}
          {current.kind === "attention" && (
            <AttentionScreen key={current.id} card={current} busy={busy} act={act} estimateId={estimateId} onNext={() => { answered("attention", current.areaId); advance(); }} />
          )}
          {current.kind === "rooms" && (
            <RoomsScreen key={current.id} card={current} busy={busy} act={act} roomTypes={roomTypes}
              onAdded={(areaId) => { answered("rooms", areaId); jumpTo(`measure:${areaId}`); }}
              onNext={() => { answered("rooms", null); advance(); }} />
          )}
          {current.kind === "extras" && (
            <ExtrasScreen key={current.id} offer={initialExtras.offer} state={jobExtras} busy={busy} act={act} onNext={() => { answered("extras", null); advance(); }} />
          )}
          {current.kind === "side-size" && v2State && (
            <SideSizeScreen key={current.id} card={current} busy={busy} v2={v2State} walk={walk} onDone={(measured) => {
              sendWizardEvent("quote_card_answered", { card: "side-size", line: current.areaId, measured });
              sendWizardEvent("quote_line_settled", { line: current.areaId, state: measured ? "measured" : "typical" });
              advance();
            }} />
          )}
          {current.kind === "side-on" && v2State && (
            <SideOnScreen key={current.id} card={current} busy={busy} act={act} v2={v2State} rows={typicalRows} walk={walk} onNext={() => { answered("side-on", current.areaId); advance(); }} />
          )}
          {current.kind === "side-attn" && (
            <SideAttentionScreen key={current.id} card={current} busy={busy} act={act} estimateId={estimateId} v2={v2State} onNext={async () => {
              if (leaving.current) return;
              leaving.current = true;
              try {
                answered("side-attn", current.areaId);
                if (v2State) await walk(checkSide(v2State, current.sideKey));
                await act({ action: "confirm_side", side: current.sideKey });
                advance();
              } finally { leaving.current = false; }
            }} />
          )}

          {current.kind === "done" && (
            <section data-testid="q-done">
              <p className="wzm-gate-label" data-testid="gate-label">{firstName ? `${firstName}, your quote range` : "Your quote range"}</p>
              <p className="wzm-gate-price" data-testid="gate-range">{fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}</p>
              <p className="wzm-gate-fine" data-testid="gate-fine">
                {typicalRoomNames(rooms).length > 0 ? `${typicalRoomNames(rooms).join(", ")} ${typicalRoomNames(rooms).length === 1 ? "is" : "are"} at the typical size — tap it below to measure it. ` : "Every room measured. "}
                {prepRooms > 0 ? `Repairs in ${prepRooms} ${prepRooms === 1 ? "room are" : "rooms are"} allowed for and confirmed on the day. ` : "Repairs are allowed for and confirmed on the day. "}
                Price is subject to change based on the information provided. {who} confirms it with you before anything is fixed. Includes GST.
              </p>
              {/* F: the quote in full; a typical or open line jumps back to that room's size card */}
              <div className="wzq-done-doc" data-testid="q-done-doc"><QuoteDoc doc={doc} brand={brand} currentAreaId={null} onLineTap={(areaId) => jumpTo(`measure:${areaId}`)} /></div>
              <ol className="wzm-tiles" data-testid="gate-tiles" data-at={2}>
                <li className="wzm-tile done" data-state="done"><span className="k" aria-hidden="true">✓</span><b>Your range</b>Done</li>
                <li className="wzm-tile done" data-state="done"><span className="k" aria-hidden="true">✓</span><b>Your quote range</b>Just now</li>
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
      {/* Tom, 5 Nov 2026: save and come back any time — the same sheet the quick look's header pill opens */}
      <p className="wzq-save" data-testid="q-save-row"><button type="button" className="wzm-linkish" onClick={() => setSaveOpen(true)} data-testid="q-save">Save estimate</button> — you can come back to it at any time.</p>
      <SaveAndBookSheet open={saveOpen} onClose={() => setSaveOpen(false)} phone={companyPhone} screen="quote" estimateId={estimateId} prefill={{ email: preparedFor.email ?? "", phone: preparedFor.mobile ?? "", name: preparedFor.name ?? "" }} />
      {/* §2 desktop — the key hints (shown at ≥ 900px by CSS) */}
      <p className="wzq-keys" data-testid="q-keys" aria-hidden="true">
        {current.kind === "general" || current.kind === "robe" ? <><b>1</b><b>2</b><b>3</b> choose · </> : current.kind === "measure" || current.kind === "side-size" ? <><b>Tab</b> next field · <b>Enter</b> that&rsquo;s the size · </> : <><b>Enter</b> next · </>}<b>←</b> back
      </p>

      {roomOpen && currentRoom && (picture || (currentSideKey && v2State)) && (
        <div className="wz-sheetback wzm-sheetback" role="dialog" aria-modal="true" aria-label={currentRoom.name} data-testid="q-room-sheet" onClick={(e) => { if (e.target === e.currentTarget) setRoomOpenFor(null); }}>
          <div className="wz-sheet wzm-sheet">
            <button type="button" className="wz-sheet-x" aria-label="Close" onClick={() => setRoomOpenFor(null)} data-testid="q-room-sheet-x">×</button>
            <div className="wzm-grab" aria-hidden="true" />
            <div className="wzm-bigpic" data-testid="q-room-bigpic">{linePicture("q-room-bigpic-pic")}</div>
            <p className="wzm-cap" data-testid="q-room-cap">{currentRoom.name} — {currentRoom.kind === "side" ? `${currentRoom.lengthM} × ${currentRoom.widthM} m` : `${currentRoom.widthM} × ${currentRoom.lengthM} × ${currentRoom.heightM} m`}. Updates as you answer.</p>
          </div>
        </div>
      )}
      {planOpen && plan && (
        <div className="wz-sheetback wzm-sheetback" role="dialog" aria-modal="true" aria-label="Your floorplan" data-testid="q-plan-sheet" onClick={(e) => { if (e.target === e.currentTarget) setPlanOpen(false); }}>
          <div className="wz-sheet wzm-sheet wzq-plan-sheet">
            <button type="button" className="wz-sheet-x" aria-label="Close" onClick={() => setPlanOpen(false)} data-testid="q-plan-sheet-x">×</button>
            <div className="wzm-grab" aria-hidden="true" />
            <div className="wzq-plan" data-testid="q-plan-viewer"><PlanViewer src={plan.url} title="YOUR FLOORPLAN" note="AS UPLOADED" /></div>
            <p className="wzm-cap" data-testid="q-plan-cap">Your floorplan. Tap a room to jump to it.</p>
            {/* D-Q1: no room positions in the plan read — the ticked room list beside the image is the tap-to-jump */}
            <ul className="wzq-rooms wzq-plan-rooms" data-testid="q-plan-rooms">
              {rooms.map((r) => {
                const st = lineState(r);
                return (
                  <li key={r.areaId} data-testid={`q-plan-room-${r.areaId}`} data-state={st} className={r.areaId === currentAreaId ? "now" : ""}>
                    <button type="button" onClick={() => { setPlanOpen(false); jumpTo(`measure:${r.areaId}`); }}>
                      <span className="tick" aria-hidden="true">{st === "todo" ? "" : "✓"}</span>{r.name}<span>{r.widthM} × {r.lengthM} m</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <MobileContact open={contactOpen} onClose={() => setContactOpen(false)} brand={brand} estimatorName={estimator.name} suburb={customerSuburb}
        phone={estimator.phone ?? companyPhone} onBook={book} onCall={() => sendWizardEvent("quote_book_clicked", {})} />
    </div>
  );
}

/** §3 B1 — "How big is {room}?": typed numbers over greyed typicals (R2); the typical stands unless something is typed. */
function MeasureScreen({ card, busy, estimateId, onSize }: { card: MeasureCard; busy: boolean; estimateId: string; onSize: (dims: { lengthM: number; widthM: number; heightM: number | null } | null) => void }) {
  const [draft, setDraft] = useState<{ w: string; l: string; h: string }>({ w: "", l: "", h: "" });
  const photo = useRoomPhotos(estimateId, card.areaId, card.name, "room", false);
  const typed = draft.w.trim() !== "" || draft.l.trim() !== "" || draft.h.trim() !== "";
  const num = (v: string, fallback: number) => { const n = parseFloat(v.replace(/[^0-9.]/g, "")); return isNaN(n) || n <= 0 ? fallback : n; };
  const submit = () => {
    if (!typed) { onSize(null); return; }
    onSize({ widthM: num(draft.w, card.widthM), lengthM: num(draft.l, card.lengthM), heightM: draft.h.trim() ? Math.min(6, Math.max(2, num(draft.h, card.heightM))) : null });
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
      {/* B1: an optional photo of the room (D-Q5: three per room, 5 MB each, the one upload path) */}
      <div className="wzq-photo">
        <PhotoDrop testId="q-room-photo" title="Take or attach a photo of the room" hint="Optional. Helps us check it before the visit." ready={photo.ready} disabled={photo.busy || photo.full} onFiles={photo.add} />
        {photo.error && <p className="wz-err" data-testid="q-photo-error">{photo.error}</p>}
      </div>
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={submit} data-testid="q-size-ok">{busy ? "Saving…" : "That's the size"}</button>
        <p className="wzm-hint"><button type="button" className="wzm-linkish" disabled={busy} onClick={() => onSize(null)} data-testid="q-size-typical">Not sure — use the typical size for now</button></p>
      </div>
    </>
  );
}

/** §5 — the formal quote: header, prepared for, one line per room, the repairs line, the Subtotal / GST / total rows. */
function QuoteDoc({ doc, brand, currentAreaId, onLineTap }: { doc: QuoteDocument; brand: WizardBrand; currentAreaId: number | null; onLineTap?: (areaId: number) => void }) {
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
        <div key={l.areaId} className={`ql ${l.state} ${l.areaId === currentAreaId ? "now" : ""} ${onLineTap && l.state !== "measured" ? "tap" : ""}`} data-testid={`q-line-${l.areaId}`} data-state={l.state}
          role={onLineTap && l.state !== "measured" ? "button" : undefined} tabIndex={onLineTap && l.state !== "measured" ? 0 : undefined}
          onClick={onLineTap && l.state !== "measured" ? () => onLineTap(l.areaId) : undefined}>
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
function PriceBand({ lo, hi, settled, testId = "q-band" }: { lo: number; hi: number; settled: number; testId?: string }) {
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
    <div className="wzq-band" data-testid={testId} data-lo={lo} data-hi={hi} data-settled={pctSettled}>
      <div className="row">
        <span className="p" data-testid={`${testId}-range`}>{fmt(shown.lo)} – {fmt(shown.hi)}</span>
        <span className="l" data-testid={`${testId}-settled`}>{pctSettled >= 100 ? "settled" : `closing in · ${pctSettled}% settled`}</span>
      </div>
      <div className="track" aria-hidden="true"><i style={{ width: `${Math.max(6, open * 100)}%`, marginLeft: `${(1 - Math.max(0.06, open)) * 50}%`, background: mix([47, 211, 223], [52, 199, 123], pctSettled / 100) }} /></div>
    </div>
  );
}

/** D-Q5 — the room's photos this session: three per room, 5 MB each, through the one upload path; `kind` names the event. */
function useRoomPhotos(estimateId: string, areaId: number, roomName: string, kind: "room" | "prep", analyse: boolean) {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ sourceId: string | null; suggestion: { tag: string; extent: SpotExtent; severity?: 1 | 2 | 3 } | null } | null>(null);
  const full = count >= SPOT_PHOTOS_PER_ROOM;
  const add = async (files: File[]) => {
    const f = files[0];
    if (!f || full) return;
    if (f.size > SPOT_PHOTO_MAX_BYTES) { setError("That photo is over 25 MB — try a smaller one."); return; }
    setBusy(true); setError(null);
    try {
      const r = await uploadSpotPhoto(f, { estimateId, label: roomName, analyse });
      setLast({ sourceId: r.sourceId, suggestion: r.suggestion ? { tag: r.suggestion.tag, extent: r.suggestion.extent, severity: r.suggestion.severity } : null });
      setCount((n) => n + 1);
      sendWizardEvent("quote_photo_added", { line: areaId, kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo didn't upload — you can still carry on.");
    } finally { setBusy(false); }
  };
  const ready = count === 0 ? null : count === 1 ? "Photo added" : `${count} photos added`;
  return { count, busy, error, full, add, ready, last, clear: () => setLast(null) };
}

/** A chip with − / + (the doors, the window groups, an extra's count). */
function Counter({ value, min, max, onChange, testId, disabled }: { value: number; min: number; max: number; onChange: (n: number) => void; testId: string; disabled?: boolean }) {
  return (
    <span className="n" data-testid={testId}>
      <button type="button" aria-label="Fewer" disabled={disabled || value <= min} onClick={(e) => { e.stopPropagation(); onChange(value - 1); }}>−</button>
      <b>{value}</b>
      <button type="button" aria-label="More" disabled={disabled || value >= max} onClick={(e) => { e.stopPropagation(); onChange(value + 1); }}>+</button>
    </span>
  );
}

/** §3 B2 — "What we're painting in here": the room's tiles as chips; walls with their share, doors with count and scope, the window groups with count and size; + Add a surface. */
function SurfacesScreen({ card, busy, act, catalogue, onNext }: { card: SurfacesCard; busy: boolean; act: Act; catalogue: InteriorLoopView["catalogue"]; onNext: () => void }) {
  const room = card.room;
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const tile = (key: string) => room.tiles.find((t) => String(t.key) === key);
  const walls = tile("walls"); const doors = tile("doors"); const windows = tile("windows");
  const plain = room.tiles.filter((t) => !["walls", "doors", "windows"].includes(String(t.key)) && (t.on || !t.longTail));
  const toggle = (t: CustomerTile) => t.surfaceId != null && t.on
    ? act({ action: "room_remove_line", areaId: room.areaId, surfaceId: t.surfaceId })
    : act({ action: "toggle_surface", areaId: room.areaId, key: String(t.key), on: !t.on });
  const chip = (t: CustomerTile, extra?: ReactNode) => (
    <button key={String(t.key)} type="button" className={`wzm-chip ${t.on ? "on" : ""}`} aria-pressed={t.on} disabled={busy} data-testid={`q-surf-${String(t.key).replace(/[^a-z0-9]+/gi, "-")}`} onClick={() => void toggle(t)}>
      {t.label}{t.on && extra}
    </button>
  );
  const seg = (opts: Array<[string, string]>, value: string, pick: (v: string) => void, testId: string) => (
    <span className="seg" data-testid={testId}>
      {opts.map(([v, label]) => <span key={v} role="button" tabIndex={0} className={value === v ? "sel" : ""} data-testid={`${testId}-${v}`} onClick={(e) => { e.stopPropagation(); pick(v); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); pick(v); } }}>{label}</span>)}
    </span>
  );
  const offered = (catalogue ?? []).filter((o) => !room.tiles.some((t) => t.on && t.label.toLowerCase() === o.label.toLowerCase()));
  const tail = room.tiles.filter((t) => t.longTail && !t.on);
  return (
    <>
      <h1 data-testid="wzm-h1">What we&rsquo;re painting in here</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Untick anything we&rsquo;re not doing.</p>
      <div className="wzm-chips wzq-surf" data-testid="q-surfaces">
        {walls && chip(walls, seg([["100", "All"], ["75", "75%"], ["50", "50%"], ["25", "25%"]], String(walls.wallsPct ?? 100), (v) => void act({ action: "walls_share", areaId: room.areaId, pct: Number(v) }), "q-walls-share"))}
        {plain.map((t) => chip(t, t.countable && t.count != null ? <Counter value={t.count} min={1} max={t.surfaceId != null ? 20 : 12} testId={`q-count-${String(t.key).replace(/[^a-z0-9]+/gi, "-")}`} disabled={busy}
          onChange={(n) => void act(t.surfaceId != null ? { action: "room_line_count", areaId: room.areaId, surfaceId: t.surfaceId, count: n } : { action: "set_count", areaId: room.areaId, key: String(t.key), count: n })} /> : undefined))}
        {doors && chip(doors, <>
          <Counter value={doors.count ?? 1} min={1} max={12} testId="q-count-doors" disabled={busy} onChange={(n) => void act({ action: "set_count", areaId: room.areaId, key: "doors", count: n })} />
          {seg([["door", "door"], ["frame", "+ frame"], ["architrave", "+ architrave"]], doors.doorScope ?? "frame", (v) => void act({ action: "room_door_scope", areaId: room.areaId, scope: v }), "q-door-scope")}
        </>)}
        {windows && windows.on && room.windows.length === 0 && chip(windows, <Counter value={windows.count ?? 1} min={1} max={12} testId="q-count-windows" disabled={busy} onChange={(n) => void act({ action: "set_count", areaId: room.areaId, key: "windows", count: n })} />)}
        {windows && (windows.on && room.windows.length === 0 ? null : windows.on && room.windows.length > 0
          ? room.windows.map((w) => (
            <button key={w.id} type="button" className="wzm-chip on" aria-pressed data-testid={`q-win-${w.id}`} disabled={busy} onClick={() => void act({ action: "room_remove_line", areaId: room.areaId, surfaceId: w.id })}>
              {w.label}
              <Counter value={w.count} min={1} max={20} testId={`q-count-win-${w.id}`} disabled={busy} onChange={(n) => void act({ action: "room_line_count", areaId: room.areaId, surfaceId: w.id, count: n })} />
              {seg([["S", "S"], ["M", "M"], ["L", "L"]], w.sizeBand, (v) => void act({ action: "room_win_size", areaId: room.areaId, surfaceId: w.id, size: v }), `q-win-size-${w.id}`)}
            </button>
          ))
          : chip(windows))}
        <button type="button" className="wzm-chip add" data-testid="q-add-surface" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>+ Add a surface</button>
      </div>
      {adding && (
        <div className="wzq-addpanel" data-testid="q-add-panel">
          <div className="wzm-chips">
            {tail.map((t) => <button key={String(t.key)} type="button" className="wzm-chip" disabled={busy} data-testid={`q-add-${String(t.key).replace(/[^a-z0-9]+/gi, "-")}`} onClick={() => { void act({ action: "toggle_surface", areaId: room.areaId, key: String(t.key), on: true }); setAdding(false); }}>+ {t.label}</button>)}
            {offered.map((o) => <button key={`${o.via}:${o.key}`} type="button" className="wzm-chip" disabled={busy} data-testid={`q-add-${o.key.replace(/[^a-z0-9]+/gi, "-")}`}
              onClick={() => { void act(o.via === "substrate" ? { action: "toggle_surface", areaId: room.areaId, key: o.key, on: true } : { action: "room_add_catalogue", areaId: room.areaId, code: o.key }); setAdding(false); }}>+ {o.label}</button>)}
            {windows?.on && <button type="button" className="wzm-chip" disabled={busy} data-testid="q-add-window-group" onClick={() => { void act({ action: "room_add_window_group", areaId: room.areaId }); setAdding(false); }}>+ More windows — a different size</button>}
          </div>
          <label className="wzq-field wzq-field--text">
            <span>Something else</span>
            <input value={custom} placeholder="e.g. balustrade" data-testid="q-custom-surface" onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) { void act({ action: "room_custom", areaId: room.areaId, name: custom.trim().slice(0, 120) }); setCustom(""); setAdding(false); } }} />
          </label>
          <p className="wzm-note">Priced by your estimator. Press Enter to add it.</p>
        </div>
      )}
      <p className="wzm-note" data-testid="q-win-key">Windows: S under 50 × 50 cm · M to 1.5 m · L over 1.5 m</p>
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={onNext} data-testid="q-next">{busy ? "Saving…" : "Next"}</button>
      </div>
    </>
  );
}

/** §3 B3 — robes and cupboards: No advances; Yes asks the loop's own two questions (the doors, the walls inside) — `room_cupboard` / `room_cupboard_interior`. */
function RobeScreen({ card, busy, act, onNext }: { card: RobeCard; busy: boolean; act: Act; onNext: () => void }) {
  const room = card.room;
  const [robe, setRobe] = useState<"none" | "yes" | null>(room.cupboard?.on === true || room.cupboardInterior?.on === true ? "yes" : room.cupboard?.on === false ? "none" : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const pick = (v: "none" | "yes") => {
    setRobe(v);
    if (v === "none") {
      const actions = [{ action: "room_cupboard", areaId: room.areaId, on: false, count: null }, ...(room.cupboardInterior ? [{ action: "room_cupboard_interior", areaId: room.areaId, on: false, count: null }] : [])];
      void act({ actions });
      timer.current = setTimeout(onNext, 300);
    }
  };
  const yn = (value: boolean | null, pickYn: (on: boolean) => void, testId: string) => (
    <div className="wzm-opts two" data-testid={testId}>
      <button type="button" className={`wzm-opt ${value === true ? "on" : ""}`} aria-pressed={value === true} disabled={busy} data-testid={`${testId}-yes`} onClick={() => pickYn(true)}><span><span className="t">Yes</span></span></button>
      <button type="button" className={`wzm-opt ${value === false ? "on" : ""}`} aria-pressed={value === false} disabled={busy} data-testid={`${testId}-no`} onClick={() => pickYn(false)}><span><span className="t">No</span></span></button>
    </div>
  );
  return (
    <>
      <h1 data-testid="wzm-h1">Any built-in robes or cupboards being painted?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Wardrobes, linen press, hall cupboards.</p>
      <div className="wzm-opts two" data-testid="q-robe">
        <button type="button" className={`wzm-opt ${robe === "none" ? "on" : ""}`} aria-pressed={robe === "none"} disabled={busy} data-testid="q-robe-none" onClick={() => pick("none")}><span><span className="t">No</span></span></button>
        <button type="button" className={`wzm-opt ${robe === "yes" ? "on" : ""}`} aria-pressed={robe === "yes"} disabled={busy} data-testid="q-robe-yes" onClick={() => pick("yes")}><span><span className="t">Yes</span></span></button>
      </div>
      {robe === "yes" && (
        <div className="wzq-sub" data-testid="q-robe-more">
          {room.cupboard && <><p className="wzq-grp">{room.cupboard.question}</p>{yn(room.cupboard.on, (on) => void act({ action: "room_cupboard", areaId: room.areaId, on, count: null }), "q-robe-doors")}</>}
          {room.cupboardInterior && <><p className="wzq-grp">{room.cupboardInterior.question}</p>{yn(room.cupboardInterior.on, (on) => void act({ action: "room_cupboard_interior", areaId: room.areaId, on, count: null }), "q-robe-inside")}</>}
          <p className="wzm-note">Inside: shelves out, filling minor cracks and sanding — allowances set by us.</p>
        </div>
      )}
      {robe === "yes" && (
        <div className="wzm-foot" data-testid="wzm-foot">
          <button type="button" className="wzm-cta" disabled={busy} onClick={onNext} data-testid="q-next">{busy ? "Saving…" : "Next"}</button>
        </div>
      )}
    </>
  );
}

/** §3 B4 — anything needing attention: the spot tags (+ a feature wall), how much of it, a photo of the spot; "Nothing to fix — next" or "Add it". */
function AttentionScreen({ card, busy, act, estimateId, onNext }: { card: AttentionCard; busy: boolean; act: Act; estimateId: string; onNext: () => void }) {
  const room = card.room;
  const tags = tagsFor("interior");
  const [picked, setPicked] = useState<string[]>([]);
  const [extent, setExtent] = useState<SpotExtent>("spots");
  const [note, setNote] = useState("");
  const photo = useRoomPhotos(estimateId, room.areaId, room.name, "prep", true);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const featureOn = room.extras.featureWalls > 0;
  const needsNote = picked.includes(OTHER_TAG_KEY) && note.trim() === "";
  const addAll = async () => {
    for (const k of picked) {
      if (k === "feature_wall") { await act({ action: "room_extra", areaId: room.areaId, kind: "feature_wall", count: 1 }); continue; }
      const sug = photo.last?.suggestion;
      await act({ action: "add_spot", areaId: room.areaId, tag: k, extent, ...(sug && sug.tag === k && sug.severity ? { severity: sug.severity } : {}), sourceId: photo.last?.sourceId ?? null, ...(k === OTHER_TAG_KEY ? { note: note.trim().slice(0, 300) } : {}) });
    }
    setPicked([]); setNote(""); photo.clear();
    onNext();
  };
  return (
    <>
      <h1 data-testid="wzm-h1">Anything needing attention?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Tap what you can see. A photo lets us price the repair straight away; without one, a person prices it.</p>
      {(room.spots.length > 0 || featureOn) && (
        <div className="wzq-noted" data-testid="q-spots-noted">
          {room.spots.map((sp) => (
            <span key={sp.surfaceId} className="wzq-noted-row" data-testid={`q-spot-${sp.surfaceId}`}>{sp.label}<button type="button" aria-label={`Remove ${sp.label}`} disabled={busy} onClick={() => void act({ action: "remove_spot", areaId: room.areaId, surfaceId: sp.surfaceId })}>×</button></span>
          ))}
          {featureOn && <span className="wzq-noted-row" data-testid="q-spot-feature">Feature wall<button type="button" aria-label="Remove feature wall" disabled={busy} onClick={() => void act({ action: "room_extra", areaId: room.areaId, kind: "feature_wall", count: 0 })}>×</button></span>}
        </div>
      )}
      <div className="wzm-chips" data-testid="q-prep">
        {tags.map((t) => <button key={t.key} type="button" className={`wzm-chip ${picked.includes(t.key) ? "on" : ""}`} aria-pressed={picked.includes(t.key)} data-testid={`q-prep-${t.key}`} onClick={() => toggle(t.key)}>{t.label}</button>)}
        {!featureOn && <button type="button" className={`wzm-chip ${picked.includes("feature_wall") ? "on" : ""}`} aria-pressed={picked.includes("feature_wall")} data-testid="q-prep-feature" onClick={() => toggle("feature_wall")}>Feature wall</button>}
      </div>
      {picked.includes(OTHER_TAG_KEY) && (
        <label className="wzq-field wzq-field--text" data-testid="q-prep-note">
          <span>What is it?</span>
          <input value={note} placeholder="In your own words" maxLength={300} data-testid="q-prep-note-input" onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      {picked.some((k) => k !== "feature_wall") && (
        <>
          <p className="wzq-grp">How much of it is there?</p>
          <div className="wzm-opts wzq-three" data-testid="q-prep-extent">
            {SPOT_EXTENTS.map((x) => <button key={x} type="button" className={`wzm-opt ${extent === x ? "on" : ""}`} aria-pressed={extent === x} data-testid={`q-prep-extent-${x}`} onClick={() => setExtent(x)}><span><span className="t">{EXTENT_LABEL[x]}</span></span></button>)}
          </div>
          <div className="wzq-photo">
            <PhotoDrop testId="q-prep-photo" title="Take or attach a photo of the spot" hint="With a photo we price the repair; without one, a person does." ready={photo.ready ? `${photo.ready} — we'll price the repair from it` : null} disabled={photo.busy || photo.full} onFiles={photo.add} />
            {photo.error && <p className="wz-err" data-testid="q-photo-error">{photo.error}</p>}
          </div>
        </>
      )}
      <div className="wzm-foot" data-testid="wzm-foot">
        {picked.length === 0
          ? <button type="button" className="wzm-cta" disabled={busy} onClick={onNext} data-testid="q-next">{busy ? "Saving…" : "Nothing to fix — next"}</button>
          : <button type="button" className="wzm-cta" disabled={busy || photo.busy || needsNote} onClick={() => void addAll()} data-testid="q-prep-add">{busy ? "Saving…" : "Add it"}</button>}
      </div>
    </>
  );
}

/** §3 E1 — have we got every room? The list, + Add a room (opens on its size card), a plan garage, and the doors-and-windows check kept from the live page. */
function RoomsScreen({ card, busy, act, roomTypes, onAdded, onNext }: { card: RoomsCard; busy: boolean; act: Act; roomTypes: string[]; onAdded: (areaId: number) => void; onNext: () => void }) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dwOk, setDwOk] = useState<boolean | null>(null);
  const label = (t: string) => ADD_ROOM_TYPES.find((x) => x.value === t)?.label ?? (t === "wc" ? "WC" : t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
  const types = [...roomTypes].sort((a, b) => (a === "hallway" ? -1 : b === "hallway" ? 1 : a.localeCompare(b)));
  const dims = (r: QuoteRoom) => `${r.widthM} × ${r.lengthM} m`;
  const add = async () => {
    const roomType = type ?? (name.trim() ? roomTypeForName(name) : null);
    if (!roomType) return;
    const before = new Set(card.rooms.map((r) => r.areaId));
    const j = await act({ action: "add_room", roomType, ...(name.trim() ? { name: name.trim().slice(0, 120) } : {}) });
    if (!j) return;
    const fresh = (j.scopeRooms ?? []).find((r) => !before.has(r.areaId));
    setAdding(false); setType(null); setName("");
    if (fresh) onAdded(fresh.areaId);
  };
  const done = async () => {
    if (dwOk === null) await act({ action: "iloop_check_done", item: "dw" });
    const j = await act({ action: "iloop_check_done", item: "sweep" });
    if (j) onNext();
  };
  return (
    <>
      <h1 data-testid="wzm-h1">Have we got every room?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Hallways are the rooms people forget most — and they make the biggest difference. Laundries, toilets, studies and garages go missing too.</p>
      <ul className="wzq-rooms" data-testid="q-rooms">
        {card.rooms.map((r) => <li key={r.areaId} data-testid={`q-room-${r.areaId}`}>{r.name}<span>{dims(r)}</span></li>)}
      </ul>
      {card.rooms.filter((r) => r.garagePending).map((r) => (
        <div key={`g${r.areaId}`} className="wzq-sub" data-testid={`q-garage-${r.areaId}`}>
          <p className="wzq-grp">The plan shows a garage — are we painting it?</p>
          <div className="wzm-chips">
            <button type="button" className="wzm-chip" disabled={busy} data-testid={`q-garage-${r.areaId}-yes`} onClick={() => void act({ action: "set_garage", areaId: r.areaId, on: true })}>Yes</button>
            <button type="button" className="wzm-chip" disabled={busy} data-testid={`q-garage-${r.areaId}-no`} onClick={() => void act({ action: "set_garage", areaId: r.areaId, on: false })}>No</button>
          </div>
        </div>
      ))}
      <div className="wzm-chips" style={{ marginTop: 12 }}>
        <button type="button" className="wzm-chip add" data-testid="q-add-room" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>+ Add a room</button>
      </div>
      {adding && (
        <div className="wzq-addpanel" data-testid="q-add-room-panel">
          <div className="wzm-chips">
            {types.map((t) => <button key={t} type="button" className={`wzm-chip ${type === t ? "on" : ""}`} aria-pressed={type === t} data-testid={`q-room-type-${t}`} onClick={() => { setType(t); if (!name.trim()) setName(label(t)); }}>{label(t)}</button>)}
          </div>
          <label className="wzq-field wzq-field--text">
            <span>Name</span>
            <input value={name} placeholder="e.g. Study" data-testid="q-room-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          </label>
          <button type="button" className="wzm-chip on" disabled={busy || (!type && !name.trim())} data-testid="q-add-room-go" onClick={() => void add()}>Add it</button>
        </div>
      )}
      {(card.doors > 0 || card.windows > 0) && (
        <div className="wzq-sub" data-testid="q-dw">
          <p className="wzq-grp">{card.doors} {card.doors === 1 ? "door" : "doors"} and {card.windows} {card.windows === 1 ? "window" : "windows"} across the house — right?</p>
          <div className="wzm-chips">
            <button type="button" className={`wzm-chip ${dwOk === true ? "on" : ""}`} aria-pressed={dwOk === true} disabled={busy} data-testid="q-dw-yes" onClick={() => { setDwOk(true); void act({ action: "iloop_check_done", item: "dw" }); }}>Yes</button>
            <button type="button" className={`wzm-chip ${dwOk === false ? "on" : ""}`} aria-pressed={dwOk === false} disabled={busy} data-testid="q-dw-no" onClick={() => { setDwOk(false); void act({ action: "iloop_dw", ok: false }); }}>Not quite</button>
          </div>
          {dwOk === false && <p className="wzm-note" data-testid="q-dw-hint">Tap ‹ to go back to a room and use − / + on its doors or windows.</p>}
        </div>
      )}
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={() => void done()} data-testid="q-next">{busy ? "Saving…" : "That's every room"}</button>
      </div>
    </>
  );
}

/** §3 E2 — anything we haven't listed? The rate card's named extras (priced), help with colours, and a note a person prices. */
function ExtrasScreen({ offer, state, busy, act, onNext }: { offer: JobExtra[]; state: JobExtrasState; busy: boolean; act: Act; onNext: () => void }) {
  const [note, setNote] = useState(state.note);
  const on = new Set(state.on);
  const slug = (code: string) => code.replace(/\s+/g, "-").toLowerCase();
  const flushNote = async () => { if (note.trim() !== state.note.trim()) await act({ action: "extra_note", note: note.trim().slice(0, 400) }); };
  return (
    <>
      <h1 data-testid="wzm-h1">Anything we haven&rsquo;t listed?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Name it and we&rsquo;ll price it. Anything unusual, tell us and a person prices it rather than guessing.</p>
      <div className="wzm-chips" data-testid="q-extras">
        {offer.map((e) => {
          const isOn = on.has(e.code);
          return (
            <button key={e.code} type="button" className={`wzm-chip ${isOn ? "on" : ""}`} aria-pressed={isOn} disabled={busy} data-testid={`q-extra-${slug(e.code)}`} onClick={() => void act({ action: "toggle_job_extra", code: e.code, on: !isOn })}>
              {e.label} · ${e.priceDollars.toLocaleString("en-AU")}
              {isOn && <Counter value={state.counts[e.code] ?? 1} min={1} max={20} testId={`q-extra-count-${slug(e.code)}`} disabled={busy} onChange={(n) => void act({ action: "toggle_job_extra", code: e.code, on: true, count: n })} />}
            </button>
          );
        })}
        <button type="button" className={`wzm-chip ${state.colourHelp ? "on" : ""}`} aria-pressed={state.colourHelp} disabled={busy} data-testid="q-extra-colour" onClick={() => void act({ action: "set_colour_help", want: !state.colourHelp })}>Help me choose colours</button>
      </div>
      <label className="wzq-field wzq-field--text wzq-field--area">
        <span>Something else?</span>
        {/* no flush on blur: the blur fires on the Next tap's pointer-down, the save disables Next, and the tap is lost (C1 proof, 5 Nov) — Next flushes the note itself */}
        <textarea value={note} placeholder="In your own words." maxLength={400} rows={3} data-testid="q-extra-note" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={async () => { await flushNote(); onNext(); }} data-testid="q-next">{busy ? "Saving…" : "Next"}</button>
      </div>
    </>
  );
}

/** §3 C1 — "How big is the {side}?": across · high over greyed typicals (R2); "That's the size" → `side_dims`, "Not sure" → `side_size_ok`. */
function SideSizeScreen({ card, busy, v2, walk, onDone }: { card: SideSizeCard; busy: boolean; v2: ExteriorV2; walk: (next: ExteriorV2) => Promise<Payload | null>; onDone: (measured: boolean) => void }) {
  const [draft, setDraft] = useState({ w: "", h: "" });
  const typed = draft.w.trim() !== "" || draft.h.trim() !== "";
  const num = (v: string, fallback: number) => { const n = parseFloat(v.replace(/[^0-9.]/g, "")); return isNaN(n) || n <= 0 ? fallback : n; };
  const submit = async () => {
    // the walk-around's own answers: adjusted with the numbers (clamped by the model), or "not sure" = the typical stands
    const j = typed
      ? await walk(setSideSize(v2, card.sideKey, "adj", { w: Math.min(60, Math.max(0.5, num(draft.w, card.side.lengthM))), h: Math.min(12, Math.max(1, num(draft.h, card.side.widthM))) }))
      : await walk(setSideSize(v2, card.sideKey, "ns"));
    if (j) onDone(typed);
  };
  const field = (key: "w" | "h", label: string, typical: number) => (
    <label className={`wzq-field ${draft[key].trim() ? "" : "typ"}`}>
      <span>{label}</span>
      <input inputMode="decimal" placeholder={String(typical)} value={draft[key]} data-testid={`q-side-${key}`} autoFocus={key === "w"} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      <em>m</em>
    </label>
  );
  return (
    <>
      <h1 data-testid="wzm-h1">How big is the {card.name.toLowerCase()}?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Corner to corner, ground to the gutter line. No tape? Walk it out — one large step is about a metre.</p>
      <div className="wzq-meas wzq-meas--two" data-testid="q-side-measure" data-measured={card.side.size === "adjusted" ? "1" : "0"}>
        {field("w", "Across", card.side.lengthM)}{field("h", "High", card.side.widthM)}
      </div>
      {!typed && <p className="wzm-note" data-testid="q-typical-note">{card.side.size === "adjusted" ? "Your numbers — type over them to change them." : "The grey numbers are typical for a side like this — type yours over them."}</p>}
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={() => void submit()} data-testid="q-size-ok">{busy ? "Saving…" : "That's the size"}</button>
        <p className="wzm-hint"><button type="button" className="wzm-linkish" disabled={busy} onClick={async () => { const j = await walk(setSideSize(v2, card.sideKey, "ns")); if (j) onDone(false); }} data-testid="q-size-typical">Not sure — use the typical size for now</button></p>
      </div>
    </>
  );
}

/** §3 C2 — "On this side": the side's counted lines (windows, doors…) with − / +, a window group's S / M / L, and how the paint is on this side. */
const COND_HINT: Record<"good" | "weathered" | "peeling", string> = {
  good: "Sound surfaces, maybe a few marks — a light sand and it's ready for paint.",
  weathered: "Typical for a house not painted in 6–7 years — faded or chalky in places, a few cracked or peeling spots.",
  peeling: "Lifting or flaking with bare timber showing — scraped back and properly prepared before any paint goes on.",
};

function SideOnScreen({ card, busy, act, v2, rows, walk, onNext }: { card: SideOnCard; busy: boolean; act: Act; v2: ExteriorV2; rows: ReadonlyArray<ExteriorTypicalRow>; walk: (next: ExteriorV2) => Promise<Payload | null>; onNext: () => void }) {
  const sd = v2.sides[card.sideKey];
  const t = typicalFor(v2.propertyType, rows);
  const on = new Set(partsOnSide(v2, card.sideKey, t));
  const listed = sideListParts(v2, card.sideKey, t);
  const addable = sideAddableParts(v2, card.sideKey, t);
  const [adding, setAdding] = useState(false);
  const posts = sd?.posts ?? postCount(sd?.w ?? 0);
  // windows and doors are the drawn house's own counts (the walk-around's steppers); everything else priced per item on
  // this side keeps the tree's counter. The server derives the whole-house condition and the peeling sides from the model.
  const tiles = (card.side.sideTiles ?? []).filter((t) => !t.window && !/door/i.test(t.label));
  const cond = sd?.cond ?? null;
  const pickCond = (c: "good" | "weathered" | "peeling") => { void walk(setSideCond(v2, card.sideKey, c)); };
  const stepper = (testId: string, label: string, value: number, set: (n: number) => void, max: number) => (
    <div className="wzm-step" data-testid={testId}>
      <span className="l">{label}</span>
      <span className="stp">
        <button type="button" aria-label="Fewer" disabled={busy || value <= 0} onClick={() => set(value - 1)}>−</button>
        <b data-testid={`${testId}-n`}>{value}</b>
        <button type="button" aria-label="More" disabled={busy || value >= max} onClick={() => set(value + 1)}>+</button>
      </span>
    </div>
  );
  return (
    <>
      <h1 data-testid="wzm-h1">On this side</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Count them up — the house&rsquo;s parts you ticked, on the {card.name.toLowerCase()}.</p>
      {/* Tom, 5 Nov 2026: what is on this side — untick a part, or add one that was never ticked (shutters, a handrail, fascias…) */}
      <div className="wzm-chips" data-testid="q-side-parts">
        {listed.map((p) => (
          <button key={p} type="button" className={`wzm-chip ${on.has(p) ? "on" : ""}`} aria-pressed={on.has(p)} disabled={busy} data-testid={`q-side-part-${p}`} onClick={() => void walk(toggleSidePart(v2, card.sideKey, p, t))}>{PART_LABEL[p]}</button>
        ))}
        <button type="button" className="wzm-chip add" data-testid="q-side-add-open" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>{adding ? "Done adding" : "+ Add something"}</button>
      </div>
      {adding && (
        <div className="wzm-chips wzm-addchips" data-testid="q-side-add">
          {addable.map((p) => (
            <button key={p} type="button" className="wzm-chip" disabled={busy} data-testid={`q-side-addpart-${p}`} onClick={() => { void walk(toggleSidePart(v2, card.sideKey, p, t)); setAdding(false); }}>{PART_LABEL[p]}</button>
          ))}
          {addable.length === 0 && <span className="wzm-note">Everything is already on this side.</span>}
        </div>
      )}
      {sd && (
        <div className="wzm-steps" data-testid="q-side-counts">
          {on.has("windows") && stepper("q-side-win", "Windows", sd.windows, (n) => void walk(setSideCounts(v2, card.sideKey, { windows: n })), 60)}
          {on.has("doors") && stepper("q-side-door", "Doors", sd.doors, (n) => void walk(setSideCounts(v2, card.sideKey, { doors: n })), 20)}
          {on.has("posts") && stepper("q-side-posts", "Posts / columns", posts, (n) => void walk(setSideCounts(v2, card.sideKey, { posts: n })), 40)}
        </div>
      )}
      <div className="wzm-chips wzq-surf" data-testid="q-side-lines">
        {tiles.map((t) => (
          <span key={t.id} className="wzm-chip on" data-testid={`q-side-line-${t.id}`}>
            {t.label}
            {t.countable && <Counter value={t.count} min={1} max={20} testId={`q-side-count-${t.id}`} disabled={busy} onChange={(n) => void act({ action: "side_count", side: card.sideKey, surfaceId: t.id, count: n })} />}
            {t.window && t.sizeBand && (
              <span className="seg" data-testid={`q-side-win-size-${t.id}`}>
                {(["S", "M", "L"] as const).map((z) => <span key={z} role="button" tabIndex={0} className={t.sizeBand === z ? "sel" : ""} data-testid={`q-side-win-size-${t.id}-${z}`} onClick={() => void act({ action: "win_size", side: card.sideKey, surfaceId: t.id, size: z })} onKeyDown={(e) => { if (e.key === "Enter") void act({ action: "win_size", side: card.sideKey, surfaceId: t.id, size: z }); }}>{z}</span>)}
              </span>
            )}
          </span>
        ))}
        {tiles.length === 0 && !sd && <p className="wzm-note">Nothing counted on this side yet — the walls are priced by its size.</p>}
      </div>
      <p className="wzq-grp">How&rsquo;s the paint on this side?</p>
      <div className="wzm-opts wzq-cond" data-testid="q-side-cond">
        {([["good", "Good, just tired"], ["weathered", "Weathered"], ["peeling", "Peeling or flaking"]] as const).map(([k, label]) => (
          <button key={k} type="button" className={`wzm-opt ${cond === k ? "on" : ""}`} aria-pressed={cond === k} disabled={busy} data-testid={`q-side-cond-${k}`} onClick={() => pickCond(k)}><span><span className="t">{label}</span><span className="d">{COND_HINT[k]}</span></span></button>
        ))}
      </div>
      <div className="wzm-foot" data-testid="wzm-foot">
        <button type="button" className="wzm-cta" disabled={busy} onClick={onNext} data-testid="q-next">{busy ? "Saving…" : "Next"}</button>
      </div>
    </>
  );
}

/** §3 C3 — anything needing attention on this side: the outside tags, a photo; written as the side's note (`side_note`), which rides to the estimator. */
function SideAttentionScreen({ card, busy, act, estimateId, v2, onNext }: { card: SideAttentionCard; busy: boolean; act: Act; estimateId: string; v2: ExteriorV2 | null; onNext: () => void }) {
  // Tom, 5 Nov 2026: "Cracked render" only where render (or stucco) is a wall material — the house's or this side's own
  const rendered = (m: string | null | undefined) => m === "render" || m === "stucco";
  const hasRender = !v2 ? true : rendered(v2.wall.down) || rendered(v2.wall.up) || rendered(v2.sides[card.sideKey]?.material) || rendered(v2.sides[card.sideKey]?.materialUp);
  const tags = tagsFor("exterior").filter((t) => t.key !== OTHER_TAG_KEY && (hasRender || t.key !== "render"));
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const photo = useRoomPhotos(estimateId, card.areaId, card.name, "prep", false);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const addAll = async () => {
    const words = [...picked.map((k) => tags.find((t) => t.key === k)?.label ?? k), ...(note.trim() ? [note.trim()] : [])].join("; ");
    const j = await act({ action: "side_note", side: card.sideKey, note: words.slice(0, 600), photos: (card.side.sideNotePhotos ?? 0) + photo.count });
    if (!j) return;
    setPicked([]); setNote("");
    onNext();
  };
  return (
    <>
      <h1 data-testid="wzm-h1">Anything needing attention?</h1>
      <p className="wzm-sub" data-testid="wzm-sub">Tap what you can see on the {card.name.toLowerCase()}. A photo helps us price the prep; without one, a person prices it.</p>
      {card.side.sideNote && <div className="wzq-noted" data-testid="q-side-noted"><span className="wzq-noted-row">{card.side.sideNote}</span></div>}
      <div className="wzm-chips" data-testid="q-side-prep">
        {tags.map((t) => <button key={t.key} type="button" className={`wzm-chip ${picked.includes(t.key) ? "on" : ""}`} aria-pressed={picked.includes(t.key)} data-testid={`q-side-prep-${t.key}`} onClick={() => toggle(t.key)}>{t.label}</button>)}
      </div>
      <label className="wzq-field wzq-field--text">
        <span>Something else</span>
        <input value={note} placeholder="In your own words" maxLength={300} data-testid="q-side-note" onChange={(e) => setNote(e.target.value)} />
      </label>
      {(picked.length > 0 || note.trim()) && (
        <div className="wzq-photo">
          <PhotoDrop testId="q-side-photo" title="Take or attach a photo of it" hint="Helps us price the prep straight away." ready={photo.ready} disabled={photo.busy || photo.full} onFiles={photo.add} />
          {photo.error && <p className="wz-err" data-testid="q-photo-error">{photo.error}</p>}
        </div>
      )}
      <div className="wzm-foot" data-testid="wzm-foot">
        {picked.length === 0 && !note.trim()
          ? <button type="button" className="wzm-cta" disabled={busy} onClick={onNext} data-testid="q-next">{busy ? "Saving…" : "Nothing to fix — next side"}</button>
          : <button type="button" className="wzm-cta" disabled={busy || photo.busy} onClick={() => void addAll()} data-testid="q-prep-add">{busy ? "Saving…" : "Add it"}</button>}
      </div>
    </>
  );
}

