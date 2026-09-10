"use client";

import { useCallback, useEffect, useState } from "react";
import { STAFF_EVENTS, type StaffEventKey, type StaffNotifyChannel, type StaffNotifyMap } from "@/lib/staff/notifyEvents";
import { listStaffAction, updateStaffNotifyAction, type StaffRow } from "./staffActions";

/**
 * Settings → Automations → Staff (Tom, 10 Sep 2026): "which staff member
 * sees each of these". One row per staff login, one column per staff alert,
 * Email / Text ticks in each cell. Saved per person (profiles.staff_notify).
 * The master user sets anyone's; everyone else sees the table and can
 * change their own row. Text needs a mobile on the login (Staff logins).
 */
export default function StaffAlertsMatrix() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  /** The database hasn't had 20270134 run on it: nothing here can be saved yet. */
  const [needsMigration, setNeedsMigration] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await listStaffAction().catch(() => null);
    if (!r || r.status === "error") { setLoadMsg(r?.status === "error" ? r.message : "Couldn't load the staff list."); return; }
    setRows(r.rows); setIsOwner(r.isOwner); setNeedsMigration(r.needsMigration); setLoadMsg(""); setDirty(new Set());
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const canEdit = (row: StaffRow) => !needsMigration && (isOwner || row.self);
  const has = (m: StaffNotifyMap, k: StaffEventKey, c: StaffNotifyChannel) => (m[k] ?? []).includes(c);
  const tick = (row: StaffRow, k: StaffEventKey, c: StaffNotifyChannel, on: boolean) => {
    setRows((rs) => rs.map((x) => {
      if (x.id !== row.id) return x;
      const cur = x.notify[k] ?? [];
      const next = on ? [...new Set([...cur, c])] : cur.filter((y) => y !== c);
      const notify: StaffNotifyMap = { ...x.notify };
      if (next.length) notify[k] = next; else delete notify[k];
      return { ...x, notify };
    }));
    setDirty((d) => new Set(d).add(row.id));
    setMsg(null);
  };

  async function save() {
    setBusy(true); setMsg(null);
    const results = await Promise.all(rows.filter((r) => dirty.has(r.id)).map((r) =>
      updateStaffNotifyAction({ id: r.id, notify: r.notify }).catch(() => ({ status: "error" as const, message: "That didn't save — try again." })),
    ));
    setBusy(false);
    const err = results.find((r) => r.status === "error");
    setMsg(err ? { ok: false, text: err.message } : { ok: true, text: "Saved ✓" });
    if (!err) setDirty(new Set());
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white" data-testid="staff-alerts">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="text-sm font-semibold text-gray-900">Who gets each staff alert</div>
        <p className="mt-0.5 text-xs text-gray-600">
          Tick Email and/or Text per person. {isOwner ? "You can set everyone's." : "You can change your own row; the master user sets the rest."} Text needs a mobile on the login (Company → Staff logins).
        </p>
      </div>
      {needsMigration && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="staff-alerts-needs-migration">
          This database hasn&rsquo;t had the staff-alerts update run on it yet, so nothing here can be saved.
          Run <code className="font-mono text-xs">supabase/migrations/20270134000000_staff_notifications.sql</code>, then reload this page.
        </p>
      )}
      {loadMsg && <p className="px-4 py-3 text-sm text-red-600">{loadMsg}</p>}
      {!loadMsg && rows.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">Loading staff…</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 font-medium">Person</th>
                {STAFF_EVENTS.map((e) => <th key={e.key} className="px-2 py-2 font-medium" title={e.label}>{e.short}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} data-testid={`alerts-row-${row.email}`} className={canEdit(row) ? "" : "text-gray-400"}>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium text-gray-900">{row.name || row.email}{row.self && <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] uppercase text-gray-500">you</span>}</div>
                    <div className="text-[11px] text-gray-500">{row.phone ? row.phone : "no mobile on file"}</div>
                  </td>
                  {STAFF_EVENTS.map((e) => (
                    <td key={e.key} className="px-2 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        {(["email", "sms"] as const).map((c) => {
                          const disabled = !canEdit(row) || (c === "sms" && !row.phone);
                          return (
                            <label key={c} className={`flex items-center gap-1 ${disabled ? "text-gray-300" : "text-gray-700"}`} title={c === "sms" && !row.phone ? "Add a mobile under Staff logins" : undefined}>
                              <input
                                type="checkbox" className="h-3.5 w-3.5 accent-emerald-600" disabled={disabled}
                                checked={has(row.notify, e.key, c)} onChange={(ev) => tick(row, e.key, c, ev.target.checked)}
                                data-testid={`alert-${row.email}-${e.key}-${c}`}
                              />
                              {c === "email" ? "Email" : "Text"}
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3">
        <button type="button" onClick={save} disabled={busy || dirty.size === 0} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="staff-alerts-save">
          {busy ? "Saving…" : "Save who gets what"}
        </button>
        {dirty.size > 0 && !msg && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="staff-alerts-msg">{msg.text}</span>}
      </div>
    </div>
  );
}
