/**
 * Commercial routing — the segment question and the gates
 * (estimator journey v2 §9.7; `docs/briefs/commercial-pricing-strategy.md`).
 *
 * That brief's own sequencing, kept: **"First — routing, no pricing."** This
 * module decides WHO gets seen and captures why; it touches the pricing engine
 * nowhere, and there is not a dollar figure in it. The sector bands and the
 * per-segment caps are a later step, and they need `commercial_rates` data
 * this repository does not have yet.
 *
 * The gate's principle, in the brief's words: *price online where the
 * variables are bounded, and refuse to guess where they aren't. A wrong
 * assumption on a $4,000 office is recoverable. The same assumption on a
 * strata block is a five-figure mistake, and the customer will hold you to the
 * number they saw.*
 *
 * So: **any single gate sends the job to an appointment. No scoring, no
 * override.** A gate is not a risk weighting to be balanced against a good
 * lead — it is a statement that we cannot price this from a form.
 *
 * The brief is explicit that this reuses `requires_site_check` rather than
 * inventing a second flag, and it does.
 */

/** The segment question — one answer that selects everything else downstream. */
export const COMMERCIAL_SEGMENTS = [
  "office", "healthcare", "strata", "industrial", "shopfront", "other",
] as const;
export type CommercialSegment = (typeof COMMERCIAL_SEGMENTS)[number];

export const SEGMENT_LABEL: Record<CommercialSegment, string> = {
  office: "Office",
  healthcare: "Hospital, aged care or medical",
  strata: "Strata or common property",
  industrial: "Industrial or warehouse",
  shopfront: "Shop front or retail",
  other: "Something else",
};

/**
 * Two segments trip on their own, before a single gate question is asked.
 *
 * Healthcare is the brief's "regulated environment" gate — infection control,
 * clearances and approvals dominate, and no yes/no from a customer changes
 * that. Strata is its "owners corporation" gate: you are not quoting a person,
 * you are quoting a process.
 *
 * Asking a facilities manager to self-declare these would be asking them to
 * talk us out of visiting, which is not a question worth putting to anyone.
 */
export const ALWAYS_APPOINTMENT: ReadonlySet<CommercialSegment> = new Set(["healthcare", "strata"]);

/**
 * The seven gates a customer can answer. (The brief lists nine; the last two —
 * measured area and estimated value over the segment cap — fall out of the
 * estimate itself rather than being asked, and belong with the sector-band
 * work that needs `commercial_rates`.)
 *
 * Wording follows the brief's own warning: *phrase for the least informed
 * reader.* "Does the site need an induction?" is obvious to a facilities
 * manager and meaningless to a shop owner, so every question here is asked in
 * plain words with an example.
 */
export type CommercialGate = {
  key: string;
  /** What the customer is asked. */
  question: string;
  /** The example that makes it answerable by someone who has never let a job. */
  hint: string;
  /** What the estimator is told when it trips. */
  needs: string;
};

export const COMMERCIAL_GATES: CommercialGate[] = [
  {
    key: "height",
    question: "Is any of the work higher than a ladder safely reaches?",
    hint: "Roughly: higher than you could reach standing on a 2.4 m step ladder.",
    needs: "working height above safe ladder reach — access equipment changes both the cost and the method",
  },
  {
    key: "equipment",
    question: "Will we need a lift, scaffold or boom to reach it?",
    hint: "A scissor lift, boom lift, scaffold or swing stage.",
    needs: "access equipment needed — hire runs $925–$2,000 on a single job and is never assumed",
  },
  {
    key: "hours",
    question: "Does the work have to happen outside normal working hours?",
    hint: "Nights, weekends, or around your trading hours.",
    needs: "out-of-hours work — the loading is real, unmeasured, and negotiated rather than calculated",
  },
  {
    key: "stages",
    question: "Would we need to come back in stages?",
    hint: "For example one floor at a time, or around people still working there.",
    needs: "more than one mobilisation — staged works carry setup cost a calculator cannot see",
  },
  {
    key: "compliance",
    question: "Is there any site paperwork before we can start?",
    hint: "A site induction, a SWMS, a work permit or a security clearance.",
    needs: "site compliance required — time and paperwork before a brush is lifted",
  },
  {
    key: "occupied",
    question: "Will people be using the space while we paint?",
    hint: "Staff, students, patients, residents or customers.",
    needs: "occupied commercial site — protection, staging and supervision are not the residential allowance",
  },
  {
    key: "committee",
    question: "Does a committee or building owner have to approve the work?",
    hint: "An owners corporation, a landlord, or a head office.",
    needs: "a committee decides — we are quoting a process, not a person",
  },
];

export type GateAnswers = Partial<Record<string, "yes" | "no">>;

export type CommercialRouting = {
  /** True when the wizard may go on to price this job. */
  canPriceOnline: boolean;
  /** The gate keys (or the segment) that closed the door. */
  tripped: string[];
  /** What the estimator reads, one line per reason. */
  reasons: string[];
  /** Every gate answered? An unanswered gate is not a "no". */
  complete: boolean;
};

/**
 * Route a commercial enquiry.
 *
 * An UNANSWERED gate is never treated as a "no". The brief's whole point is
 * that we refuse to guess where the variables are unbounded, and a blank is
 * the least bounded answer there is — so an incomplete gate set cannot price
 * online either. It is not "tripped" though: the customer has not told us
 * anything alarming, they have simply not finished.
 */
export function routeCommercial(
  segment: CommercialSegment | null | undefined,
  answers: GateAnswers,
  gates: CommercialGate[] = COMMERCIAL_GATES,
): CommercialRouting {
  const tripped: string[] = [];
  const reasons: string[] = [];

  if (segment == null) {
    return { canPriceOnline: false, tripped: [], reasons: ["we don't know what sort of site it is yet"], complete: false };
  }
  if (ALWAYS_APPOINTMENT.has(segment)) {
    tripped.push(segment);
    reasons.push(segment === "healthcare"
      ? "a regulated environment — infection control, clearances and approvals dominate the job"
      : "strata or common property — an owners corporation decides, and that is a process not a person");
  }
  for (const g of gates) {
    if (answers[g.key] === "yes") { tripped.push(g.key); reasons.push(g.needs); }
  }
  const complete = gates.every((g) => answers[g.key] === "yes" || answers[g.key] === "no");
  if (!complete && tripped.length === 0) {
    reasons.push("some of the site questions aren't answered yet");
  }
  return { canPriceOnline: tripped.length === 0 && complete, tripped, reasons, complete };
}

/**
 * The one-line summary a customer reads when the gate sends them to a person.
 * Honest about WHY — "we'll need to see it" with no reason reads as a brush-off,
 * and a facilities manager who knows exactly why will trust us more for saying it.
 */
export function gateMessage(routing: CommercialRouting): string {
  if (routing.canPriceOnline) return "";
  if (routing.tripped.length === 0) {
    return "Answer the few site questions above and we'll price what we can online.";
  }
  return "We'll need to see this one before we put a number on it — from what you've told us, "
    + "there are things here a form can't price honestly. One of our estimators will call to arrange a time.";
}
