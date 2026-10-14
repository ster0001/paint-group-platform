/**
 * The demo checklist (induction brief §4.2 "Progress"): the "On your phone"
 * steps of each module, ticked from the practice job's own rows — DERIVED,
 * never stored (the one-work-queue rule applies to this list too). Pure:
 * `demoChecklist(facts)` is what the painter's banner and the staff grid both
 * render, so they can never disagree. Steps whose feature is not built yet
 * (Request more, No work today, Share with a worker) are not listed; they
 * arrive with Steps 3a/3b.
 */

export type DemoStepKey =
  | "accept" | "photo" | "stage" | "prompt" | "question" | "finish_date"
  | "variation" | "walkthrough" | "invoice" | "expense" | "block_day" | "gcal";

export type DemoStep = { key: DemoStepKey; module: number; label: string };

export const DEMO_STEPS: readonly DemoStep[] = [
  { key: "prompt", module: 6, label: "Answered the DEMO text with a photo" },
  { key: "question", module: 7, label: "Asked a question" },
  { key: "finish_date", module: 7, label: "Changed the finish date" },
  { key: "variation", module: 8, label: "Raised a variation and accepted it" },
  { key: "walkthrough", module: 9, label: "Walked the customer through and signed" },
  { key: "accept", module: 10, label: "Accepted the offer" },
  { key: "photo", module: 10, label: "Added a before photo" },
  { key: "stage", module: 10, label: "Moved a surface to Prepped and Painted" },
  { key: "invoice", module: 11, label: "Submitted the invoice" },
  { key: "expense", module: 11, label: "Claimed an expense" },
  { key: "block_day", module: 12, label: "Blocked out a day" },
  { key: "gcal", module: 12, label: "Linked Google Calendar" },
];

export type DemoFacts = {
  offerAccepted: boolean;
  beforePhotos: number;
  /** Surfaces past "todo" (prepped or done). */
  surfacesMoved: number;
  /** null = the DEMO text has not been sent. */
  promptAnswered: boolean | null;
  questionsAsked: number;
  finishDateChanged: boolean;
  variationAccepted: boolean;
  signedAt: string | null;
  invoiceSubmitted: boolean;
  expenseSubmitted: boolean;
  dayBlocked: boolean;
  gcalLinked: boolean;
};

export type DemoChecklistRow = DemoStep & { done: boolean; detail: string };

export function demoChecklist(f: DemoFacts): DemoChecklistRow[] {
  const state: Record<DemoStepKey, [boolean, string]> = {
    accept: [f.offerAccepted, f.offerAccepted ? "Accepted" : "Offer waiting"],
    photo: [f.beforePhotos > 0, f.beforePhotos > 0 ? `${f.beforePhotos} before photo${f.beforePhotos === 1 ? "" : "s"}` : "No before photo yet"],
    stage: [f.surfacesMoved > 0, f.surfacesMoved > 0 ? `${f.surfacesMoved} surface${f.surfacesMoved === 1 ? "" : "s"} moved` : "Nothing ticked yet"],
    prompt: [f.promptAnswered === true, f.promptAnswered === null ? "DEMO text not sent yet" : f.promptAnswered ? "Answered" : "Text sent — waiting for a photo"],
    question: [f.questionsAsked > 0, f.questionsAsked > 0 ? `${f.questionsAsked} asked` : "Nothing asked yet"],
    finish_date: [f.finishDateChanged, f.finishDateChanged ? "Logged" : "Not changed"],
    variation: [f.variationAccepted, f.variationAccepted ? "Accepted — on the invoice" : "Not accepted yet"],
    walkthrough: [Boolean(f.signedAt), f.signedAt ? "Signed" : "Not signed"],
    invoice: [f.invoiceSubmitted, f.invoiceSubmitted ? "Submitted" : "Not submitted"],
    expense: [f.expenseSubmitted, f.expenseSubmitted ? "Claimed" : "Nothing claimed"],
    block_day: [f.dayBlocked, f.dayBlocked ? "A day is blocked" : "No day blocked"],
    gcal: [f.gcalLinked, f.gcalLinked ? "Linked" : "Not linked"],
  };
  return DEMO_STEPS.map((s) => ({ ...s, done: state[s.key][0], detail: state[s.key][1] }));
}

/** How many of the steps are done — the number on the grid. */
export function demoProgress(rows: readonly DemoChecklistRow[]): { done: number; total: number } {
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}
