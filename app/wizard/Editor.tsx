"use client";

import { money0 as money } from "@/lib/format/money";
import { useMemo, useRef, useState } from "react";
import RoomCard from "@/app/components/scope/RoomCard";
import PlanViewer from "./PlanViewer";
import type { WizardEditorPayload, WizardRoomView } from "@/lib/wizard/view";
import { assertStaffShape } from "@/lib/wizard/contract";

/**
 * W3: the editor. Internal mode — point price and margin visible, no email
 * gate. Every action here POSTs to /api/estimates/:id/wizard-edit and takes
 * the server's repriced payload back; this component never mutates the tree
 * or computes a number.
 *
 * The plan is pinned left on desktop / docked top on mobile. Room cards are
 * the shared RoomCard (staff mode) — the master plan's rule: consume, don't
 * fork — wrapped with the wizard's provenance chips and one-tap actions.
 * Plan↔card region sync needs room outlines the extraction schema doesn't
 * report yet; recorded as a known gap rather than faked.
 */

type Props = {
  initial: WizardEditorPayload & {
    estimateId: string;
    openAt: string;
    planUrl: string | null;
    skipped: Array<{ name: string; reason: string }>;
    warnings: string[];
  };
  roomTypes: string[];
};


function roomWarnings(r: WizardRoomView): string[] {
  const w: string[] = [];
  if (r.status === "typical") w.push("typical size — confirm");
  if (r.status === "check") w.push("read from the plan, low confidence — check");
  if (r.assumedFields.includes("H")) w.push("ceiling height assumed");
  if (!r.L || !r.W) w.push("no measurements — priced at $0");
  return w;
}

function provChip(r: WizardRoomView): { cls: string; text: string } {
  switch (r.status) {
    case "confirmed": return { cls: "ok", text: "✓ CONFIRMED" };
    case "extracted": return { cls: "ok", text: "READ FROM THE PLAN" };
    case "check": return { cls: "ai", text: "⚠ CHECK — READ FROM THE PLAN" };
    default: return { cls: "ai", text: "TYPICAL SIZE — CONFIRM" };
  }
}

