"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMaterial } from "../../actions";

/**
 * Materials on the PC job page (Tom, 4 Sep 2026).
 *
 *  1. The colour breakdown per substrate — one row per product × colour on
 *     the job sheet, listing the surfaces (area · substrate · coats) painted
 *     in it. Name, swatch, TBC/confirmed and order litres are editable here;
 *     a save rewrites the frozen job sheet so the painter sees it too.
 *  2. The materials budget — the estimate's engine materials cost against
 *     every supplier invoice matched to this job, updating as new ones are
 *     matched on the Payables tab.
 */

export type MaterialRowProp = {
  rowKey: string;
  product: string;
  photoUrl: string;
  colourName: string;
  colourHex: string;
  colourStatus: "tbc" | "confirmed";
  litres: number | null;
  coverageMissing: boolean;
  /** Colour-match code on the job (snapshot or supplied), "" when none. */
  matchCode: string;
  matchRequired: boolean;
  substrates: { area: string; label: string; coats: number }[];
};

export type MaterialInvoiceProp = {
  id: string;
  supplier: string;
  amountCents: number;
  date: string | null;
  ref: string;
};

export type MaterialsBudgetProp = {
  budgetCents: number | null;
  invoicedIncCents: number;
  invoicedExCents: number;
  pct: number | null;
  over: boolean;
  invoices: MaterialInvoiceProp[];
};

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

type Draft = { colourName: string; colourHex: string; colourStatus: "tbc" | "confirmed"; litres: string };

const draftOf = (r: MaterialRowProp): Draft => ({
  colourName: r.colourName, colourHex: r.colourHex, colourStatus: r.colourStatus,
  litres: r.litres == null ? "" : String(r.litres),
});
const same = (a: Draft, b: Draft) =>
  a.colourName === b.colourName && a.colourHex.toUpperCase() === b.colourHex.toUpperCase()
  && a.colourStatus === b.colourStatus && a.litres === b.litres;

