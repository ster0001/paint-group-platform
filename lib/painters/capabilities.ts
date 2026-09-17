/**
 * Employed painters — the ONE capability function (brief §3.1).
 *
 * A painter is a `contractors` row. Two employment types share it:
 *
 *   contractor  offered jobs (accept / decline / propose, 24h clock), sees
 *               their price, self-invoices (RCTI), carries insurance and a
 *               crew count. Everything shipped before this brief.
 *   employee    PAYG staff. Jobs are ASSIGNED and acknowledged with one tap;
 *               never sees a dollar figure; expenses only; white card and
 *               working-at-heights instead of insurance; several employees can
 *               share one job with exactly one lead painter; clocks on and off.
 *
 * Every behavioural difference between the two derives from HERE. No
 * component, RPC, policy or route may check `employment_type` directly — they
 * call `painterCapabilities()`. If a session needs a question this function
 * cannot express, it stops and reports rather than branching inline.
 *
 * The `employees_enabled` Settings switch (lib/painters/employeesFlag.ts)
 * gates the office's tick box only. It is deliberately NOT an input here: a
 * row that IS an employee is treated as one whatever the switch says, because
 * "switch off" must never mean "money visible to someone it was hidden from".
 *
 * Shared by Server and Client Components — no Supabase or next/headers imports.
 */

export type EmploymentType = "contractor" | "employee";

export const EMPLOYMENT_TYPES: readonly EmploymentType[] = ["contractor", "employee"];

export function isEmploymentType(value: unknown): value is EmploymentType {
  return value === "contractor" || value === "employee";
}

export type PainterCapabilities = {
  /** Contractor: accept / decline / propose an offer against the 24h SLA. */
  acceptsOffers: boolean;
  /** Employee: one-tap Accept on an assignment — an acknowledgement, not a gate. */
  acknowledgesAssignments: boolean;
  /** Offer price, variation delta, invoice totals. Employee: never. */
  seesMoney: boolean;
  /** Allocated days and hours, with no rate anywhere near them. Both. */
  seesTimeBudget: boolean;
  /** Self-invoicing / RCTI. Employee: never. */
  canSelfInvoice: boolean;
  /** Receipt-backed expense claims, $100 pre-approval threshold. Both. */
  canClaimExpenses: boolean;
  /** Public liability insurance is a condition of being offerable. Employee: no. */
  requiresInsurance: boolean;
  /** "Painters they can field at once" capacity signal. Employee: no. */
  hasCrewCount: boolean;
  /** Several painters may be scheduled to the same job. Employee only (ruling 9). */
  multiAssignable: boolean;
  /** Start day / Finish day timesheets. Employee only. */
  clocksOn: boolean;
};

const CONTRACTOR: PainterCapabilities = Object.freeze({
  acceptsOffers: true,
  acknowledgesAssignments: false,
  seesMoney: true,
  seesTimeBudget: true,
  canSelfInvoice: true,
  canClaimExpenses: true,
  requiresInsurance: true,
  hasCrewCount: true,
  multiAssignable: false,
  clocksOn: false,
});

const EMPLOYEE: PainterCapabilities = Object.freeze({
  acceptsOffers: false,
  acknowledgesAssignments: true,
  seesMoney: false,
  seesTimeBudget: true,
  canSelfInvoice: false,
  canClaimExpenses: true,
  requiresInsurance: false,
  hasCrewCount: false,
  multiAssignable: true,
  clocksOn: true,
});

/**
 * The capabilities of a painter. Accepts the row (or any object carrying
 * `employment_type`), the bare type, or nothing at all.
 *
 * Anything that is not the literal 'employee' — null, undefined, a row from
 * before migration 20270153, an unknown string — is a CONTRACTOR: the type
 * every painter was before this brief, and the one whose screens are proven.
 * The migration's column default and check constraint make the other cases
 * unreachable from the database; this is the same rule for the TS side.
 */
export function painterCapabilities(
  painter: { employment_type?: unknown } | EmploymentType | null | undefined,
): PainterCapabilities {
  const type = typeof painter === "string" ? painter : painter?.employment_type;
  return type === "employee" ? EMPLOYEE : CONTRACTOR;
}

/** The type behind a capability set — for labels, never for branching. */
export function employmentTypeOf(painter: Parameters<typeof painterCapabilities>[0]): EmploymentType {
  return painterCapabilities(painter).seesMoney ? "contractor" : "employee";
}

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  contractor: "Contractor",
  employee: "Employee",
};
