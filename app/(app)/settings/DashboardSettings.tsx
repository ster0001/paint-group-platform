"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SOURCES } from "@/lib/crm/attribution";
import { fyLabel, fyMonthLabel, fyMonths, fyOf } from "@/lib/reporting/financialYear";

/**
 * Dashboard 0d (B7) — owner/admin only (⚑2; the folder is not rendered for
 * anyone else, and the two tables' RLS refuse them anyway).
 *   · Monthly sales target ($ inc GST) — ⚑9: the month total; the table also
 *     carries optional category / salesperson columns for later rows.
 *   · Marketing spend by channel and month — ⚑5: typed monthly by the office.
 *   · The dashboard's thresholds, as plain numeric settings.
 *   · Recorded sales months (Tom, 20 Sep 2026) — the months sold in
 *     PaintScout before the platform, typed once from its Total Sold report;
 *     the dashboard reads a recorded month INSTEAD of the imported estimates.
 *   · Targets are picked by FINANCIAL YEAR (July → June, Tom, 20 Sep 2026):
 *     "January" in FY 2026/27 saves 2027-01-01.
 * Money is typed in dollars and stored in integer cents.
 */
export type TargetRow = { id: string; month: string; target_cents: number; note: string };
export type SpendRow = { id: string; month: string; channel: string; spend_cents: number; note: string };
export type ThresholdRow = { key: string; value: number; unit: string; notes: string };
export type HistoryRow = { month: string; sales_cents: number; accepted: number | null; source: string; note: string };

