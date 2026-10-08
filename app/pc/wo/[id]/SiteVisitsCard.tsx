"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSiteVisitNote, markSiteVisitVisited, removeSiteVisit, scheduleSiteVisit, sendSiteVisitNote,
} from "../../actions";
import { noteShareLine, SITE_VISIT_BUCKET, SITE_VISIT_NOTE_MAX, type SiteVisit } from "@/lib/workorder/siteVisits";

/**
 * Site check-ins on the PC job page (Tom, 9 Oct 2026):
 *   "a site check in isn't documented as pass or fail, but progress notes can
 *    be made with the option to send to the painter, and also attach photos"
 *
 * Each visit: its day and time (movable until it is visited), the calendar
 * invite line, "Mark visited" (what clears its PC Command card), and its
 * notes — each with author and time, photos, and whether the painter was sent
 * it, in words. A note is office-only unless "Send to the painter" is ticked
 * (or pressed later); the customer never sees any of it.
 */
const when = (iso: string) => new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
}).format(new Date(iso));
const dayWords = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

async function uploadPhoto(visitId: string, noteId: string, file: File): Promise<void> {
  const signRes = await fetch("/api/wo/site-visits/photos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitId, size: file.size, contentType: file.type }),
  });
  const sign = await signRes.json();
  if (!signRes.ok) throw new Error(sign.error ?? "We couldn't start that upload.");
  const put = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${SITE_VISIT_BUCKET}/${sign.path}?token=${sign.token}`,
    { method: "PUT", body: file, headers: { "Content-Type": file.type } },
  );
  if (!put.ok) throw new Error("The upload didn't finish — try again.");
  const ingest = await fetch("/api/wo/site-visits/photos", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteId, path: sign.path }),
  });
  const done = await ingest.json();
  if (!ingest.ok) throw new Error(done.error ?? "We couldn't file that photo.");
}

function Visit({ visit, painter, closed }: { visit: SiteVisit; painter: string | null; closed: boolean }) {
  const router = useRouter();
  const files = useRef<HTMLInputElement | null>(null);
  const [body, setBody] = useState("");
  const [send, setSend] = useState(false);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(visit.date ?? "");
  const [time, setTime] = useState(visit.time ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function addNote() {
    setBusy(true); setMessage(null);
    try {
      const r = await addSiteVisitNote({ visitId: visit.id, body, sendToPainter: send });
      if (!r.ok || !r.noteId) { setMessage(r.message ?? "The note didn't save."); return; }
      const picked = Array.from(files.current?.files ?? []);
      const failed: string[] = [];
      for (const f of picked) {
        try { await uploadPhoto(visit.id, r.noteId, f); } catch (e) { failed.push(e instanceof Error ? e.message : "a photo didn't upload"); }
      }
      let msg = picked.length ? `Note saved with ${picked.length - failed.length} of ${picked.length} photo${picked.length === 1 ? "" : "s"}.` : "Note saved.";
      if (failed.length) msg += ` ${failed[0]}`;
      if (send) {
        const s = await sendSiteVisitNote({ noteId: r.noteId });
        msg += ` ${s.message ?? ""}`;
      }
      setMessage(msg.trim());
      setBody(""); setSend(false);
      if (files.current) files.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => startTransition(async () => {
    setMessage(null);
    const r = await fn();
    setMessage(r.message ?? null);
    if (r.ok) router.refresh();
  });

  return (
    <div className="tick" style={{ display: "block", paddingTop: 10 }} data-testid={`site-visit-${visit.id}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <b>{visit.date ? `${dayWords(visit.date)}${visit.time ? ` at ${visit.time}` : ""}` : "No day yet"}</b>
        {visit.visitedAt
          ? <span className="pill p-cy" data-testid="site-visit-visited">Visited {when(visit.visitedAt)}{visit.visitedBy ? ` · ${visit.visitedBy}` : ""}</span>
          : <span className="pill">Not visited yet</span>}
      </div>
      {visit.invite && (
        <p className="note" style={{ margin: "4px 0 0" }}>
          {visit.invite.outcome === "nobody" ? "No calendar invite — nobody is ticked for \"QA invite\" in Settings → Staff alerts."
            : visit.invite.outcome === "not_configured" ? "No calendar invite — email is not set up on this site."
            : visit.invite.outcome === "error" ? "Calendar invite FAILED — it is retried automatically."
            : `Calendar invite ${visit.invite.method === "CANCEL" ? "cancelled" : "sent"}${visit.invite.at ? ` ${when(visit.invite.at)}` : ""}.`}
        </p>
      )}

      {!closed && !visit.visitedAt && (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn primary" disabled={pending} data-testid="site-visit-mark"
            onClick={() => act(() => markSiteVisitVisited({ visitId: visit.id }))}>
            Mark visited
          </button>
          {moving ? (
            <>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" style={{ fontSize: 13 }} />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={900} aria-label="Time" style={{ fontSize: 13 }} />
              <button type="button" className="btn" disabled={pending || !date || !time}
                onClick={() => act(async () => { const r = await scheduleSiteVisit({ visitId: visit.id, date, time }); if (r.ok) setMoving(false); return r; })}>
                Save
              </button>
              <button type="button" className="btn dim" onClick={() => setMoving(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn dim" onClick={() => setMoving(true)}>Move</button>
          )}
          {visit.notes.length === 0 && (
            <button type="button" className="btn dim" disabled={pending}
              onClick={() => act(() => removeSiteVisit({ visitId: visit.id }))}>
              Remove
            </button>
          )}
        </div>
      )}

      {visit.notes.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {visit.notes.map((n) => (
            <div key={n.id} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10 }} data-testid={`site-visit-note-${n.id}`}>
              <p className="note" style={{ margin: 0, opacity: .75 }}>{n.author ?? "The office"} · {when(n.createdAt)}</p>
              <p style={{ margin: "2px 0", whiteSpace: "pre-wrap" }} data-testid="site-visit-note-body">{n.body}</p>
              {n.photos.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "4px 0" }}>
                  {n.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" data-testid="site-visit-note-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="Site check-in photo" style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8 }} />
                    </a>
                  ))}
                </div>
              )}
              <p className="note" style={{ margin: 0 }} data-testid="site-visit-note-share">{noteShareLine(n, when)}</p>
              {n.sentOutcome !== "sent" && (
                <button type="button" className="btn dim" style={{ marginTop: 4 }} disabled={pending}
                  data-testid="site-visit-note-send"
                  onClick={() => act(() => sendSiteVisitNote({ noteId: n.id }))}>
                  {n.sendToPainter ? "Try sending again" : "Send to the painter"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={SITE_VISIT_NOTE_MAX}
          placeholder="Progress notes from the visit — what you saw, what needs doing"
          aria-label="Progress note" data-testid="site-visit-note-input" style={{ fontSize: 13 }} />
        <input ref={files} type="file" accept="image/*" multiple aria-label="Photos" data-testid="site-visit-note-photos" disabled={busy} />
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} data-testid="site-visit-note-send-tick" />
          Send to the painter{painter ? ` (${painter})` : ""} — a text and an email with the note; it shows on their job page
        </label>
        <button type="button" className="btn primary" style={{ justifySelf: "start" }} disabled={busy || !body.trim()}
          data-testid="site-visit-note-add" onClick={() => void addNote()}>
          {busy ? "Saving…" : "Add note"}
        </button>
      </div>
      {message && <p className="note" style={{ color: "var(--amber)", margin: "6px 0 0" }} role="status" data-testid="site-visit-msg">{message}</p>}
    </div>
  );
}

export default function SiteVisitsCard({
  visits, painter, closed, failure,
}: { visits: SiteVisit[]; painter: string | null; closed: boolean; failure: string | null }) {
  if (visits.length === 0 && !failure) return null;
  return (
    <div className="card" id="site-visits" data-testid="site-visits-card">
      <h3>Site check-ins <em>your own visits — no pass or fail</em></h3>
      <p className="note">
        Only the office sees these. They never hold the job up and the customer is never told.
        A note goes to the painter only when you tick &ldquo;Send to the painter&rdquo;.
      </p>
      {failure && <p className="note" style={{ color: "var(--amber)" }} data-testid="site-visits-failure">{failure}</p>}
      {visits.map((v) => <Visit key={v.id} visit={v} painter={painter} closed={closed} />)}
    </div>
  );
}
