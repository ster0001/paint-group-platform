"use client";

import { useCallback, useEffect, useState } from "react";
import { STAFF_AREAS, type StaffAreaKey } from "@/lib/staff/access";
import { DASHBOARD_ROLES, ROLE_LABEL, type DashboardRole } from "@/lib/reporting/roles";
import { createStaffAction, listStaffAction, removeStaffAction, sendStaffResetLinkAction, setStaffPasswordAction, updateStaffAction, type StaffRow } from "./staffActions";

/**
 * Settings → Company → Staff logins (Tom, 5 Sep 2026).
 *
 * The master user creates office logins here (email, name, starting
 * password) and ticks which areas each person sees. Until a master exists,
 * any staff login can create the first one — tick "Master user".
 */
export default function StaffAccountsManager() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerExists, setOwnerExists] = useState(true);
  const [loadMsg, setLoadMsg] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [newOwner, setNewOwner] = useState(false);
  const [newAccess, setNewAccess] = useState<Record<string, boolean>>({});
  const [newRoles, setNewRoles] = useState<DashboardRole[]>([]);

  const load = useCallback(async () => {
    const r = await listStaffAction().catch(() => null);
    if (!r || r.status === "error") { setLoadMsg(r?.status === "error" ? r.message : "Couldn't load the staff list."); return; }
    setRows(r.rows); setCanManage(r.canManage); setIsOwner(r.isOwner); setOwnerExists(r.ownerExists); setLoadMsg("");
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const r = await createStaffAction({ email, name, phone, password, isOwner: newOwner, access: newAccess, roles: newRoles }).catch(() => null);
    setBusy(false);
    if (!r || r.status === "error") { setMsg({ ok: false, text: r?.message ?? "That didn't save — try again." }); return; }
    setEmail(""); setName(""); setPhone(""); setPassword(""); setNewOwner(false); setNewAccess({}); setNewRoles([]);
    setMsg({ ok: true, text: r.message });
    load();
  };

  const toggle = (row: StaffRow, key: StaffAreaKey, visible: boolean) =>
    setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, access: { ...x.access, [key]: visible } } : x)));
  const save = async (row: StaffRow) => {
    setMsg(null); setBusy(true);
    const access: Record<string, boolean> = {};
    for (const a of STAFF_AREAS) access[a.key] = row.access[a.key] !== false;
    const r = await updateStaffAction({ id: row.id, isOwner: row.isOwner, access, roles: row.roles, name: row.name, phone: row.phone }).catch(() => null);
    setBusy(false);
    setMsg(r ? { ok: r.status === "ok", text: r.message } : { ok: false, text: "That didn't save — try again." });
    if (r?.status === "ok") load();
  };
  // Tom, 24 Sep: a password by hand, or a reset link by email, per login.
  const [newPw, setNewPw] = useState<Record<string, string>>({});
  const setPw = async (row: StaffRow) => {
    setMsg(null); setBusy(true);
    const r = await setStaffPasswordAction({ id: row.id, password: newPw[row.id] ?? "" }).catch(() => null);
    setBusy(false);
    setMsg(r ? { ok: r.status === "ok", text: r.message } : { ok: false, text: "That didn't save — try again." });
    if (r?.status === "ok") setNewPw((m) => ({ ...m, [row.id]: "" }));
  };
  const sendReset = async (row: StaffRow) => {
    setMsg(null); setBusy(true);
    const r = await sendStaffResetLinkAction({ id: row.id }).catch(() => null);
    setBusy(false);
    setMsg(r ? { ok: r.status === "ok", text: r.message } : { ok: false, text: "That didn't send — try again." });
  };
  const remove = async (row: StaffRow) => {
    if (!window.confirm(`Remove ${row.email || row.name}'s login? They will not be able to sign in.`)) return;
    setMsg(null); setBusy(true);
    const r = await removeStaffAction({ id: row.id }).catch(() => null);
    setBusy(false);
    setMsg(r ? { ok: r.status === "ok", text: r.message } : { ok: false, text: "That didn't work — try again." });
    load();
  };

  /** Dashboard 0d (Tom, 19 Sep): roles = which dashboard sections; a person may hold several (union). */
  const roleTicks = (roles: DashboardRole[], onTick: (r: DashboardRole, v: boolean) => void, disabled: boolean, idPrefix: string) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
      {DASHBOARD_ROLES.map((r) => (
        <label key={r} className={`flex items-center gap-1.5 ${disabled ? "text-gray-400" : "text-gray-700"}`}>
          <input type="checkbox" disabled={disabled} checked={roles.includes(r)} onChange={(e) => onTick(r, e.target.checked)} data-testid={`${idPrefix}role-${r}`} />
          {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  );
  const withRole = (roles: DashboardRole[], r: DashboardRole, on: boolean): DashboardRole[] =>
    DASHBOARD_ROLES.filter((x) => (x === r ? on : roles.includes(x)));

  const areaTicks = (access: Record<string, boolean | undefined>, onTick: (k: StaffAreaKey, v: boolean) => void, disabled: boolean) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
      {STAFF_AREAS.map((a) => (
        <label key={a.key} className={`flex items-center gap-1.5 ${disabled ? "text-gray-400" : "text-gray-700"}`}>
          <input type="checkbox" disabled={disabled} checked={access[a.key] !== false} onChange={(e) => onTick(a.key, e.target.checked)} data-testid={`area-${a.key}`} />
          {a.label}
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-6" data-testid="staff-logins">
      {loadMsg && <p className="text-sm text-red-600">{loadMsg}</p>}
      {!ownerExists && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No master user yet. Create one below and tick <b>Master user</b> — from then on only the master can add or change staff logins.
        </p>
      )}
      {ownerExists && !isOwner && (
        <p className="text-sm text-gray-600">Only the master user can add staff logins or change what each person sees.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-800">Staff logins</h3>
        <div className="mt-2 space-y-3">
          {rows.length === 0 && <p className="text-sm text-gray-500">No staff logins found.</p>}
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`staff-row-${row.email}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="min-w-[160px] rounded-md border border-gray-300 px-2 py-1 text-sm"
                  value={row.name} disabled={!isOwner} placeholder="Name"
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, name: e.target.value } : x)))}
                />
                <span className="text-sm text-gray-600">{row.email}</span>
                {row.self && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">you</span>}
                <input
                  className="w-36 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  value={row.phone} disabled={!isOwner} placeholder="Mobile (for texts)" inputMode="tel"
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, phone: e.target.value } : x)))}
                  data-testid={`staff-phone-${row.email}`}
                />
                <label className={`ml-auto flex items-center gap-1.5 text-sm ${isOwner ? "text-gray-700" : "text-gray-400"}`}>
                  <input type="checkbox" disabled={!isOwner} checked={row.isOwner}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, isOwner: e.target.checked } : x)))} />
                  Master user
                </label>
              </div>
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{row.isOwner ? "A master user sees everything" : "Areas this person sees"}</div>
                {areaTicks(row.access, (k, v) => toggle(row, k, v), !isOwner || row.isOwner)}
              </div>
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{row.isOwner ? "A master user holds every dashboard role" : "Dashboard roles (sections they see — several add up)"}</div>
                {roleTicks(row.roles, (r, v) => setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, roles: withRole(x.roles, r, v) } : x))), !isOwner || row.isOwner, `${row.email}-`)}
              </div>
              {isOwner && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">Password</span>
                  <input
                    type="password" autoComplete="new-password" minLength={8} placeholder="New password (8+ characters)"
                    className="w-56 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={newPw[row.id] ?? ""} onChange={(e) => setNewPw((m) => ({ ...m, [row.id]: e.target.value }))}
                    data-testid={`staff-newpw-${row.email}`}
                  />
                  <button type="button" disabled={busy || (newPw[row.id] ?? "").length < 8} onClick={() => setPw(row)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50" data-testid={`staff-setpw-${row.email}`}>
                    Set password
                  </button>
                  <button type="button" disabled={busy || !row.email} onClick={() => sendReset(row)}
                    className="rounded-md border border-cyan-600 px-3 py-1.5 text-sm text-cyan-700 hover:bg-cyan-50 disabled:opacity-50" data-testid={`staff-reset-${row.email}`}>
                    Email a reset link
                  </button>
                </div>
              )}
              {isOwner && (
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => save(row)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">Save</button>
                  {!row.self && <button type="button" disabled={busy} onClick={() => remove(row)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">Remove login</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <form onSubmit={create} className="rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="staff-create">
          <h3 className="text-sm font-semibold text-gray-800">Add a staff login</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-gray-600">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid="staff-email" /></label>
            <label className="text-xs text-gray-600">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid="staff-name" /></label>
            <label className="text-xs text-gray-600">Mobile (for text alerts)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="04xx xxx xxx" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid="staff-phone" /></label>
            <label className="text-xs text-gray-600">Starting password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid="staff-password" /></label>
          </div>
          <label className="mt-3 flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={newOwner} onChange={(e) => setNewOwner(e.target.checked)} data-testid="staff-owner" /> Master user (sees everything, manages staff logins)
          </label>
          {!newOwner && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">Areas this person sees</div>
              {areaTicks(newAccess, (k, v) => setNewAccess((m) => ({ ...m, [k]: v })), false)}
              <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-gray-400">Dashboard roles</div>
              {roleTicks(newRoles, (r, v) => setNewRoles((rs) => withRole(rs, r, v)), false, "new-")}
            </div>
          )}
          <button type="submit" disabled={busy} className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="staff-submit">
            {busy ? "Saving…" : "Create login"}
          </button>
          <p className="mt-2 text-xs text-gray-500">Hand the password over in person or by phone. They sign in at /login and can change it afterwards. Which alerts each person gets is under Communications → Automations → Staff.</p>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="staff-msg">{msg.text}</p>}
    </div>
  );
}
