"use client";

import type { WorkOrderDoc as Doc } from "@/lib/workorder/snapshot";
import { WO_STATUS_LABEL } from "@/lib/workorder/snapshot";
import ColourPicker from "@/app/components/ColourPicker";
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
  onColour: (product: string, patch: { name?: string; hex?: string; status?: "tbc" | "confirmed" }) => void;
  onHours: (surfaceKey: string, hours: number | null) => void;
};

export default function WorkOrderDoc({ doc, edit }: { doc: Doc; edit?: WOEdit }) {
  return (
    <div className="wo">
      <div className="wrap">
        <div className="wo-top">
          <div>
            <div className="wo-ref">{doc.woRef}</div>
            <div className="wo-brand">Work order · {doc.company.name}</div>
          </div>
          <span className={`chip ${doc.status}`}>{WO_STATUS_LABEL[doc.status] ?? doc.status}</span>
        </div>

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
                    {edit ? (
                      <>
                        <ColourPicker value={m.colourName ? { name: m.colourName, hex: m.colourHex } : null} onChange={(c) => edit.onColour(m.product, { name: c.name, hex: c.hex })} compact />
                        <button type="button" className={`cchip ${m.colourStatus}`} onClick={() => edit.onColour(m.product, { status: m.colourStatus === "confirmed" ? "tbc" : "confirmed" })}>
                          {m.colourStatus === "confirmed" ? "Confirmed" : "TBC"}
                        </button>
                      </>
                    ) : (
                      <>
                        {m.colourHex && <span className="swatch" style={{ background: m.colourHex }} />}
                        <span>{m.colourName || "Colour to be confirmed"}</span>
                        <span className={`cchip ${m.colourStatus}`}>{m.colourStatus === "confirmed" ? "Confirmed" : "TBC"}</span>
                      </>
                    )}
                  </div>
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
                <div className="area-title">{a.title}</div>
                {a.surfaces.map((s) => (
                  <div className="surf" key={s.key}>
                    <div className="surf-main">
                      <div className="surf-name">{s.label}</div>
                      <div className="surf-meta">{s.coats} {s.coats === 1 ? "coat" : "coats"}{s.product ? ` · ${s.product}` : ""}</div>
                      {s.prep && <div className="surf-prep">{s.prep}</div>}
                    </div>
                    <div className="surf-right">
                      <span className="pill">{s.status === "in_progress" ? "In progress" : s.status === "complete" ? "Complete" : "Not started"}</span>
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

        {/* CONTRACTOR PAYMENT — their price only. No customer pricing anywhere. */}
        <section>
          <h2>Payment</h2>
          <div className="pay">
            <div className="l">Contractor payment for this job<small>Fixed price · paid on completion of the scope above</small></div>
            <div className="v">{money(doc.contractorPaymentCents || 0)}</div>
          </div>
        </section>

        {/* EXCLUSIONS — what NOT to do */}
        {doc.exclusions.length > 0 && (
          <section>
            <h2>Not included</h2>
            <ul className="excl">{doc.exclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        )}

        <div className="wo-foot">
          {doc.company.name}{doc.company.phone ? ` · ${doc.company.phone}` : ""} · {doc.woRef}. This work order is confidential and for the assigned contractor only.
        </div>
      </div>
    </div>
  );
}