export default function MaterialsCard({
  workOrderId, rows, budget, canEdit, moneyHref,
}: {
  workOrderId: string; rows: MaterialRowProp[]; budget: MaterialsBudgetProp; canEdit: boolean; moneyHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);

  const draft = (r: MaterialRowProp) => drafts[r.rowKey] ?? draftOf(r);
  const patch = (r: MaterialRowProp, p: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [r.rowKey]: { ...draft(r), ...p } }));

  function save(r: MaterialRowProp) {
    const d = draft(r);
    const litres = d.litres.trim() === "" ? null : Number(d.litres);
    if (litres !== null && !(Number.isFinite(litres) && litres >= 0)) {
      setMessage("Litres needs to be a number.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await setMaterial({
        workOrderId, rowKey: r.rowKey,
        colourName: d.colourName, colourHex: d.colourHex.trim().toUpperCase(),
        colourStatus: d.colourStatus, litres,
      });
      if (res.ok) {
        setMessage(res.message ?? "Saved.");
        setDrafts((m) => { const n = { ...m }; delete n[r.rowKey]; return n; });
        setOpenRow(null);
        router.refresh();
      } else setMessage(res.message);
    });
  }

  const confirmed = rows.filter((r) => r.colourStatus === "confirmed").length;
  const remaining = budget.budgetCents == null ? null : budget.budgetCents - budget.invoicedExCents;

  return (
    <div className="card" data-testid="materials-card">
      <h3>
        Materials
        <em data-testid="materials-summary">
          {rows.length === 0 ? "none on the job sheet" : `${confirmed} of ${rows.length} colour${rows.length === 1 ? "" : "s"} confirmed`}
        </em>
      </h3>

      {/* ---- the budget strip ---- */}
      <div className="draft" data-testid="materials-budget" style={{ display: "grid", gap: 8 }}>
        <div className="money" style={{ borderTop: 0, paddingTop: 0, gap: "10px 0" }}>
          <span className="mi"><span>Budget (est. materials)</span>
            <b data-testid="materials-budget-amount">{budget.budgetCents == null ? "—" : money(budget.budgetCents)}</b></span>
          <span className="mi"><span>Invoiced ex GST</span>
            <b data-testid="materials-invoiced-amount"
              style={{ color: budget.over ? "var(--clay)" : budget.invoicedExCents > 0 ? "var(--cyan)" : undefined }}>
              {money(budget.invoicedExCents)}
            </b></span>
          <span className="mi"><span>{remaining != null && remaining < 0 ? "Over budget" : "Remaining"}</span>
            <b data-testid="materials-remaining"
              style={{ color: remaining == null ? undefined : remaining < 0 ? "var(--clay)" : "var(--emerald)" }}>
              {remaining == null ? "—" : money(Math.abs(remaining))}
            </b></span>
        </div>
        {budget.pct != null && (
          <div className="prog" aria-label={`${budget.pct}% of the materials budget invoiced`}>
            <i style={{ width: `${budget.pct}%`, background: budget.over ? "var(--clay)" : undefined }} />
          </div>
        )}
        <p className="note" style={{ margin: 0 }}>
          {budget.budgetCents == null
            ? "No priced scope to budget from — the estimate has no materials on its rate card."
            : "Budget is the estimate's materials cost, ex GST. Invoiced updates as supplier invoices are matched to this job on Payables."}
          {budget.invoicedIncCents > 0 ? ` Invoices total ${money(budget.invoicedIncCents)} inc GST.` : ""}
        </p>
        {budget.invoices.length > 0 && (
          <div data-testid="materials-invoices">
            {budget.invoices.map((inv) => (
              <div className="tick" key={inv.id} data-testid={`materials-invoice-${inv.id}`}>
                <p>{inv.supplier || "Materials"}{inv.ref ? ` · ${inv.ref}` : ""}{inv.date ? ` · ${inv.date}` : ""}</p>
                <span className="pill p-cy">{money(inv.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
        <a className="btn" href={moneyHref} style={{ justifySelf: "start" }}>All job costs →</a>
      </div>

      {message && <p className="note" role="status" data-testid="materials-msg" style={{ color: "var(--amber)" }}>{message}</p>}

      {/* ---- the colour breakdown per substrate ---- */}
      {rows.length === 0 ? (
        <p className="note">
          The job sheet lists no materials. Products are set per substrate in the
          builder&rsquo;s Materials tab — edit the job sheet to add them.
        </p>
      ) : rows.map((r) => {
        const d = draft(r);
        const dirty = !same(d, draftOf(r));
        const editing = openRow === r.rowKey;
        return (
          <div className="elev" key={r.rowKey} data-testid={`material-${r.rowKey}`}>
            <div className="eh">
              <span aria-hidden="true" style={{
                width: 18, height: 18, borderRadius: 5, border: "1px solid var(--line)",
                background: r.colourHex || "transparent", flex: "0 0 auto",
              }} />
              <b>{r.product}</b>
              <em data-testid={`material-colour-${r.rowKey}`}>{r.colourName || "Colour TBC"}</em>
              <span className={`pill ${r.colourStatus === "confirmed" ? "p-em" : "p-amber"}`} data-testid={`material-status-${r.rowKey}`}>
                {r.colourStatus === "confirmed" ? "Confirmed" : "TBC"}
              </span>
              <span className="ct">{r.litres != null ? `${r.litres} L` : r.coverageMissing ? "litres unknown" : "— L"}</span>
            </div>
            {r.matchRequired && (
              <p className="note" style={{ margin: 0 }}>
                Colour match {r.matchCode ? <>code <b>{r.matchCode}</b></> : "— code still needed (see Colour matches)"}
              </p>
            )}
            {r.substrates.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} data-testid={`material-substrates-${r.rowKey}`}>
                {r.substrates.map((s, i) => (
                  <span className="pill" key={i}>{s.area} · {s.label} · {s.coats}c</span>
                ))}
              </div>
            ) : (
              <p className="note" style={{ margin: 0 }}>Not tied to a substrate on the job sheet.</p>
            )}

            {canEdit && !editing && (
              <button type="button" className="btn dim" style={{ alignSelf: "flex-start" }}
                data-testid={`material-edit-${r.rowKey}`} onClick={() => setOpenRow(r.rowKey)}>
                Adjust colour / litres
              </button>
            )}
            {canEdit && editing && (
              <div style={{ display: "grid", gap: 8 }} data-testid={`material-form-${r.rowKey}`}>
                <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr auto auto" }}>
                  <input className="num" style={{ width: "100%", fontFamily: "inherit" }} placeholder="Colour name"
                    value={d.colourName} data-testid={`material-name-${r.rowKey}`}
                    onChange={(e) => patch(r, { colourName: e.target.value })} />
                  <input type="color" aria-label="Swatch" value={d.colourHex || "#FFFFFF"}
                    data-testid={`material-swatch-${r.rowKey}`}
                    style={{ width: 44, height: 38, padding: 2, background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8 }}
                    onChange={(e) => patch(r, { colourHex: e.target.value.toUpperCase() })} />
                  <input className="num" style={{ width: 96 }} placeholder="#hex" value={d.colourHex}
                    data-testid={`material-hex-${r.rowKey}`}
                    onChange={(e) => patch(r, { colourHex: e.target.value })} />
                </div>
                <div className="row" style={{ alignItems: "center" }}>
                  <label className="fld">Litres
                    <input className="num" style={{ width: 80 }} inputMode="decimal" placeholder="—" value={d.litres}
                      data-testid={`material-litres-${r.rowKey}`}
                      onChange={(e) => patch(r, { litres: e.target.value })} />
                  </label>
                  <label className="fld" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={d.colourStatus === "confirmed"}
                      data-testid={`material-confirmed-${r.rowKey}`}
                      onChange={(e) => patch(r, { colourStatus: e.target.checked ? "confirmed" : "tbc" })} />
                    Colour confirmed with the customer
                  </label>
                </div>
                <div className="row">
                  <button type="button" className="btn primary" disabled={pending || !dirty}
                    data-testid={`material-save-${r.rowKey}`} onClick={() => save(r)}>
                    {pending ? "Saving…" : "Save to job sheet"}
                  </button>
                  <button type="button" className="btn dim" disabled={pending}
                    onClick={() => { setDrafts((m) => { const n = { ...m }; delete n[r.rowKey]; return n; }); setOpenRow(null); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {rows.length > 0 && (
        <p className="note">
          Saving rewrites the painter&rsquo;s job sheet and the colour register.
          Products and coverage come from the estimate — change those in the builder.
        </p>
      )}
    </div>
  );
}
