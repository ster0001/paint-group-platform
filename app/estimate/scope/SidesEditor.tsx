"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import type { CustomerExteriorView } from "@/lib/wizard/scope-editor";
import type { SidesView, SideView, SideKey } from "@/lib/wizard/sides";
import { assertCustomerShape } from "@/lib/wizard/contract";
import PlanPanel from "./PlanPanel";
import { useCoalesced } from "./useCoalesced";
import type { EstimateDocuments } from "@/lib/wizard/documents";

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

type Ladder = {
  tier: "self_serve" | "visit";
  /** C11: why it's the visit tier — the sticky line names it (mockup wording). */
  reason?: "custom" | "peeling" | "rot" | "flagged" | "big" | "signoff" | null;
  visitSlots: string[];
};

const VISIT_REASON_LINE: Record<NonNullable<Ladder["reason"]>, string> = {
  custom: "You've added something we'll price in person — ",
  peeling: "Peeling paint needs a lead-safe check — ",
  rot: "Rot repair needs eyes on it — ",
  flagged: "You've flagged the photos — ",
  big: "Bigger exterior — ",
  signoff: "Every exterior job is signed off by your estimator — ",
};
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
function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className={`sd-chip ${on ? "on" : ""}`} onClick={onClick}>{label}</button>;
}

