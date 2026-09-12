"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { moneyFmt } from "@/lib/portal/money";
import type { CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import type { Ladder } from "@/lib/wizard/ladder";
import type { ColourOnFile } from "@/lib/portal/colours-on-file";
import {
  SHEET_COLUMNS, cycleCoatsActions, cycleCountActions, presentKeys, sheetRowsFromRooms,
  type SheetAction, type SheetColumn, type SheetRow,
} from "@/lib/wizard/spec-sheet";

/**
 * The grid. Computes NOTHING about money: every tap posts the room card's
 * own actions to wizard-edit (view: customer) and re-reads the range and the
 * rooms from the response. On a phone the grid scrolls horizontally — no
 * stacked fallback in v1 (⚑59).
 */
type Range = { lo: number; hi: number; bandPct: number };
type Payload = {
  rangeLoCents?: number; rangeHiCents?: number; bandPct?: number;
  scopeRooms?: CustomerScopeRoom[]; ladder?: Ladder; error?: string; outcome?: string; message?: string;
};

const HEAD: Record<SheetColumn, string> = { walls: "Walls", ceilings: "Ceiling", trims: "Trims", doors: "Doors", windows: "Windows" };

export default function SpecSheet(props: {
  estimateId: string;
  initialRows: SheetRow[];
  initialRooms: CustomerScopeRoom[];
  initialRange: Range;
  initialLadder: Ladder;
  sent: boolean;
  colours: ColourOnFile[];
  estimatorName: string | null;
  holdDays: number;
  tenantHref: string;
  onFile: { measured: string | null; access: string | null };
}) {
  const router = useRouter();
  const sizes = useMemo(() => Object.fromEntries(props.initialRows.map((r) => [r.areaId, r.size])), [props.initialRows]);
  const [rows, setRows] = useState<SheetRow[]>(props.initialRows);
  const [rooms, setRooms] = useState<CustomerScopeRoom[]>(props.initialRooms);
  const [range, setRange] = useState<Range | null>(props.initialRange);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(props.sent);
  const who = props.estimatorName?.trim() || "Your estimator";

  async function post(body: Record<string, unknown>): Promise<Payload | null> {
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/estimates/${props.estimateId}/wizard-edit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, view: "customer" }),
      });
      const j = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) { setNote(j.error ?? "That didn't save — try again."); return null; }
      if (j.error) setNote(j.error);
      if (j.scopeRooms) {
        setRooms(j.scopeRooms);
        setRows(sheetRowsFromRooms(j.scopeRooms, sizes));
      }
      if (typeof j.rangeLoCents === "number" && typeof j.rangeHiCents === "number") {
        setRange({ lo: j.rangeLoCents, hi: j.rangeHiCents, bandPct: j.bandPct ?? range?.bandPct ?? 0 });
      } else if (j.outcome && j.outcome !== "reveal") {
        setRange(null);
        setNote(j.message ?? "This one needs a person to look at it.");
      }
      return j;
    } catch {
      setNote("That didn't save — check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function tap(row: SheetRow, col: SheetColumn) {
    if (busy || sent) return;
    const room = rooms.find((r) => r.areaId === row.areaId);
    const actions: SheetAction[] = col === "doors" || col === "windows"
      ? cycleCountActions(row, col)
      : cycleCoatsActions(row, col, presentKeys(room));
    if (!actions.length) return;
    await post(actions.length === 1 ? actions[0] : { actions });
  }

  async function send() {
    if (busy || sent) return;
    const j = await post({ action: "accept_intent" });
    if (j && !j.error) { setSent(true); router.push("/account"); }
  }

  const cellText = (row: SheetRow, col: SheetColumn) => {
    const c = row.cells[col];
    if (!c.on) return "—";
    if (c.kind === "count") return String(c.count);
    return c.coats ? `${c.coats}c` : "on";
  };
  const areaCount = rows.length;
  const doorCount = rows.reduce((n, r) => n + (r.cells.doors.kind === "count" && r.cells.doors.on ? r.cells.doors.count : 0), 0);
  const windowCount = rows.reduce((n, r) => n + (r.cells.windows.kind === "count" && r.cells.windows.on ? r.cells.windows.count : 0), 0);

  return (
    <div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }} data-testid="spec-sheet">
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={th}>Area</th>
              <th style={th}>Size</th>
              {SHEET_COLUMNS.map((c) => <th key={c} style={{ ...th, textAlign: "center" }}>{HEAD[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.areaId} data-testid="sheet-row" data-area-id={row.areaId}>
                <td style={td}><b>{row.name}</b></td>
                <td style={{ ...td, color: "var(--muted)", whiteSpace: "nowrap" }}>{row.size}</td>
                {SHEET_COLUMNS.map((col) => (
                  <td key={col} style={{ ...td, textAlign: "center", padding: 4 }}>
                    <button
                      type="button"
                      onClick={() => tap(row, col)}
                      disabled={busy || sent}
                      data-testid={`cell-${col}`}
                      data-on={row.cells[col].on ? "1" : "0"}
                      aria-label={`${row.name} ${HEAD[col].toLowerCase()}: ${cellText(row, col)}`}
                      style={{
                        minWidth: 44, minHeight: 36, borderRadius: 8, border: "1px solid var(--line, #e5e7eb)",
                        background: row.cells[col].on ? "var(--cyan-soft, #ecfeff)" : "transparent",
                        color: row.cells[col].on ? "var(--text)" : "var(--muted)", fontWeight: 600, cursor: sent ? "default" : "pointer",
                      }}
                    >
                      {cellText(row, col)}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={td} colSpan={2}><span className="sub">{areaCount} area{areaCount === 1 ? "" : "s"}</span></td>
              <td style={td} /><td style={td} /><td style={td} />
              <td style={{ ...td, textAlign: "center" }}><span className="sub">{doorCount}</span></td>
              <td style={{ ...td, textAlign: "center" }}><span className="sub">{windowCount}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Tap a coat cell to cycle 1c → 2c → not painted. Doors and windows count up, then off.
        It matches the room-by-room view because every tap is the same change, made the same way.
      </p>
      {note && <p className="sub" role="status" data-testid="sheet-note">{note}</p>}

      <h2>Colours <span className="chip mut nodot" style={{ marginLeft: 6 }}>from the register</span></h2>
      <div className="card" data-testid="sheet-colours">
        {props.colours.length ? props.colours.map((c) => (
          <div key={c.surface} className="row" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0" }}>
            <span>{c.surface}</span>
            <span style={{ textAlign: "right" }}><b>{[c.brand, c.name].filter(Boolean).join(" ")}</b>{c.when ? <span className="sub"> · {c.when}</span> : null}</span>
          </div>
        )) : <p className="sub">Nothing on the register for this property yet — {who} will confirm colours with you.</p>}
        {props.colours.length > 0 && <p className="sub" style={{ marginTop: 6 }}>Same again unless you say otherwise — tell {who} in the confirmation if they&rsquo;re changing.</p>}
      </div>

      <h2>Condition</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: 10 }}>Photos let {who} confirm from the desk more often. Ask the tenant — a link they open on their phone, pinned to this property.</p>
        <Link className="btn btn-ghost" href={props.tenantHref} data-testid="ask-tenant">Ask the tenant for photos</Link>
      </div>

      <div className="card raised" data-testid="sheet-range">
        <div className="sub" style={{ letterSpacing: ".04em", textTransform: "uppercase", fontSize: 12 }}>Your range</div>
        {range ? (
          <>
            <div className="big" data-testid="range-figure">{moneyFmt(range.lo)} – {moneyFmt(range.hi)}</div>
            <div className="sub">inc. GST · ±{range.bandPct}%</div>
          </>
        ) : (
          <div className="sub" data-testid="range-none">No range on this one — a person looks first.</div>
        )}
        <div className="btn-row" style={{ marginTop: 12 }}>
          {sent ? (
            <span className="chip cyan nodot" data-testid="sheet-sent">With {who}</span>
          ) : (
            <button type="button" className="btn btn-cyan" onClick={send} disabled={busy} data-testid="send-for-confirmation">Send for confirmation</button>
          )}
          <Link className="btn btn-ghost" href="/account">Save as a draft</Link>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          {who} confirms every price on this account before you can accept it — usually within a day, and usually without a visit.
          {props.holdDays ? ` A confirmed price is held for ${props.holdDays} days.` : ""}
        </p>
      </div>

      {(props.onFile.measured || props.onFile.access) && (
        <>
          <h2>On file for this property</h2>
          <div className="card" data-testid="sheet-on-file">
            {props.onFile.measured && <div className="row" style={{ padding: "4px 0" }}><span className="sub">Measured</span> {props.onFile.measured}</div>}
            {props.onFile.access && <div className="row" style={{ padding: "4px 0" }}><span className="sub">Access</span> {props.onFile.access}</div>}
          </div>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 10px", borderBottom: "1px solid var(--line, #e5e7eb)", fontSize: 12, color: "var(--muted)", letterSpacing: ".03em", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line, #f1f5f9)", verticalAlign: "middle" };
