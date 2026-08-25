"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCustomerUpdateAction } from "../../actions";

/**
 * Tom (25 Aug): push an update to the client FROM THE JOB PAGE — words plus
 * the site photos that show it, emailed and texted with the link to their
 * job page. The dashboard's "update due" card is the reminder; this is the
 * button it points at.
 */
export default function UpdateComposer({ workOrderId, draftText, photos }: {
  workOrderId: string;
  /** The sweep's drafted text, if one is waiting — a starting point, not a cage. */
  draftText: string;
  photos: { id: string; url: string; caption: string }[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(draftText);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < 8) n.add(id);
      return n;
    });
  }

  function send() {
    setMessage(null);
    start(async () => {
      const r = await sendCustomerUpdateAction({
        workOrderId, body: body.trim(), photoIds: [...picked],
      });
      setMessage(r.message ?? null);
      if (r.ok) {
        setBody("");
        setPicked(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="card" data-testid="update-composer">
      <h3>Send the customer an update</h3>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="What's happened on site — plain words, the customer reads this."
        data-testid="update-body"
        style={{ width: "100%", marginTop: 8, background: "var(--ink, #0A0B0D)", color: "var(--text, #EDF0F2)", border: "1px solid var(--line, #242B32)", borderRadius: 10, padding: "10px 12px", font: "inherit", fontSize: 13, resize: "vertical" }}
      />
      {photos.length > 0 && (
        <>
          <p className="note" style={{ margin: "8px 0 4px" }}>
            Attach photos ({picked.size}/8) — tap to include:
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {photos.slice(0, 24).map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                title={p.caption} data-testid={`update-photo-${p.id}`}
                style={{
                  appearance: "none", padding: 0, cursor: "pointer", borderRadius: 8,
                  border: picked.has(p.id) ? "2px solid var(--cyan, #3BD8E9)" : "2px solid transparent",
                  opacity: picked.has(p.id) ? 1 : 0.75,
                }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || "Site photo"} width={64} height={64}
                  style={{ display: "block", width: 64, height: 64, objectFit: "cover", borderRadius: 6 }} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={pending || body.trim().length === 0}
          onClick={send} data-testid="send-update">
          {pending ? "Sending…" : `Send update${picked.size ? ` + ${picked.size} photo${picked.size === 1 ? "" : "s"}` : ""} — email & text`}
        </button>
      </div>
      {message && <p className="note" data-testid="update-composer-msg">{message}</p>}
    </div>
  );
}
