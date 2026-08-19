"use client";

import { useMemo, useRef, useState } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";
import type { CustomerExteriorView, CustomerScopeRoom, ExteriorExtent } from "@/lib/wizard/scope-editor";

type Ladder = { tier: "self_serve" | "visit"; visitSlots: string[] };

/**
 * Part B (interior + shared): the customer scope editor, matching
 * design/reference/customer-scope-editor-mockup.html — room cards with tile
 * grids and steppers, "More surfaces…", the skirting pairing advice,
 * per-room "Something else?" notes (amber, never silently priced), delta
 * toasts and the live range, and the sign-off ladder's framing.
 *
 * This component computes NOTHING. Every tap posts to wizard-edit's
 * whitelisted actions; the server reprices via lib/pricing and answers with
 * the authoritative range + rebuilt tile state. No hour, rate or point
 * price exists anywhere in its props.
 */

type Payload = CustomerPayload & {
  scopeRooms?: CustomerScopeRoom[];
  exterior?: CustomerExteriorView | null;
  ladder?: Ladder;
  error?: string;
};

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

export default function ScopeEditor({ estimateId, initial, initialRooms, initialExterior = null, initialLadder, roomTypes, liveRange }: {
  estimateId: string;
  initial: CustomerPayload;
  initialRooms: CustomerScopeRoom[];
  initialExterior?: CustomerExteriorView | null;
  initialLadder?: Ladder;
  roomTypes: string[];
  liveRange: boolean;
}) {
  const [payload, setPayload] = useState<CustomerPayload>(initial);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(initialRooms);
  const [exterior, setExterior] = useState<CustomerExteriorView | null>(initialExterior);
  const [ladder, setLadder] = useState<Ladder>(initialLadder ?? { tier: "visit", visitSlots: [] });
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const [fenceText, setFenceText] = useState("");
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [openMore, setOpenMore] = useState<Set<number>>(new Set());
  const [advice, setAdvice] = useState<{ areaId: number; key: string } | null>(null);
  const [notes, setNotes] = useState<Record<number | string, string>>({});
  const [noteChips, setNoteChips] = useState<Record<number | string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const mid = (payload.rangeLoCents + payload.rangeHiCents) / 2;

  function say(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /** POST a whitelisted action; reconcile range + tiles from the server. */
  function act(body: Record<string, unknown>, busyKey: string, describe?: (deltaCents: number) => string) {
    setBusyKeys((s) => new Set(s).add(busyKey));
    const before = mid;
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // R1.1: this surface renders the CUSTOMER payload — declared
          // explicitly, so a staff preview gets exactly what a customer gets.
          body: JSON.stringify({ ...body, view: "customer" }),
        });
        const j = (await res.json().catch(() => ({}))) as Payload;
        if (!res.ok) { say(j.error ?? "That didn't save — try again."); return; }
        assertCustomerShape(j, "ScopeEditor");
        setPayload(j);
        if (j.scopeRooms) setRooms(j.scopeRooms);
        if (j.exterior !== undefined) setExterior(j.exterior);
        if (j.ladder) setLadder(j.ladder);
        if (liveRange) { setFlash((n) => n + 1); }
        if (describe && liveRange) {
          const delta = (j.rangeLoCents + j.rangeHiCents) / 2 - before;
          say(describe(delta));
        } else if (describe) {
          say(describe(0).replace(/ — about.*$/, ""));
        }
      } catch {
        say("That didn't save — check the connection and try again.");
      } finally {
        setBusyKeys((s) => { const n = new Set(s); n.delete(busyKey); return n; });
      }
    });
  }

  const deltaText = (label: string, added: boolean) => (delta: number) => {
    const abs = Math.abs(Math.round(delta));
    if (abs < 100) return `${added ? "Added" : "Removed"} ${label.toLowerCase()}.`;
    return `${added ? "Added" : "Removed"} ${label.toLowerCase()} — about ${added ? "+" : "−"}${fmt(abs)} ${added ? "to" : "from"} your range`;
  };

  function toggle(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number]) {
    const turningOff = tile.on;
    // Pairing advice (mockup): skirting off while walls stay on → advisory.
    if (turningOff && tile.key === "skirting" && room.tiles.some((t) => t.key === "walls" && t.on)) {
      setAdvice({ areaId: room.areaId, key: "skirting" });
    }
    act(
      { action: "toggle_surface", areaId: room.areaId, key: tile.key, on: !tile.on },
      `${room.areaId}:${tile.key}`,
      deltaText(tile.label, !tile.on),
    );
  }

  function step(room: CustomerScopeRoom, tile: CustomerScopeRoom["tiles"][number], dir: 1 | -1) {
    const next = Math.max(1, Math.min(12, (tile.count ?? 1) + dir));
    if (next === tile.count) return;
    act(
      { action: "set_count", areaId: room.areaId, key: tile.key, count: next },
      `${room.areaId}:${tile.key}:n`,
      (d) => `${tile.label} ×${next}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`,
    );
  }

  function addNote(scope: number | "job") {
    const text = (notes[scope] ?? "").trim();
    if (!text) return;
    act(
      { action: "add_note", areaId: scope === "job" ? null : scope, note: text },
      `note:${scope}`,
      () => "Added as a note for your estimator — never priced silently.",
    );
    setNoteChips((c) => ({ ...c, [scope]: text }));
    setNotes((n) => ({ ...n, [scope]: "" }));
  }

  const rangeText = `${fmt(payload.rangeLoCents)} – ${fmt(payload.rangeHiCents)}`;
  const selfServe = ladder.tier === "self_serve";
  // The visit tier is an offer, never a block (mockup copy verbatim).
  const tierLine = booked
    ? "Visit booked — your price is confirmed on the day, then fixed in writing."
    : accepted
      ? "Accepted — our team gives it a final desk check, then your fixed price and booking confirmation follow."
      : selfServe
        ? `At ${payload.accuracyPct}% accuracy you can accept online. We confirm details before we start.`
        : "The final step is a short visit so we can stand behind every number.";

  return (
    <>
      <header className="wz-top"><div className="wz-wm">PAINT<span>—</span>GROUP</div></header>

      <main className="sc-wrap">
        <div className="sc-scorebar">
          <div className="sc-score">
            <div className="sc-ring">
              <svg width="48" height="48" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="#242B32" strokeWidth="4" />
                <circle cx="24" cy="24" r="20" fill="none" stroke={payload.accuracyPct >= 90 ? "#2FA46B" : "#E0A83C"}
                  strokeWidth="4" strokeLinecap="round" strokeDasharray="125.6"
                  strokeDashoffset={(125.6 * (1 - payload.accuracyPct / 100)).toFixed(1)} />
              </svg>
              <div className="sc-num">{payload.accuracyPct}%</div>
            </div>
            <div className="sc-lbl">
              <b>Shape your estimate</b>
              <span>Add or remove anything — we&rsquo;ll reprice as you go</span>
            </div>
          </div>
          <div className="sc-range" key={flash}>
            <small>YOUR ESTIMATE · INCL. GST</small>
            <div className="sc-r">{rangeText}</div>
          </div>
        </div>

        <div className="sc-cards">
          {rooms.map((room) => {
            const main = room.tiles.filter((t) => !t.longTail);
            const tail = room.tiles.filter((t) => t.longTail);
            const showTail = openMore.has(room.areaId);
            return (
              <section className="sc-rc" key={room.areaId}>
                <div className="sc-hd">
                  <b>{room.name}</b>
                  <span className="sc-m">
                    {room.m2 != null && `${room.m2.toFixed(1)} m²`}
                    <button
                      className="sc-x" aria-label={`Remove ${room.name}`}
                      onClick={() => act({ action: "remove_room", areaId: room.areaId }, `rm:${room.areaId}`, deltaText(room.name, false))}
                    >×</button>
                  </span>
                </div>
                <div className="sc-tgrid">
                  {[...main, ...(showTail ? tail : [])].map((t) => (
                    <div
                      key={String(t.key)}
                      className={`sc-tl ${t.on ? "on" : ""} ${busyKeys.has(`${room.areaId}:${t.key}`) ? "busy" : ""}`}
                      role="checkbox" aria-checked={t.on} tabIndex={0}
                      onClick={() => toggle(room, t)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(room, t); } }}
                    >
                      {t.label}
                      {t.on && t.countable && (
                        <span className="sc-st" onClick={(e) => e.stopPropagation()}>
                          <button aria-label="fewer" onClick={() => step(room, t, -1)}>−</button>
                          <b>{t.count ?? 1}</b>
                          <button aria-label="more" onClick={() => step(room, t, 1)}>+</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {tail.length > 0 && (
                  <button className="sc-more" onClick={() => setOpenMore((s) => {
                    const n = new Set(s); if (n.has(room.areaId)) n.delete(room.areaId); else n.add(room.areaId); return n;
                  })}>
                    {showTail ? "Fewer surfaces" : "More surfaces…"}
                  </button>
                )}
                {advice?.areaId === room.areaId && (
                  <div className="sc-advice">
                    <span>Skirting is usually painted with the walls — leave it out?</span>
                    <button className="keep" onClick={() => {
                      setAdvice(null);
                      const t = room.tiles.find((x) => x.key === "skirting");
                      if (t && !t.on) act({ action: "toggle_surface", areaId: room.areaId, key: "skirting", on: true }, `${room.areaId}:skirting`, () => "Skirting kept in.");
                      else say("Skirting kept in.");
                    }}>Keep it in</button>
                    <button onClick={() => { setAdvice(null); say(`No problem — skirting left out of ${room.name}.`); }}>Leave it out</button>
                  </div>
                )}
                <div className="sc-else">
                  <input
                    placeholder="Something else in this room? Tell us…"
                    value={notes[room.areaId] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [room.areaId]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addNote(room.areaId); }}
                  />
                  <button onClick={() => addNote(room.areaId)}>Add</button>
                </div>
                {noteChips[room.areaId] && (
                  <div className="sc-notechip">⚑ Noted for your estimator: &ldquo;{noteChips[room.areaId]}&rdquo; — we&rsquo;ll price this with you</div>
                )}
                <div className="sc-inc">Includes filling minor cracks and sanding — allowances set by us</div>
              </section>
            );
          })}

          {exterior && (
            <>
              <div className="sc-geo">
                <span className="g">{exterior.storeys > 1 ? "DOUBLE" : "SINGLE"} STOREY · <i>FROM YOUR PHOTOS</i></span>
                <button onClick={() => {
                  act({ action: "flag_geometry" }, "geo", () => "Flagged — geometry is ours to verify, so your estimator will confirm this on site.");
                }}>Not right? Tell us</button>
              </div>
              {exterior.groups.map((g) => (
                <div key={g.group}>
                  <p className="sc-grouplbl">{g.label}</p>
                  <section className="sc-rc">
                    <div className="sc-tgrid">
                      {g.tiles.map((t) => (
                        <div key={String(t.key)} className={`sc-tl ${t.on ? "on" : ""}`}
                          role="checkbox" aria-checked={t.on} tabIndex={0}
                          onClick={() => act({ action: "toggle_exterior", key: String(t.key), on: !t.on }, `ext:${t.key}`, deltaText(t.label, !t.on))}>
                          {t.label}
                        </div>
                      ))}
                    </div>
                    {g.group === "body" && (
                      <div className="sc-seg">
                        {([["whole", "Whole house"], ["front", "Front only"], ["front_sides", "Front + sides"]] as Array<[ExteriorExtent, string]>).map(([v, l]) => (
                          <button key={v} className={exterior.extent === v ? "on" : ""}
                            onClick={() => act({ action: "set_extent", extent: v }, "extent", (d) => `${l}${liveRange && Math.abs(d) >= 100 ? ` — about ${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : ""}`)}>
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                    {g.group === "roofline" && (
                      <div className="sc-inc">Pre-selected — most exterior quotes include the roofline. Untick anything you don&rsquo;t want.</div>
                    )}
                    {g.group === "extras" && (
                      <div className="sc-else">
                        <input placeholder="Fence length in metres — or type 'not sure'"
                          value={fenceText} onChange={(e) => setFenceText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          onBlur={() => {
                            const v = fenceText.trim().toLowerCase();
                            if (!v) return;
                            setFenceText("");
                            if (v.includes("not")) act({ action: "set_fence", metres: null }, "fence", () => "Not a problem — we'll measure it on the day.");
                            else {
                              const m = Number(v.replace(/[^0-9.]/g, ""));
                              if (m > 0) act({ action: "set_fence", metres: m }, "fence", () => `Fence set to ${m} m — range repriced.`);
                            }
                          }} />
                      </div>
                    )}
                  </section>
                </div>
              ))}
              <section className="sc-rc"><div className="sc-inc">Prep, access equipment and sundries are allowed for by us and included in your range</div></section>
            </>
          )}

          <div className="sc-addrooms">
            <p className="q">Are any rooms missing?</p>
            <div className="sc-chips">
              {roomTypes.map((t) => (
                <button key={t} className="sc-chip"
                  onClick={() => act({ action: "add_room", roomType: t }, `add:${t}`, deltaText(t.replace(/_/g, " "), true))}>
                  + {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      <div className="sc-stick">
        <div className={`sc-tier ${selfServe && !accepted && !booked ? "" : "visit"}`}><i />{tierLine}</div>
        <div className="sc-row">
          <div className="sc-pr"><small>ESTIMATE · INCL. GST</small><span>{rangeText}</span></div>
          <div className="sc-sp" />
          {!accepted && !booked && (
            <button className="sc-btn" onClick={() => {
              if (selfServe) {
                setAccepted(true);
                act({ action: "accept_intent" }, "accept");
                say("Accepted — our team gives it a final desk check today, then your fixed price and booking confirmation follow.");
              } else {
                setSlotsOpen((v) => !v);
              }
            }}>
              {selfServe ? "Accept estimate" : "Confirm my price — book the visit"}
            </button>
          )}
        </div>
        {slotsOpen && !booked && (
          <div className="sc-slots">
            {ladder.visitSlots.map((slot) => (
              <button key={slot} onClick={() => {
                setSlotsOpen(false);
                setBooked(slot);
                act({ action: "book_visit", slot }, "book");
                say("Booked — your estimator arrives with everything you've built here.");
              }}>{slot.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="sc-toast">{toast}</div>}
    </>
  );
}
