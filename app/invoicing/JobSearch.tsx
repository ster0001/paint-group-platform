"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JobPickProp } from "./PayablesCosts";

/**
 * The "matched job" search box (Tom, 4 Sep 2026): type part of the property
 * address (or the PG- job number) and pick the job from the matches. Replaces
 * the wall of one-tile-per-project buttons that no longer fitted once the
 * list grew.
 *
 * Matching is word-based and order-free: "ocean st" finds "7 Ocean St,
 * Ormond"; "pg-0004" finds the job by its order reference. Pure UI — the
 * chosen work-order id goes back to the caller exactly as the tiles did.
 */
export default function JobSearch({
  jobs, value, onChange, testId, allowNone = false, noneLabel = "No job yet (unmatched)", autoFocus = false,
}: {
  jobs: JobPickProp[];
  value: string | null;
  onChange: (woId: string | null) => void;
  testId: string;
  /** Offer an explicit "no job" choice (materials can sit unmatched). */
  allowNone?: boolean;
  noneLabel?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const chosen = value ? jobs.find((j) => j.woId === value) ?? null : null;

  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const list = words.length === 0
      ? jobs
      : jobs.filter((j) => {
          const hay = j.label.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
    return list.slice(0, 8);
  }, [jobs, q]);

  // Click-away closes the list without picking.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(woId: string | null) {
    onChange(woId);
    setQ("");
    setOpen(false);
  }

  if (chosen) {
    return (
      <div className="jsel" data-testid={`${testId}-chosen`}>
        <span className="jsel-label">{chosen.label}</span>
        <button type="button" className="mini" onClick={() => { onChange(null); setOpen(true); }}
          data-testid={`${testId}-change`}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="jsearch" ref={wrap}>
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${testId}-list`}
        aria-autocomplete="list"
        placeholder="Type the property address or PG- number…"
        value={q}
        autoFocus={autoFocus}
        data-testid={testId}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setCursor(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && matches[cursor]) pick(matches[cursor].woId); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {allowNone && value === null && (
        <div className="hint mono" style={{ fontSize: 10, marginTop: 4 }} data-testid={`${testId}-none`}>
          {noneLabel} — pick a job to match it.
        </div>
      )}
      {open && (
        <ul className="jlist" role="listbox" id={`${testId}-list`} data-testid={`${testId}-list`}>
          {matches.length === 0 ? (
            <li className="jempty">No job matches &ldquo;{q}&rdquo;. Closed jobs drop off after 60 days.</li>
          ) : matches.map((j, i) => (
            <li key={j.woId} role="option" aria-selected={i === cursor}
              className={i === cursor ? "on" : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(j.woId); }}
              onMouseEnter={() => setCursor(i)}
              data-testid={`${testId}-opt-${j.woId}`}>
              {j.label}
            </li>
          ))}
          {allowNone && (
            <li role="option" aria-selected={false} className="jnone"
              onMouseDown={(e) => { e.preventDefault(); pick(null); }}
              data-testid={`${testId}-pick-none`}>
              {noneLabel}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
