"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";
import { markThreadReadAction, postMessageAction, signMessagePhotoAction } from "./messageActions";
import { declaredType, putToSignedSlot, shrinkImage, uploadFailureText, uploadingLabel } from "@/lib/workorder/uploadMedia";
import { MESSAGE_BUCKET, MESSAGE_MAX_CHARS, MESSAGE_MAX_PHOTOS, MESSAGE_PHOTO_TYPES, messageWhen, type MessageMode } from "@/lib/workorder/messageModel";
import type { JobPainter, ThreadView } from "@/lib/workorder/messagesLoad";
import "./messages.css";

/**
 * A project's messages between the office and ONE painter (Tom, 9 Oct 2026:
 * "a message box in PC Command in the project, to message the contractor …
 * photos can be attached from both sides").
 *
 * ONE component, two sides — `mode` "staff" on the PC job page, "painter" on
 * the portal job page. Staff pick whose thread (one per painter on the job)
 * and see, under each of their messages, what telling the painter came to;
 * the painter's page is never handed that line (the loader leaves it out).
 *
 * Opening a thread with something unread marks YOUR side read — that is what
 * clears the "<painter> replied" card on PC Command. Photos go phone → storage
 * through the same uploader as site photos (shrunk, progress, stall timer);
 * the bytes are checked on Send.
 */
type Staged = { key: string; name: string; preview: string; path: string | null; progress: number | null; error: string | null };

