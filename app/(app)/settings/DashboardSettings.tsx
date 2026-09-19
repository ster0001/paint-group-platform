"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SOURCES } from "@/lib/crm/attribution";

/**
 * Dashboard 0d (B7) — owner/admin only (⚑2; the folder is not rendered for
 * anyone else, and the two tables' RLS refuse them anyway).
 *   · Monthly sales target ($ inc GST) — ⚑9: the month total; the table also
 *     carries optional category / salesperson columns for later rows.
 *   · Marketing spend by channel and month — ⚑5: typed monthly by the office.
 *   · The dashboard's thresholds, as plain numeric settings.
 * Money is typed in dollars and stored in integer cents.
 */
export type TargetRow = { id: string; month: string; target_cents: number; note: string };
export type SpendRow = { id: string; month: string; channel: string; spend_cents: number; note: string };
export type ThresholdRow = { key: string; value: number; unit: string; notes: string };

const inp = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";
const thisMonth = () => {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const y = p.find((x) => x.type === "year")!.value; const m = p.find((x) => x.type === "month")!.value;
  return `${y}-${m}`;
};
const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
const dollars = (cents: number) => (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const toCents = (s: string): number | null => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export default function DashboardSettings({ targets, spend, thresholds }: { targets: TargetRow[]; spend: SpendRow[]; thresholds: ThresholdRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tMonth, setTMonth] = useState(thisMonth());
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

  async function saveTarget() {
    const cents = toCents(tAmount);
    if (cents == null || !/^\d{4}-\d{2}$/.test(tMonth)) { setMsg({ ok: false, text: "A month and a dollar amount, please." }); return; }
    setBusy(true); setMsg(null);
    // The unique index is on coalesced columns, which upsert cannot name: update the month's row when there is one, else insert.
    const existing = targets.find((t) => t.month.slice(0, 7) === tMonth);
    const r = existing
      ? await supabase.from("sales_targets").update({ target_cents: cents }).eq("id", existing.id)
      : await supabase.from("sales_targets").insert({ month: `${tMonth}-01`, target_cents: cents });
    done(r.error, `Target for ${monthLabel(`${tMonth}-01`)} saved.`);
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
      <section>
        <h4 className="text-sm font-semibold">Monthly sales target</h4>
        <p className="text-xs text-gray-500">Sales $ inc GST the month should reach. A month with no row reads “no target set”, never 0%.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Month<input type="month" className={`mt-1 block ${inp}`} value={tMonth} onChange={(e) => setTMonth(e.target.value)} data-testid="target-month" /></label>
          <label className="text-xs text-gray-600">Target ($ inc GST)<input inputMode="decimal" className={`mt-1 block w-36 ${inp}`} value={tAmount} onChange={(e) => setTAmount(e.target.value)} placeholder="e.g. 120000" data-testid="target-amount" /></label>
          <button type="button" disabled={busy} onClick={() => void saveTarget()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" data-testid="target-save">Save target</button>
        </div>
        {targets.length > 0 && (
          <table className="mt-3 w-full max-w-md text-sm">
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-t border-gray-100" data-testid={`target-row-${t.month.slice(0, 7)}`}>
                  <td className="py-1.5">{monthLabel(t.month)}</td>
                  <td className="py-1.5 text-right font-mono">{dollars(t.target_cents)}</td>
                  <td className="py-1.5 text-right"><button type="button" disabled={busy} onClick={() => void removeTarget(t.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
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
