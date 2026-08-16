"use client";

import { useEffect, useState } from "react";
import { finishLevel } from "@/lib/workorder/finish";
import "./finish.css";

/**
 * The PG finish-level chip. Tapping it opens the standard the contractor is
 * actually held to — prep committed and how the work gets judged at walkthrough.
 *
 * Works inside both the staff work order (.wo) and the contractor portal (.pt);
 * the stylesheet only uses colour tokens that both define.
 */
export default function FinishChip({
  code,
  variant = "full",
  differs = false,
  fallbackLabel = "",
}: {
  code: string | null;
  /** "full" = header chip with wording; "mini" = compact per-area pill. */
  variant?: "full" | "mini";
  /** Mini only: this area differs from the job's level, so flag it as an exception. */
  differs?: boolean;
  /** Shown when the estimate's level has no PG standard — the internal label. */
  fallbackLabel?: string;
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

  return (
    <>
      <button
        type="button"
        className={`fchip ${variant === "mini" ? "mini" : ""} ${differs ? "diff" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <b>{level.code}</b>
        {variant === "full" ? (
          <>
            {level.name} finish — what this means
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
        <div className="fsheet-wrap" role="dialog" aria-modal="true" aria-label={`${level.code} ${level.name} finish standard`}>
          <div className="fsheet-scrim" onClick={() => setOpen(false)} />
          <div className="fsheet">
            <div className="fs-code">{level.code}</div>
            <h3>{level.name} finish</h3>
            <div className="fs-sum">{level.summary}</div>
            <div className="fs-use">{level.typicalUse}</div>

            <div className="fs-lab">Prep included at this level</div>
            <ul>
              {level.prep.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>

            <div className="fs-lab">How it will be judged</div>
            <ul className="fs-accept">
              {level.acceptance.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>

            <button type="button" className="fs-close" onClick={() => setOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
