"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import type { CustomerExteriorView } from "@/lib/wizard/scope-editor";
import type { SidesView, SideView, SideKey } from "@/lib/wizard/sides";
import { assertCustomerShape } from "@/lib/wizard/contract";

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
  reason?: "custom" | "peeling" | "rot" | "flagged" | "big" | null;
  visitSlots: string[];
};

const VISIT_REASON_LINE: Record<NonNullable<Ladder["reason"]>, string> = {
  custom: "You've added something we'll price in person — ",
  peeling: "Peeling paint needs a lead-safe check — ",
  rot: "Rot repair needs eyes on it — ",
  flagged: "You've flagged the photos — ",
  big: "Bigger exterior — ",
};
type Payload = CustomerPayload & {
  error?: string;
  sides?: SidesView | null;
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

/** A selectable chip — a real component so its onClick is a handler in the
 * linter's eyes (the old render-time chip() helper tripped react-hooks/refs). */
function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className={`sd-chip ${on ? "on" : ""}`} onClick={onClick}>{label}</button>;
}

const WALL_ADDABLE = [
  { code: "Render", label: "Render" },
  { code: "Brick", label: "Painted brick" },
  { code: "Stucco", label: "Stucco" },
  { code: "Weatherboards", label: "Weatherboard cladding" },
];

