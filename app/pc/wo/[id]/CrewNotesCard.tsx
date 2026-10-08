"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCrewNotes } from "../../actions";

/**
 * Further instructions for the crew, written from PC Command (Tom, 8 Oct 2026).
 *
 * The same field the estimate builder's work-order tab edits —
 * work_orders.crew_notes — and the same words the painter sees under
 * "Further instructions for the crew" on their job sheet. Saving goes through
 * wo_set_crew_notes (20270244); the sheet follows the column in the same
 * statement, so there is no second copy to keep in step by hand.
 */
export default function CrewNotesCard({
  workOrderId, notes, sheetNotes, canEdit,
}: {
  workOrderId: string;
  /** What the office has written (work_orders.crew_notes). */
  notes: string;
  /** What the painter's issued sheet says today, when it differs. */
  sheetNotes: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(notes);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = draft.trim() !== notes.trim();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const r = await setCrewNotes({ workOrderId, notes: draft });
      setMessage(r.message ?? (r.ok ? "Saved." : "Couldn't save."));
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="card" data-testid="crew-notes-card">
      <h3>Further instructions for the crew</h3>
      <p className="note">
        Shown at the top of the painter&rsquo;s work order. Saving updates the
        job sheet they already have — the same note the builder&rsquo;s work
        order tab edits.
      </p>
      {sheetNotes != null && (
        <p className="note" data-testid="crew-notes-sheet" style={{ color: "var(--amber)" }}>
          The painter&rsquo;s sheet currently says: &ldquo;{sheetNotes || "nothing"}&rdquo;. Save to replace it with the text below.
        </p>
      )}
      {canEdit ? (
        <>
          <textarea
            className="edit"
            rows={4}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything the crew needs to know for this job…"
            aria-label="Further instructions for the crew"
            data-testid="crew-notes-input"
          />
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn primary"
              onClick={save}
              disabled={pending || (!dirty && sheetNotes == null)}
              data-testid="crew-notes-save"
            >
              {pending ? "Saving…" : "Save to the work order"}
            </button>
            {message && <span className="note" role="status" data-testid="crew-notes-msg">{message}</span>}
          </div>
        </>
      ) : (
        <p data-testid="crew-notes-text" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {notes || <span className="note">None written.</span>}
        </p>
      )}
    </div>
  );
}
