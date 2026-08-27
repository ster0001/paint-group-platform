/**
 * 3a-6 · AI/estimate gates by account type (experience map §3).
 *
 * Residential runs the standard visitor limits (the cost control AND the
 * sales funnel — §10.6); trade runs unlimited (decided); and the office can
 * unblock any single account with `flags.unlimited` (⚑1's unblock, without
 * making them "trade"). ⚑12 default: limits are account-wide — the
 * `limits_scope` Settings flag exists for a later per-property flip.
 */

export type LimitAccount = {
  account_type: "residential" | "trade";
  flags: Record<string, unknown> | null;
};

export function bypassesWizardLimits(account: LimitAccount | null): boolean {
  if (!account) return false;
  if (account.account_type === "trade") return true;
  return account.flags?.unlimited === true;
}