export default function SidesEditor({ estimateId, initial, initialSides, initialExterior, initialLadder, embedded = false, onState, docs = { plan: null, photos: [] }, logoUrl = null }: {
  estimateId: string;
  initial: CustomerPayload;
  initialSides: SidesView;
  initialExterior: CustomerExteriorView | null;
  initialLadder: Ladder;
  /** R5: the photos/plan on file — the embedded (Both-job) case leaves this
   * to the parent ScopeEditor so a stacked page shows ONE plan, not two. */
  docs?: EstimateDocuments;
  logoUrl?: string | null;
  /** Batch 4: Both-jobs render the sides stack INSIDE the interior editor —
   * embedded mode drops SidesEditor's own chrome (header/range/CTA) and
   * reports progress + range upward so the host owns one combined loop. */
  embedded?: boolean;
  onState?: (s: { progress: SidesView["progress"]; payload: CustomerPayload }) => void;
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [sides, setSides] = useState<SidesView>(initialSides);
  const [exterior, setExterior] = useState<CustomerExteriorView | null>(initialExterior);
  const [ladder, setLadder] = useState<Ladder>(initialLadder);
  const [open, setOpen] = useState<string>("front");
  const [adjusting, setAdjusting] = useState<SideKey | null>(null);
  const [dims, setDims] = useState({ L: "", H: "" });
  const [addOpen, setAddOpen] = useState<SideKey | null>(null);
  const [customText, setCustomText] = useState("");
  const [fenceText, setFenceText] = useState("");
  const [sweepOtherOpen, setSweepOtherOpen] = useState(false);
  const [sweepOtherText, setSweepOtherText] = useState("");
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
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
  /** R5: a burst of stepper taps becomes ONE save (see useCoalesced). */
  const { queue, flush } = useCoalesced();

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
        if (j.sides) onState?.({ progress: j.sides.progress, payload: j });
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
    const onCodes = new Set(s.tiles.map((t) => t.code));
    const priced = new Set(sides.catalog.map((c) => c.code));
    const groups = new Map<string, SidesView["addable"]>();
    for (const o of sides.addable ?? []) {
      if (onCodes.has(o.key) || priced.has(o.key)) continue;
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(o);
    }
    return [...groups.entries()];
  }

  const range = `${fmt(payload.rangeLoCents)} – ${fmt(payload.rangeHiCents)}`;
  const prog = sides.progress;
  const allDone = prog.allDone;
  const openNext = (j?: Payload) => {
    const v = j?.sides ?? sides;
    const order: string[] = ["front", "left", "right", "back", "extras", "cond", "dw", "sweep"];
    const doneOf = (k: string) =>
      k === "extras" ? v.meta.done.extras : k === "cond" ? v.meta.done.cond
      : k === "dw" ? v.meta.done.dw : k === "sweep" ? v.meta.done.sweep
      : v.sides.find((s) => s.key === k)?.confirmed ?? false;
    const nxt = order.find((k) => !doneOf(k));
    if (nxt) setOpen(nxt);
  };

  const extrasTiles = exterior?.groups.find((g) => g.group === "extras")?.tiles ?? [];
  const extrasAnswered = sides.meta.extrasAns === "none" || extrasTiles.some((t) => t.on);

  function sideCard(s: SideView) {
    const isOpen = open === s.key;
    const pill = s.confirmed ? (s.include === false ? "NOT PAINTING ✓" : "CONFIRMED ✓") : "CONFIRM THIS SIDE";
    const cls = `sd-card ${s.confirmed ? (s.include === false ? "skip" : "done") : ""} ${isOpen ? "open" : ""} ${shake === s.key ? "shake" : ""}`;
    return (
      <section className={cls} key={s.key} data-side={s.key}>
        <div className="sd-hd" onClick={() => setOpen(s.key)}>
          <b>{s.label}</b>
          <span className="sd-pill">{pill}</span>
        </div>
        {isOpen && (
          <div className="sd-body">
            <div className={`sd-q ${s.include != null ? "ok" : ""}`}>
              <p className="sd-ql">Are we painting this side? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
              <div className="sd-chips">
                <button className={`sd-chip ${sel(`inc:${s.key}`, s.include === true, "yes") ? "on" : ""}`} onClick={() => act({ action: "side_include", side: s.key, include: true }, { opt: [`inc:${s.key}`, "yes"] })}>Yes</button>
                <button
                  className={`sd-chip ${sel(`inc:${s.key}`, s.include === false, "no") ? "on" : ""}`}
                  onClick={() => act({ action: "side_include", side: s.key, include: false }, {
                    done: `${s.label} skipped — it'll show as excluded on your quote.`,
                    onOk: openNext,
                    opt: [`inc:${s.key}`, "no"],
                  })}
                >
                  No — skip this side
                </button>
              </div>
            </div>

            {s.include === true && (
              <>
                <div className={`sd-q il-first ${s.size != null ? "ok" : ""}`}>
                  <p className="il-kick">FIRST — THE SIZE OF THIS SIDE</p>
                  <p className="sd-ql">
                    This side&rsquo;s about{" "}
                    <span className="sd-size">
                      {s.size === "ns" ? `${s.L} × ${s.H} m (we'll measure)` : `${s.L} m long × ${s.H} m high`}
                      {s.size === "adjusted" ? " · updated by you" : ""}
                    </span>{" "}
                    — sound right? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span>
                  </p>
                  <div className="sd-chips">
                    <button className={`sd-chip ${sel(`size:${s.key}`, s.size === "yes", "yes") ? "on" : ""}`} onClick={() => act({ action: "side_size_ok", side: s.key }, { opt: [`size:${s.key}`, "yes"] })}>Looks right</button>
                    <button className={`sd-chip ${s.size === "adjusted" || adjusting === s.key ? "on" : ""}`} onClick={() => { setAdjusting(s.key); setDims({ L: "", H: "" }); }}>Adjust it</button>
                  </div>
                  {adjusting === s.key && (
                    <div className="sd-mrow">
                      <input placeholder="length m" inputMode="decimal" value={dims.L} onChange={(e) => setDims({ ...dims, L: e.target.value })} />
                      <span>×</span>
                      <input placeholder="height m" inputMode="decimal" value={dims.H} onChange={(e) => setDims({ ...dims, H: e.target.value })} />
                      <button
                        onClick={() => {
                          const lv = dims.L.trim().toLowerCase();
                          const hv = dims.H.trim().toLowerCase();
                          if (lv.includes("not") || hv.includes("not")) {
                            act({ action: "side_dims", side: s.key, notSure: true }, {
                              done: "Not a problem — we'll measure this side on the day; your range widens a touch until then.",
                            });
                            setAdjusting(null);
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
                          setAdjusting(null);
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
                        {t.label}
                        {t.countable && (
                          <span className="sd-st" onClick={(e) => e.stopPropagation()}>
                            <button aria-label="fewer" onClick={() => shownCount(s.key, t) > 1 && stepCount(s.key, t, -1)}>−</button>
                            <b>{shownCount(s.key, t)}</b>
                            <button aria-label="more" onClick={() => stepCount(s.key, t, 1)}>+</button>
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

  const m = sides.meta;
  const edgeClass = (k: SideKey) => {
    const s = sides.sides.find((x) => x.key === k);
    if (!s) return "sd-edge";
    if (s.include === false) return "sd-edge skip";
    return s.confirmed ? "sd-edge done" : "sd-edge";
  };

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

  return (
    <div className={`sd ${ready || embedded ? "" : "wz-waking"}`} data-ready={embedded ? undefined : ready ? "1" : undefined}>
      {!embedded && !ready && <div className="sd-saving">ONE MOMENT…</div>}
      {!embedded && ready && pendingCount > 0 && <div className="sd-saving">SAVING…</div>}
      {!embedded && (
      <header className="sd-top">
        <div className="sd-row">
          {logoUrl ? <img className="wz-logo" src={logoUrl} alt="Paint Group" /> : <div className="sd-wm">PAINT<span>—</span>GROUP</div>}
          <span className={`sd-status ${allDone ? "ok" : ""}`}>{allDone ? "ESTIMATE CONFIRMED ✓" : "IN REVIEW · CONFIRM EACH SIDE"}</span>
        </div>
        <div className="sd-progwrap">
          <div className="sd-lbl"><span className="sd-prog">{prog.done} OF {prog.total} CONFIRMED</span><span>ORANGE = TO CONFIRM · BLUE = CONFIRMED</span></div>
          <div className={`sd-pbar ${allDone ? "ok" : ""}`}><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
        </div>
        {/* R5: an exterior-only job had no confidence score at all — same
            ring, same one function, frozen with the rest of the header. */}
        <div className="sd-scorewrap">
          <div className="sc-scorebar">
            <div className="sc-score">
              <div className="sc-ring">
                <svg width="48" height="48" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#242B32" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" fill="none" stroke={payload.accuracyPct >= 85 ? "#2FA46B" : "#E0A83C"}
                    strokeWidth="4" strokeLinecap="round" strokeDasharray="125.6"
                    strokeDashoffset={(125.6 * (1 - payload.accuracyPct / 100)).toFixed(1)} />
                </svg>
                <div className="sc-num">{payload.accuracyPct}%</div>
              </div>
              <div className="sc-lbl">
                <b>Confidence score</b>
                <span>{allDone
                  ? "Everything confirmed — this is as sure as we get before we see it"
                  : "It climbs with every side you confirm"}</span>
              </div>
            </div>
            <div className="sc-range" data-role="range"><small>YOUR ESTIMATE · INCL. GST</small><div className="sc-r">{range}</div></div>
          </div>
        </div>
        {!embedded && <div className="sd-scorewrap" style={{ marginTop: 8 }}><PlanPanel docs={docs} variant="peek" /></div>}
      </header>
      )}

      <main className="sd-wrap">
        <div className="sd-rangebar">
          <div><b>{embedded ? "Now the outside — one side at a time" : "Walk around the house, one side at a time"}</b><span>Front, both sides, back — confirm each and it turns blue.</span></div>
          {!embedded && <div className="sd-range" data-role="range"><small>YOUR ESTIMATE · INCL. GST</small>{range}</div>}
        </div>

        <div className="sd-grid">
          {/* The rail: the plan/photos on file and the house-from-above, one
              column that stays put. R5 added the PlanPanel as a THIRD child of
              a two-column grid, which pushed the side cards onto row 2 in the
              360px column — Tom, 29 Aug: "the box in the bottom left hand
              corner is way too small… this needs to fill the full page".
              Wrapping the two together gives the cards the whole wide column
              back. */}
          <div className="sd-rail">
            {!embedded && <PlanPanel docs={docs} variant="column" />}
            <div className="sd-visual">
              <p className="sd-t">YOUR HOME FROM ABOVE · TAP A SIDE</p>
              <svg viewBox="0 0 300 240" className="sd-house">
                <rect x="62" y="52" width="176" height="136" fill="#12161A" stroke="#242B32" />
                <line className={edgeClass("back")} x1="66" y1="52" x2="234" y2="52" onClick={() => setOpen("back")} />
                <line className={edgeClass("left")} x1="62" y1="56" x2="62" y2="184" onClick={() => setOpen("left")} />
                <line className={edgeClass("right")} x1="238" y1="56" x2="238" y2="184" onClick={() => setOpen("right")} />
                <line className={edgeClass("front")} x1="66" y1="188" x2="234" y2="188" onClick={() => setOpen("front")} />
                <rect x="138" y="180" width="24" height="8" fill="#152A31" stroke="#3BD8E9" strokeWidth="1" />
                <text x="124" y="212">FRONT · STREET</text>
                <text x="132" y="42">BACK</text>
                <text x="14" y="124">LEFT</text>
                <text x="248" y="124">RIGHT</text>
              </svg>
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
              <div className="sd-legend">
                <span><i style={{ background: "var(--amber)" }} />TO CONFIRM</span>
                <span><i style={{ background: "var(--cyan)" }} />CONFIRMED</span>
                <span><i style={{ background: "#39424B" }} />NOT PAINTING</span>
              </div>
            </div>
          </div>

          <div className="sd-cards">
            {sides.sides.map(sideCard)}

            {metaCard("extras", "Freestanding extras", (
              <div className={`sd-q ${extrasAnswered ? "ok" : ""}`}>
                <p className="sd-ql">Not on a wall — fences, pergolas and the like. <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
                <div className="sd-chips">
                  {extrasTiles.map((t) => (
                    <Chip key={String(t.key)} on={t.on} label={`${t.on ? "✓ " : "+ "}${t.label}`}
                      onClick={() => act({ action: "toggle_exterior", key: String(t.key), on: !t.on }, { done: `${t.on ? "Removed" : "Added"} ${t.label.toLowerCase()}.` })} />
                  ))}
                  <Chip on={sel("extras:none", m.extrasAns === "none")} label={"Nothing else ✓"} onClick={() => act({ action: "loop_extras_none" }, { opt: ["extras:none", "1"] })} />
                </div>
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
              </div>
            ), "Confirm extras ✓")}

            {metaCard("cond", "Condition & access", (
              <>
                <div className={`sd-q ${m.cond.cond ? "ok" : ""}`}>
                  <p className="sd-ql">How&rsquo;s the paintwork holding up? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
                  <div className="sd-chips">
                    <Chip on={sel("cond:c", m.cond.cond === "good", "good")} label={"Good overall"} onClick={() => act({ action: "loop_cond", cond: "good" }, { describe: withDelta("Good to hear — noted"), opt: ["cond:c", "good"] })} />
                    <Chip on={sel("cond:c", m.cond.cond === "weathered", "weathered")} label={"Weathered"} onClick={() => act({ action: "loop_cond", cond: "weathered" }, { describe: withDelta("Extra prep allowed for weathered paintwork"), opt: ["cond:c", "weathered"] })} />
                    <Chip on={sel("cond:c", m.cond.cond === "peeling", "peeling")} label={"Peeling & flaking"} onClick={() => act({ action: "loop_cond", cond: "peeling" }, { done: "Peeling paint needs a proper look — a lead-safe check is part of our visit.", opt: ["cond:c", "peeling"] })} />
                  </div>
                </div>
                <div className={`sd-q ${m.cond.rot ? "ok" : ""}`}>
                  <p className="sd-ql">Any timber rot up on the fascias? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
                  <div className="sd-chips">
                    <Chip on={sel("cond:r", m.cond.rot === "no", "no")} label={"No, looks solid"} onClick={() => act({ action: "loop_cond", rot: "no" }, { describe: withDelta("Noted — no rot allowance needed"), opt: ["cond:r", "no"] })} />
                    <Chip on={sel("cond:r", m.cond.rot === "little", "little")} label={"A little"} onClick={() => act({ action: "loop_cond", rot: "little" }, { describe: withDelta("We've allowed for minor fascia prep"), opt: ["cond:r", "little"] })} />
                    <Chip on={sel("cond:r", m.cond.rot === "lots", "lots")} label={"Quite a bit"} onClick={() => act({ action: "loop_cond", rot: "lots" }, { done: "Thanks for the honesty — rot repair needs eyes on it, so we'll confirm the roofline on the site visit.", opt: ["cond:r", "lots"] })} />
                  </div>
                </div>
                <div className={`sd-q ${m.cond.acc ? "ok" : ""}`}>
                  <p className="sd-ql">Anything tricky about access? <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
                  <div className="sd-chips">
                    <Chip on={sel("cond:a", m.cond.acc === "steep", "steep")} label={"Steep block"} onClick={() => act({ action: "loop_cond", acc: "steep" }, { describe: withDelta("Access allowance added"), opt: ["cond:a", "steep"] })} />
                    <Chip on={sel("cond:a", m.cond.acc === "tight", "tight")} label={"Tight side access"} onClick={() => act({ action: "loop_cond", acc: "tight" }, { describe: withDelta("Access allowance added"), opt: ["cond:a", "tight"] })} />
                    <Chip on={sel("cond:a", m.cond.acc === "high", "high")} label={"Double-height entry"} onClick={() => act({ action: "loop_cond", acc: "high" }, { describe: withDelta("Access allowance added"), opt: ["cond:a", "high"] })} />
                    <Chip on={sel("cond:a", m.cond.acc === "none", "none")} label={"None of these ✓"} onClick={() => act({ action: "loop_cond", acc: "none" }, { describe: withDelta("No access allowance needed"), opt: ["cond:a", "none"] })} />
                  </div>
                </div>
              </>
            ), "Confirm condition & access ✓")}

            {metaCard("dw", "Quick check — windows & doors", (
              <div className={`sd-q ${m.dwOk === true ? "ok" : ""}`}>
                <p className="sd-ql">
                  Across the sides you&rsquo;re painting, we make it {sides.dw.windows} windows and {sides.dw.doors} doors — is that right?{" "}
                  <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span>
                </p>
                <div className="sd-chips">
                  <Chip on={sel("dw:ok", m.dwOk === true)} label={"That's right ✓"} onClick={() => act({ action: "loop_dw", ok: true }, { opt: ["dw:ok", "1"] })} />
                  <Chip on={false} label={"Something's off — I'll adjust"} onClick={() => { act({ action: "loop_dw", ok: false }); say("Adjust the − / + on the side cards above, then tap “That's right”."); }} />
                </div>
                <p className="sd-help">Counts sit on each side above — use the − / + there, then come back.</p>
              </div>
            ), "Confirm counts ✓")}

            {metaCard("sweep", "Last check — anything we haven't listed?", (
              <div className={`sd-q ${m.sweepAns ? "ok" : ""}`}>
                <p className="sd-ql">Sheds, side gates and the fence behind the house are the usual missing ones. <span className="sd-req">REQUIRED</span><span className="sd-okc">✓</span></p>
                <div className="sd-chips">
                  {sides.sweepItems.map((it) => (
                    <Chip key={it.code} on={sel(`sw:${it.code}`, it.on)}
                      label={`${it.on ? "✓" : "+"} ${it.label} — ${fmt(it.priceCents)}`}
                      onClick={() => act({ action: "sweep_item", code: it.code, on: !it.on }, {
                        describe: withDelta(it.on ? `${it.label} taken off` : `${it.label} added`),
                        opt: [`sw:${it.code}`, it.on ? "0" : "1"],
                      })} />
                  ))}
                  <Chip on={false} label="+ Carport"
                    onClick={() => act({ action: "loop_sweep", add: "Carport" }, {
                      done: "Thanks — we've added the carport, and we'll confirm it on the site visit.",
                    })} />
                  {/* Tom, 31 Aug: "something else" opens a box to SAY what —
                      a flag that just reads "Something else" tells the
                      estimator nothing. */}
                  <Chip on={sweepOtherOpen} label="+ Something else"
                    onClick={() => setSweepOtherOpen((v) => !v)} />
                  <Chip on={sel("sweep:none", m.sweepAns === "none")} label={"No — that's everything ✓"} onClick={() => act({ action: "loop_sweep", ans: "none" }, { opt: ["sweep:none", "1"] })} />
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
              </div>
            ), "Confirm — nothing missing ✓")}
          </div>
        </div>
      </main>

      {!embedded && (
      <div className="sd-stick">
        <div className={`sd-tier ${ladder.tier === "visit" ? "visit" : ""}`}>
          <i />
          {/* Tom, 21 Aug: exterior never accepts online. policy.ts puts every
              exterior job on the visit tier, so there is no self-serve branch
              here to fall through to. */}
          {booked
            ? "Visit booked — your price is confirmed on the day, then fixed in writing."
            : `${VISIT_REASON_LINE[ladder.reason ?? "signoff"]}we'll visit to confirm before your price is fixed — the calendar's right here once everything's blue.`}
        </div>
        <div className="sd-row">
          <div className="sd-pr"><small>ESTIMATE · INCL. GST</small><span data-role="range">{range}</span></div>
          <div className="sd-sp" />
          <button
            className="sd-cta"
            disabled={!allDone || booked != null}
            onClick={() => setSlotsOpen((v) => !v)}
          >
            {booked ? `Visit booked · ${booked}`
              : !allDone ? "Confirm all sides to continue"
              : "Confirm my price — book the visit"}
          </button>
        </div>
        {slotsOpen && (
          <div className="sd-slots">
            {ladder.visitSlots.map((slot) => (
              <button key={slot} onClick={() => {
                act({ action: "book_visit", slot }, { done: "Booked — your estimator arrives with everything you've confirmed, side by side." });
                setBooked(slot);
                setSlotsOpen(false);
              }}>
                {slot}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {toast && <div className="sd-toast sd-show">{toast}</div>}
    </div>
  );
}
