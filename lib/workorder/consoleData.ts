import type { SupabaseClient } from "@supabase/supabase-js";
import { melbourneDate, type ConsoleInput } from "./console";

/**
 * One load for the whole console.
 *
 * Eight queries fired together rather than one per card — a fixed number of
 * round trips for the screen, never a query inside a loop. RLS scopes it all to
 * staff; a non-staff session simply gets empty arrays and an empty console.
 */

export type ConsoleData = {
  input: ConsoleInput;
  signedOffThisWeek: number;
  ticksByDay: Record<string, number>;
};

type WoRow = {
  id: string; estimate_id: string; wo_ref: string; stage: string; contractor_id: string | null;
  start_date: string | null; end_date: string | null; walkthrough_required: boolean | null;
  colours: Record<string, { status?: string }> | null;
  blocked_reason: string | null; wo_snapshot: { jobTitle?: string } | null;
  issued_at: string | null;
  estimates: { total_cents: number | null; accepted_at: string | null } | null;
};

export async function loadConsole(supabase: SupabaseClient, now = new Date()): Promise<ConsoleData> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const fortnightAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  const [wos, offers, variations, updates, signoffs, flags, closed, ticks, contractors, settings, coloursTicked, collections,
         qaOpen, walkBooked, sentUpdates] =
    await Promise.all([
      supabase.from("work_orders")
        .select("id, estimate_id, wo_ref, stage, contractor_id, start_date, end_date, walkthrough_required, colours, blocked_reason, wo_snapshot, issued_at, estimates(total_cents, accepted_at)")
        // Open jobs, plus anything closed in the last 30 days — so a signed job
        // lands in the board's Closed lane rather than vanishing (Tom, 23 Aug).
        // The queue and tiles filter closed out where they should.
        .or(`stage.neq.closed,stage_entered_at.gte.${new Date(now.getTime() - 30 * 86_400_000).toISOString()}`),
      supabase.from("booking_offers")
        .select("id, work_order_id, state, expires_at, contractors(company_name)")
        // 'expired' and 'declined' too: the sweep flips a breached offer to
        // expired within minutes, and a job nobody is coming to is precisely
        // what the console has to surface.
        .in("state", ["offered", "proposed", "expired", "declined"]),
      supabase.from("wo_variations")
        .select("id, work_order_id, status, created_at, priced_lines, contractor_rate_cents, credit, needs_manual_deduction, deduction_cents")
        .in("status", ["raised", "priced", "customer_approved"]),
      supabase.from("wo_updates").select("id, work_order_id, status, created_at").eq("status", "drafted"),
      // Unsigned only. buildQueue skips a signed row on the first line of its
      // loop, so this changes nothing on screen — but signed jobs accumulate
      // for ever, and the console was reading every one of them on every load.
      supabase.from("wo_signoff")
        .select("work_order_id, evidence_pack_sent_at, signed_at, extension_requested_at, extension_approved_at")
        .is("signed_at", null),
      supabase.from("wo_events").select("work_order_id, created_at, meta")
        .eq("type", "quiet_site").gte("created_at", weekAgo),
      supabase.from("wo_events").select("work_order_id").eq("type", "signed_off").gte("created_at", weekAgo),
      supabase.from("wo_events").select("created_at").eq("type", "surface_tick").gte("created_at", fortnightAgo),
      supabase.from("contractors").select("id, company_name"),
      supabase.from("settings").select("value").eq("key", "wo_loop").maybeSingle(),
      // The colours box is a person's tick now (Tom, 23 Aug) — the console's
      // "Colours TBC" reads THAT, not the phantom per-product status.
      supabase.from("wo_checklist_items").select("work_order_id")
        .eq("phase", "pre_start").eq("label", "Colour schedule finalised").not("done_at", "is", null),
      // Rubbish / equipment yeses nobody has organised yet (Tom, 23 Aug).
      supabase.from("wo_checklist_items")
        .select("id, work_order_id, item_key, answer_note, done_at, work_orders(wo_ref, contractor_id, wo_snapshot)")
        .eq("phase", "completion_prep").in("item_key", ["rubbish", "equipment"])
        .eq("answer", "yes").is("handled_at", null),
      // Tom, 23 Aug: quality checks to do, walkthroughs not booked, updates due.
      supabase.from("wo_qa_checks").select("work_order_id, kind, scheduled_for, created_at").is("result", null),
      supabase.from("wo_walkthroughs").select("work_order_id").eq("kind", "final").eq("status", "booked"),
      supabase.from("wo_updates").select("work_order_id, approved_at, sent_at, created_at").in("status", ["approved", "sent"]),
    ]);

  const contractorName = new Map(
    ((contractors.data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]),
  );

  const coloursTickedIds = new Set(
    ((coloursTicked.data ?? []) as { work_order_id: string }[]).map((r) => r.work_order_id),
  );
  const workOrders = ((wos.data ?? []) as unknown as WoRow[]).map((w) => {
    const colours = w.colours ?? {};
    const values = Object.values(colours);
    return {
      id: w.id,
      woRef: w.wo_ref,
      stage: w.stage,
      title: w.wo_snapshot?.jobTitle ?? w.wo_ref,
      contractorName: w.contractor_id ? contractorName.get(w.contractor_id) ?? null : null,
      contractValueCents: w.estimates?.total_cents ?? 0,
      startDate: w.start_date,
      endDate: w.end_date,
      walkthroughRequired: w.walkthrough_required !== false,
      // No colour rows at all is "not confirmed" — an empty object is not a yes.
      coloursConfirmed: coloursTickedIds.has(w.id)
        || (values.length > 0 && values.every((c) => c?.status === "confirmed")),
      blockedReason: w.blocked_reason,
      // When the CUSTOMER said yes — the clock the office is judged on. Not the
      // work order's own created_at, which is an internal artefact.
      acceptedAt: w.estimates?.accepted_at ?? null,
      // A job accepted before its work order exists still needs chasing, but
      // the action is "open it once", not "ring them".
      issued: Boolean(w.issued_at),
      estimateId: w.estimate_id,
      ticksDone: 0,
      ticksTotal: 0,
    };
  });

  // Tick counts per job, in one more query rather than one per card.
  const ids = workOrders.map((w) => w.id);
  if (ids.length > 0) {
    const { data: surfaces } = await supabase
      .from("wo_surfaces").select("work_order_id, state").in("work_order_id", ids);
    const byId = new Map(workOrders.map((w) => [w.id, w]));
    for (const row of (surfaces ?? []) as { work_order_id: string; state: string }[]) {
      const w = byId.get(row.work_order_id);
      if (!w) continue;
      w.ticksTotal += 1;
      if (row.state === "done") w.ticksDone += 1;
    }
  }

  const loop = (settings.data as { value?: Record<string, unknown> } | null)?.value ?? {};

  const ticksByDay: Record<string, number> = {};
  for (const t of (ticks.data ?? []) as { created_at: string }[]) {
    const day = melbourneDate(new Date(t.created_at));
    ticksByDay[day] = (ticksByDay[day] ?? 0) + 1;
  }

  return {
    input: {
      now,
      workOrders,
      offers: ((offers.data ?? []) as unknown as {
        id: string; work_order_id: string; state: string; expires_at: string;
        contractors: { company_name: string } | null;
      }[]).map((o) => ({
        id: o.id, workOrderId: o.work_order_id, state: o.state, expiresAt: o.expires_at,
        contractorName: o.contractors?.company_name ?? "The contractor",
      })),
      variations: ((variations.data ?? []) as {
        id: string; work_order_id: string; status: string; created_at: string;
        credit: boolean; needs_manual_deduction: boolean; deduction_cents: number | null;
      }[]).map((v) => ({
        id: v.id, workOrderId: v.work_order_id, status: v.status,
        createdAt: v.created_at,
        // A priced variation's clock starts when it was priced; the row does not
        // carry that separately, so the created_at of the price event stands in.
        pricedAt: v.status === "priced" ? v.created_at : null,
        credit: v.credit,
        needsManualDeduction: v.needs_manual_deduction,
        deductionCents: v.deduction_cents,
      })),
      updates: ((updates.data ?? []) as { id: string; work_order_id: string; status: string; created_at: string }[])
        .map((u) => ({ id: u.id, workOrderId: u.work_order_id, status: u.status, createdAt: u.created_at })),
      signoffs: ((signoffs.data ?? []) as {
        work_order_id: string; evidence_pack_sent_at: string | null; signed_at: string | null;
        extension_requested_at: string | null; extension_approved_at: string | null;
      }[]).map((s) => ({
        workOrderId: s.work_order_id, evidencePackSentAt: s.evidence_pack_sent_at,
        signedAt: s.signed_at, extensionRequestedAt: s.extension_requested_at,
        extensionApprovedAt: s.extension_approved_at,
      })),
      quietSites: ((flags.data ?? []) as {
        work_order_id: string; created_at: string; meta: { days?: number } | null;
      }[]).map((f) => ({ workOrderId: f.work_order_id, at: f.created_at, days: f.meta?.days ?? 3 })),
      collections: ((collections.data ?? []) as unknown as {
        id: string; work_order_id: string; item_key: string; answer_note: string | null; done_at: string | null;
        work_orders: { wo_ref: string; contractor_id: string | null; wo_snapshot: { jobTitle?: string } | null } | null;
      }[]).map((c) => ({
        itemId: c.id, workOrderId: c.work_order_id,
        kind: c.item_key === "equipment" ? "equipment" as const : "rubbish" as const,
        note: c.answer_note ?? "", answeredAt: c.done_at ?? now.toISOString(),
        woRef: c.work_orders?.wo_ref ?? "", title: c.work_orders?.wo_snapshot?.jobTitle ?? c.work_orders?.wo_ref ?? "",
        contractorName: c.work_orders?.contractor_id ? contractorName.get(c.work_orders.contractor_id) ?? null : null,
      })),
      qaChecks: ((qaOpen.data ?? []) as { work_order_id: string; kind: string; scheduled_for: string | null; created_at: string }[])
        .map((c) => ({ workOrderId: c.work_order_id, kind: c.kind, scheduledFor: c.scheduled_for, createdAt: c.created_at })),
      walkthroughBooked: ((walkBooked.data ?? []) as { work_order_id: string }[]).map((w) => w.work_order_id),
      lastUpdateAt: ((sentUpdates.data ?? []) as { work_order_id: string; approved_at: string | null; sent_at: string | null; created_at: string }[])
        .reduce<Record<string, string>>((acc, u) => {
          const at = u.sent_at ?? u.approved_at ?? u.created_at;
          if (!acc[u.work_order_id] || acc[u.work_order_id] < at) acc[u.work_order_id] = at;
          return acc;
        }, {}),
      settings: {
        coloursWarnDays: Number(loop.coloursWarnDays ?? 5),
        updateEveryDays: Number(loop.updateEveryDays ?? 3),
        variationCustomerSilentHours: Number(loop.variationCustomerSilentHours ?? 24),
      },
    },
    signedOffThisWeek: (closed.data ?? []).length,
    ticksByDay,
  };
}
