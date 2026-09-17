"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordTimesheetAction } from "./actions";

export type PainterOption = { id: string; name: string; jobs: { id: string; label: string }[] };

/** The office records a day on a painter's behalf. Lands submitted — approval is still its own click. */
export default function RecordHours({ painters, today }: { painters: PainterOption[]; today: string }) {
  const router = useRouter();
  const [painter, setPainter] = useState(painters[0]?.id ?? "");
  const [job, setJob] = useState(painters[0]?.jobs[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("07:30");
  const [finish, setFinish] = useState("15:30");
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const jobs = painters.find((p) => p.id === painter)?.jobs ?? [];

  if (painters.length === 0) return <p className="empty">No employed painters yet.</p>;

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const r = await recordTimesheetAction({ contractorId: painter, workOrderId: job, date, start, finish, breakMinutes });
      setMessage(r.message ?? (r.ok ? "Recorded." : null));
      if (r.ok) router.refresh();
    });
  }

  return (
    <div data-testid="record-hours">
      <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
        <select className="num" style={{ width: 180 }} value={painter} data-testid="record-painter"
          onChange={(e) => { setPainter(e.target.value); setJob(painters.find((p) => p.id === e.target.value)?.jobs[0]?.id ?? ""); }}>
          {painters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="num" style={{ width: 260 }} value={job} onChange={(e) => setJob(e.target.value)} data-testid="record-job">
          {jobs.length === 0 && <option value="">Not on a job</option>}
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
        <input className="num" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="record-date" />
        <input className="num" type="time" value={start} onChange={(e) => setStart(e.target.value)} data-testid="record-start" />
        <input className="num" type="time" value={finish} onChange={(e) => setFinish(e.target.value)} data-testid="record-finish" />
        <select className="num" style={{ width: 120 }} value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))} data-testid="record-break">
          <option value={0}>no break</option>
          <option value={30}>30 min</option>
          <option value={45}>45 min</option>
          <option value={60}>60 min</option>
        </select>
        <button type="button" className="btn primary" disabled={pending || !job} onClick={submit} data-testid="record-submit">
          {pending ? "Saving…" : "Record"}
        </button>
      </div>
      {message && <p className="note" data-testid="record-msg">{message}</p>}
    </div>
  );
}