export default function MessageThread({
  mode, thread, painters = [], canWrite, cantWriteReason,
}: {
  mode: MessageMode;
  thread: ThreadView;
  /** Staff only: every painter this job has a thread for, or could. */
  painters?: JobPainter[];
  canWrite: boolean;
  cantWriteReason?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [sending, startSend] = useTransition();
  const [openAt, setOpenAt] = useState<{ messageId: string; index: number } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const previews = useRef<string[]>([]);

  // Seen it — your side only. Once per thread view with something unread.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!thread.threadId || !thread.unread || marked.current === thread.threadId) return;
    marked.current = thread.threadId;
    void markThreadReadAction({ threadId: thread.threadId });
  }, [thread.threadId, thread.unread]);

  useEffect(() => () => { for (const u of previews.current) URL.revokeObjectURL(u); }, []);

  const uploading = staged.some((s) => s.path === null && s.error === null);
  const ready = staged.flatMap((s) => (s.path ? [s.path] : []));

  async function addFiles(files: File[]) {
    const room = MESSAGE_MAX_PHOTOS - staged.length;
    if (room <= 0) { setStatus({ text: `Up to ${MESSAGE_MAX_PHOTOS} photos in one message.`, tone: "warn" }); return; }
    setStatus(null);
    for (const original of files.slice(0, room)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(original);
      previews.current.push(preview);
      setStaged((list) => [...list, { key, name: original.name, preview, path: null, progress: 0, error: null }]);
      const update = (patch: Partial<Staged>) => setStaged((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
      try {
        const file = await shrinkImage(original);
        const type = declaredType(file);
        if (!(MESSAGE_PHOTO_TYPES as readonly string[]).includes(type)) {
          update({ error: "Only photos can go in a message.", progress: null });
          continue;
        }
        const slot = await signMessagePhotoAction({ workOrderId: thread.workOrderId, contractorId: thread.contractorId, size: file.size, contentType: type });
        if (!slot.ok) { update({ error: slot.message, progress: null }); continue; }
        await putToSignedSlot(MESSAGE_BUCKET, slot, file, (f) => update({ progress: f }));
        update({ path: slot.path, progress: null });
      } catch (e) {
        update({ error: uploadFailureText(e, original), progress: null });
      }
    }
    if (files.length > room) setStatus({ text: `Only the first ${room} went on — up to ${MESSAGE_MAX_PHOTOS} photos in one message.`, tone: "warn" });
  }

  function remove(key: string) {
    setStaged((list) => list.filter((s) => s.key !== key));
  }

  function send() {
    const text = body.trim();
    if (!text && ready.length === 0) { setStatus({ text: "Write something or add a photo first.", tone: "warn" }); return; }
    startSend(async () => {
      const r = await postMessageAction({
        workOrderId: thread.workOrderId, contractorId: thread.contractorId, body: text, photoPaths: ready,
      });
      if (!r.ok) { setStatus({ text: r.message, tone: "warn" }); return; }
      setBody("");
      setStaged([]);
      if (mode === "painter") setStatus({ text: "Sent to the office.", tone: "ok" });
      else if (r.batched) setStatus({ text: "Sent. Covered by the text that just went — one per 10 minutes.", tone: "ok" });
      else setStatus({ text: `Sent. ${r.notify?.detail ?? ""}`.trim(), tone: r.notify?.status === "sent" || r.notify?.status === "queued" ? "ok" : "warn" });
      router.refresh();
    });
  }

  const active = painters.find((p) => p.contractorId === thread.contractorId);
  const lightbox: LightboxPhoto[] = openAt
    ? (thread.messages.find((m) => m.id === openAt.messageId)?.photos ?? []).map((p, i) => ({ id: `${openAt.messageId}-${i}`, url: p.url, alt: "Photo in a message", caption: "" }))
    : [];

  return (
    <div className="card msgbox" id="messages" data-testid="msg-box" data-mode={mode} data-thread={thread.threadId ?? ""}>
      <div className="msg-head">
        <b>Messages</b>
        <span className="msg-sub">
          {mode === "staff" ? (active ? `with ${active.name}` : "with the painter") : "with the office"}
        </span>
      </div>

      {mode === "staff" && painters.length > 1 && (
        <div className="msg-painters" role="tablist" aria-label="Whose messages">
          {painters.map((p) => (
            <Link key={p.contractorId} href={`?painter=${p.contractorId}#messages`} scroll={false} replace
              role="tab" aria-selected={p.contractorId === thread.contractorId}
              className={`msg-painter${p.contractorId === thread.contractorId ? " on" : ""}`}
              data-testid={`msg-painter-${p.contractorId}`}>
              {p.name}<em>{p.role}</em>{p.unread && <span className="msg-dot" aria-label="unread" />}
            </Link>
          ))}
        </div>
      )}

      {thread.failure && <p className="msg-note warn" role="status" data-testid="msg-failure">{thread.failure}</p>}
      {thread.more && <p className="msg-note">Older messages aren&rsquo;t shown — this is the latest 100.</p>}

      <div className="msg-list" data-testid="msg-list">
        {thread.messages.length === 0 && (
          <p className="msg-note" data-testid="msg-empty">
            {mode === "staff" ? "Nothing yet. What you write here goes to this painter only, and they're texted that there's a message." : "Nothing yet. Anything the office sends about this job lands here — and you can write to them."}
          </p>
        )}
        {thread.messages.map((m) => {
          const mine = m.side === (mode === "staff" ? "staff" : "painter");
          return (
            <div key={m.id} className={`msg${mine ? " mine" : ""}`} data-testid="msg-item" data-side={m.side}>
              <div className="msg-meta">
                <b>{m.side === "staff" ? (mode === "painter" ? `${m.authorName || "The office"} · Office` : m.authorName || "The office") : m.authorName || "Painter"}</b>
                <span>{messageWhen(m.at)}</span>
              </div>
              {m.body && <p className="msg-body" data-testid="msg-body">{m.body}</p>}
              {m.photos.length > 0 && (
                <div className="msg-photos">
                  {m.photos.map((p, i) => (
                    <button key={p.path} type="button" className="msg-photo" onClick={() => setOpenAt({ messageId: m.id, index: i })} data-testid="msg-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs: next/image would cache an expiring signature */}
                      <img src={p.url} alt="Photo in a message" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {m.notify && <p className="msg-notify" data-testid="msg-notify">{m.notify}</p>}
            </div>
          );
        })}
      </div>

      {canWrite ? (
        <div className="msg-compose">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MESSAGE_MAX_CHARS} rows={3}
            placeholder={mode === "staff" ? "Write to the painter about this job…" : "Write to the office about this job…"}
            aria-label="Your message" data-testid="msg-input" />
          {staged.length > 0 && (
            <div className="msg-staged">
              {staged.map((s) => (
                <div key={s.key} className={`msg-chip${s.error ? " bad" : ""}`} data-testid="msg-staged">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (object URL) */}
                  <img src={s.preview} alt="" />
                  <span>{s.error ?? (s.path ? "Ready" : uploadingLabel(s.progress))}</span>
                  <button type="button" onClick={() => remove(s.key)} aria-label={`Remove ${s.name}`}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* No `capture`: the phone offers the camera OR the library (Tom, 1 Sep). */}
          <input ref={fileInput} type="file" hidden multiple accept={MESSAGE_PHOTO_TYPES.join(",")}
            data-testid="msg-photo-input"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void addFiles(files); }} />
          <div className="msg-actions">
            <button type="button" className="msg-btn" onClick={() => fileInput.current?.click()}
              disabled={sending || staged.length >= MESSAGE_MAX_PHOTOS} data-testid="msg-attach">📷 Add photos</button>
            <button type="button" className="msg-btn msg-primary" onClick={send}
              disabled={sending || uploading || (!body.trim() && ready.length === 0)} data-testid="msg-send">
              {sending ? "Sending…" : uploading ? "Photos uploading…" : "Send"}
            </button>
          </div>
        </div>
      ) : (
        cantWriteReason && <p className="msg-note">{cantWriteReason}</p>
      )}
      {status && <p className={`msg-note ${status.tone}`} role="status" data-testid="msg-status">{status.text}</p>}

      <PhotoLightbox photos={lightbox} openAt={openAt ? openAt.index : null}
        onClose={() => setOpenAt(null)} onNavigate={(i) => setOpenAt((o) => (o ? { ...o, index: i } : o))} />
    </div>
  );
}
