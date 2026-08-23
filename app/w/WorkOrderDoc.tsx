"use client";

import type { WorkOrderDoc as Doc } from "@/lib/workorder/snapshot";
import { WO_STATUS_LABEL } from "@/lib/workorder/snapshot";
import { FINISH_LEVELS, FINISH_ORDER } from "@/lib/workorder/finish";
import { STAGE_LANES, type WoStage } from "@/lib/workorder/stages";
import { SURFACE_STATE_LABEL, type SurfaceState } from "@/lib/workorder/surfaces";
import type { CrewVariation } from "@/lib/workorder/crew";
import { WO_PHOTO_KIND_LABEL, groupByKind, type WOPhoto } from "@/lib/workorder/photos";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import { bookingCaption, bookingDates, bookingDays, bookingLabel, bookingTone, type Booking } from "@/lib/workorder/booking";
import FinishChip from "@/app/components/FinishChip";
import "./workorder.css";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "TBC");

// Staff-edit handlers. When omitted, the document is read-only (contractor view).
export type WOEdit = {
  contractors: { id: string; name: string }[];
  contractorId: string | null;
  onContractor: (id: string | null) => void;
  onStart: (date: string | null) => void;
  onAccess: (notes: string) => void;
  onCrewNotes: (notes: string) => void;
  onColour: (product: string, patch: { name?: string; hex?: string; status?: "tbc" | "confirmed" }) => void;
  onHours: (surfaceKey: string, hours: number | null) => void;
  /** null = this area follows the job's level. */
  onAreaFinish: (areaId: string, code: string | null) => void;
};

/**
 * `stage` is the live seven-stage position, read from the work_orders row — not
 * from the frozen snapshot, which is why it is a prop rather than part of Doc.
 * Step 1 renders it and nothing more; the ticks and gates arrive in step 2.
 */
