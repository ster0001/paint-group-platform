"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setTemperature, snooze } from "@/app/crm/actions";

/**
 * The Pipeline card's ⋯ menu (brief §4.2, ⚑5): temperature and snooze, through
 * the CRM's own actions (`crm_set_temperature`, `crm_snooze`). Both are about
 * the customer, so every estimate they hold changes with it (ruling E‑E).
 */
export default function PipelineCardMenu({ accountId, testId }: { accountId: string; testId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, start] = useTransition();
  const run = (p: Promise<{ ok: boolean; message: string }>) => start(async () => {
    const r = await p.catch(() => ({ ok: false, message: "That didn't save — try again." }));
    setSaid(r.message);
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  const btn = "block w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-100 disabled:opacity-50";
  return (
    <div className="absolute right-1 top-1">
      <button type="button" aria-label="Temperature and snooze" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" data-testid={testId}>⋯</button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white p-1 shadow-lg" data-testid={`${testId}-panel`}>
          <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Temperature</p>
          {(["hot", "warm", "cold"] as const).map((t) => (
            <button key={t} type="button" disabled={busy} className={`${btn} capitalize`} onClick={() => run(setTemperature(accountId, t))} data-testid={`${testId}-${t}`}>{t}</button>
          ))}
          <p className="px-2 pt-2 text-[10px] uppercase tracking-wide text-gray-400">Snooze</p>
          {[1, 3, 7].map((d) => (
            <button key={d} type="button" disabled={busy} className={btn} onClick={() => run(snooze(accountId, d, ""))} data-testid={`${testId}-snooze-${d}`}>{d} day{d === 1 ? "" : "s"}</button>
          ))}
          <form className="flex items-center gap-1 px-2 py-1" onSubmit={(e) => { e.preventDefault(); const n = Number(custom); if (n >= 1) run(snooze(accountId, n, "")); }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder="days" className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs" aria-label="Snooze for this many days" />
            <button type="submit" disabled={busy} className="text-xs text-cyan-700 hover:underline">Snooze</button>
          </form>
          {said && <p className="px-2 pb-1 text-[11px] text-gray-500" role="status">{said}</p>}
        </div>
      )}
    </div>
  );
}
