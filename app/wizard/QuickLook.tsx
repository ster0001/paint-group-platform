"use client";

import type { ReactNode } from "react";
import {
  COLOUR_INTENTS, CONDITION_BANDS, JOB_TYPES, OCCUPIED, PROPERTY_KINDS,
  SCOPE_PRESETS, STOREYS, type Choice, type QuickLook, type QuickLookStep,
} from "@/lib/wizard/quick-look";

/**
 * The QUICK LOOK — four screens, about nine taps, then a range.
 *
 * Estimator journey v2 §3, phase 2. This replaces the five-page interior
 * wizard (property → surfaces → condition → details → contact) that §2 takes
 * apart: it asked 25-30 answers, made the customer choose a route before
 * showing them anything, and put the contact form in front of the price.
 *
 * Every screen here follows the same rule: **ask only what a person standing
 * in their own hallway can answer.** Bedrooms, storeys, what needs painting,
 * whether the colours are changing, how it looks. Nothing about coats, film
 * builds, substrates or ceiling heights to the nearest 300 mm — those are our
 * job, derived from these answers and shown back on the reveal screen where
 * they can be corrected in context.
 *
 * Presentational on purpose: WizardApp owns the state, the address lookup and
 * the submit. This file owns the questions and their words.
 */

const BEDROOMS = [1, 2, 3, 4, 5];

export default function QuickLook({
  step, quick, onQuick, addressField, error, canContinue, busy, onBack, onNext, stepNo, stepsTotal,
}: {
  step: QuickLookStep;
  quick: QuickLook;
  onQuick: (patch: Partial<QuickLook>) => void;
  /** The address input, wired by WizardApp (Places lookup + service area). */
  addressField: ReactNode;
  error: string | null;
  canContinue: boolean;
  busy: boolean;
  onBack: (() => void) | null;
  onNext: () => void;
  stepNo: number;
  stepsTotal: number;
}) {
  const last = step === "condition" || (step === "place" && quick.jobType === "exterior");

  return (
    <div className="wz-wrap wz-quick" data-quick-step={step}>
      {step === "start" && (
        <>
          <p className="wz-kick">A minute to a guide range</p>
          <h1>Let&rsquo;s price your painting</h1>
          <p className="wz-sub">
            Four quick screens, then a guide range. Everything after that is optional — and
            nothing you say here is a commitment.
          </p>
          {addressField}
          <p className="wz-qhead">What&rsquo;s being painted?</p>
          <Chips options={JOB_TYPES} value={quick.jobType} onPick={(jobType) => onQuick({ jobType })} name="jobtype" />
        </>
      )}

      {step === "place" && (
        <>
          <p className="wz-kick">About the place</p>
          <h1>What kind of home is it?</h1>
          <p className="wz-sub">
            Near enough is fine — this seeds the rooms, and you can change any of them later.
          </p>
          <Cards options={PROPERTY_KINDS} value={quick.propertyKind} onPick={(propertyKind) => onQuick({ propertyKind })} name="kind" />

          {quick.propertyKind !== "commercial" && (
            <>
              <p className="wz-qhead">How many bedrooms?</p>
              <div className="wz-chips" data-testid="ql-bedrooms">
                {BEDROOMS.map((n) => (
                  <button
                    key={n} type="button"
                    className={`wz-tile ${quick.bedrooms === n ? "on" : ""}`}
                    data-testid={`ql-bedrooms-${n}`}
                    onClick={() => onQuick({ bedrooms: n })}
                  >{n === 5 ? "5+" : n}</button>
                ))}
              </div>

              <p className="wz-qhead">Storeys</p>
              <Cards options={STOREYS} value={quick.storeys} onPick={(storeys) => onQuick({ storeys })} name="storeys" />
            </>
          )}
        </>
      )}

      {step === "job" && (
        <>
          <p className="wz-kick">The job</p>
          <h1>What&rsquo;s the job?</h1>
          <p className="wz-sub">
            We work out the coats and the preparation from these two answers — and you&rsquo;ll see
            exactly what we&rsquo;ve allowed for.
          </p>
          <Cards options={SCOPE_PRESETS} value={quick.scope} onPick={(scope) => onQuick({ scope })} name="scope" />

          <p className="wz-qhead">Colours</p>
          <Cards options={COLOUR_INTENTS} value={quick.colour} onPick={(colour) => onQuick({ colour })} name="colour" />
        </>
      )}

      {step === "condition" && (
        <>
          <p className="wz-kick">Condition</p>
          <h1>How&rsquo;s it looking?</h1>
          <p className="wz-sub">
            Honest is best — it sets the preparation we allow for. You can point out particular
            spots later, with photos.
          </p>
          <Cards options={CONDITION_BANDS} value={quick.condition} onPick={(condition) => onQuick({ condition })} name="condition" />

          <p className="wz-qhead">Will anyone be living there while we paint?</p>
          <Cards options={OCCUPIED} value={quick.occupied} onPick={(occupied) => onQuick({ occupied })} name="occupied" />
        </>
      )}

      {error && <div className="wz-err" data-testid="ql-error">{error}</div>}

      <div className="wz-nav">
        {onBack && (
          <button type="button" className="wz-btn wz-bs" onClick={onBack} data-testid="ql-back">Back</button>
        )}
        <button
          type="button"
          className="wz-btn wz-bp"
          disabled={!canContinue || busy}
          data-testid="ql-next"
          onClick={onNext}
        >
          {busy ? "Working it out…" : last ? "See my guide range" : "Continue"}
        </button>
      </div>
      <p className="wz-steps">Step {stepNo} of {stepsTotal}</p>
    </div>
  );
}

/** A row of plain chips — for answers whose label is the whole story. */
function Chips<T extends string>({ options, value, onPick, name }: {
  options: Choice<T>[]; value: T; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-chips" data-testid={`ql-${name}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-tile ${value === o.value ? "on" : ""}`}
          data-testid={`ql-${name}-${o.value}`}
          onClick={() => onPick(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** Cards — for answers that need a line of explanation under them. */
function Cards<T extends string>({ options, value, onPick, name }: {
  options: Choice<T>[]; value: T; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-cards" data-testid={`ql-${name}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-card ${value === o.value ? "on" : ""}`}
          data-testid={`ql-${name}-${o.value}`}
          onClick={() => onPick(o.value)}
        >
          <b>{o.label}</b>
          {o.hint && <span>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}
