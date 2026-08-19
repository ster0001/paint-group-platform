"use client";

import { useState } from "react";
import RoomCard from "@/app/components/scope/RoomCard";
import PlanViewer from "./PlanViewer";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { CustomerPayload } from "@/lib/wizard/view";
import { assertCustomerShape } from "@/lib/wizard/contract";

/**
 * Step 8: what the customer sees after submitting — either a guardrail
 * outcome (a polite screen, no price), or the reveal: a RANGE whose width
 * follows the accuracy score, room cards with inclusions and confidence,
 * one-tap confirmations that tighten the range (stamped customer_stated,
 * always cross-checked by staff), and the walkthrough CTA whenever the
 * policy says a human signs off first — which is every exterior.
 */

export type CustomerOutcome = {
  outcome: "hard_stop" | "handoff" | "outside_area" | "below_floor" | "rate_limited";
  message: string;
};

type Reveal = CustomerPayload & { estimateId: string; planUrl: string | null };

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

const OUTCOME_HEADINGS: Record<CustomerOutcome["outcome"], string> = {
  hard_stop: "This one needs a proper look first",
  handoff: "This one deserves a person",
  outside_area: "A little outside our patch",
  below_floor: "A small job — we'll price it directly",
  rate_limited: "Looks like you're busy",
};

