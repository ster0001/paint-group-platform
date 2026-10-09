"use client";

import { uploadFailureText, uploadWorkOrderMedia, uploadingLabel } from "@/lib/workorder/uploadMedia";

import { useRef, useState, useTransition } from "react";
import { acceptVariationAction, acknowledgeVariationAction, raiseVariationAction, declineVariationAction } from "./variationActions";
import { VARIATION_CATEGORIES, variationCategoryLabel, type VariationStatus } from "@/lib/workorder/variations";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type VariationView = {
  id: string;
  category: string;
  comment: string;
  status: VariationStatus;
  contractorDeltaCents: number | null;
  estHours: number | null;
  released: boolean;
  /** A signed scope REMOVAL — the pay moves down, and it's acknowledged, not accepted. */
  credit?: boolean;
  needsManualDeduction?: boolean;
  deductionCents?: number | null;
  deductionNote?: string;
  acknowledged?: boolean;
  /** Tom, 7 Oct 2026: the painter declined the client-approved change, with this note. */
  contractorDeclined?: boolean;
  declineNote?: string;
  /** Tom, 8 Oct 2026: the office turned the request down, with this reply. */
  officeRejected?: boolean;
  officeRejectNote?: string;
};

/**
 * The contractor's variations: raise one, and accept the adjusted offer when
 * both approvals are in.
 *
 * Photos are taken FIRST and uploaded before the variation is raised, because
 * the server refuses a variation with no evidence — so the form asks for them
 * up front rather than failing at the end.
 */
/**
 * Employed painters (S4, ruling 8): what an employee sees of a variation.
 * Outcome and scope, never a delta. `scope_lines` arrive stripped in SQL.
 */
export type EmployeeVariationView = {
  id: string;
  category: string;
  comment: string;
  estHours: number | null;
  outcome: "with_office" | "with_customer" | "approved" | "not_going_ahead";
  scopeLines: { label: string }[];
  officeNote: string;
  credit: boolean;
};

