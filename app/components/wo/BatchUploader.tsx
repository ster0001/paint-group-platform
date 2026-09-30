"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isVideoFile, uploadFailureText, uploadWorkOrderMedia, type UploadKind } from "@/lib/workorder/uploadMedia";

/**
 * Tom, 30 Sep 2026: "a 'Step 1 · upload before photos' button — they will be
 * using this on their phone — allow them to upload multiple images using
 * their camera or files on the phone, followed by clicking Done to upload
 * them in one batch."
 *
 * One tap opens the phone's own picker with multi-select (camera or library —
 * no `capture`, so the OS offers both). The picks queue on the card with a
 * count; Done sends them one after another through the one upload path,
 * showing "3 of 8", and a file that fails stays in the list with Retry so
 * nothing is lost to a bad patch of signal. When the last one lands the page
 * refreshes, so the server's own gate opens the next step.
 */
type Item = { id: number; file: File; status: "queued" | "uploading" | "done" | "failed"; progress: number; error?: string };

export default function BatchUploader({
  workOrderId, kind, title, hint, areas = [], doneLabel = "Done — upload them", testId = "batch",
  onUploaded,
}: {
  workOrderId: string;
  kind: UploadKind;
  title: string;
  hint: string;
  /** Optional area chips — a batch can be tagged with one; blank = the whole job. */
  areas?: string[];
  doneLabel?: string;
  testId?: string;
  /** Called with how many landed once a Done run finishes with nothing failed. */
  onUploaded?: (count: number) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [area, setArea] = useState("");
  const [running, setRunning] = useState(false);
  const [uploadedTotal, setUploadedTotal] = useState(0);
  const nextId = useRef(1);

  const queued = items.filter((i) => i.status === "queued" || i.status === "failed");
  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const add: Item[] = Array.from(files).map((file) => ({ id: nextId.current++, file, status: "queued", progress: 0 }));
    setItems((cur) => [...cur, ...add]);
  }

  const patch = (id: number, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function run() {
    if (running) return;
    setRunning(true);
    let landed = 0;
    let anyFailed = false;
    for (const item of items) {
      if (item.status === "done" || item.status === "uploading") continue;
      patch(item.id, { status: "uploading", progress: 0, error: undefined });
      try {
        await uploadWorkOrderMedia({ workOrderId, file: item.file, kind, area, onProgress: (f) => patch(item.id, { progress: f }) });
        patch(item.id, { status: "done", progress: 1 });
        landed += 1;
      } catch (e) {
        anyFailed = true;
        patch(item.id, { status: "failed", error: uploadFailureText(e, item.file) });
      }
    }
    setRunning(false);
    setUploadedTotal((n) => n + landed);
    if (landed > 0) router.refresh();
    if (!anyFailed && landed > 0) onUploaded?.(landed);
  }

  const total = items.length;
  const inFlight = items.find((i) => i.status === "uploading");

  return (
    <div className="card batch" data-testid={`${testId}-uploader`}>
      <div className="tick-head"><b>{title}</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>{hint}</p>

      {areas.length > 0 && (
        <div className="var-chips" style={{ marginTop: 10 }}>
          <button type="button" className={`var-chip ${area === "" ? "on" : ""}`} onClick={() => setArea("")} data-testid={`${testId}-area-all`}>Whole job</button>
          {areas.map((a) => (
            <button key={a} type="button" className={`var-chip ${area === a ? "on" : ""}`} onClick={() => setArea(a)} data-testid={`${testId}-area-${a}`}>{a}</button>
          ))}
        </div>
      )}

      <input ref={input} type="file" hidden multiple
        accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
        data-testid={`${testId}-input`}
        onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />

      <button type="button" className="var-photo" disabled={running} onClick={() => input.current?.click()} data-testid={`${testId}-pick`}>
        📷 {total === 0 ? "Take photos or choose from your phone" : "Add more"}
      </button>

      {total > 0 && (
        <ul className="batch-list" data-testid={`${testId}-list`}>
          {items.map((i) => (
            <li key={i.id} className={`batch-item ${i.status}`} data-testid={`${testId}-item`} data-status={i.status}>
              <span className="batch-name">{isVideoFile(i.file) ? "🎬" : "🖼"} {i.file.name}</span>
              <span className="batch-state">
                {i.status === "queued" && "ready"}
                {i.status === "uploading" && `${Math.round(i.progress * 100)}%`}
                {i.status === "done" && "✓"}
                {i.status === "failed" && <button type="button" className="batch-retry" onClick={() => void run()} disabled={running}>Retry</button>}
              </span>
              {i.status === "failed" && i.error && <span className="batch-err">{i.error}</span>}
              {i.status !== "uploading" && i.status !== "done" && (
                <button type="button" className="batch-x" aria-label="Remove" onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(queued.length > 0 || running) && (
        <button type="button" className="btn" disabled={running || queued.length === 0} onClick={() => void run()} data-testid={`${testId}-done`} style={{ marginTop: 10 }}>
          {running
            ? `Uploading ${Math.min(doneCount + 1, total)} of ${total}${inFlight ? ` · ${Math.round(inFlight.progress * 100)}%` : ""}`
            : failedCount > 0 ? `Retry ${failedCount} that didn't upload` : `${doneLabel} (${queued.length})`}
        </button>
      )}
      {!running && uploadedTotal > 0 && queued.length === 0 && (
        <p className="tick-msg ok" role="status" data-testid={`${testId}-message`}>{uploadedTotal} uploaded. {kind === "before" ? "The scope below is unlocked — tick away." : "Thanks — carry on below."}</p>
      )}
    </div>
  );
}