export default function Editor({ initial, roomTypes }: Props) {
  /**
   * A4: what renders is DERIVED — the last authoritative server payload with
   * every still-pending optimistic transform re-applied on top. A removal
   * disappears the instant it's tapped (even mid-flight of the previous
   * one); each server response replaces the base and the remaining pending
   * transforms re-apply, so responses can never resurrect a row that a
   * queued action already removed. A failed action simply drops its
   * transform (the row comes back) and says so.
   */
  const [serverPayload, setServerPayload] = useState<WizardEditorPayload>(initial);
  const [pending, setPending] = useState<Array<{ id: number; fn: (p: WizardEditorPayload) => WizardEditorPayload }>>([]);
  const payload = useMemo(
    () => pending.reduce((p, e) => e.fn(p), serverPayload),
    [serverPayload, pending],
  );
  const [openRoom, setOpenRoom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [heightPick, setHeightPick] = useState("2.4");
  const [sizeDraft, setSizeDraft] = useState<{ L: string; W: string }>({ L: "", W: "" });
  /** Requests run strictly one at a time — the server must never race itself
   * on builder_state — but the QUEUE is what waits, not the user. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const actIdRef = useRef(1);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }

  function act(
    body: Record<string, unknown>,
    done: string,
    optimistic?: (p: WizardEditorPayload) => WizardEditorPayload,
  ) {
    const id = actIdRef.current++;
    if (optimistic) setPending((xs) => [...xs, { id, fn: optimistic }]);
    else setBusy(true); // non-optimistic actions still hold the UI briefly
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/estimates/${initial.estimateId}/wizard-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // R1.1: the internal editor renders the STAFF payload — declared.
          body: JSON.stringify({ ...body, view: "staff" }),
        });
        const j: { error?: string } & WizardEditorPayload = await res.json();
        if (!res.ok) { flash(j.error ?? "That didn't save — try again."); return; }
        assertStaffShape(j, "wizard/Editor");
        setServerPayload(j);
        flash(done);
      } catch {
        // Network drop or a non-JSON error page: say so, never fail silently —
        // a quiet failure invites a second tap and a duplicate room.
        flash("That didn't save — check the connection and try again.");
      } finally {
        if (optimistic) setPending((xs) => xs.filter((e) => e.id !== id));
        else setBusy(false);
      }
    });
  }

  const accuracy = payload.accuracyPct;
  const arc = 138.2;

  return (
    <>
      <header className="wz-top">
        <div className="wz-wm">PAINT<span>—</span>GROUP</div>
        <a className="wz-exit" href="/estimates">Exit</a>
      </header>

      <div className={`wz-ed ${initial.planUrl ? "" : "noplan"}`}>
        <div className="wz-scorebar">
          <div className="wz-score">
            <div className="wz-scring">
              <svg width="52" height="52">
                <circle cx="26" cy="26" r="22" fill="none" stroke="#242B32" strokeWidth="4" />
                <circle
                  cx="26" cy="26" r="22" fill="none"
                  stroke={accuracy >= 90 ? "#2FA46B" : "#E0A83C"}
                  strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={arc} strokeDashoffset={(arc * (1 - accuracy / 100)).toFixed(1)}
                />
              </svg>
              <div className="wz-num">{accuracy}%</div>
            </div>
            <div className="wz-lbl">
              <b>Estimate accuracy</b>
              <span>
                {accuracy >= 90
                  ? "Solid — the assumptions are confirmed"
                  : "Confirm the items below to firm the price up"}
              </span>
            </div>
          </div>
          <div className="wz-money">
            <small>ESTIMATE · INCL. GST</small>
            <div className="wz-r">{money(payload.totals.totalCents)}</div>
          </div>
          <div className="wz-money">
            <small>MARGIN · INTERNAL</small>
            <div className="wz-r" style={{ color: payload.totals.marginCents >= 0 ? "#2FA46B" : "#B3574A" }}>
              {money(payload.totals.marginCents)}
            </div>
          </div>
        </div>

        {(payload.heightUnconfirmed || payload.exteriorWidthFromPlan || payload.exteriorWidthMissing) && (
          <div className="wz-confirmrow">
            {payload.exteriorWidthMissing && (
              <div className="wz-cf">
                <span><b>Width measurement required</b> — an exterior wall has no width; add it in the builder or measure on site.</span>
                <a className="wz-mini" href={initial.openAt} style={{ textDecoration: "none" }}>Open the builder</a>
              </div>
            )}
            {payload.exteriorWidthFromPlan && (
              <div className="wz-cf">
                <span>Exterior widths came from the <b>floorplan&rsquo;s room sums</b> — check them against the plan.</span>
                <button disabled={busy} onClick={() => act(
                  { action: "confirm_exterior_widths" },
                  "Exterior widths confirmed — accuracy up.",
                )}>
                  They&rsquo;re right
                </button>
                <a className="wz-mini" href={initial.openAt} style={{ textDecoration: "none" }}>Adjust in the builder</a>
              </div>
            )}
            {payload.heightUnconfirmed && (
            <div className="wz-cf">
              <span>Ceiling height is assumed at <b style={{ fontFamily: "var(--wz-mono)", fontSize: 12 }}>2.4 m</b> — confirm it:</span>
              <select value={heightPick} onChange={(e) => setHeightPick(e.target.value)}>
                <option value="2.4">2.4 m</option>
                <option value="2.55">2.55 m</option>
                <option value="2.7">2.7 m</option>
                <option value="3.0">3.0 m</option>
                <option value="3.3">3.3 m</option>
              </select>
              <button disabled={busy} onClick={() => act(
                { action: "confirm_height", heightM: Number(heightPick) },
                "Height confirmed across every room — accuracy up.",
              )}>
                Confirm
              </button>
            </div>
            )}
          </div>
        )}

        {initial.planUrl && <PlanViewer src={initial.planUrl} />}

        <div className="wz-rooms">
          {payload.rooms.map((r) => {
            const chip = provChip(r);
            const open = openRoom === r.areaId;
            return (
              <div className="wz-room" key={r.areaId}>
                <RoomCard
                  mode="staff"
                  room={{
                    name: r.name,
                    surfaceCount: r.surfaces.length,
                    totalCents: r.priceCents,
                    warnings: roomWarnings(r),
                  }}
                  onOpen={() => {
                    setOpenRoom(open ? null : r.areaId);
                    setSizeDraft({ L: r.L ? String(r.L) : "", W: r.W ? String(r.W) : "" });
                  }}
                />
                {open && (
                  <div className="wz-detail">
                    <span className={`wz-prov ${chip.cls}`}>{chip.text}</span>
                    <span className="wz-prov" style={{ color: "var(--muted)", border: "1px solid var(--line)" }}>
                      {r.L && r.W ? `${r.L} × ${r.W} × ${r.H} m` : "no size yet"}
                    </span>
                    <div className="wz-surf">
                      {r.surfaces.map((s, i) => (
                        <i key={i}>{s.label}{s.count > 1 ? ` ×${s.count}` : ""} · {s.coats} coat{s.coats === 1 ? "" : "s"}</i>
                      ))}
                    </div>
                    <div className="wz-rowbtns">
                      {r.status !== "confirmed" && (
                        <>
                          <input
                            className="wz-numin" inputMode="decimal" placeholder="L m"
                            value={sizeDraft.L} onChange={(e) => setSizeDraft({ ...sizeDraft, L: e.target.value })}
                          />
                          <input
                            className="wz-numin" inputMode="decimal" placeholder="W m"
                            value={sizeDraft.W} onChange={(e) => setSizeDraft({ ...sizeDraft, W: e.target.value })}
                          />
                          <button
                            className="wz-mini primary" disabled={busy}
                            onClick={() => act(
                              {
                                action: "confirm_room",
                                areaId: r.areaId,
                                ...(Number(sizeDraft.L) > 0 ? { lengthM: Number(sizeDraft.L) } : {}),
                                ...(Number(sizeDraft.W) > 0 ? { widthM: Number(sizeDraft.W) } : {}),
                              },
                              `${r.name} confirmed — accuracy up.`,
                            )}
                          >
                            Confirm size
                          </button>
                        </>
                      )}
                      <button
                        className="wz-mini danger" disabled={busy}
                        onClick={() => {
                          setOpenRoom(null);
                          act(
                            { action: "remove_room", areaId: r.areaId },
                            `${r.name} removed — price updated.`,
                            (p) => ({ ...p, rooms: p.rooms.filter((x) => x.areaId !== r.areaId) }),
                          );
                        }}
                      >
                        Remove
                      </button>
                      <a className="wz-mini" href={`/quote/capture?id=${initial.estimateId}`} style={{ textDecoration: "none" }}>
                        Adjust in capture
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="wz-addrooms" style={{ gridColumn: initial.planUrl ? "2" : "1" }}>
          <p className="wz-q">Any rooms missing?</p>
          <p className="wz-s">Floorplans don&rsquo;t always show everything — tap to add a room and it&rsquo;s priced in at its typical size.</p>
          <div className="wz-chips">
            {roomTypes.map((t) => (
              <button
                key={t} className="wz-chip" disabled={busy}
                onClick={() => act(
                  { action: "add_room", roomType: t },
                  "Added and priced from its typical size — open it to confirm the size.",
                )}
              >
                + {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {(payload.deferred.length > 0 || initial.skipped.length > 0 || initial.warnings.length > 0) && (
          <p className="wz-note">
            {payload.deferred.map((d, i) => (
              <span key={i}>STILL TO SETTLE — {d.room}: {d.what} ({d.needs})<br /></span>
            ))}
            {initial.skipped.map((s, i) => (
              <span key={`s${i}`}>SKIPPED — {s.name}: {s.reason}<br /></span>
            ))}
            {initial.warnings.map((w, i) => (
              <span key={`w${i}`}>NOTE — {w}<br /></span>
            ))}
          </p>
        )}
      </div>

      <div className="wz-stick">
        <div className="wz-pr">
          <small>ESTIMATE · INCL. GST</small>
          <span>{money(payload.totals.totalCents)}</span>
        </div>
        <div className="wz-pr">
          <small>HOURS</small>
          <span>{payload.totals.contractorHours}</span>
        </div>
        <div className="wz-sp" />
        <a className="wz-btn wz-bg" href={`/quote/capture?id=${initial.estimateId}`} style={{ textDecoration: "none" }}>
          Capture detail
        </a>
        <a className="wz-btn wz-bp" href={initial.openAt} style={{ textDecoration: "none", textAlign: "center" }}>
          Open in the builder
        </a>
      </div>

      <div className={`wz-toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
