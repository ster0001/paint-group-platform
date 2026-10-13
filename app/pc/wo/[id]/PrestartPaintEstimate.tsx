import type { MaterialRowProp } from "./MaterialsCard";
import { cansLabel, litresLabel } from "@/lib/workorder/snapshot";

/**
 * The paint estimate under the pre-start's materials item (Tom, 13 Oct 2026:
 * "this can also be labelled in the prestart checklist in the paint
 * section"). Read-only — the same rows as the Materials card, where the
 * colour and order litres are adjusted.
 */
const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PrestartPaintEstimate({ rows }: { rows: MaterialRowProp[] }) {
  if (rows.length === 0) return null;
  const costed = rows.filter((r) => r.estimateCostCents != null);
  const total = costed.reduce((n, r) => n + (r.estimateCostCents ?? 0), 0);
  return (
    <div data-testid="prestart-paint-estimate" style={{ display: "grid", gap: 4, margin: "6px 0 8px" }}>
      <p className="note" style={{ margin: 0 }}><b>Paint estimate</b> — order rounded down, in 15 / 10 / 4 / 2 / 1 L cans</p>
      {rows.map((r) => (
        <div key={r.rowKey} className="row" style={{ alignItems: "center", gap: 8, fontSize: 13 }}
          data-testid={`prestart-paint-${r.rowKey}`}>
          <span aria-hidden="true" style={{
            width: 12, height: 12, borderRadius: 3, border: "1px solid var(--line)",
            background: r.colourHex || "transparent", flex: "0 0 auto",
          }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {r.product}{r.finish ? ` · ${r.finish}` : ""} · {r.colourName || "Colour TBC"}
          </span>
          <span className="note" style={{ margin: 0, whiteSpace: "nowrap" }}>
            {r.estimateLitres != null ? `est. ${litresLabel(r.estimateLitres)}` : "est. —"}
            {r.estimateCostCents != null ? ` · ${money(r.estimateCostCents)}` : ""}
            {r.litres != null && r.litres > 0 ? ` · order ${cansLabel(r.litres)}` : ""}
          </span>
        </div>
      ))}
      {costed.length > 0 && (
        <p className="note" style={{ margin: 0 }} data-testid="prestart-paint-total">
          Estimated paint cost {money(total)} ex GST
        </p>
      )}
    </div>
  );
}
