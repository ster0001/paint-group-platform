"use client";

import { useEffect, useState } from "react";
import { finishLevel } from "@/lib/workorder/finish";
import "./finish.css";

/**
 * The PG finish-level chip. Tapping it opens the approved one-screen summary of
 * the level — the guide's five rows (filling, sanding, gaps, old problems, the
 * look test) — and, where the host says so, a link to the full standards.
 *
 * Works inside both the staff work order (.wo) and the contractor portal (.pt);
 * the stylesheet only uses colour tokens that both define.
 */
export default function FinishChip({
  code,
  variant = "full",
  differs = false,
  fallbackLabel = "",
  standardsHref,
}: {
  code: string | null;
  /** "full" = header chip with wording; "mini" = compact per-area pill. */
  variant?: "full" | "mini";
  /** Mini only: this area differs from the job's level, so flag it as an exception. */
  differs?: boolean;
  /** Shown when the estimate's level has no PG standard — the internal label. */
  fallbackLabel?: string;
  /** Where the full finish standards live for this reader (the portal's Help, PC Command). */
  standardsHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const level = finishLevel(code);

  // Close on Escape, and don't let the page scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // No PG equivalent for this estimate's level of finish. Say so plainly rather
  // than showing a standard the job wasn't priced for.
  if (!level) {
    if (variant === "mini") return null;
    return (
      <span className="fchip unset">
        <b>No PG level</b>
        {fallbackLabel ? fallbackLabel : "Finish standard not set for this job"}
      </span>
    );
  }

  const number = level.code.split("-")[1];

  return (
    <>
      <button
        type="button"
        className={`fchip ${variant === "mini" ? "mini" : ""} ${differs ? "diff" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid={variant === "full" ? "finish-chip" : undefined}
      >
        <b>{level.code}</b>
        {variant === "full" ? (
          <>
            Level {number} · {level.name} — what this means
            <span className="fchev" aria-hidden>
              ›
            </span>
          </>
        ) : (
          <span className="fchev" aria-hidden>
            ›
          </span>
        )}
      </button>

      {open && (
        <div className="fsheet-wrap" role="dialog" aria-modal="true" aria-label={`Level ${number} — ${level.name}`} data-testid="finish-sheet">
          <div className="fsheet-scrim" onClick={() => setOpen(false)} />
          <div className="fsheet">
            <div className="fs-code">{level.code} · Level {number}</div>
            <h3>{level.name}</h3>
            <div className="fs-sum">Look test: stand {level.lookTest} back. If you can see a problem from there, fix it.</div>

            <div className="fs-lab">What this level means</div>
            <dl className="fs-rows">
              {level.rows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.text}</dd>
                </div>
              ))}
            </dl>

            {standardsHref && (
              <a className="fs-link" href={standardsHref} data-testid="finish-sheet-standards">
                Open the finish standards ›
              </a>
            )}

            <button type="button" className="fs-close" onClick={() => setOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
