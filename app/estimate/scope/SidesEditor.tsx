"use client";
import { useRouter } from "next/navigation";

import FinalisePrompt from "./FinalisePrompt";
import AllDoneBanner from "./AllDoneBanner";
import EstimatorStrip from "@/app/wizard/EstimatorStrip";
import { alreadySentFrom, useAutoSend } from "./useAutoSend";
import SideNote from "./SideNote";
import PeelingPhotos from "./PeelingPhotos";
import { SIDE_LABEL as SIDE_FALLBACK, TWICE_OK_CODES } from "@/lib/wizard/sides";
import Paginated, { type PaginatedStep } from "./Paginated";
import { TIER_LABEL, type Ladder } from "@/lib/wizard/ladder";
import { afterLayout, scrollCardToTop } from "./scrollCard";
import { useRef, useState, useSyncExternalStore } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import type { CustomerExteriorView } from "@/lib/wizard/scope-editor";
import type { SidesView, SideView, SideKey } from "@/lib/wizard/sides";
import { assertCustomerShape } from "@/lib/wizard/contract";
import PlanPanel from "./PlanPanel";
import { useCoalesced } from "./useCoalesced";
import { useStickyRoom } from "./useStickyRoom";
import type { EstimateDocuments } from "@/lib/wizard/documents";
import WizardHeader from "@/app/wizard/WizardHeader";
import Wordmark from "@/app/wizard/Wordmark";
import TopView, { type TopSide } from "@/app/wizard/pictures/TopView";
import { rangeBand } from "./rangeBand";

/**
 * R2b — the exterior confirm-loop editor, BY SIDES.
 * Reference: design/reference/customer-review-confirm-exterior-v2-sides.html
 * (supersedes the element-grouped exterior layout).
 *
 * Everything here is display + one-tap POSTs to wizard-edit (view=customer);
 * the tree, the pricing and every validation live server-side. Eight loop
 * items confirm amber → cyan; the CTA stays disabled until all eight are
 * blue; a skipped side reads NOT PAINTING and is an explicit exclusion.
 */