export default function SidesEditor({ estimateId, initial, initialSides, initialExterior, initialLadder, embedded = false, onState }: {
  estimateId: string;
  initial: CustomerPayload;
  initialSides: SidesView;
  initialExterior: CustomerExteriorView | null;
  initialLadder: Ladder;
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
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
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

  function act(
    body: Record<string, unknown>,
    opts: { done?: string; describe?: (deltaCents: number) => string; onFail?: (msg: string) => void; onOk?: (j: Payload) => void; opt?: [string, string] } = {},
  ) {
    if (opts.opt) setOptimistic((o) => ({ ...o, [opts.opt![0]]: opts.opt![1] }));
    setPendingCount((n) => n + 1);
    const before = (payload.rangeLoCents + payload.rangeHiCents) / 2;
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, view: "customer" }),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) {
          (opts.onFail ?? say)(j.error ?? "That didn't save — try again.");
          return;
        }
        assertCustomerShape(j, "SidesEditor");
        setPayload(j);
        if (j.sides) setSides(j.sides);
        if (j.sides) onState?.({ progress: j.sides.progress, payload: j });
        if (j.exterior !== undefined) setExterior(j.exterior ?? null);
        if (j.ladder) setLadder(j.ladder);
        // The interior editor's $-delta toasts, same recipe: the range
        // midpoint before vs after IS the honest customer-visible delta.
        if (opts.describe) say(opts.describe((j.rangeLoCents + j.rangeHiCents) / 2 - before));
        else if (opts.done) say(opts.done);
        opts.onOk?.(j);
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        setPendingCount((n) => n - 1);
        if (opts.opt) setOptimistic((o) => { const n = { ...o }; delete n[opts.opt![0]]; return n; });
      }
    });
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
                <div className={`sd-q ${s.size != null ? "ok" : ""}`}>
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
                      <div className="sd-wall sd-tl on" key={w.id}>
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
                  <p className={`sd-wallsum ${s.wallSum === 100 ? "" : "bad"}`}>
                    {s.wallSum === 100 ? "Adds up to 100% ✓" : `Adds up to ${s.wallSum}% — make it 100% before confirming this side`}
                  </p>
                </div>

                <div className="sd-q">
                  <p className="sd-ql">Also on this side — tap to change</p>
                  <div className="sd-tgrid">
                    {s.tiles.map((t) => (
                      <div className="sd-tl on" key={t.id}>
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
                      <div className="sd-tl on custom" key={`c${i}`}>{name}</div>
                    ))}
                  </div>
                  <button className="sd-addsurf" onClick={() => setAddOpen(addOpen === s.key ? null : s.key)}>+ Add a surface to this side</button>
                  {addOpen === s.key && (
                    <div className="sd-addpanel">
                      <p className="sd-pl">EVERYTHING WE PAINT — TAP TO ADD TO {s.label.toUpperCase()}</p>
                      <div className="sd-chips">
                        {WALL_ADDABLE.filter((w) => !s.walls.some((x) => x.code === w.code)).map((w) => (
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
                onClick={() => act({ action: "confirm_side", side: s.key }, {
                  done: `${s.label} confirmed ✓`,
                  onFail: (m) => refuse(s.key, m),
                  onOk: openNext,
                  opt: [`confirm:${s.key}`, "1"],
                })}
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
              onClick={() => act({ action: "confirm_loop_item", item: key }, {
                done: "Confirmed ✓",
                onFail: (m) => refuse(key, m),
                onOk: openNext,
                opt: [`confirm:${key}`, "1"],
              })}
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
  function stepCount(sideKey: SideKey, t: { id: number; count: number; label: string }, dir: 1 | -1) {
    const next = Math.max(1, Math.min(20, shownCount(sideKey, t) + dir));
    if (next === shownCount(sideKey, t)) return;
    act({ action: "side_count", side: sideKey, surfaceId: t.id, count: next },
      { describe: withDelta(`${t.label} ×${next}`), opt: [`cnt:${sideKey}:${t.id}`, String(next)] });
  }

  return (
    <div className={`sd ${ready || embedded ? "" : "wz-waking"}`} data-ready={embedded ? undefined : ready ? "1" : undefined}>
      {!embedded && !ready && <div className="sd-saving">ONE MOMENT…</div>}
      {!embedded && ready && pendingCount > 0 && <div className="sd-saving">SAVING…</div>}
      {!embedded && (
      <header className="sd-top">
        <div className="sd-row">
          <div className="sd-wm">PAINT<span>—</span>GROUP</div>
          <span className={`sd-status ${allDone ? "ok" : ""}`}>{allDone ? "ESTIMATE CONFIRMED ✓" : "IN REVIEW · CONFIRM EACH SIDE"}</span>
        </div>
        <div className="sd-progwrap">
          <div className="sd-lbl"><span className="sd-prog">{prog.done} OF {prog.total} CONFIRMED</span><span>ORANGE = TO CONFIRM · BLUE = CONFIRMED</span></div>
          <div className={`sd-pbar ${allDone ? "ok" : ""}`}><i style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
        </div>
      </header>
      )}

      <main className="sd-wrap">
        <div className="sd-rangebar">
          <div><b>{embedded ? "Now the outside — one side at a time" : "Walk around the house, one side at a time"}</b><span>Front, both sides, back — confirm each and it turns blue.</span></div>
          {!embedded && <div className="sd-range" data-role="range"><small>YOUR ESTIMATE · INCL. GST</small>{range}</div>}
        </div>

        <div className="sd-grid">
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
                  {["Carport", "Something else"].map((n) => (
                    <Chip key={n} on={false} label={`+ ${n}`}
                      onClick={() => act({ action: "loop_sweep", add: n }, {
                        done: `Thanks — we've added ${n.toLowerCase()}, and we'll confirm it on the site visit.`,
                      })} />
                  ))}
                  <Chip on={sel("sweep:none", m.sweepAns === "none")} label={"No — that's everything ✓"} onClick={() => act({ action: "loop_sweep", ans: "none" }, { opt: ["sweep:none", "1"] })} />
                </div>
              </div>
            ), "Confirm — nothing missing ✓")}
          </div>
        </div>
      </main>

      {!embedded && (
      <div className="sd-stick">
        <div className={`sd-tier ${ladder.tier === "visit" ? "visit" : ""}`}>
          <i />
          {booked
            ? "Visit booked — your price is confirmed on the day, then fixed in writing."
            : ladder.tier === "visit"
              ? `${VISIT_REASON_LINE[ladder.reason ?? "big"]}we'll visit to confirm before your price is fixed — the calendar's right here once everything's blue.`
              : "Straightforward exterior — accept online once everything's blue."}
        </div>
        <div className="sd-row">
          <div className="sd-pr"><small>ESTIMATE · INCL. GST</small><span data-role="range">{range}</span></div>
          <div className="sd-sp" />
          <button
            className="sd-cta"
            disabled={!allDone || accepted || booked != null}
            onClick={() => {
              if (ladder.tier === "self_serve") {
                act({ action: "accept_intent" }, { done: "Accepted — desk check today, then your fixed price and booking follow." });
                setAccepted(true);
              } else {
                setSlotsOpen((v) => !v);
              }
            }}
          >
            {booked ? `Visit booked · ${booked}`
              : accepted ? "Accepted ✓"
              : !allDone ? "Confirm all sides to continue"
              : ladder.tier === "self_serve" ? "Accept estimate" : "Confirm my price — book the visit"}
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
