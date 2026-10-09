"use client";

import type { ReactNode } from "react";
import type { QuickLookStep } from "@/lib/wizard/quick-look";
import { railFor, STEP_LABELS } from "./stepRail";

/**
 * The wizard's one slim header (UI refresh S1, brief §7.1; components doc §2).
 *
 * Logo · step rail · phone number · chat · Save & book, 64px on a laptop and
 * 56px on a phone, with a 3px progress stripe along its bottom edge. On a
 * phone the rail gives way to "Step 2 of 6 · The place" and a bar under the
 * header, and the number becomes a round call button — still one tap.
 *
 * It replaces the five dots, the floating "Step x of y" line and the
 * full-width page header on the quick-look steps. It keeps `.wz-top` (the
 * class the old header had) so anything that looks for the header still
 * finds it. No backdrop-filter: that would make it the containing block for
 * the chat panel, which is `position: fixed` and lives inside it.
 */
export default function WizardHeader({ logo, steps, at, done = false, phone, chat, onSaveBook }: {
  logo: ReactNode;
  /** `stepsFor()` for the answers so far — never a list of our own. */
  steps: readonly QuickLookStep[];
  at: QuickLookStep;
  /** Every step answered (the range is being worked out). */
  done?: boolean;
  phone: string | null;
  /** ⚑ 10: the chat's header icon (ChatWidget with place="header"). */
  chat?: ReactNode;
  onSaveBook?: () => void;
}) {
  const rail = railFor(steps, at);
  const progress = done ? 1 : rail.progress;
  const tel = phone ? `tel:${phone.replace(/\s+/g, "")}` : null;
  return (
    <header className="wz-top wz-head" data-testid="wz-head">
      <div className="wz-head-in">
        <span className="wz-head-logo">{logo}</span>
        <nav className={`wz-rail ${rail.compact ? "compact" : ""}`} aria-label="Progress">
          <ol data-testid="wz-rail" data-steps={rail.steps.length}>
            {rail.steps.map((s, i) => {
              const state = done || i < rail.current ? "done" : i === rail.current ? "cur" : "todo";
              return (
                <li key={s} className={state} data-step={s} data-state={state} aria-current={state === "cur" ? "step" : undefined}>
                  <span className="n" aria-hidden="true">{state === "done" ? <Tick /> : i + 1}</span>
                  <span className="l">{STEP_LABELS[s].rail}</span>
                </li>
              );
            })}
            <li className="end" data-testid="wz-rail-end"><span className="l">{rail.end}</span></li>
          </ol>
        </nav>
        <div className="wz-head-r">
          {tel && (
            <a className="wz-tel" href={tel} aria-label={`Call Paint Group on ${phone}`} data-testid="wz-head-call">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
              <span>{phone}</span>
            </a>
          )}
          {chat}
          {onSaveBook && (
            <button type="button" className="wz-exit wz-book wz-head-save" onClick={onSaveBook} data-testid="save-and-book-pill">Save &amp; book</button>
          )}
        </div>
      </div>
      <i className="wz-stripe" style={{ width: `${Math.round(progress * 1000) / 10}%` }} aria-hidden="true" />
      <div className="wz-mprog" data-testid="wz-mprog">
        <p><b>{rail.phoneLine.split(" · ")[0]}</b> · {STEP_LABELS[at].long}<span>{done ? "Working it out" : rail.remaining}</span></p>
        <i aria-hidden="true"><em style={{ width: `${Math.round(progress * 1000) / 10}%` }} /></i>
      </div>
    </header>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
