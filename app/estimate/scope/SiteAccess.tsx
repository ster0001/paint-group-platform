"use client";

import type { SiteAccess as Answers } from "@/lib/wizard/site-access";

/**
 * Site and access — plan §4.4, prototype screen 9.
 *
 * The plan's own framing, kept: "None of these are a problem — they just
 * change how long protection and packing down takes." Every question here is
 * something the customer knows without thinking, and none of them is a
 * judgement about the paint.
 *
 * Ceiling height and asbestos are deliberately NOT here. Height is already
 * the details card's question (`confirm_height`) and asbestos is a hard stop
 * the policy ladder owns — asking either a second time invites two answers.
 *
 * FLOORS is gone (Tom, 9 Sep): he does not price it separately — the
 * allowance is already inside the empty/furnished figure — and a question
 * that changes nothing is a question that wastes the customer's patience.
 * The stairwell stays because the painter needs to know, and its hint no
 * longer implies a price it does not carry.
 */

type Q = {
  field: keyof Answers;
  label: string;
  hint?: string;
  options: Array<{ value: string; label: string; warn?: boolean }>;
};

const QUESTIONS: Q[] = [
  {
    field: "cleared", label: "Will the rooms be cleared before we start?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "some", label: "Mostly" },
      { value: "no", label: "Furniture stays", warn: true },
    ],
  },
  {
    field: "stairwell", label: "A stairwell or void with high walls?",
    hint: "So your painter arrives with the right gear.",
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes", warn: true }],
  },
  {
    field: "parking", label: "Where can we park?",
    options: [
      { value: "drive", label: "Driveway" },
      { value: "street", label: "Street" },
      { value: "hard", label: "Tricky", warn: true },
    ],
  },
  {
    field: "pets", label: "Pets we should know about?",
    hint: "Just so we keep doors and gates shut.",
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
  },
];

const LIFT: Q = {
  field: "lift", label: "Does the building need a lift booking?",
  hint: "We book the lift and work to the building's hours.",
  options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes", warn: true }],
};

export default function SiteAccessCard({
  answers, asksLift, busy, onAnswer,
}: {
  answers: Answers;
  asksLift: boolean;
  busy?: boolean;
  onAnswer: (field: keyof Answers, value: string) => void;
}) {
  const questions = asksLift ? [...QUESTIONS.slice(0, 4), LIFT, ...QUESTIONS.slice(4)] : QUESTIONS;
  const answered = questions.filter((q) => answers[q.field] != null).length;

  return (
    <section className="sc-rc il-card sc-access" data-card="access" data-testid="access-card">
      <div className="sc-hd il-hd">
        <b>Site and access</b>
        <span className={`il-pill ${answered === questions.length ? "done" : ""}`}>
          {answered === questions.length ? "ANSWERED ✓" : `${answered} OF ${questions.length}`}
        </span>
      </div>
      <p className="wz-note" style={{ margin: "2px 0 12px" }}>
        None of these are a problem — they just change how long protection and packing down takes.
      </p>
      {questions.map((q) => (
        <div className="il-q" key={q.field} data-testid={`access-${q.field}`}>
          <p className="il-ql">
            {q.label}
            {q.hint && <span className="il-hm"> {q.hint}</span>}
          </p>
          <div className="sc-chips">
            {q.options.map((o) => {
              const on = answers[q.field] === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`sd-chip il-chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  disabled={busy}
                  data-testid={`access-${q.field}-${o.value}`}
                  onClick={() => onAnswer(q.field, o.value)}
                >{o.label}</button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
