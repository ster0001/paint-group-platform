"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ContractorRow } from "@/lib/painterStatus/contractorsView";
import { addQaCheck } from "../actions";

/**
 * The rows of PC Command → Contractors (brief §7). Tap a row: the last 10
 * jobs as dots (tap one for why), the bonus history (staff only, ⚑13),
 * Spot check on a job under way (R13) and Log call back — which opens the
 * route 3 form on one of the painter's FINISHED jobs; never a fifth route.
 */
const COLOUR: Record<string, string> = { new: "New", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red" };
const ARROW = { better: "↑", worse: "↓", same: "→" } as const;
const ARROW_LABEL = { better: "better than last month", worse: "worse than last month", same: "same as last month" } as const;
const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" }) : "");

export default function ContractorRows({ rows }: { rows: ContractorRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [dot, setDot] = useState<string | null>(null);
  const [spotFor, setSpotFor] = useState<string | null>(null);
  const [cbFor, setCbFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (rows.length === 0) return <p className="empty">No active painters.</p>;
  return (
    <div className="ctr-rows" data-testid="contractor-rows" data-count={rows.length}>
      {rows.map((r) => {
        const isOpen = open === r.id;
        return (
          <div key={r.id}>
            <button type="button" className="ctr-row" aria-expanded={isOpen} data-testid={`painter-status-row-${r.id}`} data-colour={r.colour ?? "none"}
              onClick={() => { setOpen(isOpen ? null : r.id); setDot(null); setSpotFor(null); setCbFor(null); setMsg(null); }}>
              <div className="ctr-head">
                <span className={`stl ${r.colour ? `stl-${r.colour}` : ""}`}>{r.colour ? COLOUR[r.colour].toUpperCase() : "NOT EVALUATED"}{r.offersBlocked ? " · NO OFFERS" : ""}</span>
                <b className="grow">{r.name}</b>
                <span className="num" title={ARROW_LABEL[r.trend]} aria-label={ARROW_LABEL[r.trend]} data-testid={`trend-${r.id}`}>{ARROW[r.trend]}</span>
              </div>
              <div className="ctr-mini">
                {[["Checks", r.checks], ["App", r.app], ["Call backs", String(r.callbacks)], ["Streak", String(r.streak)]].map(([l, v]) => (
                  <span key={l}><span className="k">{l}</span><b>{v}</b></span>
                ))}
              </div>
              {r.tags.length > 0 && (
                <div className="ctr-tags">{r.tags.map((t) => <span key={t.text} className={`ctr-tag ${t.tone}`}>{t.text}</span>)}</div>
              )}
            </button>
            {isOpen && (
              <div className="ctr-sheet" data-testid={`painter-sheet-${r.id}`}>
                <div className="k">{r.name} · last 10 jobs</div>
                <div className="ctr-dots">
                  {r.lastTen.map((j) => (
                    <button key={j.workOrderId} type="button" className={`ctr-dot ${j.result === "clean" ? "ok" : "slip"}`} aria-pressed={dot === j.workOrderId}
                      aria-label={`${j.title}, ${j.result === "clean" ? "clean" : "not clean"}`} onClick={() => setDot(dot === j.workOrderId ? null : j.workOrderId)}>
                      {j.result === "clean" ? "✓" : "!"}
                    </button>
                  ))}
                  {Array.from({ length: Math.max(0, (r.colour === "new" ? 4 : 10) - r.lastTen.length) }, (_, i) => <span key={`t${i}`} className="ctr-dot todo">{r.lastTen.length + i + 1}</span>)}
                </div>
                {dot && (() => { const j = r.lastTen.find((x) => x.workOrderId === dot)!; return (
                  <div className="ctr-why" data-testid="painter-dot-why">
                    <b>{j.title}</b> · {j.hours} h · {j.result === "clean" ? "Clean job" : "Not clean"}
                    {j.reasons.length > 0 && <ul>{j.reasons.map((w) => <li key={w}>{w}</li>)}</ul>}
                  </div>
                ); })()}
                <p className="muted small">{r.lastTen.length === 0 ? (r.tags.some((t) => t.text === "Standards not signed") ? "No finished jobs yet. No offers until they sign the standards." : "No finished jobs scored yet.") : r.line.replace(/\bYour\b/g, "Their").replace(/\byour\b/g, "their").replace(/\byou\b/g, "they")}</p>
                {r.bonusHistory.length > 0 && (
                  <p className="small" data-testid={`bonus-history-${r.id}`}><b>Bonus history (staff only):</b> {r.bonusHistory.map((b) => `${money(b.amountCents)} on ${day(b.decidedAt)}${b.status === "paid" ? "" : " (approved)"}`).join(" · ")}</p>
                )}
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" disabled={pending || r.underWay.length === 0} data-testid={`spot-${r.id}`}
                    title={r.underWay.length === 0 ? "No job under way to check" : ""} onClick={() => { setCbFor(null); setSpotFor(spotFor === r.id ? null : r.id); }}>Spot check</button>
                  <button type="button" className="btn" disabled={r.finished.length === 0} data-testid={`logcb-${r.id}`}
                    title={r.finished.length === 0 ? "No finished job to log it against" : ""} onClick={() => { setSpotFor(null); setCbFor(cbFor === r.id ? null : r.id); }}>Log call back</button>
                  <Link className="btn dim" href={`/contractors/${r.id}`}>Open painter</Link>
                </div>
                {spotFor === r.id && (
                  <div className="ctr-pick" data-testid={`spot-pick-${r.id}`}>
                    <span className="k">Which job?</span>
                    {r.underWay.map((j) => (
                      <button key={j.workOrderId} type="button" className="btn primary" disabled={pending} data-testid={`spot-job-${j.workOrderId}`}
                        onClick={() => start(async () => {
                          setMsg(null);
                          const res = await addQaCheck({ workOrderId: j.workOrderId, date: null, kind: "spot" });
                          setMsg(res.ok ? `✓ Spot check added to ${j.woRef} — it is on ${r.name}'s job.` : res.message);
                          if (res.ok) { setSpotFor(null); router.refresh(); }
                        })}>{j.woRef} · {j.title}</button>
                    ))}
                  </div>
                )}
                {cbFor === r.id && (
                  <div className="ctr-pick" data-testid={`logcb-pick-${r.id}`}>
                    <span className="k">Which finished job?</span>
                    {r.finished.map((j) => (
                      <Link key={j.workOrderId} className="btn primary" href={`/pc/wo/${j.workOrderId}#callbacks`} data-testid={`logcb-job-${j.workOrderId}`}>{j.woRef} · {j.title}</Link>
                    ))}
                  </div>
                )}
                {msg && <p className="small" data-testid="contractors-msg" style={{ color: msg.startsWith("✓") ? "var(--emerald)" : "var(--amber)" }}>{msg}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
