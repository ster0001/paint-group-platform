"use client";
import { useState, type ReactNode } from "react";

/**
 * Tom, 14 Sep (tighten batch, items 5, 24, 27, 28): questions one at a time.
 * The first unanswered step shows; the moment it is answered the next
 * unanswered one takes its place, so the card never grows down the page.
 * When every step is answered the card collapses to a "settled" line with a
 * way back into any answer. The `TIGHTENS YOUR RANGE` pill and the money
 * line above the questions are the parent's to pass.
 */
export type PaginatedStep = {
  key: string;
  question: ReactNode;
  hint?: ReactNode;
  answered: boolean;
  body: ReactNode;
  /** A short label for the "change an answer" row once everything is settled. */
  label: string;
};

export default function Paginated({ testid, title, pill, lead, steps, settledText, settledExtra, after, cardClass = "", dataCard, id, attrs }: {
  testid: string;
  title: ReactNode;
  pill?: string;
  lead?: ReactNode;
  steps: PaginatedStep[];
  settledText: string;
  settledExtra?: ReactNode;
  /** Always shown under the questions — a standing note such as "we'll get our estimator to check". */
  after?: ReactNode;
  cardClass?: string;
  dataCard?: string;
  id?: string;
  attrs?: Record<string, string | undefined>;
}) {
  const firstOpen = steps.findIndex((s) => !s.answered);
  const [idx, setIdx] = useState<number | null>(null);
  const allDone = firstOpen === -1 && steps.length > 0;
  // The step on show: a chosen one while it is still open (or everything is
  // settled and it was reopened to change), else the first open one. Derived,
  // not synced — answering the step on show hands over on the next render.
  const chosen = idx != null && idx < steps.length && (allDone || !steps[idx].answered) ? idx : null;
  const current = chosen ?? firstOpen;
  const step = current >= 0 ? steps[current] : null;

  if (steps.length === 0) return null;
  const openCount = steps.filter((s) => !s.answered).length;
  const position = current >= 0 ? current + 1 : steps.length;

  return (
    <section className={`sc-rc il-card sc-paged ${allDone ? "done" : "amber"} ${cardClass}`} data-card={dataCard} id={id} data-testid={testid} data-open={openCount} {...attrs}>
      <div className="sc-hd il-hd"><b>{title}</b>{pill && <span className={`il-pill ${allDone ? "done" : ""}`}>{allDone ? "SETTLED ✓" : pill}</span>}</div>
      {lead}
      {step && !allDone && (
        <div className="sc-page" data-testid={`${testid}-step-${step.key}`} data-step={step.key}>
          <div className="sc-page-nav" data-testid={`${testid}-count`}>
            <span>Question {position} of {steps.length}</span>
            <span className="sc-page-dots" aria-hidden="true">{steps.map((s, i) => <i key={s.key} className={s.answered ? "done" : i === current ? "on" : ""} />)}</span>
          </div>
          <p className="il-ql">{step.question}</p>
          {step.hint && <p className="il-hint">{step.hint}</p>}
          <div className="sc-page-body">{step.body}</div>
          <div className="sc-page-row">
            {current > 0 && <button type="button" className="wz-linkish" data-testid={`${testid}-back`} onClick={() => setIdx(current - 1)}>← Back</button>}
            {openCount > 1 && current < steps.length - 1 && (
              <button type="button" className="wz-linkish" data-testid={`${testid}-skip`} onClick={() => { const n = steps.findIndex((s, i) => i > current && !s.answered); setIdx(n === -1 ? null : n); }}>Skip for now →</button>
            )}
          </div>
        </div>
      )}
      {step && allDone && chosen != null && (
        <div className="sc-page" data-testid={`${testid}-step-${step.key}`} data-step={step.key}>
          <p className="il-ql">{step.question}</p>
          <div className="sc-page-body">{step.body}</div>
          <div className="sc-page-row"><button type="button" className="wz-linkish" data-testid={`${testid}-done`} onClick={() => setIdx(null)}>Done</button></div>
        </div>
      )}
      {allDone && chosen == null && (
        <div className="sc-page-done" data-testid={`${testid}-settled`}>
          <p className="il-hint">{settledText}</p>
          <div className="sc-chips">
            {steps.map((s, i) => <button key={s.key} type="button" className="sd-chip il-chip" data-testid={`${testid}-change-${s.key}`} onClick={() => setIdx(i)}>{s.label}</button>)}
          </div>
          {settledExtra}
        </div>
      )}
      {after}
    </section>
  );
}
