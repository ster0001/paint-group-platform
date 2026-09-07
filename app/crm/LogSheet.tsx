"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logContact } from "./recordActions";
import type { LogKind } from "./recordTypes";
import type { CrmResult } from "./actions";

/**
 * CRM v2 P2 — the log sheet (deep dive §4.1.5): what just happened with this
 * customer, in one tap from wherever you are. Outcome, a line, and "come back
 * to this on…". Inline on the record; a small "Log" button that opens the
 * same sheet on a Today item.
 */

const KINDS: Array<{ key: LogKind; label: string }> = [
  { key: "call_no_answer", label: "Called — no answer" },
  { key: "voicemail", label: "Left voicemail" },
  { key: "call_connected", label: "Spoke to customer" },
  { key: "email_logged", label: "Emailed" },
  { key: "sms_logged", label: "Texted" },
  { key: "note_added", label: "Note" },
];

const localDay = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD in the office's own zone
};

const PRESETS: Array<{ key: string; label: string; day: () => string | null }> = [
  { key: "none", label: "No reminder", day: () => null },
  { key: "tomorrow", label: "Tomorrow", day: () => localDay(1) },
  { key: "3d", label: "3 days", day: () => localDay(3) },
  { key: "week", label: "Next week", day: () => localDay(7) },
  { key: "date", label: "Pick a date", day: () => null },
];

export function LogSheetBody({ accountId, onDone, compact = false }: { accountId: string; onDone?: (r: CrmResult) => void; compact?: boolean }) {
  const [kind, setKind] = useState<LogKind>("call_no_answer");
  const [note, setNote] = useState("");
  const [preset, setPreset] = useState("none");
  const [day, setDay] = useState(localDay(1));
  const [said, setSaid] = useState<CrmResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  const followupDay = preset === "date" ? day : PRESETS.find((p) => p.key === preset)?.day() ?? null;

  const save = () => start(async () => {
    const r = await logContact(accountId, { kind, note, followupDay });
    setSaid(r);
    if (r.ok) {
      setNote("");
      setPreset("none");
      router.refresh();
      onDone?.(r);
    }
  });

  return (
    <div className={`logbody ${compact ? "compact" : ""}`} data-testid="log-sheet">
      <div className="chips">
        {KINDS.map((k) => (
          <button key={k.key} type="button" className={`chip ${kind === k.key ? "on" : ""}`} disabled={busy} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="field logta"
        rows={compact ? 2 : 3}
        placeholder={kind === "note_added" ? "The note" : "A line about it — what they said, what's next"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) save(); }}
      />
      <div className="logfollow">
        <span className="plabel" style={{ margin: 0 }}>Come back to this</span>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={`chip sm ${preset === p.key ? "on" : ""}`} disabled={busy} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
          {preset === "date" && (
            <input className="field datefield" type="date" value={day} min={localDay(0)} onChange={(e) => setDay(e.target.value)} aria-label="Follow-up date" />
          )}
        </div>
      </div>
      <div className="row">
        <button type="button" className="go" disabled={busy || (kind === "note_added" && !note.trim())} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        {said && <span className={`said ${said.ok ? "" : "bad"}`}>{said.message}</span>}
      </div>
    </div>
  );
}

/** The "Log" button: opens the sheet in a popover under itself. */
export default function LogSheet({ accountId, label = "Log" }: { accountId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span className="logwrap" ref={ref}>
      <button type="button" className="qgo logbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label}</button>
      {open && (
        <div className="logpop" role="dialog" aria-label="Log something">
          <LogSheetBody accountId={accountId} compact onDone={() => setTimeout(() => setOpen(false), 700)} />
        </div>
      )}
    </span>
  );
}
