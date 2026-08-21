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
  id: string; wo_ref: string; stage: string; contractor_id: string | null;
  start_date: string | null; colours: Record<string, { status?: string }> | null;
  blocked_reason: string | null; wo_snapshot: { jobTitle?: string } | null;
  estimates: { total_cents: number | null } | null;
};

export async function loadConsole(supabase: SupabaseClient, now = new Date()): Promise<ConsoleData> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const fortnightAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const dayAgo = new Date(now.getTime() - 36 * 3_600_000).toISOString();

  const [wos, offers, variations, updates, signoffs, flags, closed, ticks, contractors, settings] =
    await Promise.all([
      supabase.from("work_orders")
        .select("id, wo_ref, stage, contractor_id, start_date, colours, blocked_reason, wo_snapshot, estimates(total_cents)")
        .neq("stage", "closed"),
      supabase.from("booking_offers")
        .select("work_order_id, state, expires_at, contractors(company_name)")
        .in("state", ["offered", "proposed"]),
      supabase.from("wo_variations")
        .select("id, work_order_id, status, created_at, priced_lines, contractor_rate_cents")
        .in("status", ["raised", "priced", "customer_approved"]),
      supabase.from("wo_updates").select("id, work_order_id, status, created_at").eq("status", "drafted"),
      supabase.from("wo_signoff")
        .select("work_order_id, evidence_pack_sent_at, signed_at, extension_requested_at, extension_approved_at"),
      supabase.from("wo_events").select("work_order_id, created_at")
        .eq("type", "zero_tick_flag").gte("created_at", dayAgo),
      supabase.from("wo_events").select("work_order_id").eq("type", "signed_off").gte("created_at", weekAgo),
      supabase.from("wo_events").select("created_at").eq("type", "surface_tick").gte("created_at", fortnightAgo),
      supabase.from("contractors").select("id, company_name"),
      supabase.from("settings").select("value").eq("key", "wo_loop").maybeSingle(),
    ]);

  const contractorName = new Map(
    ((contractors.data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]),
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
      // No colour rows at all is "not confirmed" — an empty object is not a yes.
      coloursConfirmed: values.length > 0 && values.every((c) => c?.status === "confirmed"),
      blockedReason: w.blocked_reason,
      ticksDone: 0,
      ticksTotal: 0,
    };
  });

  // Tick counts per job, in one more query rather than one per card.
  const ids = workOrders.map((w) => w.id);
  if (ids.length > 0) {
    const { data: surfaces } = await supabase
      .from("wo_surfaces").select("work_order_id, state").in("work_order_id", ids);
    for (const row of (surfaces ?? []) as { work_order_id: string; state: string }[]) {
      const w = workOrders.find((x) => x.id === row.work_order_id);
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
        work_order_id: string; state: string; expires_at: string; contractors: { company_name: string } | null;
      }[]).map((o) => ({
        workOrderId: o.work_order_id, state: o.state, expiresAt: o.expires_at,
        contractorName: o.contractors?.company_name ?? "The contractor",
      })),
      variations: ((variations.data ?? []) as {
        id: string; work_order_id: string; status: string; created_at: string;
      }[]).map((v) => ({
        id: v.id, workOrderId: v.work_order_id, status: v.status,
        createdAt: v.created_at,
        // A priced variation's clock starts when it was priced; the row does not
        // carry that separately, so the created_at of the price event stands in.
        pricedAt: v.status === "priced" ? v.created_at : null,
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
      zeroTickFlags: ((flags.data ?? []) as { work_order_id: string; created_at: string }[])
        .map((f) => ({ workOrderId: f.work_order_id, at: f.created_at })),
      settings: {
        coloursWarnDays: Number(loop.coloursWarnDays ?? 5),
        variationCustomerSilentHours: Number(loop.variationCustomerSilentHours ?? 24),
      },
    },
    signedOffThisWeek: (closed.data ?? []).length,
    ticksByDay,
  };
}
