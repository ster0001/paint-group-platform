/**
 * What staff read on an answered visit request (/crm/visit-requests/[id]).
 *
 * The page re-renders the moment an answer is saved (the action revalidates
 * it), so this line — not a client-side "done" flash — is the one place staff
 * learn what happened. It is built from the rows, never assumed: the booked
 * time and estimator from the visit, and what actually reached the customer
 * from `messages` / `automation_holds` (the time-offered send is best-effort
 * and can be switched off, held for quiet hours or waiting for approval).
 * Pure: the reads live in `loadAnsweredSummary` (requests.ts).
 */

export type AnsweredFacts = {
  visit: { when: string; estimatorName: string | null } | null;
  sent: { sms: boolean; email: boolean };
  waiting: boolean;
  mobile: string | null;
};

export function answeredWords(f: AnsweredFacts): string[] {
  const lines: string[] = [];
  if (!f.visit) return lines;
  lines.push(`Booked ${f.visit.when}${f.visit.estimatorName ? ` with ${f.visit.estimatorName}` : ""}. The visit is on the Diary.`);
  const by = [f.sent.sms ? "text" : null, f.sent.email ? "email" : null].filter(Boolean).join(" and ");
  if (by) lines.push(`The customer was sent the details by ${by}.`);
  else if (f.waiting) lines.push("The message to the customer is waiting in the message queue (held or awaiting approval) — it has not gone yet.");
  else lines.push(`No message has reached the customer — ring them${f.mobile ? ` on ${f.mobile}` : ""} with the time.`);
  return lines;
}
