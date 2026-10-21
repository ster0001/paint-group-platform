"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PainterLine } from "@/lib/movements/painterView";
import { painterMovementDone } from "@/app/pc/movements/actions";

/**
 * "Your pickups and drop-offs today" (brief §3.4, ruling 8): every movement on THIS
 * painter's lane that day — their own job's pickup, or a staff-style run the office gave
 * them — with Navigate, Call and the tick. The tick is `movement_painter_done`, which
 * refuses anything not on their lane. Also the job sheet's logistics lines (one
 * component, two places): `compact` drops the heading.
 */
export default function MovementsCard({ lines, day, error, title, compact = false, testId = "movements-card" }: {
  lines: PainterLine[]; day: string; error: string | null; title?: string; compact?: boolean; testId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function tick(id: string) {
    setBusy(id); setMessage(null);
    const r = await painterMovementDone({ id });
    setBusy(null);
    if (!r.ok) { setMessage(r.message); return; }
    router.refresh();
  }

  if (!error && lines.length === 0 && compact) return null;

  return (
    <div className={compact ? "" : "card"} id="movements" data-testid={testId} data-day={day}>
      {!compact && (
        <div className="tick-head">
          <b>{title ?? "Your pickups and drop-offs today"}</b>
          {lines.length > 0 && <span className="tick-count">{lines.filter((l) => !l.done).length} to do</span>}
        </div>
      )}
      {error && <p className="hint" style={{ color: "var(--amber)", padding: 0 }} data-testid="movements-card-error">{error}</p>}
      {!error && lines.length === 0 && <p className="hint" style={{ padding: 0, marginTop: 6 }}>Nothing to pick up or drop off today.</p>}
      {lines.length > 0 && (
        <ol className="mvl" data-testid="movements-card-list">
          {lines.map((l, i) => (
            <li key={l.id} className={`mvl-row${l.done ? " done" : ""}`} data-testid="movements-card-line" data-movement-id={l.id} data-section={l.section}>
              <span className="mvl-n">{l.done ? "✓" : i + 1}</span>
              <div className="mvl-b">
                <b>{l.what}</b>
                <span className="mvl-t">{l.text}</span>
                {l.lines.length > 0 && (
                  <ul className="mvl-lines">
                    {l.lines.map((x) => <li key={x.rowKey}>{x.product}{x.colourName ? ` · ${x.colourName}` : ""}{x.litres != null ? ` · ${x.litres} L` : ""}{x.cans ? ` · ${x.cans} can${x.cans === 1 ? "" : "s"}` : ""}</li>)}
                  </ul>
                )}
                {l.note && <span className="mvl-note">{l.note}</span>}
                <div className="mvl-acts">
                  {l.shop && <a className="btn sm" href={l.shop.mapsUrl} target="_blank" rel="noreferrer" data-testid="movements-navigate">Navigate</a>}
                  {l.shop?.phone && <a className="btn sm" href={`tel:${l.shop.phone.replace(/[^\d+]/g, "")}`} data-testid="movements-call">Call {l.shop.name.split(" ")[0]}</a>}
                  {l.tick && (
                    <button type="button" className="btn sm pri" disabled={busy === l.id} onClick={() => void tick(l.id)} data-testid="movements-tick">
                      {busy === l.id ? "Saving…" : `${l.tick} ✓`}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {message && <p className="hint" style={{ color: "var(--amber)", padding: 0 }}>{message}</p>}
    </div>
  );
}
