"use client";

import { useRef, useState, useTransition } from "react";
import { acceptVariationAction, acknowledgeVariationAction, raiseVariationAction } from "./variationActions";
import { VARIATION_CATEGORIES, type VariationStatus } from "@/lib/workorder/variations";

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
};

/**
 * The contractor's variations: raise one, and accept the adjusted offer when
 * both approvals are in.
 *
 * Photos are taken FIRST and uploaded before the variation is raised, because
 * the server refuses a variation with no evidence — so the form asks for them
 * up front rather than failing at the end.
 */
export default function Variations({
  workOrderId, variations,
}: { workOrderId: string; variations: VariationView[] }) {
  const [list, setList] = useState(variations);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(VARIATION_CATEGORIES[0].code);
  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadPhoto(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const signRes = await fetch("/api/wo/photos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, size: file.size }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error ?? "upload");

      const put = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
        { method: "PUT", body: file },
      );
      if (!put.ok) throw new Error("upload");

      const ingest = await fetch("/api/wo/photos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, path: sign.path, kind: "variation" }),
      });
      const done = await ingest.json();
      if (!ingest.ok) throw new Error(done.error ?? "upload");
      setPhotoIds((ids) => [...ids, done.id]);
    } catch (e) {
      setMessage(e instanceof Error && e.message !== "upload" ? e.message : "That photo didn't upload — try again.");
    } finally {
      setUploading(false);
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

          <input
            ref={fileInput} type="file" hidden capture="environment"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPhoto(f); }}
          />
          <button type="button" className="var-photo" onClick={() => fileInput.current?.click()}
            disabled={uploading} data-testid="variation-photo">
            {uploading ? "Uploading…" : photoIds.length === 0
              ? "📷 Photos — needed before this can go to the office"
              : `📷 ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"} added — take another`}
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

      {list.map((v) => (
        <div className="var-item" key={v.id} data-testid={`variation-${v.id}`}>
          <div className="var-item-top">
            <b>
              {v.category === "scope_removed" ? "Removed from scope"
                : VARIATION_CATEGORIES.find((c) => c.code === v.category)?.label ?? v.category}
            </b>
            <span className={`chip ${v.status === "contractor_accepted" ? "grn" : v.status === "declined" ? "cly" : "amb"}`}>
              {v.status === "raised" ? "With the office"
                : v.status === "priced" ? "With the customer"
                : v.status === "customer_approved"
                  ? (v.credit
                      ? (v.needsManualDeduction && v.deductionCents == null ? "With the office" : "Acknowledge")
                      : v.released ? "Your approval" : "Approved — coming to you")
                : v.status === "contractor_accepted" ? (v.credit ? "Acknowledged" : "Accepted")
                : v.status === "declined" ? "Declined" : "Closed"}
            </span>
          </div>
          <p className="var-item-comment">{v.comment}</p>

          {/* Additions: the existing accept (both approvals, in order). */}
          {!v.credit && v.status === "customer_approved" && v.released && (
            <button type="button" className="var-send" disabled={pending}
              onClick={() => accept(v.id)} data-testid={`accept-${v.id}`}>
              Accept {v.contractorDeltaCents ? money(v.contractorDeltaCents) : ""} — {v.estHours ?? "?"} hrs
            </button>
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

      {list.length === 0 && !open && (
        <p className="note">Nothing raised on this job. Found rot or damage? Tell the office before you work on it.</p>
      )}
    </div>
  );
}