type Payload = CustomerPayload & {
  error?: string;
  sides?: SidesView | null;
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
  /** A guardrail verdict arrives as a 200 with no range — see act(). */
  message?: string;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

/** Matches the wizard-edit route's own cap on a batch. */
const MAX_BATCH = 24;

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

/** A selectable chip — a real component so its onClick is a handler in the
 * linter's eyes (the old render-time chip() helper tripped react-hooks/refs). */
function Chip({ on, label, hint, onClick }: { on: boolean; label: string; hint?: string; onClick: () => void }) {
  return (
    // The hint is visible but NOT part of the accessible name — a chip is still
    // "Weathered" to a screen reader and to every spec that clicks it by name.
    <button className={`sd-chip ${on ? "on" : ""}${hint ? " has-hint" : ""}`} aria-label={hint ? label : undefined} onClick={onClick}>
      {label}
      {hint && <small className="sd-chip-hint" aria-hidden="true">{hint}</small>}
    </button>
  );
}

export default function SidesEditor({ estimateId, initial, initialSides, initialExterior, initialLadder, embedded = false, onState, openKey, onOpenKey, docs = { plan: null, photos: [] }, logoUrl = null, companyPhone = null, estimator = null, customerSuburb = null }: {
  estimateId: string;
  initial: CustomerPayload;
  initialSides: SidesView;
  initialExterior: CustomerExteriorView | null;
  initialLadder: Ladder;
  /** R5: the photos/plan on file — the embedded (Both-job) case leaves this
   * to the parent ScopeEditor so a stacked page shows ONE plan, not two. */
  docs?: EstimateDocuments;
  logoUrl?: string | null;
  companyPhone?: string | null;
  /** When the office answers the phone — Settings owns the wording. */
  phoneHours?: string | null;
  /** C7 (v2.4) — the estimator this goes to, for the CTA. Null keeps the old label. */
  sendTo?: string | null;
  /** Tom, 14 Sep (item 4): the resolved estimator for the frozen header. */
  estimator?: { name: string | null; phone: string | null; covers: boolean } | null;
  customerSuburb?: string | null;
  /** The mobile the customer already gave us (Tom, 8 Sep: don't ask twice). */
  customerPhone?: string | null;
  /** Batch 4: Both-jobs render the sides stack INSIDE the interior editor —
   * embedded mode drops SidesEditor's own chrome (header/range/CTA) and
   * reports progress + range upward so the host owns one combined loop. */
  embedded?: boolean;
  onState?: (s: { progress: SidesView["progress"]; payload: CustomerPayload; sides: SidesView }) => void;
  /** UI refresh S6: on a "both" page the room editor owns the ONE open card —
   * it passes the side that is open ("" = none of these) and hears every open. */
  openKey?: string;
  onOpenKey?: (key: string) => void;
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [sides, setSides] = useState<SidesView>(initialSides);
  const [exterior, setExterior] = useState<CustomerExteriorView | null>(initialExterior);
  const [ladder, setLadder] = useState<Ladder>(initialLadder);
  const [ownOpen, setOwnOpen] = useState<string>("front");
  const open = openKey ?? ownOpen;
  const setOpen = (k: string) => { if (onOpenKey) onOpenKey(k); else setOwnOpen(k); };
  const [dims, setDims] = useState({ L: "", H: "" });
  const [addOpen, setAddOpen] = useState<SideKey | null>(null);
  /** Tom, 8 Sep: a side can be given the customer's own name ("Courtyard"). */
  const [renaming, setRenaming] = useState<{ key: SideKey; value: string } | null>(null);
  /** Tom, 8 Sep: the metres on a lineal run, keyed `${side}:${surfaceId}`. */
  const [metres, setMetres] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState("");
  const [fenceText, setFenceText] = useState("");
  // Tom, 5 Oct: the pergola top's size — priced on length × width, never per pergola.
  const [pergolaL, setPergolaL] = useState(initialExterior?.pergola ? String(initialExterior.pergola.lengthM) : "");
  const [pergolaW, setPergolaW] = useState(initialExterior?.pergola ? String(initialExterior.pergola.widthM) : "");
  const [sweepOtherOpen, setSweepOtherOpen] = useState(false);
  const [sweepOtherText, setSweepOtherText] = useState("");
  const [prompt, setPrompt] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  // P1: production feel. `ready` gates interaction until React has hydrated
  // (pre-hydration clicks were silently lost on production); `pendingCount`
  // drives the SAVING… indicator while the action queue drains; `optimistic`
  // paints a tapped control selected IMMEDIATELY, replaced by server truth
  // when its response lands — a 1–3s production round-trip no longer reads
  // as a dead button.
  // (useSyncExternalStore is the canonical hydration detector: server
  // snapshot false, client snapshot true, no effect-driven re-render.)
  const ready = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse);
  const [pendingCount, setPendingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** The fixed footer takes no space in the flow — reserve its real height. */
  const stickRef = useRef<HTMLDivElement | null>(null);
  /** R5: a burst of stepper taps becomes ONE save (see useCoalesced). */
  const { queue, flush } = useCoalesced();
  useStickyRoom(stickRef, !embedded);

  function say(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /** Is `val` the selected state for control `key`? Optimistic overlay wins
   * until its action's response replaces it with server truth. */
  function sel(key: string, serverOn: boolean, val = "1"): boolean {
    const o = optimistic[key];
    return o != null ? o === val : serverOn;
  }

  type Queued = {
    body: Record<string, unknown>;
    opts: { done?: string; describe?: (deltaCents: number) => string; onFail?: (msg: string) => void; onOk?: (j: Payload) => void; opt?: [string, string] };
  };

  /**
   * A confirm ENDS its batch — nothing tapped after it travels with it.
   *
   * A confirm is the one action whose refusal is a normal part of the walk
   * ("the wall surfaces need to add up to 100%"), and a batch stops at the
   * first refusal. Batching past one therefore threw away the customer's
   * CORRECTION: tapping 50% → confirm → 100% → confirm quickly arrived as a
   * single batch, the first confirm refused exactly as designed, and the
   * 100% fix and its confirm were dropped on the floor. Caught by
   * sides-editor's "amber to cyan" failing 2 runs in 3.
   */
  const endsBatch = (body: Record<string, unknown>) =>
    String(body.action ?? "").startsWith("confirm_");
  const queuedRef = useRef<Queued[]>([]);

  /**
   * R5.1: the same queue the interior editor uses. Taps queue as WORK, not as
   * requests — a step sweeps up everything tapped since the last one and
   * sends it as one batch, so a side with several surfaces to add costs two
   * round trips rather than six. Ordering comes from the chain, so a confirm
   * appended after a tap can never overtake it.
   */
  function drain() {
    chainRef.current = chainRef.current.then(async () => {
      // Take up to MAX_BATCH (the route's own cap), stopping AFTER the first
      // confirm. The rest waits for the next step rather than being dropped.
      const q = queuedRef.current;
      let take = 0;
      while (take < q.length && take < MAX_BATCH) { take++; if (endsBatch(q[take - 1].body)) break; }
      const batch = q.slice(0, take);
      if (batch.length === 0) return;
      queuedRef.current = q.slice(take);
      const before = (payload.rangeLoCents + payload.rangeHiCents) / 2;
      // The last tap owns the toast and the callbacks — it is the one the
      // customer is watching.
      const opts = batch[batch.length - 1].opts;
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            batch.length === 1
              ? { ...batch[0].body, view: "customer" }
              : { actions: batch.map((b) => b.body), view: "customer" },
          ),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) {
          (opts.onFail ?? say)(j.error ?? "That didn't save — try again.");
          return;
        }
        assertCustomerShape(j, "SidesEditor");
        // R5: a guardrail outcome is a 200 with NO range in it. Storing it as
        // the payload rendered "$NaN – $NaN" and an NaN progress ring — the
        // screen looked broken at exactly the moment we needed to explain
        // ourselves. Keep the last good numbers and say the sentence instead.
        if (typeof j.outcome === "string" && j.outcome !== "reveal") {
          say(j.message ?? "That change needs one of our team — we'll be in touch.");
          return;
        }
        setPayload(j);
        if (j.sides) setSides(j.sides);
        if (j.sides) onState?.({ progress: j.sides.progress, payload: j, sides: j.sides });
        if (j.exterior !== undefined) setExterior(j.exterior ?? null);
        if (j.ladder) setLadder(j.ladder);
        // The interior editor's $-delta toasts, same recipe: the range
        // midpoint before vs after IS the honest customer-visible delta.
        // A batch that stopped part-way still saved what applied.
        if (j.error) (opts.onFail ?? say)(j.error);
        else if (opts.describe) say(opts.describe((j.rangeLoCents + j.rangeHiCents) / 2 - before));
        else if (opts.done) say(opts.done);
        // EVERY item's onOk runs, not just the last one's. The confirm
        // buttons hang `openNext` here, and a confirm that landed in the
        // middle of a batch (tap a side's confirm, then immediately open the
        // next side) would otherwise never advance the walk — an
        // intermittent stall that showed up as sides-editor's "amber to
        // cyan" failing on one run in several. openNext reads the payload,
        // so running it per item is idempotent.
        if (!j.error) for (const b of batch) b.opts.onOk?.(j);
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        setPendingCount((n) => n - batch.length);
        for (const b of batch) {
          if (b.opts.opt) setOptimistic((o) => { const n = { ...o }; delete n[b.opts.opt![0]]; return n; });
        }
        if (queuedRef.current.length) drain();
      }
    });
  }

  function act(
    body: Record<string, unknown>,
    opts: { done?: string; describe?: (deltaCents: number) => string; onFail?: (msg: string) => void; onOk?: (j: Payload) => void; opt?: [string, string] } = {},
  ) {
    if (opts.opt) setOptimistic((o) => ({ ...o, [opts.opt![0]]: opts.opt![1] }));
    setPendingCount((n) => n + 1);
    queuedRef.current.push({ body, opts });
    drain();
  }

  function refuse(cardKey: string, msg: string) {
    setShake(cardKey);
    setTimeout(() => setShake(null), 400);
    say(msg);
  }

  /** "…— about +$X on your range" when the reprice moved the range; the
   * plain message when it didn't (e.g. the answer was already priced in). */
  const withDelta = (msg: string) => (delta: number) => {
    const abs = Math.abs(Math.round(delta));
    if (abs < 100) return msg;
    return `${msg.replace(/\.$/, "")} — about ${delta > 0 ? "+" : "−"}${fmt(abs)} on your range.`;
  };

  /** R5: what one side can still have added, grouped by the card's own
   * sub-categories. Anything already on the side — or already offered as a
   * priced catalogue chip — is left out. */
  function sideAddGroups(s: SideView): Array<[string, SidesView["addable"]]> {
    const onCount = new Map<string, number>();
    for (const t of s.tiles) onCount.set(t.code, (onCount.get(t.code) ?? 0) + 1);
    const priced = new Set(sides.catalog.map((c) => c.code));
    const groups = new Map<string, SidesView["addable"]>();
    for (const o of sides.addable ?? []) {
      const on = onCount.get(o.key) ?? 0;
      // Eaves, gutters and fascias may go on twice — a lower run and an upper
      // run (Tom, 5 Sep for eaves; 8 Sep for gutters and fascias). The set is
      // sides.ts's own, so the panel and the server can never disagree about
      // what a second row is allowed to be.
      const secondOk = TWICE_OK_CODES.has(o.key) && on === 1;
      if ((on > 0 && !secondOk) || priced.has(o.key)) continue;
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(secondOk ? { ...o, label: `${o.label} (second run, upper)` } : o);
    }
    return [...groups.entries()];
  }

  const range = `${fmt(payload.rangeLoCents)} – ${fmt(payload.rangeHiCents)}`;
  // UI refresh S5: the price card's band (rangeBand.ts) — where the guide range started vs now.
  const [startRange] = useState(() => ({ lo: initial.rangeLoCents, hi: initial.rangeHiCents }));
  const band = rangeBand(startRange, { lo: payload.rangeLoCents, hi: payload.rangeHiCents });
  const prog = sides.progress;
  const allDone = prog.allDone;
  // Tom, 14 Sep (items 2, 3, 31) — see ScopeEditor: the same gate, the same send.
  const router = useRouter();
  const goBook = () => router.push(`/estimate/book?id=${estimateId}`);
  const autoSend = useAutoSend(estimateId, !embedded && allDone, ready && pendingCount === 0, alreadySentFrom(payload.confirmOnSite));
  const sentHref = `/estimate/sent?id=${estimateId}`;
  function onFinalise() {
    if (autoSend === "sent") { router.push(sentHref); return; }
    if (!allDone) { setPrompt(true); return; }
    router.push(`/estimate/finish?id=${estimateId}`);
  }
  function answerRemaining() {
    setPrompt(false);
    const first = document.querySelector<HTMLElement>(".sd-card:not(.done)");
    if (first) { const key = first.getAttribute("data-side"); if (key) setOpen(key); first.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  const openNext = (j?: Payload) => {
    const v = j?.sides ?? sides;
    // Tom, 15 Sep (late): condition first, the last checks last.
    const order: string[] = ["cond", "front", "left", "right", "back", "extras", "dw", "sweep"];
    const doneOf = (k: string) =>
      k === "extras" ? v.meta.done.extras : k === "cond" ? v.meta.done.cond
      : k === "dw" ? v.meta.done.dw : k === "sweep" ? v.meta.done.sweep
      // Tom, 15 Sep: a side taken off the estimate has nothing to open — it
      // counts as done here, or the loop would try to open a card that is gone.
      : v.sides.find((s) => s.key === k)?.confirmed ?? true;
    const nxt = order.find((k) => !doneOf(k));
    if (nxt === "cond" || nxt === "dw" || nxt === "sweep") {
      // The paginated blocks show their first open question on their own.
      setOpen("");
      afterLayout(() => scrollCardToTop(document.querySelector(nxt === "cond" ? '[data-testid="sides-q"]' : '[data-testid="sides-last"]')));
      return;
    }
    if (nxt) {
      setOpen(nxt);
      // Same rule as the interior loop: the next side's NAME lands under the
      // sticky header, so the customer always sees which side they are on.
      afterLayout(() => scrollCardToTop(document.querySelector(`[data-side="${nxt}"]`)));
    }
  };

  const extrasTiles = exterior?.groups.find((g) => g.group === "extras")?.tiles ?? [];
  // Tom, 15 Sep: nothing ticked is an answer — the card confirms as it is.
  const extrasAnswered = sides.meta.done.extras || extrasTiles.some((t) => t.on);

  /** The short word for a side in running copy — the customer's own name for it wins. */
  const shortSide = (k: SideKey) => sides.sides.find((x) => x.key === k)?.customLabel?.toLowerCase() ?? k;

  function sideCard(s: SideView) {
    const isOpen = open === s.key;
    // UI refresh S5 (⚑ 7, the mockup's wording): the same pill words as the room cards.
    const pill = s.confirmed ? (s.include === false ? "Not painting" : "Checked ✓") : isOpen ? "Close" : "Check this side";
    const cls = `sd-card ${s.confirmed ? (s.include === false ? "skip" : "done") : ""} ${isOpen ? "open" : ""} ${shake === s.key ? "shake" : ""}`;
    return (
      <section className={cls} key={s.key} data-side={s.key}>
        <div className="sd-hd" onClick={() => setOpen(s.key)}>
          {renaming?.key === s.key ? (
            /* Tom, 8 Sep: "I can click left side and change the name to
               courtyard." The canonical side word stays in the block name so
               nothing downstream loses track of which elevation this is. */
            <form className="sd-rn" data-testid={`side-rename-${s.key}`} onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const name = renaming.value.trim().slice(0, 40);
                setRenaming(null);
                act({ action: "rename_side", side: s.key, name }, {
                  done: name ? `Renamed to “${name}”.` : `Back to “${SIDE_FALLBACK[s.key]}”.`,
                });
              }}>
              <input autoFocus value={renaming.value} maxLength={40} aria-label="Name for this side"
                placeholder={SIDE_FALLBACK[s.key]}
                onChange={(e) => setRenaming({ key: s.key, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
              <button type="submit" className="sd-x sd-xw">Save</button>
              <button type="button" className="sd-x sd-xw" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <b>
              {s.label}
              <button type="button" className="sd-rename" data-testid={`side-rename-open-${s.key}`}
                aria-label={`Rename ${s.label}`}
                onClick={(e) => { e.stopPropagation(); setRenaming({ key: s.key, value: s.customLabel ?? "" }); }}>
                Rename
              </button>
            </b>
          )}
          <span className="sd-pill">{pill}</span>
          {/* Tom, 16 Sep: a side is deleted the way a room is — the × on the
              header, whatever state the card is in. There is no way back: a
              deleted side leaves the estimate for good (Tom's ruling). */}
          <button type="button" className="sd-x sd-xhd" data-testid={`side-delete-${s.key}`} aria-label={`Remove ${s.label}`}
            onClick={(e) => { e.stopPropagation(); act({ action: "side_include", side: s.key, include: false }, { done: `${s.label} taken off your estimate.`, onOk: openNext }); }}>×</button>
        </div>
        {isOpen && (
          <div className="sd-body">
            {s.include !== true && (
            <div className={`sd-q ${s.include != null ? "ok" : ""}`}>
              <p className="sd-ql">Are we painting this side? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
              <div className="sd-chips">
                <button className={`sd-chip ${sel(`which:${s.key}`, false, "1") ? "on" : ""}`} onClick={() => act({ action: "side_include", side: s.key, include: true }, { opt: [`inc:${s.key}`, "yes"] })}>Yes</button>
                <button
                  className={`sd-chip ${sel(`inc:${s.key}`, s.include === false, "no") ? "on" : ""}`}
                  onClick={() => act({ action: "side_include", side: s.key, include: false }, {
                    done: `${s.label} taken off your estimate.`,
                    onOk: openNext,
                    opt: [`which:${s.key}`, "0"],
                  })}
                >
                  No, leave it off
                </button>
              </div>
            </div>
            )}

            {s.include === true && (
              <>
                <div className={`sd-q il-first ${s.size != null ? "ok" : ""}`}>
                  {/*
                    ⚑ Tom, 10 Sep: "the sizing needs to be added in and not
                    assumed for exterior."

                    This used to READ the assumption back — "this side's about
                    12 m long × 5.5 m high, sound right?" — with "Looks right"
                    as the easy tap. On an exterior the range is mostly length ×
                    height, so accepting a guess with one tap is how a quote
                    ends up confidently wrong. The boxes are there from the
                    start and empty: the assumption is shown as what we USED,
                    not as an answer to agree with, and "not sure" is still
                    there for somebody who genuinely does not know.
                  */}
                  <p className="il-kick">FIRST — THE SIZE OF THIS SIDE</p>
                  <p className="sd-ql">
                    How big is this side? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span>
                  </p>
                  <p className="sd-help" data-testid={`side-assumed-${s.key}`}>
                    {s.size === "ns"
                      ? `We'll measure this side on the day — your range stays wider until then.`
                      : s.size === "adjusted" || s.size === "yes"
                        ? `Recorded: ${s.L} m long × ${s.H} m high.`
                        : s.mirroredFrom
                          ? `Same as the ${shortSide(s.mirroredFrom)} — ${s.L} m × ${s.H} m. Check it and tap Update, or change the numbers.`
                          : `Your guide range used ${s.L} m × ${s.H} m — pace it out and put the real numbers in.`}
                  </p>
                  {(
                    <div className="sd-mrow" data-testid={`side-dims-${s.key}`} data-mirrored={s.mirroredFrom ?? undefined}>
                      {/* Tom, 15 Sep: a mirrored side's boxes come pre-written with
                          the opposite side's numbers — still orange until Update. */}
                      <input placeholder="length m" inputMode="decimal" value={dims.L || (s.mirroredFrom ? String(s.L) : "")} onChange={(e) => setDims({ ...dims, L: e.target.value })} />
                      <span>×</span>
                      <input placeholder="height m" inputMode="decimal" value={dims.H || (s.mirroredFrom ? String(s.H) : "")} onChange={(e) => setDims({ ...dims, H: e.target.value })} />
                      <button
                        onClick={() => {
                          const lv = (dims.L || (s.mirroredFrom ? String(s.L) : "")).trim().toLowerCase();
                          const hv = (dims.H || (s.mirroredFrom ? String(s.H) : "")).trim().toLowerCase();
                          if (lv.includes("not") || hv.includes("not")) {
                            act({ action: "side_dims", side: s.key, notSure: true }, {
                              done: "Not a problem — we'll measure this side on the day; your range widens a touch until then.",
                            });
                            return;
                          }
                          // The gentle clamp (3–40 m long, 2–8 m high) — the
                          // server clamps too; matching here keeps the toast
                          // honest about what was recorded.
                          const rawL = parseFloat(lv.replace(/[^0-9.]/g, ""));
                          const rawH = parseFloat(hv.replace(/[^0-9.]/g, ""));
                          const L = isNaN(rawL) ? null : Math.min(40, Math.max(3, rawL));
                          const H = isNaN(rawH) ? null : Math.min(8, Math.max(2, rawH));
                          const clamped = (L != null && L !== rawL) || (H != null && H !== rawH);
                          act({
                            action: "side_dims", side: s.key,
                            lengthM: L, heightM: H,
                          }, {
                            done: clamped
                              ? `${s.label} set to ${L ?? "—"} × ${H ?? "—"} m (sides run 3–40 × 2–8 m) — repriced.`
                              : `${s.label} repriced — walls and roofline follow the new size.`,
                          });
                          setDims({ L: "", H: "" });
                        }}
                      >
                        Update
                      </button>
                    </div>
                  )}
                  <p className="sd-help">Pace the length — a big step is about a metre. A single storey is usually 2.4–2.7 m. &ldquo;Not sure&rdquo; is fine.</p>
                </div>

                <div className="sd-q">
                  <p className="sd-ql">The walls on this side — from your answers</p>
                  <div className="sd-tgrid">
                    {s.walls.map((w) => (
                      <div className="sd-wall sd-tl on has-x" key={w.id}>
                        <button className="sd-x" aria-label={`Remove ${w.label}`}
                          onClick={(e) => { e.stopPropagation(); removeLine(s.key, w.id, w.label); }}>×</button>
                        {w.label}
                        <span className="sd-pcts" onClick={(e) => e.stopPropagation()}>
                          <i>% of wall</i>
                          {[25, 50, 75, 100].map((p) => (
                            <button
                              key={p}
                              className={`sd-pc ${sel(`pct:${s.key}:${w.id}`, w.pct === p, String(p)) ? "on" : ""}`}
                              onClick={() => act({ action: "wall_share", side: s.key, surfaceId: w.id, pct: p }, { done: `${w.label} set to ${p}% of this side — repriced.`, opt: [`pct:${s.key}:${w.id}`, String(p)] })}
                            >
                              {p}
                            </button>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Tom, 31 Aug: under 100% is a normal answer — a side can
                      be part glass or garage door. Only over-committed is bad. */}
                  <p className={`sd-wallsum ${s.wallSum > 100 ? "bad" : ""}`}>
                    {s.wallSum === 100 ? "Adds up to 100% ✓"
                      : s.wallSum > 100 ? `Adds up to ${s.wallSum}% — bring it back to 100% or less before confirming`
                      // 5 Oct: more than one surface and no share picked yet — the split is theirs to make.
                      : s.wallSum === 0 ? "Roughly what share is each surface? Tap a % on each — they can add up to less than 100"
                      : `Painting ${s.wallSum}% of this side's walls ✓ — the rest (windows, glass, garage door) isn't charged`}
                  </p>
                </div>

                <div className="sd-q">
                  <p className="sd-ql">Also on this side — tap to change</p>
                  <div className="sd-tgrid">
                    {s.tiles.map((t) => (
                      <div className="sd-tl on has-x" key={t.id}>
                        {/* Tom, 21 Aug: "I can't untick items from exterior
                            quotes, all should be untickable." */}
                        <button className="sd-x" aria-label={`Remove ${t.label}`}
                          onClick={(e) => { e.stopPropagation(); removeLine(s.key, t.id, t.label); }}>×</button>
                        {/* The tile's own name, in its own element: it used to
                            be a bare text node, which stopped being readable
                            the moment a metres control joined the tile. */}
                        <span className="sd-tlname">{t.label}</span>
                        {t.countable && (
                          <span className="sd-st" onClick={(e) => e.stopPropagation()}>
                            <button aria-label="fewer" onClick={() => shownCount(s.key, t) > 1 && stepCount(s.key, t, -1)}>−</button>
                            <b>{shownCount(s.key, t)}</b>
                            <button aria-label="more" onClick={() => stepCount(s.key, t, 1)}>+</button>
                          </span>
                        )}
                        {t.lineal && !t.countable && (
                          /* Tom, 8 Sep: "allow to choose the metres of
                             handrail when it is added." A lineal run with no
                             metres of its own prices off the whole side, which
                             is right for a gutter and wrong for 6 m of
                             handrail — so every lineal row can be told. */
                          <span className="sd-mseg" onClick={(e) => e.stopPropagation()}>
                            <i>Metres</i>
                            <input
                              inputMode="decimal"
                              aria-label={`Metres of ${t.label}`}
                              data-testid={`side-metres-${s.key}-${t.id}`}
                              placeholder={t.metres == null ? `${s.L}` : ""}
                              value={metres[`${s.key}:${t.id}`] ?? (t.metres == null ? "" : String(t.metres))}
                              onChange={(e) => setMetres((m) => ({ ...m, [`${s.key}:${t.id}`]: e.target.value }))}
                              onBlur={() => {
                                const raw = metres[`${s.key}:${t.id}`];
                                if (raw == null) return;
                                setMetres((m) => { const n = { ...m }; delete n[`${s.key}:${t.id}`]; return n; });
                                const v = parseFloat(raw.replace(/[^0-9.]/g, ""));
                                if (raw.trim() === "") {
                                  if (t.metres != null) act({ action: "side_metres", side: s.key, surfaceId: t.id, metres: null }, { describe: withDelta(`${t.label} back to the length of this side`) });
                                  return;
                                }
                                if (isNaN(v) || v === t.metres) return;
                                act({ action: "side_metres", side: s.key, surfaceId: t.id, metres: Math.min(200, Math.max(0.1, v)) }, {
                                  describe: withDelta(`${t.label} set to ${Math.min(200, Math.max(0.1, v))} m`),
                                });
                              }}
                            />
                            <em>{t.metres == null ? "follows this side" : "you told us"}</em>
                          </span>
                        )}
                        {t.window && (
                          <span className="sd-wseg" onClick={(e) => e.stopPropagation()}>
                            <i>Size</i>
                            {(["S", "M", "L"] as const).map((z) => (
                              <button key={z} className={sel(`ws:${s.key}:${t.id}`, t.sizeBand === z, z) ? "on" : ""} onClick={() => act({ action: "win_size", side: s.key, surfaceId: t.id, size: z }, { describe: withDelta(`Windows set to ${z === "S" ? "small" : z === "M" ? "medium" : "large"}`), opt: [`ws:${s.key}:${t.id}`, z] })}>{z}</button>
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                    {s.customs.map((name, i) => (
                      <div className="sd-tl on custom has-x" key={`c${i}`}>
                        <button className="sd-x" aria-label={`Remove ${name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            act({ action: "side_remove_custom", side: s.key, index: i }, { done: `Removed “${name}”.` });
                          }}>×</button>
                        {name}
                      </div>
                    ))}
                  </div>
                  <button className="sd-addsurf" onClick={() => setAddOpen(addOpen === s.key ? null : s.key)}>+ Add a surface to this side</button>
                  {addOpen === s.key && (
                    <div className="sd-addpanel">
                      <p className="sd-pl">EVERYTHING WE PAINT — TAP TO ADD TO {s.label.toUpperCase()}</p>
                      <div className="sd-chips">
                        {/* The wall chips come from the view now, so only a
                            substrate the live card can price is ever offered. */}
                        {sides.wallOptions.filter((w) => !s.walls.some((x) => x.code === w.code)).map((w) => (
                          <button
                            key={w.code}
                            className="sd-chip"
                            onClick={() => act({ action: "add_wall", side: s.key, code: w.code }, {
                              done: `${w.label} added at 25% of the wall — the largest surface gave up the share to keep it at 100%.`,
                            })}
                          >
                            + {w.label} — wall surface
                          </button>
                        ))}
                        <button className="sd-chip" onClick={() => act({ action: "add_window_group", side: s.key }, { done: "Added another window group — set how many, and its size. Mix as many sizes as the side has." })}>
                          + More windows — a different size
                        </button>
                        {sides.catalog.filter((c) => !s.tiles.some((t) => t.code === c.code)).map((c) => (
                          <button
                            key={c.code}
                            className="sd-chip"
                            onClick={() => act({ action: "add_catalog", side: s.key, code: c.code }, {
                              describe: withDelta(`${c.label} added`),
                            })}
                          >
                            + {c.label} — {fmt(c.priceCents)}
                          </button>
                        ))}
                      </div>
                      {/* R5: the rest of the exterior card, per side — eaves,
                          gutters, downpipes, posts, columns, shutters, a roof.
                          Grouped as the card groups them; a code already on
                          this side, or already offered as a priced chip above,
                          is filtered out. */}
                      {sideAddGroups(s).map(([group, opts]) => (
                        <div className="sd-group" key={group}>
                          <p className="sd-gl">{group.toUpperCase()}</p>
                          <div className="sd-chips">
                            {opts.map((o) => (
                              <button key={o.key} className="sd-chip"
                                onClick={() => act({ action: "add_side_surface", side: s.key, code: o.key }, {
                                  describe: withDelta(`${o.label} added to ${s.label}`),
                                })}>
                                + {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      <div className="sd-custom">
                        <input placeholder="Something else on this side? Name it" value={customText} onChange={(e) => setCustomText(e.target.value)} />
                        <button
                          onClick={() => {
                            const v = customText.trim();
                            if (!v) return;
                            act({ action: "side_custom", side: s.key, name: v }, {
                              done: `Thanks — we've added “${v}”, and we'll confirm this area on the site visit.`,
                            });
                            setCustomText("");
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {/* Tom, 8 Sep: the optional comments + photo box, at the
                    bottom of every side. Neither prices anything — both ride
                    to the estimator as an amber line on this side. */}
                <SideNote
                  estimateId={estimateId}
                  sideKey={s.key}
                  sideLabel={s.label}
                  note={s.note}
                  photoCount={s.notePhotos}
                  busy={pendingCount > 0}
                  onSave={(note, photos) => act({ action: "side_note", side: s.key, note, photos }, {
                    done: photos > 0
                      ? `Saved — your note and ${photos} photo${photos > 1 ? "s" : ""} are with your estimator.`
                      : note ? "Saved — your estimator reads this before pricing the prep here." : "Note cleared.",
                  })}
                />
              </>
            )}

            {s.include !== false && (
              <button
                className="sd-confirm"
                disabled={optimistic[`confirm:${s.key}`] != null}
                onClick={() => { flush(); act({ action: "confirm_side", side: s.key }, {
                  done: `${s.label} confirmed ✓`,
                  onFail: (m) => refuse(s.key, m),
                  onOk: openNext,
                  opt: [`confirm:${s.key}`, "1"],
                }); }}
              >
                {optimistic[`confirm:${s.key}`] != null ? "Confirming…"
                  : s.confirmed ? "Confirmed ✓" : `Confirm ${s.label.split(" — ")[0].toLowerCase()} ✓`}
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  function metaCard(key: "extras" | "cond" | "dw" | "sweep", title: string, body: React.ReactNode, confirmLabel: string) {
    const done = sides.meta.done[key];
    const isOpen = open === key;
    return (
      <section className={`sd-card ${done ? "done" : ""} ${isOpen ? "open" : ""} ${shake === key ? "shake" : ""}`} data-side={key}>
        <div className="sd-hd" onClick={() => setOpen(key)}>
          <b>{title}</b>
          <span className="sd-pill">{done ? "CONFIRMED ✓" : "CONFIRM THIS"}</span>
        </div>
        {isOpen && (
          <div className="sd-body">
            {body}
            <button
              className="sd-confirm"
              disabled={optimistic[`confirm:${key}`] != null}
              onClick={() => { flush(); act({ action: "confirm_loop_item", item: key }, {
                done: "Confirmed ✓",
                onFail: (m) => refuse(key, m),
                onOk: openNext,
                opt: [`confirm:${key}`, "1"],
              }); }}
            >
              {optimistic[`confirm:${key}`] != null ? "Confirming…" : done ? "Confirmed ✓" : confirmLabel}
            </button>
          </div>
        )}
      </section>
    );
  }

  // A side the customer never asked for is not in the estimate at all (Tom, 8 Sep): grey.
  const liveSides = sides.sides.filter((x) => x.include !== false);
  const topSides: TopSide[] = (["front", "back", "left", "right"] as const).map((k) => {
    const x = sides.sides.find((y) => y.key === k);
    const label = k === "front" ? "Front" : k === "back" ? "Back" : k === "left" ? "Left" : "Right";
    return { key: k, label, state: !x || x.include === false ? "skip" : x.confirmed ? "ok" : "todo" };
  });


  /** Stepper display honours the optimistic target while the queue drains. */
  function shownCount(sideKey: string, t: { id: number; count: number }): number {
    const o = optimistic[`cnt:${sideKey}:${t.id}`];
    return o != null ? parseInt(o, 10) : t.count;
  }
  /** "+ Something else" in the final sweep — the typed name rides the amber
   * flag, so the estimator prices a "bungalow", never a "Something else". */
  function addSweepOther() {
    const name = sweepOtherText.trim().slice(0, 60);
    if (!name) { say("Give it a name first — a word or two is plenty."); return; }
    act({ action: "loop_sweep", add: name }, {
      done: `Thanks — "${name}" is on the list, and we'll confirm it on the site visit.`,
    });
    setSweepOtherText("");
    setSweepOtherOpen(false);
  }
  // ---- Tom, 15 Sep (late): the condition questions, one at a time ------------
  const m = sides.meta;
  const mc = sides.meta.cond;
  const condVal = (k: "cond" | "rot" | "acc") => optimistic[`cond:${k}`] ?? mc[k];
  const peelingSides = mc.peelingSides ?? [];
  const rotWhere = mc.rotWhere ?? [];
  const isPeeling = condVal("cond") === "peeling";
  const rotSome = condVal("rot") === "little" || condVal("rot") === "lots";
  /** The set is complete when every REQUIRED answer is in — the same rule the route's confirm applies. */
  const condComplete = (c: SidesView["meta"]["cond"]) =>
    c.cond != null && c.rot != null && c.acc != null
    && (c.cond !== "peeling" || (c.peelingSides?.length ?? 0) > 0)
    && (c.rot === "no" || (c.rotWhere?.length ?? 0) > 0);
  /** Answer one condition question; when the set is complete, confirm the card behind it. */
  function condAct(body: Record<string, unknown>, opts: Parameters<typeof act>[1] = {}) {
    act(body, { ...opts, onOk: (j) => {
      opts.onOk?.(j);
      const c = j.sides?.meta.cond;
      if (c && condComplete(c) && !j.sides?.meta.done.cond) {
        act({ action: "confirm_loop_item", item: "cond" }, { done: "Condition & access confirmed ✓", onFail: (msg) => say(msg), onOk: openNext });
      }
    } });
  }
  /** Where the rot could be: everything the wizard ticked on the house, plus what stands alone. */
  const rotPlaces: Array<{ key: string; label: string }> = (() => {
    const out = new Map<string, string>();
    for (const sub of sides.geo?.substrates ?? []) out.set(sub.toLowerCase(), sub.charAt(0).toUpperCase() + sub.slice(1));
    for (const sd of sides.sides) for (const t of sd.tiles) out.set(t.label.toLowerCase(), t.label);
    for (const t of extrasTiles) if (t.on) out.set(String(t.key).toLowerCase(), t.label);
    return [...out.entries()].map(([key, label]) => ({ key, label }));
  })();
  const toggleIn = (list: string[], v: string, exclusive: string[] = ["all", "unsure"]) => {
    if (exclusive.includes(v)) return list.includes(v) ? [] : [v];
    const base = list.filter((x) => !exclusive.includes(x));
    return base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
  };
  const condSteps: PaginatedStep[] = [
    {
      key: "cond", label: "Paintwork", answered: mc.cond != null,
      question: <>How&rsquo;s the paintwork holding up overall?</>,
      hint: "Your range prices this from good to peeling until you answer.",
      body: (
        <div className="sd-chips" data-testid="cond-chips">
          {/* Tom, 5 Oct: a line under each answer says what it means in practice. */}
          <Chip on={sel("cond:cond", mc.cond === "good", "good")} label={"Good overall"} hint="A few spots to fill and the odd mark, but mostly sound — a repaint, not a rescue." onClick={() => condAct({ action: "loop_cond", cond: "good" }, { describe: withDelta("Good to hear — noted"), opt: ["cond:cond", "good"] })} />
          <Chip on={sel("cond:cond", mc.cond === "weathered", "weathered")} label={"Weathered"} hint="Chalky, faded or thin in places — more sanding and spot-priming allowed for." onClick={() => condAct({ action: "loop_cond", cond: "weathered" }, { describe: withDelta("Extra prep allowed for weathered paintwork"), opt: ["cond:cond", "weathered"] })} />
          <Chip on={sel("cond:cond", mc.cond === "peeling", "peeling")} label={"Peeling & flaking"} hint="Lifting or flaking with bare timber showing — scraped back and properly prepared before any paint goes on." onClick={() => condAct({ action: "loop_cond", cond: "peeling" }, { describe: withDelta("Extra prep allowed for peeling paintwork — and a lead-safe check is part of our visit"), opt: ["cond:cond", "peeling"] })} />
        </div>
      ),
    },
    ...(isPeeling ? [{
      key: "peeling", label: "Where it's peeling", answered: peelingSides.length > 0,
      question: <>Which sides are peeling and flaking?</>,
      hint: "Tick all that apply. A photo helps us price the preparation.",
      body: (
        <>
          <div className="sd-chips" data-testid="peeling-sides">
            {sides.sides.filter((sd) => sd.include !== false).map((sd) => (
              <Chip key={sd.key} on={peelingSides.includes(sd.key)} label={`${peelingSides.includes(sd.key) ? "✓ " : "+ "}${sd.label}`}
                onClick={() => condAct({ action: "loop_cond", peelingSides: toggleIn(peelingSides, sd.key) }, { done: "Noted." })} />
            ))}
            <Chip on={peelingSides.includes("all")} label="All of them" onClick={() => condAct({ action: "loop_cond", peelingSides: toggleIn(peelingSides, "all") }, { done: "Noted — peeling all round." })} />
            <Chip on={peelingSides.includes("unsure")} label="Not sure" onClick={() => condAct({ action: "loop_cond", peelingSides: toggleIn(peelingSides, "unsure") }, { done: "No problem — your estimator will look." })} />
          </div>
          <PeelingPhotos estimateId={estimateId} count={mc.peelingPhotos ?? 0} busy={pendingCount > 0}
            onUploaded={(n) => condAct({ action: "loop_cond", peelingPhotos: n }, { done: `${n} photo${n === 1 ? "" : "s"} attached — thanks, that helps us price the prep.` })} />
        </>
      ),
    } satisfies PaginatedStep] : []),
    {
      key: "rot", label: "Timber rot", answered: mc.rot != null,
      question: <>Any timber rot anywhere?</>,
      hint: "Soft or crumbling timber — fascias, window sills, weatherboards, posts.",
      body: (
        <div className="sd-chips" data-testid="rot-chips">
          <Chip on={sel("cond:rot", mc.rot === "no", "no")} label={"No, looks solid"} onClick={() => condAct({ action: "loop_cond", rot: "no" }, { describe: withDelta("Noted — no rot allowance needed"), opt: ["cond:rot", "no"] })} />
          <Chip on={sel("cond:rot", mc.rot === "little", "little")} label={"A little"} onClick={() => condAct({ action: "loop_cond", rot: "little" }, { describe: withDelta("We've allowed for minor rot prep"), opt: ["cond:rot", "little"] })} />
          <Chip on={sel("cond:rot", mc.rot === "lots", "lots")} label={"Quite a bit"} onClick={() => condAct({ action: "loop_cond", rot: "lots" }, { done: "Thanks for the honesty — rot repair needs eyes on it, so we'll confirm it on the site visit.", opt: ["cond:rot", "lots"] })} />
        </div>
      ),
    },
    ...(rotSome ? [{
      key: "rotWhere", label: "Where the rot is", answered: rotWhere.length > 0,
      question: <>Where is the timber rot?</>,
      hint: "Tick everything you ticked earlier that has some rot.",
      body: (
        <div className="sd-chips" data-testid="rot-where">
          {rotPlaces.map((pl) => (
            <Chip key={pl.key} on={rotWhere.includes(pl.key)} label={`${rotWhere.includes(pl.key) ? "✓ " : "+ "}${pl.label}`}
              onClick={() => condAct({ action: "loop_cond", rotWhere: toggleIn(rotWhere, pl.key) }, { done: "Noted." })} />
          ))}
          <Chip on={rotWhere.includes("unsure")} label="Not sure" onClick={() => condAct({ action: "loop_cond", rotWhere: toggleIn(rotWhere, "unsure") }, { done: "No problem — your estimator will look." })} />
        </div>
      ),
    } satisfies PaginatedStep] : []),
    {
      key: "acc", label: "Access", answered: mc.acc != null,
      question: <>Anything tricky about access?</>,
      body: (
        <div className="sd-chips" data-testid="acc-chips">
          <Chip on={sel("cond:acc", mc.acc === "steep", "steep")} label={"Steep block"} onClick={() => condAct({ action: "loop_cond", acc: "steep" }, { describe: withDelta("Access allowance added"), opt: ["cond:acc", "steep"] })} />
          <Chip on={sel("cond:acc", mc.acc === "tight", "tight")} label={"Tight side access"} onClick={() => condAct({ action: "loop_cond", acc: "tight" }, { describe: withDelta("Access allowance added"), opt: ["cond:acc", "tight"] })} />
          <Chip on={sel("cond:acc", mc.acc === "none", "none")} label={"None of these ✓"} onClick={() => condAct({ action: "loop_cond", acc: "none" }, { describe: withDelta("No access allowance needed"), opt: ["cond:acc", "none"] })} />
        </div>
      ),
    },
  ];
  const condSettled = [
    mc.cond === "good" ? "Paintwork good overall" : mc.cond === "weathered" ? "Weathered paintwork" : `Peeling & flaking${peelingSides.length ? ` (${peelingSides.includes("all") ? "all sides" : peelingSides.includes("unsure") ? "not sure where" : peelingSides.join(", ")})` : ""}`,
    mc.rot === "no" ? "no rot" : `${mc.rot === "little" ? "a little" : "quite a bit of"} rot${rotWhere.length ? ` (${rotWhere.includes("unsure") ? "not sure where" : rotWhere.join(", ")})` : ""}`,
    mc.acc === "none" ? "nothing tricky about access" : mc.acc === "steep" ? "steep block" : "tight side access",
  ].join(" · ") + ".";

  // ---- Tom, 15 Sep (late, items 9–10): the last checks, one at a time --------
  const lastSteps: PaginatedStep[] = [
    {
      key: "dw", label: "Windows & doors", answered: m.done.dw,
      question: <>Across the sides you&rsquo;re painting, we make it {sides.dw.windows} windows and {sides.dw.doors} doors — is that right?</>,
      hint: "Counts sit on each side above — use the − / + there, then come back and tick.",
      body: (
        <div className="sd-checkwrap">
          <label className="sd-checkrow" data-testid="check-dw-row">
            <input type="checkbox" data-testid="check-dw-ok" checked={sel("dw:ok", m.dwOk === true)} disabled={optimistic["confirm:dw"] != null}
              onChange={() => {
                if (m.done.dw) return;
                flush();
                act({ action: "loop_dw", ok: true }, { opt: ["dw:ok", "1"] });
                act({ action: "confirm_loop_item", item: "dw" }, { done: "Counts confirmed ✓", onFail: (msg) => refuse("last", msg), onOk: openNext, opt: ["confirm:dw", "1"] });
              }} />
            <span>Confirm counts ✓</span>
          </label>
          <button type="button" className="wz-linkish" data-testid="check-dw-off" style={{ marginTop: 6 }}
            onClick={() => { act({ action: "loop_dw", ok: false }); say("Adjust the − / + on the side cards above, then come back and tick Confirm counts."); }}>
            Something&rsquo;s off — I&rsquo;ll adjust
          </button>
        </div>
      ),
    },
    {
      key: "sweep", label: "Anything missed", answered: m.done.sweep,
      question: <>Last check — any sides or bits we&rsquo;ve missed?</>,
      hint: "Sheds, side gates and the fence behind the house are the usual ones. Tick the box when there's nothing else.",
      body: (
        <div className="sd-checkwrap">
          <div className="sd-chips" data-testid="sweep-chips">
            {sides.sweepItems.map((it) => (
              <Chip key={it.code} on={sel(`sw:${it.code}`, it.on)}
                label={`${it.on ? "✓" : "+"} ${it.label} — ${fmt(it.priceCents)}`}
                onClick={() => act({ action: "sweep_item", code: it.code, on: !it.on }, {
                  describe: withDelta(it.on ? `${it.label} taken off` : `${it.label} added`),
                  opt: [`sw:${it.code}`, it.on ? "0" : "1"],
                })} />
            ))}
            <Chip on={false} label="+ Carport"
              onClick={() => act({ action: "loop_sweep", add: "Carport" }, { done: "Thanks — we've added the carport, and we'll confirm it on the site visit." })} />
            <Chip on={sweepOtherOpen} label="+ Something else" onClick={() => setSweepOtherOpen((v) => !v)} />
          </div>
          {sweepOtherOpen && (
            <div className="sd-mrow" style={{ display: "flex", marginTop: 9 }}>
              <input style={{ flex: 1, width: "auto", minWidth: 180 }}
                placeholder="What else needs painting? Name it — e.g. bungalow, letterbox" maxLength={60}
                value={sweepOtherText} onChange={(e) => setSweepOtherText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addSweepOther(); }} />
              <button onClick={addSweepOther}>Add</button>
            </div>
          )}
          <label className="sd-checkrow" data-testid="check-sweep-row" style={{ marginTop: 10 }}>
            <input type="checkbox" data-testid="check-sweep-ok" checked={sel("sweep:ok", m.done.sweep)} disabled={optimistic["confirm:sweep"] != null}
              onChange={() => {
                if (m.done.sweep) return;
                flush();
                if (m.sweepAns == null) act({ action: "loop_sweep", ans: "none" }, { opt: ["sweep:ok", "1"] });
                act({ action: "confirm_loop_item", item: "sweep" }, { done: "Nothing missing ✓", onFail: (msg) => refuse("last", msg), onOk: openNext, opt: ["confirm:sweep", "1"] });
              }} />
            <span>Confirm — nothing missing ✓</span>
          </label>
        </div>
      ),
    },
  ];



  /** Take one line off a side. The refusal that matters — the last wall —
   * comes back from the server and lands as an ordinary toast. */
  function removeLine(sideKey: SideKey, surfaceId: number, label: string) {
    act({ action: "side_remove_line", side: sideKey, surfaceId }, { describe: withDelta(`Removed ${label.toLowerCase()}`) });
  }

  function stepCount(sideKey: SideKey, t: { id: number; count: number; label: string }, dir: 1 | -1) {
    const next = Math.max(1, Math.min(20, shownCount(sideKey, t) + dir));
    if (next === shownCount(sideKey, t)) return;
    // R5: the tile already moved optimistically; a burst of taps sends ONE
    // save carrying the final count instead of one save per tap.
    setOptimistic((o) => ({ ...o, [`cnt:${sideKey}:${t.id}`]: String(next) }));
    queue(`n:${sideKey}:${t.id}`, () =>
      act({ action: "side_count", side: sideKey, surfaceId: t.id, count: next },
        { describe: withDelta(`${t.label} ×${next}`), opt: [`cnt:${sideKey}:${t.id}`, String(next)] }));
  }

  // UI refresh S5: the left column — the questions, the side cards, the extras, the last checks.
  const cards = (
      <div className="sd-cards">
        {/* Tom, 15 Sep (late, items 6–8, 11): condition & access are the FIRST
            questions, one at a time, above the sides. The old "Which sides?"
            card is gone — that is asked before the gate now (item 3), and a
            side left off there is not on this screen at all (item 4). */}
        <Paginated
          testid="sides-q"
          title="A few questions first"
          pill="TIGHTENS YOUR RANGE"
          steps={condSteps}
          cardClass={`sd-card ${m.done.cond ? "done" : ""}`}
          attrs={{ "data-side": "cond" }}
          settledText={condSettled}
        />
        {sides.sides.map(sideCard)}

        {metaCard("extras", "Freestanding extras", (
          <div className={`sd-q ${extrasAnswered ? "ok" : ""}`}>
            <p className="sd-ql">Not on a wall — fences, pergolas and the like. <span className="sd-opt">TICK ANY THAT APPLY</span><span className="sd-okc">✓</span></p>
            <div className="sd-chips">
              {extrasTiles.map((t) => (
                <Chip key={String(t.key)} on={t.on} label={`${t.on ? "✓ " : "+ "}${t.label}`}
                  onClick={() => act({ action: "toggle_exterior", key: String(t.key), on: !t.on }, { done: `${t.on ? "Removed" : "Added"} ${t.label.toLowerCase()}.` })} />
              ))}
            </div>
            {extrasTiles.some((t) => t.key === "fence" && t.on) && (
              <div className="sd-chips" style={{ marginTop: 9 }} data-testid="fence-type">
                {([["paling", "Paling Fence", "Paling"], ["picket_hand", "Picket Fence (Hand Paint)", "Picket (brushed)"], ["picket_spray", "Picket Fence (Spray)", "Picket (sprayed)"]] as const).map(([type, code, label]) => (
                  <Chip key={type} on={(exterior?.fenceCode ?? "Paling Fence") === code} label={label}
                    onClick={() => act({ action: "set_fence_type", type }, { done: `${label} fence — repriced.` })} />
                ))}
              </div>
            )}
            {extrasTiles.some((t) => t.key === "fence" && t.on) && (
              <div className="sd-mrow" style={{ display: "flex", marginTop: 9 }}>
                <input placeholder="fence metres — or 'not sure'" value={fenceText} onChange={(e) => setFenceText(e.target.value)} />
                <button
                  onClick={() => {
                    const v = fenceText.trim().toLowerCase();
                    if (!v) return;
                    const metres = parseFloat(v.replace(/[^0-9.]/g, ""));
                    act(
                      { action: "set_fence", metres: v.includes("not") || isNaN(metres) ? null : metres },
                      { done: v.includes("not") ? "Not a problem — we'll measure it on the day." : `Fence set to ${metres} m — repriced.` },
                    );
                  }}
                >
                  Set
                </button>
              </div>
            )}
            {/* Tom, 5 Oct: the pergola is priced on its top's length × width — never per pergola. */}
            {extrasTiles.some((t) => t.key === "pergola" && t.on) && (
              <div data-testid="pergola-size" style={{ marginTop: 9 }}>
                <p className="sd-help" style={{ margin: "0 0 6px" }}>
                  {exterior?.pergola
                    ? `Priced on a top of about ${exterior.pergola.lengthM} × ${exterior.pergola.widthM} m. Change it below and confirm.`
                    : "Roughly how big is the pergola top? Length and width in metres, then Confirm — it's priced on the area."}
                </p>
                <div className="sd-mrow" style={{ display: "flex", flexWrap: "wrap" }}>
                  <input placeholder="top length m" inputMode="decimal" value={pergolaL} onChange={(e) => setPergolaL(e.target.value)} data-testid="pergola-length" />
                  <input placeholder="top width m" inputMode="decimal" value={pergolaW} onChange={(e) => setPergolaW(e.target.value)} data-testid="pergola-width" />
                  <button data-testid="pergola-confirm"
                    onClick={() => {
                      const L = parseFloat(pergolaL.replace(/[^0-9.]/g, ""));
                      const W = parseFloat(pergolaW.replace(/[^0-9.]/g, ""));
                      if (!(L > 0 && W > 0)) return;
                      act({ action: "set_pergola", lengthM: L, widthM: W }, { done: `Pergola top ${L} × ${W} m — repriced.` });
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </div>
        ), "Confirm extras ✓")}

        {/* Tom, 15 Sep (late, items 9–10): the two last checks, one at a time,
            each confirmed with a tick box — no "That's right", no "No — that's
            everything". A missed side is added back from here (item 4). */}
        <Paginated
          testid="sides-last"
          title="Last checks"
          pill="NEARLY THERE"
          steps={lastSteps}
          cardClass={`sd-card ${m.done.dw && m.done.sweep ? "done" : ""}`}
          attrs={{ "data-side": "last" }}
          settledText="Counts confirmed, nothing missing."
        />
      </div>
  );

  // UI refresh S5 (brief §7.8): "Your home from above" — amber = still to check, cyan =
  // checked, grey dashed = not painting; tap a side to open it. The rail card on a laptop,
  // the top of the page on a phone; inside the room editor for a "both" job.
  const fromAbove = (
    <section className="sc-home sd-visual" aria-label="Your home from above">
      <p className="sc-home-head"><b>Your home from above</b>
        <span>{liveSides.filter((x) => x.confirmed).length} of {liveSides.length} checked</span></p>
      {!embedded && <PlanPanel docs={docs} variant="peek" />}
      {!embedded && <PlanPanel docs={docs} variant="column" />}
      <div className="sc-home-art">
        <TopView sides={topSides} onPick={(k) => setOpen(k)} />
      </div>
      {sides.geo && (
        <div className="sd-geo">
          {sides.geo.storeys && (
            <span className="sd-g">{sides.geo.storeys === "double" ? "DOUBLE" : "SINGLE"} STOREY · <i>FROM YOUR ANSWERS</i></span>
          )}
          {sides.geo.substrates.slice(0, 2).map((sub) => (
            <span className="sd-g" key={sub}>{sub.toUpperCase()} · <i>FROM YOUR ANSWERS</i></span>
          ))}
          <button
            onClick={() => act({ action: "flag_geometry" }, {
              done: "Flagged — geometry is ours to verify, so your estimator will confirm this on site.",
            })}
          >
            Not right? Tell us
          </button>
        </div>
      )}
      <p className="sc-home-key"><span className="todo">Still to check</span><span className="ok">Checked</span><span className="off">Not painting</span></p>
    </section>
  );

  return (
    <div className={`sd ${ready || embedded ? "" : "wz-waking"}`} data-ready={embedded ? undefined : ready ? "1" : undefined}>
      {!embedded && !ready && <div className="sd-saving">ONE MOMENT…</div>}
      {!embedded && ready && pendingCount > 0 && <div className="sd-saving">SAVING…</div>}
      {/* UI refresh S5 (brief §7.8): the S4 frame — ONE slim header, the side cards on the
          left, the rail on the right (price card, Your home from above, the estimator); on a
          phone the price card is the dark range strip and the buttons the bottom bar. A
          "both" job embeds this inside the room editor, which owns the frame. */}
      {!embedded && (
      <div className="sc-freeze">
        <WizardHeader
          logo={<Wordmark logoUrl={logoUrl} />}
          steps={[]}
          at="gate"
          after={{ at: 1, labels: ["Guide range", "Side by side", `Fixed by ${estimator?.name?.trim().split(/\s+/)[0] || "your estimator"}`] }}
          phone={companyPhone}
        />
      </div>
      )}

      {embedded ? (
      // UI refresh S6 (brief §7.9): the outside half of the stacked page. The house from
      // above lives in the room editor's "Your home" card, under the plan.
      <main className="sd-wrap sd-stacked" id="outside">
        <div className="sd-rangebar">
          <div><b>Now the outside, one side at a time</b><span>Front, both sides, back — check each and it turns blue.</span></div>
        </div>
        {cards}
      </main>
      ) : (
      <div className="sc-ed sd-ed">
        <main className="sc-wrap">
          {allDone && autoSend !== "idle" && <AllDoneBanner estimator={estimator?.name ?? null} sentHref={sentHref} state={autoSend === "sending" ? "sending" : autoSend === "sent" ? "sent" : "failed"} />}
          <div className="sd-rangebar">
            <div><b>Walk around the house, one side at a time</b><span>Front, both sides, back — confirm each and it turns blue.</span></div>
          </div>
          {cards}
        </main>

        <aside className="sc-rail" aria-label="Your range">
          <section className="sc-price" data-testid="price-card">
            <div className="sc-lbl">
              <b>Your range <span className={`tier-chip ${ladder.tier}`} data-testid="tier-chip">{TIER_LABEL[ladder.tier].toUpperCase()}</span></b>
              <span data-testid="tier-next">{ladder.nextUnlock
                ? `${ladder.nextUnlock.needs.length === 1 ? "One step" : `${ladder.nextUnlock.needs.length} steps`} to ${TIER_LABEL[ladder.nextUnlock.tier]}: ${ladder.nextUnlock.needs.join(" · ")}`
                : allDone
                  ? "Everything confirmed — this is as sure as we get before we see it"
                  : "It climbs with every side you confirm"}</span>
            </div>
            <div className="sc-range" data-role="range">
              <div className="sc-r">{range}</div>
              <small><span className="sc-gst">Includes GST · within </span><span className={`sc-num ${pendingCount > 0 ? "live" : ""}`} data-testid="range-width">±{payload.bandPct}%</span></small>
            </div>
            <div className="sc-band" aria-hidden="true">
              <span className="was" style={band.was} />
              <span className="now" style={band.now} />
            </div>
            <p className="sc-bandlab">Dashed line: where your guide range started</p>
            <p className="il-prog sd-prog">{prog.done} OF {prog.total} CONFIRMED</p>
            <ul className="sc-todo">
              <li className={m.done.cond ? "d" : ""}><i aria-hidden="true" />Questions about the outside<span>{Number(m.done.cond)}/1</span></li>
              <li className={liveSides.length > 0 && liveSides.every((x) => x.confirmed) ? "d" : ""}>
                <i aria-hidden="true" />Sides checked<span>{liveSides.filter((x) => x.confirmed).length}/{liveSides.length}</span>
              </li>
              <li className={m.done.dw && m.done.sweep ? "d" : ""}><i aria-hidden="true" />Last checks<span>{Number(m.done.dw) + Number(m.done.sweep)}/2</span></li>
            </ul>
            <div className="sd-stick sc-stick sc-stick-two" ref={stickRef}>
              <div className="sc-two">
                <button type="button" className="sd-cta sc-btn il-cta" data-testid="scope-finalise" onClick={onFinalise}>
                  {autoSend === "sent" ? "See what happens next" : "Finalise my price"}
                </button>
                <button type="button" className="sc-btn sc-btn2" data-testid="scope-book" onClick={goBook}>Book a time</button>
              </div>
            </div>
          </section>
          {fromAbove}
          <div className="sc-estwrap">
            <EstimatorStrip estimator={estimator} suburb={customerSuburb} companyPhone={companyPhone} onBook={goBook} compact />
          </div>
        </aside>
      </div>
      )}
      <FinalisePrompt open={prompt} onAnswer={answerRemaining} onBook={goBook} onClose={() => setPrompt(false)} />

      {toast && <div className="sd-toast sd-show">{toast}</div>}
    </div>
  );
}
