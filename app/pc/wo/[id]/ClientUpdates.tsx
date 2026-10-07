"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addClientUpdateNote } from "../../actions";

/**
 * Tom, 7 Oct 2026 (PC Command item 5): "a client updates notes box, where
 * Felipe can log in PC Command — all of this information should appear as a
 * timeline, and also update in the customer CRM."
 *
 * The timeline below is DERIVED: the customer updates that went out (wo_updates
 * approved / sent) and the notes the office logged here (wo_events
 * 'client_update_note'). The note is also written to the customer's CRM record
 * as a Note (crm_events note_added, origin client_update) by the action.
 */
export type ClientTimelineEntry = {
  id: string;
  kind: "sent" | "approved" | "note";
  at: string;
  body: string;
  who: string | null;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", {
  timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

export default function ClientUpdates({ workOrderId, entries, failures }: { workOrderId: string; entries: ClientTimelineEntry[]; failures: string[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [added, setAdded] = useState<ClientTimelineEntry[]>([]);
  const all = [...added, ...entries];

  function save() {
    const text = body.trim();
    if (text.length < 2) { setMessage("Write what the client was told — a line is plenty."); return; }
    setMessage(null);
    start(async () => {
      const r = await addClientUpdateNote({ workOrderId, body: text });
      if (!r.ok) { setMessage(r.message); return; }
      setAdded((a) => [{ id: `local:${Date.now()}`, kind: "note", at: new Date().toISOString(), body: text, who: "you" }, ...a]);
      setBody("");
      setMessage(r.message ?? "Logged.");
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="client-updates">
      <h3>Client updates <em>what they have been told</em></h3>
      <div className="stack" style={{ gap: 8 }}>
        <textarea rows={3} maxLength={2000} value={body} placeholder="Rang Sarah — happy with the hallway colour, asked about the front door timing. Told her Thursday."
          onChange={(e) => setBody(e.target.value)} data-testid="client-note-body" />
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn primary" disabled={pending} onClick={save} data-testid="client-note-save">
            {pending ? "Saving…" : "Log it — job timeline + customer record"}
          </button>
          {message && <span className="note" data-testid="client-note-msg">{message}</span>}
        </div>
      </div>
      {failures.length > 0 && (
        <p className="note" data-testid="client-updates-failure">Couldn&rsquo;t read {failures.join(" and ")} — the timeline may be incomplete. It has been reported.</p>
      )}
      <ol className="client-timeline" data-testid="client-timeline" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
        {all.length === 0 && failures.length === 0 && (
          <li className="note" data-testid="client-timeline-empty">Nothing yet. Updates sent to the customer and notes logged here will line up below, newest first.</li>
        )}
        {all.map((e) => (
          <li key={e.id} data-testid={`client-timeline-${e.kind}`} style={{ display: "grid", gridTemplateColumns: "118px 1fr", gap: 10, alignItems: "baseline" }}>
            <span className="note" style={{ whiteSpace: "nowrap" }}>{when(e.at)}</span>
            <span>
              <span className="pill" style={{ marginRight: 8 }}>{e.kind === "sent" ? "Update sent" : e.kind === "approved" ? "Update approved" : `Note${e.who ? ` · ${e.who}` : ""}`}</span>
              {e.body}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
