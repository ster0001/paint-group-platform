"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supplyColourMatch } from "./colourMatchActions";

export type ColourMatchRow = {
  product: string;
  colourName: string;
  /** Flagged by the estimator. */
  required: boolean;
  /** Codes the estimator already gave (snapshot). */
  snapCode: string; snapBrand: string; snapCan: string;
  /** Codes supplied on the job (work_orders.colours → product → match). */
  woMatch: { code?: string; brand?: string; canSize?: string; by?: string } | null;
};

/**
 * Colour matches on a job (Tom, 23 Aug). A product needs codes when the
 * estimator flagged it, OR the pre-start colours question was answered No and
 * the product has no colour. The painter (or office) types the code, brand and
 * can size; the pack / close is gated until every one is in.
 *
 * One component for both portals — `ui` picks the class vocabulary.
 */
export default function ColourMatchCard({
  workOrderId, materials, coloursNo, canEdit, ui = "pc",
}: {
  workOrderId: string; materials: ColourMatchRow[]; coloursNo: boolean; canEdit: boolean; ui?: "pc" | "pt";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { code: string; brand: string; canSize: string }>>({});

  const rows = materials
    // Fuel, consumables and the like have no colour to match (Tom, 1 Sep #2) —
    // the SQL gate (wo_colour_match_outstanding, 20261226) skips them by the
    // same name rule so the screen and the gate can't disagree.
    .filter((m) => !/fuel|consumable/i.test(m.product))
    .map((m) => {
      const needed = m.required || (coloursNo && !m.colourName);
      const code = m.woMatch?.code || m.snapCode;
      const brand = m.woMatch?.brand || m.snapBrand;
      const canSize = m.woMatch?.canSize || m.snapCan;
      return { ...m, needed, code, brand, canSize, supplied: Boolean(code) };
    })
    .filter((m) => m.needed || m.supplied);

  if (rows.length === 0) return null;

  const outstanding = rows.filter((r) => r.needed && !r.supplied).length;
  const pc = ui === "pc";

  function save(product: string) {
    const d = drafts[product] ?? { code: "", brand: "", canSize: "" };
    setMessage(null);
    startTransition(async () => {
      const r = await supplyColourMatch({ workOrderId, product, ...d });
      if (r.ok) { setMessage("Saved — colour code on the job."); router.refresh(); }
      else setMessage(r.message);
    });
  }

  return (
    <div className="card" data-testid="colour-match-card">
      {pc ? (
        <h3>Colour matches <em>{outstanding === 0 ? "all codes in" : `${outstanding} still needed`}</em></h3>
      ) : (
        <div className="tick-head"><b>Colour matches</b>
          <span className="tick-count">{outstanding === 0 ? "all codes in" : `${outstanding} needed`}</span></div>
      )}
      <p className={pc ? "note" : "hint"} style={pc ? undefined : { padding: 0, marginTop: 6 }}>
        {outstanding > 0
          ? "These need a colour match. Add the colour code, the paint brand and the can size — the job can't go to sign-off until every code is in."
          : "Every colour match on this job has its code."}
      </p>
      {message && <p className={pc ? "note" : "tick-msg"} style={pc ? { color: "var(--amber)" } : undefined} role="status" data-testid="colour-match-msg">{message}</p>}

      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {rows.map((r) => (
          <div key={r.product} data-testid={`colour-match-${r.product}`}
            style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontSize: 13.5 }}>{r.product}</b>
              {r.colourName && <span style={{ fontSize: 12, color: "var(--muted)" }}>{r.colourName}</span>}
              <span className={pc ? `pill ${r.supplied ? "p-em" : "p-am"}` : `chip ${r.supplied ? "grn" : "amb"}`}
                data-testid={`colour-match-state-${r.product}`}>
                {r.supplied ? "code in" : r.required ? "colour match required" : "no colour — match needed"}
              </span>
            </div>
            {r.supplied && (
              <p className={pc ? "note" : "hint"} style={{ margin: "4px 0 0", padding: 0 }} data-testid={`colour-match-code-${r.product}`}>
                Code <b>{r.code}</b>{r.brand ? ` · ${r.brand}` : ""}{r.canSize ? ` · ${r.canSize}` : ""}
                {r.woMatch?.by ? ` · supplied by the ${r.woMatch.by === "staff" ? "office" : "painter"}` : " · from the estimate"}
              </p>
            )}
            {canEdit && (
              <div style={{ display: "grid", gap: 6, marginTop: 6, gridTemplateColumns: "1fr 1fr 1fr auto" }}>
                <input className={pc ? "num" : ""} placeholder="Colour code" data-testid={`cm-code-${r.product}`}
                  value={drafts[r.product]?.code ?? (r.woMatch?.code ?? "")}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.product]: { code: e.target.value, brand: d[r.product]?.brand ?? r.woMatch?.brand ?? "", canSize: d[r.product]?.canSize ?? r.woMatch?.canSize ?? "" } }))} />
                <input className={pc ? "num" : ""} placeholder="Paint brand" data-testid={`cm-brand-${r.product}`}
                  value={drafts[r.product]?.brand ?? (r.woMatch?.brand ?? "")}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.product]: { code: d[r.product]?.code ?? r.woMatch?.code ?? "", brand: e.target.value, canSize: d[r.product]?.canSize ?? r.woMatch?.canSize ?? "" } }))} />
                <input className={pc ? "num" : ""} placeholder="Can size" data-testid={`cm-can-${r.product}`}
                  value={drafts[r.product]?.canSize ?? (r.woMatch?.canSize ?? "")}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.product]: { code: d[r.product]?.code ?? r.woMatch?.code ?? "", brand: d[r.product]?.brand ?? r.woMatch?.brand ?? "", canSize: e.target.value } }))} />
                <button type="button" className={pc ? "btn" : "btn narrow cy"} disabled={pending || !(drafts[r.product]?.code ?? r.woMatch?.code ?? "").trim()}
                  onClick={() => save(r.product)} data-testid={`cm-save-${r.product}`}>
                  {pending ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
