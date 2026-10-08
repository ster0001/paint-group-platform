"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookCallbackAction, closeCallbackAction, logCallbackAction, setCallbackReasonAction, voidCallbackAction } from "@/app/pc/callbackActions";
import { uploadFailureText, uploadWorkOrderMedia } from "@/lib/workorder/uploadMedia";
import { REASON_LABEL, SOURCE_LABEL, STATUS_LABEL, dmy, isOpenStatus, type Callback, type CallbackSource } from "@/lib/callbacks/model";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import type { WOPhoto } from "@/lib/workorder/photos";

/**
 * Call backs on the PC's job page (brief Step 3, rulings C2–C8, ⚑15, ⚑22):
 *   · route 2 — a flagged final walk-through asks "Is a call back required?";
 *   · route 3 — "Customer called back": date, what is wrong, photos, reason,
 *     the return visit and who fixes it → one record and a scheduler booking;
 *   · every call back on the job, with Book the visit, Change reason, Confirm
 *     and close, and (owner) Void. Only the PC's close ends it.
 * Route 1 lives on the quality-check card and route 4 on the schedule board;
 * all four write the same record through wo_callback_log.
 */
export type Painter = { id: string; name: string };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function CallbackPanel({ workOrderId, callbacks, painters, jobPainterId, canVoid, photos, flaggedAreas, openSource }: {
  workOrderId: string;
  callbacks: Callback[];
  /** Active painters, for "who fixes it". */
  painters: Painter[];
  /** The painter who did the job — the default fixer and the one it counts against (C7). */
  jobPainterId: string | null;
  canVoid: boolean;
  /** Signed photos per call back id. */
  photos: Record<string, WOPhoto[]>;
  /** Areas the customer flagged at the walk-through and nobody has put right yet (route 2). */
  flaggedAreas: string[];
  /** Open the form at once with this source (a queue card's "Yes, call back" link). */
  openSource?: CallbackSource | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CallbackSource | null>(openSource ?? null);
  const [reportedOn, setReportedOn] = useState(today());
  const [description, setDescription] = useState(openSource === "walkthrough_fail" && flaggedAreas.length ? `Flagged at the walk-through: ${flaggedAreas.join(", ")}` : "");
  const [reason, setReason] = useState<"workmanship" | "not_workmanship">("workmanship");
  const [returnStart, setReturnStart] = useState("");
  const [returnEnd, setReturnEnd] = useState("");
  const [fixedBy, setFixedBy] = useState(jobPainterId ?? "");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [bookFor, setBookFor] = useState<string | null>(null);
  const [bookStart, setBookStart] = useState("");
  const [bookEnd, setBookEnd] = useState("");
  const [bookFixer, setBookFixer] = useState("");

  const openOnes = callbacks.filter((c) => isOpenStatus(c.status));
  const askWalkthrough = flaggedAreas.length > 0 && !callbacks.some((c) => c.source === "walkthrough_fail" && isOpenStatus(c.status));

  async function upload(file: File) {
    setUploading(true); setMsg(null);
    try {
      const { id } = await uploadWorkOrderMedia({ workOrderId, file, kind: "callback", area: "Call back", caption: description.slice(0, 120) || "Call back" });
      setPhotoIds((ids) => [...ids, id]);
    } catch (e) { setMsg({ ok: false, text: uploadFailureText(e, file) }); }
    finally { setUploading(false); }
  }

  function log() {
    if (!form) return;
    setMsg(null);
    start(async () => {
      const r = await logCallbackAction({
        workOrderId, source: form, reason, reportedOn, description, photoIds,
        returnStart: returnStart || null, returnEnd: returnEnd || returnStart || null, fixedBy: fixedBy || null,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setForm(null); setDescription(""); setPhotoIds([]); setReturnStart(""); setReturnEnd(""); router.refresh(); }
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setBookFor(null); router.refresh(); }
  });

  const painterName = (id: string | null) => painters.find((p) => p.id === id)?.name ?? "the painter";

  return (
    <div className="card" data-testid="callbacks" id="callbacks">
      <h3>Call backs <em>{openOnes.length ? `${openOnes.length} open` : callbacks.length ? "none open" : "none"}</em></h3>
      <p className="note">
        A call back is a return visit on another day to fix workmanship. It counts against the painter who did the
        job, pauses the customer&rsquo;s invoice chasing until the office closes it, and never changes the painter&rsquo;s pay.
      </p>

      {msg && <p className="note" style={{ color: msg.ok ? "var(--emerald)" : "var(--amber)" }} data-testid="callback-msg">{msg.text}</p>}

      {/* Route 2: the walk-through flagged an area. */}
      {askWalkthrough && form !== "walkthrough_fail" && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.45)" }} data-testid="callback-walkthrough-ask">
          <h3>Walk-through flagged {flaggedAreas.length === 1 ? "an area" : `${flaggedAreas.length} areas`} <em>is a call back required?</em></h3>
          <p className="note">{flaggedAreas.join(", ")}. If the painter fixes it and the customer signs today, it is a pass after a fix — not a call back. If it needs another day, log the call back.</p>
          <div className="row">
            <button type="button" className="btn primary" data-testid="callback-walkthrough-yes"
              onClick={() => { setForm("walkthrough_fail"); setDescription(`Flagged at the walk-through: ${flaggedAreas.join(", ")}`); setReason("workmanship"); setReportedOn(today()); }}>
              Yes, call back
            </button>
            <span className="note" style={{ alignSelf: "center" }}>No — fixed and signed today: nothing to do here, the signature records it.</span>
          </div>
        </div>
      )}

      {/* Route 3: the customer rang. */}
      {!form && (
        <div className="row">
          <button type="button" className="btn" onClick={() => { setForm("customer_call"); setReportedOn(today()); setReason("workmanship"); }} data-testid="callback-customer-called">
            Customer called back
          </button>
        </div>
      )}

      {form && (
        <div className="card" style={{ borderColor: "var(--paint)" }} data-testid="callback-form" data-source={form}>
          <h3>{form === "customer_call" ? "Customer called back" : form === "walkthrough_fail" ? "Call back from the walk-through" : SOURCE_LABEL[form]}</h3>
          <label className="fld">Date the customer called (reported)
            <input type="date" className="num" style={{ width: 160 }} value={reportedOn} onChange={(e) => setReportedOn(e.target.value)} data-testid="callback-reported-on" />
          </label>
          <textarea className="edit" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What is wrong — this goes to the painter" data-testid="callback-description" />
          <div className="row" role="radiogroup" aria-label="Reason">
            {(["workmanship", "not_workmanship"] as const).map((r) => (
              <button key={r} type="button" className={`btn ${reason === r ? "primary" : ""}`} aria-pressed={reason === r}
                onClick={() => setReason(r)} data-testid={`callback-reason-${r}`}>{REASON_LABEL[r]}</button>
            ))}
          </div>
          <p className="note">Only workmanship counts toward the painter&rsquo;s score. The reason can be changed later.</p>
          <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void (async () => { for (const f of files) await upload(f); })(); }} />
          <button type="button" className="btn" disabled={uploading} onClick={() => fileInput.current?.click()} data-testid="callback-photo">
            {uploading ? "Uploading…" : photoIds.length === 0 ? "📷 Photos of what is wrong" : `📷 ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"} attached — add another`}
          </button>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="fld">Return visit from
              <input type="date" className="num" style={{ width: 150 }} value={returnStart} onChange={(e) => setReturnStart(e.target.value)} data-testid="callback-return-start" />
            </label>
            <label className="fld">to
              <input type="date" className="num" style={{ width: 150 }} value={returnEnd} onChange={(e) => setReturnEnd(e.target.value)} data-testid="callback-return-end" />
            </label>
            <label className="fld">Who fixes it
              <select value={fixedBy} onChange={(e) => setFixedBy(e.target.value)} data-testid="callback-fixer">
                {painters.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === jobPainterId ? " (did the job)" : ""}</option>)}
              </select>
            </label>
          </div>
          <p className="note">Leave the dates empty to book the visit later. Whoever fixes it, the call back counts against {painterName(jobPainterId)}.</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={pending || !description.trim()} onClick={log} data-testid="callback-log">
              {pending ? "Saving…" : "Log call back"}
            </button>
            <button type="button" className="btn" onClick={() => { setForm(null); setPhotoIds([]); }}>Cancel</button>
          </div>
        </div>
      )}

      {callbacks.map((c) => (
        <div className="card" key={c.id} data-testid={`callback-${c.id}`} data-status={c.status} style={{ borderColor: isOpenStatus(c.status) ? "rgba(179,87,74,.45)" : "var(--line)" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`pill ${isOpenStatus(c.status) ? "p-clay" : c.status === "done" ? "p-em" : ""}`}>{c.status === "done" ? "Closed" : c.status === "void" ? "Voided" : "Call back"}</span>
            <span className="note">{SOURCE_LABEL[c.source]} · reported {dmy(c.reportedOn)} · {REASON_LABEL[c.reason]}</span>
          </div>
          <p style={{ margin: 0 }}>{c.description || "No description"}</p>
          <p className="note" data-testid={`callback-state-${c.id}`}>
            {STATUS_LABEL[c.status]}
            {c.visit ? ` · ${dmy(c.visit.start)}${c.visit.end !== c.visit.start ? ` – ${dmy(c.visit.end)}` : ""} with ${painterName(c.visit.contractorId)}` : ""}
            {c.fixedAt ? ` · marked fixed ${new Date(c.fixedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}${c.fixedNote ? `: “${c.fixedNote}”` : ""}` : ""}
            {c.status === "void" && c.voidReason ? ` · ${c.voidReason}` : ""}
            {" · counts against "}{painterName(c.painterId)}
          </p>
          {photos[c.id]?.length ? <PhotoGrid photos={photos[c.id]} tight showKind={false} empty="" /> : null}
          {isOpenStatus(c.status) && (
            <div className="row">
              {bookFor === c.id ? (
                <>
                  <input type="date" className="num" style={{ width: 150 }} value={bookStart} onChange={(e) => setBookStart(e.target.value)} data-testid={`callback-book-start-${c.id}`} />
                  <input type="date" className="num" style={{ width: 150 }} value={bookEnd} onChange={(e) => setBookEnd(e.target.value)} />
                  <select value={bookFixer || c.fixedByPainterId || c.painterId} onChange={(e) => setBookFixer(e.target.value)}>
                    {painters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" className="btn primary" disabled={pending || !bookStart} data-testid={`callback-book-save-${c.id}`}
                    onClick={() => run(() => bookCallbackAction({ callbackId: c.id, workOrderId, start: bookStart, end: bookEnd || bookStart, fixedBy: bookFixer || c.fixedByPainterId || c.painterId }))}>
                    Save visit
                  </button>
                  <button type="button" className="btn" onClick={() => setBookFor(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn" disabled={pending} data-testid={`callback-book-${c.id}`}
                    onClick={() => { setBookFor(c.id); setBookStart(c.visit?.start ?? ""); setBookEnd(c.visit?.end ?? ""); setBookFixer(c.fixedByPainterId ?? c.painterId); }}>
                    {c.visit ? "Move the visit" : "Book the visit"}
                  </button>
                  <button type="button" className="btn primary" disabled={pending} data-testid={`callback-close-${c.id}`}
                    onClick={() => run(() => closeCallbackAction({ callbackId: c.id, workOrderId, note: "" }))}>
                    {c.status === "fixed" ? "Confirm and close" : "Close"}
                  </button>
                  <button type="button" className="btn" disabled={pending} data-testid={`callback-reason-toggle-${c.id}`}
                    onClick={() => run(() => setCallbackReasonAction({ callbackId: c.id, workOrderId, reason: c.reason === "workmanship" ? "not_workmanship" : "workmanship" }))}>
                    {c.reason === "workmanship" ? "Mark not workmanship" : "Mark workmanship"}
                  </button>
                  {canVoid && (
                    <button type="button" className="btn dim" disabled={pending} data-testid={`callback-void-${c.id}`}
                      onClick={() => { const why = prompt("Void this call back — why? (Logged in error…)"); if (why?.trim()) run(() => voidCallbackAction({ callbackId: c.id, workOrderId, reason: why.trim() })); }}>
                      Void
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
