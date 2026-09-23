import { daysBetween } from "./derive";

/**
 * Colour for a contractor invoice by what the office owes on it (Tom, 20 Sep
 * 2026: "show up a different colour when things are outstanding for
 * payment"). ONE decision, server-rendered as class names; the Payables rows
 * and the job page's contractor chip both read it, so a state never has two
 * colours.
 *
 *   submitted            → amber    · waiting on the office to approve
 *   approved, not paid   → clay     · OUTSTANDING FOR PAYMENT
 *   approved, past due   → clay-strong, "overdue N d"
 *   paid                 → emerald
 *   draft / anything else→ grey     · nothing owed yet (a draft is the
 *                                     painter's to submit; the enum has no
 *                                     rejected or void state — a wrong draft
 *                                     is deleted)
 */
export type CiTone = "amber" | "clay" | "clay-strong" | "emerald" | "grey";

export type CiToneResult = {
  tone: CiTone;
  /** The class the row/pill carries: `ci-amber`, `ci-clay`, `ci-clay-strong`, `ci-emerald`, `ci-grey`. */
  className: `ci-${CiTone}`;
  /** True when money is owed and undecided or unpaid — the two "outstanding" states. */
  outstanding: boolean;
  /** Set only past terms: "overdue 3 d". */
  overdueLabel: string | null;
  overdueDays: number;
};

export function contractorInvoiceTone(
  ci: { status: string; dueOn: string | null },
  todayIso: string,
): CiToneResult {
  const make = (tone: CiTone, outstanding: boolean, overdueDays = 0): CiToneResult => ({
    tone, className: `ci-${tone}`, outstanding, overdueDays,
    overdueLabel: overdueDays > 0 ? `overdue ${overdueDays} d` : null,
  });
  switch (ci.status) {
    case "submitted":
      return make("amber", true);
    case "approved": {
      const over = ci.dueOn ? daysBetween(ci.dueOn, todayIso) : 0;
      return over > 0 ? make("clay-strong", true, over) : make("clay", true);
    }
    case "paid":
      return make("emerald", false);
    default:
      return make("grey", false);
  }
}
