"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isVideoFile, uploadFailureText, uploadWorkOrderMedia, type UploadKind } from "@/lib/workorder/uploadMedia";

/**
 * Tom, 30 Sep 2026: "a 'Step 1 · upload before photos' button — they will be
 * using this on their phone — allow them to upload multiple images using
 * their camera or files on the phone." Tom, 1 Oct (Saulius, Cootamundra:
 * photos chosen, never sent — the second "Done" press was the trap): ONE
 * tap. The big green button opens the phone's picker (camera or library,
 * multi-select) and the moment the picks come back they upload, one after
 * another, with "2 of 5 · 43%" on the button. Nothing to confirm. A file
 * that fails stays listed with Retry; when the last one lands the page
 * refreshes so the server's own gate opens the next step.
 */
type Item = { id: number; file: File; status: "queued" | "uploading" | "done" | "failed"; progress: number; error?: string };

export default function BatchUploader({
  workOrderId, kind, title, hint, areas = [], testId = "batch", buttonLabel = "Upload photos",
  onUploaded,
}: {
  workOrderId: string;
  kind: UploadKind;
  title: string;
  hint: string;
  /** Optional area chips — a batch can be tagged with one; blank = the whole job. */
  areas?: string[];
  testId?: string;
  buttonLabel?: string;
  /** Called with how many landed once a batch finishes with nothing failed. */
  onUploaded?: (count: number) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [area, setArea] = useState("");
  const [running, setRunning] = useState(false);
  const [uploadedTotal, setUploadedTotal] = useState(0);
  const nextId = useRef(1);

  const patch = (id: number, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));

  /** Upload these items in order. Called the moment the picker returns, and by Retry. */
  async function run(batch: Item[]) {
    if (running || batch.length === 0) return;
    setRunning(true);
    let landed = 0;
    let anyFailed = false;
    for (const item of batch) {
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
    // The page re-reads the job: the server's gate is what unlocks the next step.
    if (landed > 0) router.refresh();
    if (!anyFailed && landed > 0) onUploaded?.(landed);
  }

  function picked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const add: Item[] = Array.from(files).map((file) => ({ id: nextId.current++, file, status: "queued", progress: 0 }));
    setItems((cur) => [...cur, ...add]);
    void run(add);
  }

  const failed = items.filter((i) => i.status === "failed");
  const doneCount = items.filter((i) => i.status === "done").length;
  const inFlight = items.find((i) => i.status === "uploading");
  const total = items.length;
  const allLanded = total > 0 && !running && failed.length === 0;

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
        onChange={(e) => { picked(e.target.files); e.target.value = ""; }} />

      <button type="button" className="btn-upload" disabled={running} onClick={() => input.current?.click()} data-testid={`${testId}-pick`}>
        {running
          ? `Uploading ${Math.min(doneCount + 1, total)} of ${total}${inFlight ? ` · ${Math.round(inFlight.progress * 100)}%` : ""}`
          : `📷 ${buttonLabel}${allLanded ? " — add more" : ""}`}
      </button>

      {allLanded && (
        <p className="tick-msg ok" role="status" data-testid={`${testId}-message`}>
          ✓ {uploadedTotal} uploaded. {kind === "before" ? "The scope below is unlocking — tick away." : "Thanks — carry on below."}
        </p>
      )}

      {(running || failed.length > 0) && (
        <ul className="batch-list" data-testid={`${testId}-list`}>
          {items.filter((i) => i.status !== "done").map((i) => (
            <li key={i.id} className={`batch-item ${i.status}`} data-testid={`${testId}-item`} data-status={i.status}>
              <span className="batch-name">{isVideoFile(i.file) ? "🎬" : "🖼"} {i.file.name}</span>
              <span className="batch-state">
                {i.status === "queued" && "waiting"}
                {i.status === "uploading" && `${Math.round(i.progress * 100)}%`}
                {i.status === "failed" && <button type="button" className="batch-retry" onClick={() => void run([i])} disabled={running} data-testid={`${testId}-retry`}>Retry</button>}
              </span>
              {i.status === "failed" && i.error && <span className="batch-err">{i.error}</span>}
              {i.status === "failed" && (
                <button type="button" className="batch-x" aria-label="Remove" onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 1 && !running && (
        <button type="button" className="btn" onClick={() => void run(failed)} data-testid={`${testId}-retry-all`} style={{ marginTop: 8 }}>
          Retry the {failed.length} that didn&rsquo;t upload
        </button>
      )}
    </div>
  );
}
