import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDeskCheckItems, type DeskCheckRow } from "@/lib/crm/work-queue";
import { DEFAULT_POLICY, policyFromSettings, settingValue, type WizardPolicySettings } from "@/lib/wizard/policy";
import { DEFAULT_TURNAROUND_SETTING, turnaroundFromSettings, type TurnaroundSetting } from "@/lib/wizard/confirmation-actions";
import { moneyFmt } from "./money";

/**
 * C15 — "WAITING ON US" (walk A, screen A1).
 *
 * The trade home's first list: quotes with the estimator, and quotes the
 * estimator has fixed that are ready to accept. It derives from
 * `confirmation_requests` through the SAME evaluator the CRM work queue
 * uses (`buildDeskCheckItems`, C7b's one-evaluator rule) — the ordering and
 * the "we said one working day, that has passed" wording are that
 * function's, so the customer and the office read the same queue. This
 * module only re-words each item for the person waiting.
 */

export type WaitingItem = {
  key: string;
  estimateId: string;
  address: string;
  /** "with_us" = the estimator has it; "ready" = fixed, accept it. */
  stage: "with_us" | "ready";
  meta: string;
  amountCents: number | null;
  cta: { label: string; href: string };
};

type WaitingRow = DeskCheckRow & { estimates: (DeskCheckRow["estimates"] & { property_id: string | null; status: string }) | null };

export async function loadWaitingOnUs(
  db: SupabaseClient,
  accountIds: string[],
  addressOf: (propertyId: string | null, title: string | null) => string,
  estimatorName: string | null,
  now = new Date(),
): Promise<WaitingItem[]> {
  if (!accountIds.length) return [];
  const { data: ests } = await db.from("estimates").select("id").in("account_id", accountIds).limit(500);
  const estIds = (ests ?? []).map((e) => (e as { id: string }).id);
  if (!estIds.length) return [];

  const [rowsRes, turnaroundRes, policyRes] = await Promise.all([
    db.from("confirmation_requests")
      .select("id, estimate_id, requested_at, kind, status, suggested_action, assigned_to, estimates(title, account_id, total_cents, builder_state, property_id, status)")
      .in("estimate_id", estIds)
      .in("status", ["requested", "question_asked", "fixed"])
      .order("requested_at", { ascending: false })
      .limit(100),
    db.from("settings").select("value").eq("key", "confirmation_turnaround").maybeSingle(),
    db.from("settings").select("key, value").eq("key", "wizard_policy").maybeSingle(),
  ]);
  const rows = (rowsRes.error ? [] : (rowsRes.data ?? [])) as unknown as WaitingRow[];
  const turnaround: TurnaroundSetting = turnaroundRes.data
    ? turnaroundFromSettings((turnaroundRes.data as { value?: unknown }).value)
    : DEFAULT_TURNAROUND_SETTING;
  const policy: WizardPolicySettings = policyRes.data
    ? policyFromSettings(settingValue([policyRes.data as { key: string; value: unknown }], "wizard_policy"))
    : DEFAULT_POLICY;

  const who = estimatorName?.trim() || "your estimator";
  const out: WaitingItem[] = [];

  // With the estimator: ordered and worded by the one evaluator.
  const open = rows.filter((r) => r.status === "requested" || r.status === "question_asked");
  const items = buildDeskCheckItems(open, policy, now, turnaround);
  for (const item of items) {
    const row = open.find((r) => r.estimate_id === item.subjectRef.id);
    if (!row) continue;
    const overdue = item.bucket === "overdue" || /that has passed/.test(item.detail);
    out.push({
      key: `waiting:${row.id}`,
      estimateId: row.estimate_id,
      address: addressOf(row.estimates?.property_id ?? null, row.estimates?.title ?? null),
      stage: "with_us",
      meta: row.status === "question_asked"
        ? `${who} has a question for you`
        : overdue
          ? `Sent ${sentLabel(row.requested_at)} · we said ${turnaround.words} — ${who} is on it`
          : `Sent ${sentLabel(row.requested_at)} · ${who} confirms within ${turnaround.words}`,
      amountCents: item.valueCents ?? null,
      cta: { label: `With ${who}`, href: `/account/quote/${row.estimate_id}/sheet` },
    });
  }

  // Fixed and ready to accept — the estimate is sent, the price is held.
  for (const r of rows) {
    if (r.status !== "fixed") continue;
    if (out.some((o) => o.estimateId === r.estimate_id)) continue;
    const total = Number(r.estimates?.total_cents) || null;
    out.push({
      key: `ready:${r.id}`,
      estimateId: r.estimate_id,
      address: addressOf(r.estimates?.property_id ?? null, r.estimates?.title ?? null),
      stage: "ready",
      meta: `Confirmed ${sentLabel(r.requested_at)}${total ? ` · ${moneyFmt(total)}` : ""}`,
      amountCents: total,
      cta: { label: "Ready to accept", href: `/account/approvals/${r.estimate_id}` },
    });
  }
  return out;
}

function sentLabel(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "recently";
  return new Date(t).toLocaleDateString("en-AU", { weekday: "long", timeZone: "Australia/Melbourne" });
}