const inp = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";
// The Melbourne calendar month, never `toISOString` (the UTC day is yesterday before 10am here).
const thisMonth = () => {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const y = p.find((x) => x.type === "year")!.value; const m = p.find((x) => x.type === "month")!.value;
  return `${y}-${m}`;
};
const currentFy = () => fyOf(thisMonth());
const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
const dollars = (cents: number) => (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
/** Targets grouped by financial year, newest FY first; the rows keep the order they arrived in (newest month first). */
const targetsByFy = (rows: TargetRow[]): [number, TargetRow[]][] => {
  const m = new Map<number, TargetRow[]>();
  for (const t of rows) { const fy = fyOf(t.month); m.set(fy, [...(m.get(fy) ?? []), t]); }
  return [...m.entries()].sort((a, b) => b[0] - a[0]);
};
const toCents = (s: string): number | null => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export default function DashboardSettings({ targets, spend, thresholds, history = [] }: { targets: TargetRow[]; spend: SpendRow[]; thresholds: ThresholdRow[]; history?: HistoryRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tFy, setTFy] = useState<number>(currentFy);
  const [tMonth, setTMonth] = useState(thisMonth());
  const [hMonth, setHMonth] = useState("");
  const [hAmount, setHAmount] = useState("");
  const [hAccepted, setHAccepted] = useState("");
  const [hNote, setHNote] = useState("");
  const [tAmount, setTAmount] = useState("");
  const [sMonth, setSMonth] = useState(thisMonth());
  const [sChannel, setSChannel] = useState<string>("paid_google");
  const [sAmount, setSAmount] = useState("");
  const [sNote, setSNote] = useState("");
  const [th, setTh] = useState<Record<string, string>>(Object.fromEntries(thresholds.map((t) => [t.key, String(t.value)])));

  const done = (error: { message: string; code?: string } | null, okText: string) => {
    setBusy(false);
    setMsg(error ? { ok: false, text: error.code === "42501" ? "Only an owner or admin can change this." : error.message } : { ok: true, text: okText });
    if (!error) router.refresh();
  };

  async function saveHistory() {
    const cents = toCents(hAmount);
    const acceptedRaw = hAccepted.trim();
    const accepted = acceptedRaw === "" ? null : Number(acceptedRaw);
    if (cents == null || !/^\d{4}-\d{2}$/.test(hMonth)) { setMsg({ ok: false, text: "A month and a dollar amount, please." }); return; }
    if (accepted != null && (!Number.isInteger(accepted) || accepted < 0)) { setMsg({ ok: false, text: "Jobs signed is a whole number, or leave it blank." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("sales_history_months")
      .upsert({ month: `${hMonth}-01`, sales_cents: cents, accepted, note: hNote.trim() }, { onConflict: "month" });
    done(error, `Recorded sales for ${fyMonthLabel(hMonth)} saved — the dashboard now shows this figure for that month.`);
    if (!error) { setHMonth(""); setHAmount(""); setHAccepted(""); setHNote(""); }
  }
  async function removeHistory(month: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("sales_history_months").delete().eq("month", month);
    done(error, `Recorded month removed — ${fyMonthLabel(month.slice(0, 7))} now reads the platform's own signed jobs.`);
  }
  function pickFy(fy: number) {
    // Keep the same calendar month (July stays July) inside the newly picked FY.
    setTFy(fy);
    const mm = tMonth.slice(5, 7);
    setTMonth(fyMonths(fy).find((m) => m.slice(5, 7) === mm) ?? fyMonths(fy)[0]);
  }
  async function saveTarget() {
    const cents = toCents(tAmount);
    if (cents == null || !/^\d{4}-\d{2}$/.test(tMonth)) { setMsg({ ok: false, text: "A month and a dollar amount, please." }); return; }
    setBusy(true); setMsg(null);
    // The unique index is on coalesced columns, which upsert cannot name: update the month's row when there is one, else insert.
    const existing = targets.find((t) => t.month.slice(0, 7) === tMonth);
    const r = existing
      ? await supabase.from("sales_targets").update({ target_cents: cents }).eq("id", existing.id)
      : await supabase.from("sales_targets").insert({ month: `${tMonth}-01`, target_cents: cents });
    done(r.error, `Target for ${fyMonthLabel(tMonth)} (${fyLabel(fyOf(tMonth))}) saved.`);
    if (!r.error) setTAmount("");
  }
  async function removeTarget(id: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("sales_targets").delete().eq("id", id);
    done(error, "Target removed — that month now reads “no target set”.");
  }
  async function saveSpend() {
    const cents = toCents(sAmount);
    if (cents == null || !/^\d{4}-\d{2}$/.test(sMonth)) { setMsg({ ok: false, text: "A month, a channel and a dollar amount, please." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("marketing_spend")
      .upsert({ month: `${sMonth}-01`, channel: sChannel, spend_cents: cents, note: sNote.trim() }, { onConflict: "month,channel" });
    done(error, `Spend for ${monthLabel(`${sMonth}-01`)} · ${SOURCES.find((s) => s.key === sChannel)?.label ?? sChannel} saved.`);
    if (!error) { setSAmount(""); setSNote(""); }
  }
  async function removeSpend(id: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("marketing_spend").delete().eq("id", id);
    done(error, "Spend row removed.");
  }
  async function saveThreshold(t: ThresholdRow) {
    const n = Number(th[t.key]);
    if (!Number.isFinite(n) || n < 0) { setMsg({ ok: false, text: "A number, please." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("settings").upsert({ key: t.key, value: { value: n, unit: t.unit, notes: t.notes } }, { onConflict: "key" });
    done(error, "Saved.");
  }

  return (
    <div className="space-y-6" data-testid="dashboard-settings">
      <section data-testid="history-section">
        <h4 className="text-sm font-semibold">Recorded sales — before the platform</h4>
        <p className="text-xs text-gray-500">The months sold in PaintScout, typed once from its Total Sold report (inc GST). The dashboard shows a recorded month instead of the imported estimates for that month; a month with no row is the platform&rsquo;s own signed jobs — every month from the cutover on.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Month<input type="month" className={`mt-1 block ${inp}`} value={hMonth} onChange={(e) => setHMonth(e.target.value)} data-testid="history-month" /></label>
          <label className="text-xs text-gray-600">Sales ($ inc GST)<input inputMode="decimal" className={`mt-1 block w-36 ${inp}`} value={hAmount} onChange={(e) => setHAmount(e.target.value)} placeholder="e.g. 98,500" data-testid="history-amount" /></label>
          <label className="text-xs text-gray-600">Jobs signed<input inputMode="numeric" className={`mt-1 block w-24 ${inp}`} value={hAccepted} onChange={(e) => setHAccepted(e.target.value)} placeholder="optional" data-testid="history-accepted" /></label>
          <label className="text-xs text-gray-600">Note<input className={`mt-1 block w-48 ${inp}`} value={hNote} onChange={(e) => setHNote(e.target.value)} placeholder="optional" data-testid="history-note" /></label>
          <button type="button" disabled={busy} onClick={() => void saveHistory()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="history-save">Save month</button>
        </div>
        {history.length > 0 && (
          <table className="mt-3 w-full max-w-2xl text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 text-right font-medium">Sales $ inc GST</th>
                <th className="py-1 text-right font-medium">Jobs signed</th>
                <th className="py-1 font-medium">Source</th>
                <th className="py-1 font-medium">Note</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.month} className="border-t border-gray-100" data-testid={`history-row-${h.month.slice(0, 7)}`}>
                  <td className="py-1.5">{fyMonthLabel(h.month.slice(0, 7))}</td>
                  <td className="py-1.5 text-right font-mono">{dollars(h.sales_cents)}</td>
                  <td className="py-1.5 text-right font-mono">{h.accepted == null ? <span className="text-gray-400">—</span> : h.accepted}</td>
                  <td className="py-1.5 text-xs text-gray-500">{h.source}</td>
                  <td className="py-1.5 text-xs text-gray-500">{h.note}</td>
                  <td className="py-1.5 text-right"><button type="button" disabled={busy} onClick={() => void removeHistory(h.month)} className="text-xs text-gray-400 hover:text-red-600" data-testid={`history-remove-${h.month.slice(0, 7)}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold">Monthly sales target</h4>
        <p className="text-xs text-gray-500">Sales $ inc GST the month should reach. The financial year runs 1 July → 30 June, so January in {fyLabel(currentFy())} is January {currentFy()}. A month with no row reads “no target set”, never 0%.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Financial year
            <select className={`mt-1 block ${inp}`} value={tFy} onChange={(e) => pickFy(Number(e.target.value))} data-testid="target-fy">
              {[currentFy() - 1, currentFy(), currentFy() + 1].map((fy) => <option key={fy} value={fy}>{fyLabel(fy)}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Month
            <select className={`mt-1 block ${inp}`} value={tMonth} onChange={(e) => setTMonth(e.target.value)} data-testid="target-month">
              {fyMonths(tFy).map((m) => <option key={m} value={m}>{fyMonthLabel(m)}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Target ($ inc GST)<input inputMode="decimal" className={`mt-1 block w-36 ${inp}`} value={tAmount} onChange={(e) => setTAmount(e.target.value)} placeholder="e.g. 120000" data-testid="target-amount" /></label>
          <button type="button" disabled={busy} onClick={() => void saveTarget()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="target-save">Save target</button>
        </div>
        {targets.length > 0 && (
          <table className="mt-3 w-full max-w-md text-sm">
            <tbody>
              {targetsByFy(targets).map(([fy, rows]) => (
                <Fragment key={fy}>
                  <tr data-testid={`target-fy-${fy}`}><th colSpan={3} className="pt-3 pb-1 text-left text-xs font-semibold text-gray-500">{fyLabel(fy)}</th></tr>
                  {rows.map((t) => (
                    <tr key={t.id} className="border-t border-gray-100" data-testid={`target-row-${t.month.slice(0, 7)}`}>
                      <td className="py-1.5">{fyMonthLabel(t.month.slice(0, 7))}</td>
                      <td className="py-1.5 text-right font-mono">{dollars(t.target_cents)}</td>
                      <td className="py-1.5 text-right"><button type="button" disabled={busy} onClick={() => void removeTarget(t.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold">Marketing spend</h4>
        <p className="text-xs text-gray-500">What was spent, by channel and month. Feeds cost per accepted job and spend vs sales — until MYOB supplies actuals.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Month<input type="month" className={`mt-1 block ${inp}`} value={sMonth} onChange={(e) => setSMonth(e.target.value)} data-testid="spend-month" /></label>
          <label className="text-xs text-gray-600">Channel
            <select className={`mt-1 block ${inp}`} value={sChannel} onChange={(e) => setSChannel(e.target.value)} data-testid="spend-channel">
              {SOURCES.filter((s) => s.key !== "unknown").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Spend ($)<input inputMode="decimal" className={`mt-1 block w-32 ${inp}`} value={sAmount} onChange={(e) => setSAmount(e.target.value)} placeholder="e.g. 2500" data-testid="spend-amount" /></label>
          <label className="text-xs text-gray-600">Note<input className={`mt-1 block w-48 ${inp}`} value={sNote} onChange={(e) => setSNote(e.target.value)} placeholder="optional" /></label>
          <button type="button" disabled={busy} onClick={() => void saveSpend()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="spend-save">Save spend</button>
        </div>
        {spend.length > 0 && (
          <table className="mt-3 w-full max-w-lg text-sm">
            <tbody>
              {spend.map((r) => (
                <tr key={r.id} className="border-t border-gray-100" data-testid={`spend-row-${r.month.slice(0, 7)}-${r.channel}`}>
                  <td className="py-1.5">{monthLabel(r.month)}</td>
                  <td className="py-1.5">{SOURCES.find((s) => s.key === r.channel)?.label ?? r.channel}</td>
                  <td className="py-1.5 text-right font-mono">{dollars(r.spend_cents)}</td>
                  <td className="py-1.5 text-xs text-gray-500">{r.note}</td>
                  <td className="py-1.5 text-right"><button type="button" disabled={busy} onClick={() => void removeSpend(r.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold">Thresholds</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {thresholds.map((t) => (
            <label key={t.key} className="text-xs text-gray-600" title={t.notes}>
              {t.key.replace(/^dashboard_/, "").replaceAll("_", " ")} ({t.unit})
              <span className="mt-1 flex gap-2">
                <input inputMode="decimal" className={`w-24 ${inp}`} value={th[t.key] ?? ""} onChange={(e) => setTh((m) => ({ ...m, [t.key]: e.target.value }))} data-testid={`threshold-${t.key}`} />
                <button type="button" disabled={busy} onClick={() => void saveThreshold(t)} className="rounded-md border border-gray-300 px-2 py-1 text-xs">Save</button>
              </span>
            </label>
          ))}
        </div>
      </section>

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="dashboard-settings-msg">{msg.text}</p>}
    </div>
  );
}
