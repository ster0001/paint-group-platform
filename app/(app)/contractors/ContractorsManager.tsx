"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { docState, daysUntil, type ContractorDoc } from "@/lib/contractor/model";
import { formatDMY } from "@/lib/scheduling/offers";

export type ContractorSummary = {
  id: string;
  name: string;
  company: string;
  tier: string;
  crewSize: number;
  active: boolean;
  offerable: boolean;
  /** Staff-set: every job quality checked, not just their first few. */
  requiresQa: boolean;
  rctiSigned: boolean;
  abn: string;
  hasBank: boolean;
  docs: ContractorDoc[];
  liveOffers: number;
  bookedJobs: number;
};

/** An unacknowledged change to where a contractor gets paid. */
export type BankAlert = {
  id: string;
  contractorId: string;
  name: string;
  /** Already formatted for Melbourne on the server — render as-is. */
  when: string;
  bsb: string;
  last4: string;
  prevBsb: string;
  prevLast4: string;
  firstTime: boolean;
};

export type InviteRow = {
  id: string;
  email: string;
  name: string;
  company_name: string;
  tier: string | null;
  token: string;
  created_at: string;
  expires_at: string;
};

const TIERS = ["A", "B", "C"];

export default function ContractorsManager({
  contractors,
  invites,
  bankAlerts,
}: {
  contractors: ContractorSummary[];
  invites: InviteRow[];
  bankAlerts: BankAlert[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", company: "", tier: "B" });
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const linkFor = (token: string) =>
    typeof window === "undefined" ? `/join/${token}` : `${window.location.origin}/join/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setErr("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function sendInvite() {
    setBusy("invite");
    setErr("");
    setMsg("");
    setNewLink(null);
    try {
      if (!form.email.trim()) throw new Error("Enter their email address.");
      const { data, error } = await supabase.rpc("create_contractor_invite", {
        p_email: form.email.trim(),
        p_name: form.name.trim(),
        p_company: form.company.trim(),
        p_tier: form.tier || null,
        p_days: 7,
      });
      if (error) throw error;
      setNewLink(linkFor(String(data)));
      setMsg("Invite created — send them the link below.");
      setForm({ email: "", name: "", company: "", tier: "B" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite(id: string) {
    setBusy(id);
    setErr("");
    const { error } = await supabase
      .from("contractor_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setErr(error.message);
    else {
      setMsg("Invite revoked — that link no longer works.");
      router.refresh();
    }
    setBusy(null);
  }

  async function setRequiresQa(id: string, requires: boolean) {
    setBusy(id);
    setErr("");
    const { data, error } = await supabase.rpc("set_contractor_requires_qa",
      { p_contractor_id: id, p_requires: requires });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setMsg(requires
        ? "Every job for this contractor now gets a quality check before sign-off."
        : "Back to the normal cadence — first few jobs only.");
      router.refresh();
    }
    setBusy(null);
  }

  async function setRcti(id: string, signed: boolean) {
    // ⚑9: recording that the RCTI agreement is signed. With it on, the
    // platform issues the contractor's invoice on their behalf at approval —
    // the submit step collapses. Turning it on without a signed agreement on
    // file is a compliance problem, so the confirm says exactly that.
    if (signed && !window.confirm(
      "Confirm the RCTI agreement is signed and on file for this contractor? " +
      "From now on their invoices are issued by us on their behalf.")) return;
    setBusy(id);
    setErr("");
    const { data, error } = await supabase.rpc("contractor_set_rcti",
      { p_contractor_id: id, p_signed: signed });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setMsg(signed
        ? "RCTI on — their invoices are now raised by us at approval."
        : "RCTI off — back to contractor-submitted invoices.");
      router.refresh();
    }
    setBusy(null);
  }

  async function setActive(id: string, active: boolean) {
    setBusy(id);
    setErr("");
    const { data, error } = await supabase.rpc("set_contractor_active", { p_contractor_id: id, p_active: active });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setMsg(active ? "Access restored." : "Suspended — they can't open the portal, and any live offer was pulled.");
      router.refresh();
    }
    setBusy(null);
  }

  /** Compliance documents live in a private bucket — open via a short-lived link. */
  async function openDoc(path: string) {
    setErr("");
    const { data, error } = await supabase.storage.from("contractor-docs").createSignedUrl(path, 60);
    if (error || !data) setErr("Couldn't open that file.");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function verifyDoc(docId: string, verified: boolean) {
    setBusy(docId);
    setErr("");
    const { data, error } = await supabase.rpc("verify_contractor_document", {
      p_document_id: docId,
      p_verified: verified,
      p_note: "",
    });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setMsg(verified ? "Verified — they can now be offered work." : "Verification withdrawn.");
      router.refresh();
    }
    setBusy(null);
  }

  /**
   * Clear one bank-change alert. Deliberately worded as "I've checked this"
   * rather than "dismiss": the point of the queue is that a human confirmed the
   * new account with the contractor before the next payment run, which is the
   * control that stops invoice-redirection fraud.
   */
  async function acknowledgeBank(eventId: string) {
    setBusy(eventId);
    setErr("");
    const { data, error } = await supabase.rpc("acknowledge_contractor_event", { p_event_id: eventId });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data).replace("error:", ""));
    else {
      setMsg("Marked as checked.");
      router.refresh();
    }
    setBusy(null);
  }

  async function setTier(id: string, tier: string) {
    setBusy(id);
    setErr("");
    const { error } = await supabase.rpc("set_contractor_tier", { p_contractor_id: id, p_tier: tier });
    if (error) setErr(error.message);
    else router.refresh();
    setBusy(null);
  }

  /** Plain-English compliance line, derived live rather than trusting stored status. */
  function compliance(c: ContractorSummary) {
    const ins = c.docs.find((d) => d.kind === "insurance" && docState(d) === "valid");
    if (!ins) {
      const awaiting = c.docs.find((d) => d.kind === "insurance" && d.file_url && !d.verified_at);
      if (awaiting) return { tone: "warn", text: "Insurance uploaded — waiting for you to check it" };
      return { tone: "bad", text: "No current insurance" };
    }
    const days = daysUntil(ins.expires_on);
    if (days !== null && days <= 45) return { tone: "warn", text: `Insurance expires in ${days} days` };
    return { tone: "ok", text: ins.expires_on ? `Insured to ${formatDMY(ins.expires_on)}` : "Insured" };
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-ink px-5 py-4 text-white">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contractors</h1>
          <p className="text-sm text-gray-400">Invite painters and control who can be offered work.</p>
        </div>
        <button
          onClick={() => setShowInvite((s) => !s)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint"
        >
          {showInvite ? "Close" : "+ Invite a contractor"}
        </button>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

      {/* ---- bank changes waiting to be checked ---- */}
      {bankAlerts.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-900">
            Bank details changed — check before you pay
            {bankAlerts.length > 1 ? ` (${bankAlerts.length})` : ""}
          </div>
          <p className="mt-1 text-xs text-red-800">
            Ring the contractor on a number you already had — not one from the message that
            told you about the change — and confirm the account before the next payment run.
          </p>
          <ul className="mt-3 space-y-2">
            {bankAlerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-md bg-white px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-gray-500"> · {a.when}</span>
                  <div className="mt-0.5 font-mono text-xs text-gray-700">
                    {a.firstTime ? (
                      <>first account added — {a.bsb} · ···· {a.last4}</>
                    ) : (
                      <>
                        {a.prevBsb || "—"} · ···· {a.prevLast4 || "—"}
                        <span className="mx-1.5 font-sans text-red-700" aria-label="changed to">→</span>
                        <b>{a.bsb} · ···· {a.last4}</b>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => acknowledgeBank(a.id)}
                  disabled={busy === a.id}
                  className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  {busy === a.id ? "…" : "I've checked this"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- invite form ---- */}
      {showInvite && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium">Invite a contractor</div>
          <p className="mt-1 text-xs text-gray-500">
            You&rsquo;ll get a private link to send them however you like — text, WhatsApp or email.
            It works once, expires in 7 days, and only the address you enter here can use it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-600">
              Email <span className="text-red-500">*</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="painter@example.com"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              Their name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Josef Kovac"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              Company
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Kovac Painting Pty Ltd"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              Tier
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>Tier {t}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            onClick={sendInvite}
            disabled={busy === "invite"}
            className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy === "invite" ? "Creating…" : "Create invite link"}
          </button>

          {newLink && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-medium text-emerald-900">Send them this link</div>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={newLink} className="flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-xs" />
                <button
                  onClick={() => navigator.clipboard?.writeText(newLink)}
                  className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-medium"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- pending invites ---- */}
      {invites.length > 0 && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium">Waiting to join ({invites.length})</div>
          <ul className="mt-2 divide-y divide-gray-100">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.name || i.email}</div>
                  <div className="text-xs text-gray-500">
                    {i.email}
                    {i.company_name ? ` · ${i.company_name}` : ""} · expires {formatDMY(i.expires_at.slice(0, 10))}
                  </div>
                </div>
                <button onClick={() => copy(i.token)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">
                  {copied === i.token ? "Copied ✓" : "Copy link"}
                </button>
                <button
                  onClick={() => revokeInvite(i.id)}
                  disabled={busy === i.id}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- the contractors ---- */}
      {contractors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          No contractors yet. Invite one above and send them the link.
        </div>
      ) : (
        <div className="space-y-3">
          {contractors.map((c) => {
            const comp = compliance(c);
            return (
              <div
                key={c.id}
                className={`rounded-lg border bg-white p-4 ${c.active ? "border-gray-200" : "border-gray-300 bg-gray-50"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!c.active && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Suspended</span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.offerable ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {c.offerable ? "Ready for work" : "Not offerable"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      {c.company || <span className="italic">no company name yet</span>}
                      {c.abn ? ` · ABN ${c.abn}` : ""}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        comp.tone === "ok" ? "text-emerald-700" : comp.tone === "warn" ? "text-amber-700" : "text-red-700"
                      }`}
                    >
                      {comp.text}
                      {c.hasBank ? " · bank details on file" : " · no bank details yet"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-gray-500">
                      Tier
                      <select
                        value={c.tier}
                        onChange={(e) => setTier(c.id, e.target.value)}
                        disabled={busy === c.id}
                        className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {TIERS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <span className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600">
                      {c.crewSize} painter{c.crewSize === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={() => setRequiresQa(c.id, !c.requiresQa)}
                      disabled={busy === c.id}
                      title="Quality check every job for this contractor before sign-off"
                      data-testid={`requires-qa-${c.id}`}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        c.requiresQa
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {c.requiresQa ? "QA: every job" : "QA: first jobs"}
                    </button>
                    <button
                      onClick={() => setRcti(c.id, !c.rctiSigned)}
                      disabled={busy === c.id}
                      title="Recipient-created tax invoices — we issue their invoice at approval (needs the signed agreement on file)"
                      data-testid={`rcti-${c.id}`}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        c.rctiSigned
                          ? "bg-sky-100 text-sky-800 border border-sky-300"
                          : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {c.rctiSigned ? "RCTI: on" : "RCTI: off"}
                    </button>
                    <button
                      onClick={() => setActive(c.id, !c.active)}
                      disabled={busy === c.id}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        c.active
                          ? "border border-gray-300 text-gray-700 hover:bg-gray-100"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      {busy === c.id ? "…" : c.active ? "Suspend access" : "Restore access"}
                    </button>
                  </div>
                </div>

                {c.docs.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-2">
                    <div className="text-xs font-medium text-gray-500">Documents</div>
                    <ul className="mt-1 space-y-1">
                      {c.docs.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium capitalize">{d.kind}</span>
                          <span className="min-w-0 flex-1 truncate text-gray-500">
                            {d.name}
                            {d.expires_on ? ` · expires ${formatDMY(d.expires_on)}` : " · no expiry"}
                          </span>
                          {d.verified_at ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">Verified</span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Needs checking</span>
                          )}
                          {d.file_url && (
                            <button onClick={() => openDoc(d.file_url)} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">
                              Open
                            </button>
                          )}
                          <button
                            onClick={() => verifyDoc(d.id, !d.verified_at)}
                            disabled={busy === d.id}
                            className={`rounded px-2 py-0.5 font-medium disabled:opacity-50 ${
                              d.verified_at
                                ? "border border-gray-300 text-gray-600 hover:bg-gray-50"
                                : "bg-emerald-600 text-white hover:bg-emerald-700"
                            }`}
                          >
                            {busy === d.id ? "…" : d.verified_at ? "Un-verify" : "Verify"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-4 border-t border-gray-100 pt-2 text-xs text-gray-500">
                  <span>{c.bookedJobs} booked</span>
                  <span>{c.liveOffers} awaiting a response</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