export default function Variations({
  workOrderId, variations, mode = "contractor", employeeVariations = [],
}: {
  workOrderId: string;
  variations: VariationView[];
  /** The one component, two modes (CLAUDE.md): a contractor accepts an adjusted
   *  offer; an employee is told the outcome. Never two copies of the card. */
  mode?: "contractor" | "employee";
  employeeVariations?: EmployeeVariationView[];
}) {
  const [list, setList] = useState(variations);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(VARIATION_CATEGORIES[0].code);
  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadPhoto(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const { id } = await uploadWorkOrderMedia({ workOrderId, file, kind: "variation", onProgress: setProgress });
      setPhotoIds((ids) => [...ids, id]);
    } catch (e) {
      setMessage(uploadFailureText(e, file));
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await raiseVariationAction({
        workOrderId, category, comment,
        photoIds,
        estHours: hours.trim() === "" ? null : Number(hours),
      });
      if (!result.ok) { setMessage(result.message); return; }
      setList((l) => [
        { id: result.id, category, comment, status: "raised", contractorDeltaCents: null,
          estHours: hours.trim() === "" ? null : Number(hours), released: false },
        ...l,
      ]);
      setOpen(false); setComment(""); setHours(""); setPhotoIds([]);
      setMessage("Sent to the office. We'll come back to you with a price.");
    });
  }

  function accept(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await acceptVariationAction({ variationId: id });
      if (result.ok) {
        setList((l) => l.map((v) => (v.id === id ? { ...v, status: "contractor_accepted" } : v)));
      } else setMessage(result.message);
    });
  }

  // Tom, 7 Oct 2026: Decline, in smaller letters, opens a box for the note.
  const [declining, setDeclining] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  function decline(id: string) {
    setMessage(null);
    const note = declineNote.trim();
    if (note.length < 3) { setMessage("Tell us what needs to change — a sentence is plenty."); return; }
    startTransition(async () => {
      const result = await declineVariationAction({ variationId: id, note });
      if (result.ok) {
        setList((l) => l.map((v) => (v.id === id ? { ...v, status: "declined", contractorDeclined: true, declineNote: note } : v)));
        setDeclining(null); setDeclineNote("");
      } else setMessage(result.message);
    });
  }

  function acknowledge(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await acknowledgeVariationAction({ variationId: id });
      if (result.ok) {
        setList((l) => l.map((v) => (v.id === id ? { ...v, status: "contractor_accepted", acknowledged: true } : v)));
      } else setMessage(result.message);
    });
  }

  /** What comes off the pay for a credit: the PC's manual figure wins. */
  const creditDeduction = (v: VariationView) =>
    v.needsManualDeduction ? v.deductionCents : v.contractorDeltaCents;

  return (
    <div className="card" style={{ marginTop: 12 }} data-testid="variations">
      <div className="tick-head">
        <b>Variations</b>
        {!open && (
          <button type="button" className="var-add" onClick={() => setOpen(true)} data-testid="raise-variation">
            + Found something
          </button>
        )}
      </div>

      {message && <p className="tick-msg" role="status" data-testid="variation-message">{message}</p>}

      {open && (
        <div className="var-form">
          <div className="var-chips">
            {VARIATION_CATEGORIES.map((c) => (
              <button
                key={c.code} type="button"
                className={`var-chip ${category === c.code ? "on" : ""}`}
                onClick={() => setCategory(c.code)}
                data-testid={`category-${c.code}`}
              >{c.label}</button>
            ))}
          </div>

          <textarea
            className="var-note" rows={3} value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What have you found? The office reads this to the customer."
            data-testid="variation-comment"
          />

          {/* No `capture` — the OS offers camera OR photo library (Tom, 1 Sep). */}
          <input
            ref={fileInput} type="file" hidden
            accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPhoto(f); }}
          />
          <button type="button" className="var-photo" onClick={() => fileInput.current?.click()}
            disabled={uploading} data-testid="variation-photo">
            {uploading ? uploadingLabel(progress) : photoIds.length === 0
              ? "📷 Photos or a video — needed before this can go to the office"
              : `📷 ${photoIds.length} added — add another photo or video`}
          </button>

          <label className="var-label">
            Roughly how long? (optional)
            <input
              className="var-hours" inputMode="decimal" value={hours}
              onChange={(e) => setHours(e.target.value)} placeholder="hrs"
              data-testid="variation-hours"
            />
          </label>

          <div className="var-row">
            <button type="button" className="var-send" disabled={pending || photoIds.length === 0}
              onClick={submit} data-testid="send-variation">
              {pending ? "Sending…" : "Send to the office"}
            </button>
            <button type="button" className="var-cancel" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="note">The office prices it and the customer approves before any of it is done.</p>
        </div>
      )}

      {/* Employee mode (ruling 8): outcome + scope + hours. No accept, no $. */}
      {mode === "employee" && employeeVariations.map((v) => (
        <div className="var-item" key={v.id} data-testid={`variation-${v.id}`} data-outcome={v.outcome}>
          <div className="var-item-top">
            <b>
              {variationCategoryLabel(v.category, "painter")}
            </b>
            <span className={`chip ${v.outcome === "approved" ? "grn" : v.outcome === "not_going_ahead" ? "cly" : "amb"}`}>
              {v.outcome === "with_office" ? "With the office"
                : v.outcome === "with_customer" ? "With the customer"
                : v.outcome === "approved" ? (v.credit ? "Removed from scope" : "Variation approved")
                : "Not going ahead"}
            </span>
          </div>
          <p className="var-item-comment">{v.comment}</p>
          {v.outcome === "approved" && (
            <div className="note" data-testid={`approved-${v.id}`}>
              {v.credit
                ? "The customer has taken this out of the scope. The struck surfaces are marked on your tick list."
                : `Go ahead${v.estHours != null ? ` — ${v.estHours} hr${v.estHours === 1 ? "" : "s"} added to the job` : ""}.`}
              {v.scopeLines.length > 0 && (
                <ul className="excl" style={{ marginTop: 6 }} data-testid={`scope-${v.id}`}>
                  {v.scopeLines.map((l, i) => <li key={i}>{l.label}</li>)}
                </ul>
              )}
            </div>
          )}
          {v.outcome === "not_going_ahead" && (
            <p className="note" data-testid={`declined-${v.id}`}>
              Leave it as it is.{v.officeNote ? ` The office says: "${v.officeNote}"` : ""}
            </p>
          )}
        </div>
      ))}

      {mode === "contractor" && list.map((v) => (
        <div className="var-item" key={v.id} data-testid={`variation-${v.id}`}>
          <div className="var-item-top">
            <b>
              {variationCategoryLabel(v.category, "painter")}
            </b>
            <span className={`chip ${v.status === "contractor_accepted" ? "grn" : v.status === "declined" ? "cly" : "amb"}`}>
              {v.status === "raised" ? "With the office"
                : v.status === "priced" ? "With the customer"
                : v.status === "customer_approved"
                  ? (v.credit
                      ? (v.needsManualDeduction && v.deductionCents == null ? "With the office" : "Acknowledge")
                      : v.released ? "Your approval" : "Approved — coming to you")
                : v.status === "contractor_accepted" ? (v.credit ? "Acknowledged" : "Accepted")
                : v.status === "declined" ? (v.contractorDeclined ? "Declined — with the office" : v.officeRejected ? "Not going ahead" : "Declined") : "Closed"}
            </span>
          </div>
          <p className="var-item-comment">{v.comment}</p>

          {/* Additions: the client has approved — the painter's own approval
              (Tom, 7 Oct 2026: amount and hours up front, Accept in big
              letters, Decline in small ones with a box for what should change). */}
          {!v.credit && v.status === "customer_approved" && v.released && (
            <div className="var-approved" data-testid={`approved-by-client-${v.id}`}>
              <p className="var-approved-head">Variation approved by the client</p>
              <p className="var-approved-figures">
                <b data-testid={`approved-amount-${v.id}`}>{v.contractorDeltaCents ? money(v.contractorDeltaCents) : "No pay change"}</b>
                <span data-testid={`approved-hours-${v.id}`}>{v.estHours != null ? `${v.estHours} hr${v.estHours === 1 ? "" : "s"} estimated` : "hours to be confirmed"}</span>
              </p>
              <button type="button" className="var-send var-accept-big" disabled={pending}
                onClick={() => accept(v.id)} data-testid={`accept-${v.id}`}>
                Accept {v.contractorDeltaCents ? money(v.contractorDeltaCents) : ""} — {v.estHours ?? "?"} hrs
              </button>
              {declining !== v.id ? (
                <button type="button" className="var-decline-small" disabled={pending}
                  onClick={() => { setDeclining(v.id); setDeclineNote(""); setMessage(null); }} data-testid={`decline-${v.id}`}>
                  Decline
                </button>
              ) : (
                <div className="var-decline-box" data-testid={`decline-box-${v.id}`}>
                  <label htmlFor={`decline-note-${v.id}`}>Please advise us of any further changes</label>
                  <textarea id={`decline-note-${v.id}`} rows={3} maxLength={1000} value={declineNote}
                    placeholder="What would need to change for you to take this on — the hours, the amount, the scope?"
                    onChange={(e) => setDeclineNote(e.target.value)} data-testid={`decline-note-${v.id}`} />
                  <div className="var-decline-acts">
                    <button type="button" className="var-send" disabled={pending} onClick={() => decline(v.id)} data-testid={`decline-send-${v.id}`}>Send to the office</button>
                    <button type="button" className="var-decline-small" disabled={pending} onClick={() => setDeclining(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {v.status === "declined" && v.contractorDeclined && (
            <p className="note" data-testid={`painter-declined-${v.id}`}>
              You declined this one — it is back with the office.{v.declineNote ? ` Your note: “${v.declineNote}”` : ""}
            </p>
          )}

          {v.status === "declined" && v.officeRejected && (
            <p className="note" data-testid={`office-rejected-${v.id}`}>
              The office isn&rsquo;t going ahead with this one.{v.officeRejectNote ? ` The office says: “${v.officeRejectNote}”` : ""}
            </p>
          )}

          {/* Credits: the customer owns the scope — acknowledge, no veto. */}
          {v.credit && v.status === "customer_approved" && (
            v.needsManualDeduction && v.deductionCents == null ? (
              <p className="note" data-testid={`deduction-pending-${v.id}`}>
                Work had started here, so the office is working out the pay
                adjustment — you&rsquo;ll see the figure before your invoice goes in.
              </p>
            ) : (
              <button type="button" className="var-send" disabled={pending}
                onClick={() => acknowledge(v.id)} data-testid={`acknowledge-${v.id}`}>
                Acknowledge — {creditDeduction(v) != null ? `− ${money(creditDeduction(v)!)}` : "no pay change"}
                {v.needsManualDeduction ? " (set by the office)" : ""}
              </button>
            )
          )}

          {v.status === "contractor_accepted" && !v.credit && v.contractorDeltaCents != null && (
            <p className="note" data-testid={`delta-${v.id}`}>
              {money(v.contractorDeltaCents)} added to your payment for this job.
            </p>
          )}
          {v.status === "contractor_accepted" && v.credit && (
            <p className="note" data-testid={`delta-${v.id}`}>
              {creditDeduction(v) != null && creditDeduction(v)! > 0
                ? `${money(creditDeduction(v)!)} comes off your payment for this job${v.needsManualDeduction ? " (set by the office)" : ""}.`
                : "No pay change for this one."}
              {v.deductionNote ? ` ${v.deductionNote}` : ""}
            </p>
          )}
        </div>
      ))}

      {(mode === "employee" ? employeeVariations.length === 0 : list.length === 0) && !open && (
        <p className="note">Nothing raised on this job. Found rot or damage? Tell the office before you work on it.</p>
      )}
    </div>
  );
}