export default function CustomerResult({ outcome, reveal, roomTypes }: {
  outcome: CustomerOutcome | null;
  reveal: Reveal | null;
  roomTypes: string[];
}) {
  const [payload, setPayload] = useState<CustomerPayload | null>(reveal);
  const [openRoom, setOpenRoom] = useState<number | null>(null);
  const [sizeDraft, setSizeDraft] = useState({ L: "", W: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 3200); }

  if (outcome || !reveal || !payload) {
    const o = outcome ?? { outcome: "handoff" as const, message: "We'll be in touch shortly." };
    return (
      <>
        <header className="wz-top"><div className="wz-wm">PAINT<span>—</span>GROUP</div></header>
        <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 70 }}>
          <h1>{OUTCOME_HEADINGS[o.outcome]}</h1>
          <p className="wz-sub" style={{ marginTop: 14 }}>{o.message}</p>
          <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
            We have everything you entered — nothing needs doing again.
          </p>
        </div>
      </>
    );
  }

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/estimates/${reveal!.estimateId}/wizard-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // R1.1: the result screen renders the CUSTOMER payload — declared.
        body: JSON.stringify({ ...body, view: "customer" }),
      });
      const j: { error?: string } & CustomerPayload = await res.json();
      if (!res.ok) { flash(j.error ?? "That didn't save — try again."); return; }
      assertCustomerShape(j, "CustomerResult");
      setPayload(j);
      flash(done);
    } catch {
      flash("That didn't save — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEstimate() {
    // Account-on-save: the anonymous session becomes a real account on the
    // email they gave, so the estimate is theirs to come back to.
    setBusy(true);
    try {
      const supabase = createBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !user.email) {
        // The email lives in the lead; re-request it here for the account.
        const email = window.prompt("Confirm your email to save this estimate:")?.trim();
        if (!email) return;
        const { error } = await supabase.auth.updateUser({ email });
        if (error) { flash("Couldn't link that email just now — your estimate is still safe with us."); return; }
      }
      setSaved(true);
      flash("Saved — check your inbox to confirm, and your estimate will be waiting.");
    } finally {
      setBusy(false);
    }
  }

  const range = `${money(payload.rangeLoCents)} – ${money(payload.rangeHiCents)}`;
  const arc = 138.2;

  return (
    <>
      <header className="wz-top"><div className="wz-wm">PAINT<span>—</span>GROUP</div></header>

      <div className={`wz-ed ${reveal.planUrl ? "" : "noplan"}`}>
        <div className="wz-scorebar">
          <div className="wz-score">
            <div className="wz-scring">
              <svg width="52" height="52">
                <circle cx="26" cy="26" r="22" fill="none" stroke="#242B32" strokeWidth="4" />
                <circle
                  cx="26" cy="26" r="22" fill="none"
                  stroke={payload.tightBand ? "#2FA46B" : "#E0A83C"}
                  strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={arc} strokeDashoffset={(arc * (1 - payload.accuracyPct / 100)).toFixed(1)}
                />
              </svg>
              <div className="wz-num">{payload.accuracyPct}%</div>
            </div>
            <div className="wz-lbl">
              <b>Estimate accuracy</b>
              <span>
                {payload.tightBand
                  ? "Nice — tight range unlocked"
                  : "Confirm the items below to tighten your price"}
              </span>
            </div>
          </div>
          <div className="wz-money">
            <small>YOUR ESTIMATE · INCL. GST</small>
            <div className="wz-r">{range}</div>
          </div>
        </div>

        {/* Part B: the scope editor — full control of WHAT is painted. */}
        <div className="wz-confirmrow">
          <div className="wz-cf">
            <span><b>Shape your estimate</b> — add or remove rooms and surfaces, and watch the range follow.</span>
            <a className="wz-mini" href={`/estimate/scope?id=${reveal.estimateId}`} style={{ textDecoration: "none" }}>
              Open the editor
            </a>
          </div>
        </div>

        {(payload.heightUnconfirmed || payload.exteriorWidthFromPlan || payload.exteriorWidthMissing) && (
          <div className="wz-confirmrow">
            {payload.exteriorWidthMissing && (
              <div className="wz-cf">
                <span>Some outside walls couldn&rsquo;t be measured from your photos — we&rsquo;ll measure them when we visit.</span>
              </div>
            )}
            {payload.exteriorWidthFromPlan && (
              <div className="wz-cf">
                <span>Outside wall widths were read from your floorplan — if you know them, confirming tightens your price.</span>
                <button disabled={busy} onClick={() => act(
                  { action: "confirm_exterior_widths" },
                  "Thanks — noted. We still double-check before your final quote.",
                )}>
                  They look right
                </button>
              </div>
            )}
            {payload.heightUnconfirmed && (
              <div className="wz-cf">
                <span>We&rsquo;ve allowed standard <b style={{ fontFamily: "var(--wz-mono)", fontSize: 12 }}>2.4 m</b> ceilings — sound right?</span>
                <button disabled={busy} onClick={() => act(
                  { action: "confirm_height", heightM: 2.4 },
                  "Confirmed — accuracy up, range tighter.",
                )}>
                  Yes, standard
                </button>
                <button className="wz-mini" disabled={busy} onClick={() => act(
                  { action: "confirm_height", heightM: 2.7 },
                  "Higher ceilings noted — accuracy up, range tighter.",
                )}>
                  Higher (~2.7 m)
                </button>
              </div>
            )}
          </div>
        )}

        {reveal.planUrl && <PlanViewer src={reveal.planUrl} title="YOUR HOME" note="AS UPLOADED" />}

        <div className="wz-rooms">
          {payload.rooms.map((r) => {
            const open = openRoom === r.areaId;
            return (
              <div className="wz-room" key={r.areaId}>
                <RoomCard
                  mode="customer"
                  room={{
                    name: r.name,
                    surfaceCount: r.summary.split(",").length,
                    summary: r.summary,
                    confidencePct: r.confidencePct,
                  }}
                  onOpen={() => { setOpenRoom(open ? null : r.areaId); setSizeDraft({ L: "", W: "" }); }}
                />
                {open && (
                  <div className="wz-detail">
                    <span className="wz-prov ai">
                      {r.status === "typical" ? "TYPICAL SIZE — KNOW THE REAL ONE?" :
                       r.status === "stated" ? "✓ YOU CONFIRMED THIS" :
                       r.status === "confirmed" ? "✓ CONFIRMED" : "READ FROM YOUR PLAN"}
                    </span>
                    <div className="wz-rowbtns">
                      {r.status !== "confirmed" && r.status !== "stated" && (
                        <>
                          <input className="wz-numin" inputMode="decimal" placeholder="Length m"
                            value={sizeDraft.L} onChange={(e) => setSizeDraft({ ...sizeDraft, L: e.target.value })} />
                          <input className="wz-numin" inputMode="decimal" placeholder="Width m"
                            value={sizeDraft.W} onChange={(e) => setSizeDraft({ ...sizeDraft, W: e.target.value })} />
                          <button className="wz-mini primary" disabled={busy}
                            onClick={() => act(
                              {
                                action: "confirm_room", areaId: r.areaId,
                                ...(Number(sizeDraft.L) > 0 ? { lengthM: Number(sizeDraft.L) } : {}),
                                ...(Number(sizeDraft.W) > 0 ? { widthM: Number(sizeDraft.W) } : {}),
                              },
                              `${r.name} confirmed — range tighter.`,
                            )}>
                            Confirm size
                          </button>
                        </>
                      )}
                      <button className="wz-mini danger" disabled={busy}
                        onClick={() => act({ action: "remove_room", areaId: r.areaId }, `${r.name} removed — price updated.`)}>
                        Not painting this room
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="wz-addrooms" style={{ gridColumn: reveal.planUrl ? "2" : "1" }}>
          <p className="wz-q">Any rooms missing?</p>
          <p className="wz-s">Floorplans don&rsquo;t always show everything — tap to add a room and it&rsquo;s priced in.</p>
          <div className="wz-chips">
            {roomTypes.map((t) => (
              <button key={t} className="wz-chip" disabled={busy}
                onClick={() => act({ action: "add_room", roomType: t }, "Added and priced in — tap it to confirm the size.")}>
                + {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {payload.confirmOnSite.length > 0 && (
          <p className="wz-note">
            {payload.confirmOnSite.map((n, i) => <span key={i}>{n}<br /></span>)}
          </p>
        )}
      </div>

      <div className="wz-stick">
        <div className="wz-pr">
          <small>YOUR ESTIMATE · INCL. GST</small>
          <span>{range}</span>
        </div>
        <div className="wz-sp" />
        {payload.walkthroughRequired && (
          <span style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 260 }}>
            We confirm this one in person before it becomes a fixed price.
          </span>
        )}
        <button className="wz-btn wz-bg" onClick={() => flash("Lovely — we'll call to arrange a time that suits.")}>
          Book a walkthrough
        </button>
        <button className="wz-btn wz-bp" disabled={busy || saved} onClick={saveEstimate}>
          {saved ? "Saved ✓" : "Save my estimate"}
        </button>
      </div>

      <div className={`wz-toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