export default function WorkOrderDoc({ doc, edit, stage, booking, ticks, photos = [], variant = "contractor", crewVariations = [] }: {
  doc: Doc; edit?: WOEdit; stage?: WoStage | null;
  /**
   * "crew" is the painter's copy: no payment section, no customer phone. The
   * doc it receives is ALREADY stripped by lib/workorder/crew.ts — hiding the
   * section here is the second lock on the same door, not the first.
   */
  variant?: "contractor" | "crew";
  /** Variations for the crew view: the work, never the money. */
  crewVariations?: readonly CrewVariation[];
  /** The live booking, derived from the offer — requested is not confirmed. */
  booking?: Booking | null;
  /**
   * Live ticks from `wo_surfaces`, keyed by the document's own surface key.
   * The snapshot's per-surface status is frozen at issue and never written
   * again, so without this the job sheet says "Not started" over work the
   * painter finished — read the ticks, not the copy of the scope.
   */
  ticks?: Record<string, SurfaceState>;
  /** Site photos already signed — see lib/workorder/photos.ts. */
  photos?: readonly WOPhoto[];
}) {
  return (
    <div className="wo">
      <div className="wrap">
        <div className="wo-top">
          <div>
            <div className="wo-ref">{doc.woRef}</div>
            <div className="wo-brand">Work order · {doc.company.name}</div>
          </div>
          <span className="wo-chips">
            {stage ? (
              <span className={`stage-badge ${stage}`} title={`Stage ${STAGE_LANES[stage].n} of 06`}>
                <b>{STAGE_LANES[stage].n}</b> {STAGE_LANES[stage].title}
              </span>
            ) : null}
            <span className={`chip ${doc.status}`}>{WO_STATUS_LABEL[doc.status] ?? doc.status}</span>
          </span>
        </div>

        {booking && booking.state !== "none" && (
          <div className={`wo-booking ${bookingTone(booking.state)}`} data-testid="wo-booking">
            <span className="wo-booking-when">{bookingDates(booking)}</span>
            <span className="wo-booking-days">
              {bookingDays(booking)} day{bookingDays(booking) === 1 ? "" : "s"}
            </span>
            <span className="wo-booking-state">{bookingLabel(booking.state)}</span>
            <p>{bookingCaption(booking)}</p>
          </div>
        )}

        <h1>{doc.jobTitle}</h1>
        <div className="wo-addr">{doc.jobAddress}</div>
        <div className="print-hide" style={{ marginTop: 10 }}>
          <button onClick={() => window.print()} style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", background: "transparent", cursor: "pointer" }}>
            ⤓ Download PDF
          </button>
        </div>

        <div className="facts">
          <div className="fact">
            <div className="k">Customer</div>
            <div className="v">{doc.contactFirstName || "—"}{doc.contactPhone ? ` · ${doc.contactPhone}` : ""}</div>
          </div>
          <div className="fact">
            <div className="k">Start date</div>
            {edit ? <input type="date" value={doc.startDate ?? ""} onChange={(e) => edit.onStart(e.target.value || null)} />
              : <div className="v">{dateFmt(doc.startDate)}</div>}
          </div>
          <div className="fact">
            <div className="k">Contractor</div>
            {edit ? (
              <select value={edit.contractorId ?? ""} onChange={(e) => edit.onContractor(e.target.value || null)}>
                <option value="">— unassigned —</option>
                {edit.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : <div className="v">{doc.contractorName || "—"}</div>}
          </div>
          <div className="fact">
            <div className="k">Access notes</div>
            {edit ? <textarea rows={2} value={doc.accessNotes} onChange={(e) => edit.onAccess(e.target.value)} placeholder="Gate code, parking, pets…" />
              : <div className="v">{doc.accessNotes || "—"}</div>}
          </div>
        </div>

        {/* LEVEL OF FINISH — front and centre so the crew know the standard.
            The PG chip opens the standard itself; the rate-card label stays
            underneath so staff can still see which level was priced. */}
        {(doc.finishCode || doc.levelOfFinish) && (
          <div className="wo-finish">
            <span className="wo-finish-lab">Level of finish</span>
            <FinishChip code={doc.finishCode} fallbackLabel={doc.levelOfFinish} />
            {doc.finishCode && doc.levelOfFinish && (
              <span className="wo-finish-val">{doc.levelOfFinish}</span>
            )}
          </div>
        )}

        {/* FURTHER INSTRUCTIONS — work-order-level crew note */}
        {(edit || doc.crewNotes) && (
          <div className="wo-crew">
            <div className="k">Further instructions for the crew</div>
            {edit
              ? <textarea rows={2} value={doc.crewNotes} onChange={(e) => edit.onCrewNotes(e.target.value)} placeholder="Anything the crew needs to know for this job…" />
              : <div className="v">{doc.crewNotes}</div>}
          </div>
        )}

        {/* MATERIALS FIRST — the trade-counter shopping list */}
        {doc.materials.length > 0 && (
          <section>
            <h2>Materials &amp; colours</h2>
            {doc.materials.map((m, i) => (
              <div className="mat" key={i}>
                <div className="mat-tin">
                  {m.photoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.photoUrl} alt="" loading="lazy" />
                    : <span className="ph">🎨</span>}
                </div>
                <div className="mat-main">
                  <div className="mat-name">{m.product}</div>
                  <div className="mat-colour">
                    {m.colourHex && <span className="swatch" style={{ background: m.colourHex }} />}
                    <span>{m.colourName || "Colour to be confirmed"}</span>
                    {edit ? (
                      <button type="button" className={`cchip ${m.colourStatus}`} onClick={() => edit.onColour(m.product, { status: m.colourStatus === "confirmed" ? "tbc" : "confirmed" })}>
                        {m.colourStatus === "confirmed" ? "Confirmed" : "TBC"}
                      </button>
                    ) : (
                      <span className={`cchip ${m.colourStatus}`}>{m.colourStatus === "confirmed" ? "Confirmed" : "TBC"}</span>
                    )}
                  </div>
                  {/* Colour match (Tom, 23 Aug): codes on the sheet when the
                      estimator had them; otherwise the painter supplies them
                      on the job page before sign-off. */}
                  {m.colourMatch?.required && (
                    <div className="mat-colour" data-testid={`mat-colour-match-${m.product}`} style={{ marginTop: 2 }}>
                      {m.colourMatch.code
                        ? <span>Colour match: <b>{m.colourMatch.code}</b>{m.colourMatch.brand ? ` · ${m.colourMatch.brand}` : ""}{m.colourMatch.canSize ? ` · ${m.colourMatch.canSize}` : ""}</span>
                        : <span className="cchip tbc">Colour match required — supply the code, brand and can size</span>}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mat-litres">{m.litres != null ? `${m.litres} L` : "— L"}</div>
                  {m.coverageMissing && <div className="mat-warn print-hide">set coverage in Settings</div>}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* SCOPE BY AREA */}
        {doc.areas.length > 0 && (
          <section>
            <h2>Scope of works</h2>
            {doc.areas.map((a) => (
              <div className="area" key={a.id}>
                <div className="area-title">
                  <span>{a.title}</span>
                  {/* Only shown where the area differs from the job's level, or
                      when staff are editing and need the control. */}
                  {a.finishOverridden && (
                    <FinishChip code={a.finishCode} variant="mini" differs />
                  )}
                  {edit && (
                    <select
                      className="area-fin"
                      value={a.finishOverridden ? (a.finishCode ?? "") : ""}
                      onChange={(e) => edit.onAreaFinish(a.id, e.target.value || null)}
                      title="Finish level for this area"
                    >
                      <option value="">Job level{doc.finishCode ? ` (${doc.finishCode})` : ""}</option>
                      {FINISH_ORDER.map((c) => (
                        <option key={c} value={c}>
                          {c} {FINISH_LEVELS[c].name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {a.surfaces.map((s) => (
                  <div className="surf" key={s.key}>
                    <div className="surf-main">
                      <div className="surf-name">{s.label}</div>
                      <div className="surf-meta">{s.coats} {s.coats === 1 ? "coat" : "coats"}{s.product ? ` · ${s.product}` : ""}</div>
                      {s.prep && <div className="surf-prep">{s.prep}</div>}
                    </div>
                    <div className="surf-right">
                      {(() => {
                        // The tick wins where there is one; the snapshot's own
                        // status is the fallback for a job issued before the
                        // tick list existed.
                        const tick = ticks?.[s.key];
                        const label = tick
                          ? SURFACE_STATE_LABEL[tick]
                          : s.status === "in_progress" ? "In progress"
                          : s.status === "complete" ? "Complete" : "Not started";
                        const tone = tick === "done" || s.status === "complete" ? " done"
                          : tick === "prepped" || s.status === "in_progress" ? " doing" : "";
                        return <span className={`pill${tone}`} data-testid={`surf-state-${s.key}`}>{label}</span>;
                      })()}
                      {(edit || s.hours != null) && (
                        <div className="surf-hours">
                          <span className="hlab">Hours</span>
                          {edit
                            ? <input type="number" step="0.25" value={s.hours ?? ""} onChange={(e) => edit.onHours(s.key, e.target.value === "" ? null : Number(e.target.value))} />
                            : <span className="hval">{s.hours}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {a.photos.length > 0 && (
                  <div className="area-photos">
                    {a.photos.slice(0, 8).map((src, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={src} alt="" loading="lazy" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* SITE PHOTOS — what actually came back from site. Signed, short-lived
            URLs into the private bucket; staff and the assigned contractor see
            them, nobody else. Print drops them (see photogrid.css). */}
        {photos.length > 0 && (
          <section className="print-hide" data-testid="wo-site-photos">
            <h2>Site photos</h2>
            {groupByKind(photos).map((g) => (
              <div className="wo-photoset" key={g.kind}>
                <div className="wo-photoset-h">
                  {WO_PHOTO_KIND_LABEL[g.kind]}
                  <span>{g.photos.length}</span>
                </div>
                <PhotoGrid photos={g.photos} showKind={false} />
              </div>
            ))}
          </section>
        )}

        {/* VARIATIONS, crew copy — what changed on site, so the painter is not
            working to a stale scope. Scope only; the money lives on the
            contractor's own view of the variation, never here. */}
        {variant === "crew" && crewVariations.length > 0 && (
          <section data-testid="crew-variations">
            <h2>Variations</h2>
            <ul className="excl">
              {crewVariations.map((v, i) => (
                <li key={i}>
                  <b style={{ textTransform: "capitalize" }}>{v.category.replace(/_/g, " ")}</b>
                  {v.comment ? ` — ${v.comment}` : ""}
                  {v.estHours != null ? ` · ~${v.estHours} h` : ""}
                  <span style={{ marginLeft: 6, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {v.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* CONTRACTOR PAYMENT — their price only. No customer pricing anywhere,
            and the crew's copy has no payment at all. */}
        {variant !== "crew" && (
          <section>
            <h2>Payment</h2>
            <div className="pay">
              <div className="l">Contractor payment for this job<small>Fixed price · paid on completion of the scope above</small></div>
              <div className="v">{money(doc.contractorPaymentCents || 0)}</div>
            </div>
          </section>
        )}

        {/* EXCLUSIONS — what NOT to do */}
        {doc.exclusions.length > 0 && (
          <section>
            <h2>Not included</h2>
            <ul className="excl">{doc.exclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        )}

        <div className="wo-foot">
          {doc.company.name}{doc.company.phone ? ` · ${doc.company.phone}` : ""} · {doc.woRef}.{" "}
          {variant === "crew"
            ? "This job sheet is for the assigned crew. Questions go through your contractor."
            : "This work order is confidential and for the assigned contractor only."}
        </div>
      </div>
    </div>
  );
}
