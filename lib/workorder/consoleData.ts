import type { SupabaseClient } from "@supabase/supabase-js";
import { melbourneDate, type ConsoleInput } from "./console";
import { fetchAllRows as fetchAll } from "@/lib/supabase/fetchAllRows";

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
  /** ⚑13: active company documents within 30 days of expiry (or past it). */
  expiringDocs: Array<{ id: string; title: string; expires_on: string; daysLeft: number }>;
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

  const [woRows, offers, variations, updates, signoffs, flags, closed, tickRows, contractors, settings, coloursTickedRows, collections,
         qaOpen, walkBooked, sentUpdateRows] =
    await Promise.all([
      fetchAll<WoRow>((from, to) => supabase.from("work_orders")
        .select("id, estimate_id, wo_ref, stage, contractor_id, start_date, end_date, walkthrough_required, colours, blocked_reason, wo_snapshot, issued_at, estimates(total_cents, accepted_at)")
        // Open jobs, plus anything closed in the last 30 days — so a signed job
        // lands in the board's Closed lane rather than vanishing (Tom, 23 Aug).
        // The queue and tiles filter closed out where they should.
        .or(`stage.neq.closed,stage_entered_at.gte.${new Date(now.getTime() - 30 * 86_400_000).toISOString()}`)
        .order("id").range(from, to)),
      supabase.from("booking_offers")
        .select("id, work_order_id, state, expires_at, proposed_start_date, approval_due_at, contractors(company_name)")
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
      // One flag per quiet job per grace window, but a big enough board can
      // still outgrow a page in a week.
      fetchAll<{ work_order_id: string; created_at: string; meta: { days?: number } | null }>(
        (from, to) => supabase.from("wo_events").select("work_order_id, created_at, meta")
          .eq("type", "quiet_site").gte("created_at", weekAgo)
          .order("id").range(from, to)),
      supabase.from("wo_events").select("work_order_id").eq("type", "signed_off").gte("created_at", weekAgo),
      // A busy fortnight can log more than a page of ticks; truncation here
      // flattens the momentum chart.
      fetchAll<{ created_at: string }>((from, to) => supabase.from("wo_events")
        .select("created_at").eq("type", "surface_tick").gte("created_at", fortnightAgo)
        .order("id").range(from, to)),
      supabase.from("contractors").select("id, company_name"),
      supabase.from("settings").select("value").eq("key", "wo_loop").maybeSingle(),
      // The colours box is a person's tick now (Tom, 23 Aug) — the console's
      // "Colours TBC" reads THAT, not the phantom per-product status. Ticked
      // boxes accumulate for ever, so this pages.
      fetchAll<{ work_order_id: string }>((from, to) => supabase.from("wo_checklist_items")
        .select("work_order_id")
        .eq("phase", "pre_start").eq("label", "Colour schedule finalised").not("done_at", "is", null)
        .order("id").range(from, to)),
      // Rubbish / equipment yeses nobody has organised yet (Tom, 23 Aug).
      supabase.from("wo_checklist_items")
        .select("id, work_order_id, item_key, answer_note, done_at, work_orders(wo_ref, contractor_id, wo_snapshot)")
        .eq("phase", "completion_prep").in("item_key", ["rubbish", "equipment"])
        .eq("answer", "yes").is("handled_at", null),
      // Tom, 23 Aug: quality checks to do, walkthroughs not booked, updates due.
      supabase.from("wo_qa_checks").select("work_order_id, kind, scheduled_for, created_at").is("result", null),
      supabase.from("wo_walkthroughs").select("work_order_id").eq("kind", "final").eq("status", "booked"),
      // Sent updates accumulate for ever, and a truncated set here would
      // false-flag "update due" on jobs whose last update fell off the page.
      fetchAll<{ work_order_id: string; approved_at: string | null; sent_at: string | null; created_at: string }>(
        (from, to) => supabase.from("wo_updates")
          .select("work_order_id, approved_at, sent_at, created_at").in("status", ["approved", "sent"])
          .order("id").range(from, to)),
    ]);

  const contractorName = new Map(
    ((contractors.data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]),
  );

  const coloursTickedIds = new Set(coloursTickedRows.map((r) => r.work_order_id));
  const workOrders = woRows.map((w) => {
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

  // Tick counts per job — a fixed few queries rather than one per card. Only
  // the OPEN jobs need them (the flow card hides the chip at 0, and a closed
  // job's progress is over), which keeps this from re-reading every surface
  // the business has ever painted. The id list is chunked because a thousand
  // ids in one `in()` overflows the request line, and each chunk pages.
  const ids = workOrders.filter((w) => w.stage !== "closed").map((w) => w.id);
  if (ids.length > 0) {
    const byId = new Map(workOrders.map((w) => [w.id, w]));
    const CHUNK = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    for (let i = 0; i < chunks.length; i += 5) {
      const batches = await Promise.all(chunks.slice(i, i + 5).map((chunk) =>
        fetchAll<{ work_order_id: string; state: string }>((from, to) => supabase
          .from("wo_surfaces").select("work_order_id, state").in("work_order_id", chunk)
          .order("id").range(from, to))));
      for (const row of batches.flat()) {
        const w = byId.get(row.work_order_id);
        if (!w) continue;
        w.ticksTotal += 1;
        if (row.state === "done") w.ticksDone += 1;
      }
    }
  }

  const loop = (settings.data as { value?: Record<string, unknown> } | null)?.value ?? {};

  // 6c ask-first requests (tolerant — table lands with migration 20261127).
  const { data: askRows } = await supabase
    .from("expense_preapprovals")
    .select("id, work_order_id, description, est_cents, created_at, contractors(company_name)")
    .eq("status", "requested");
  const expenseAsks = ((askRows ?? []) as unknown as {
    id: string; work_order_id: string; description: string; est_cents: number;
    created_at: string; contractors: { company_name: string | null } | null;
  }[]).map((a) => ({
    id: a.id, workOrderId: a.work_order_id, description: a.description,
    estCents: a.est_cents, createdAt: a.created_at,
    contractorName: a.contractors?.company_name ?? "The contractor",
  }));

  // 3a-5: open warranty issues (tolerant — table lands with 20261129) and
  // company documents whose expiry is near (⚑13's amber flag).
  const [{ data: issueRows }, { data: docRows }] = await Promise.all([
    supabase.from("warranty_issues")
      .select("id, work_order_id, note, photo_paths, created_at").eq("status", "open"),
    supabase.from("company_documents")
      .select("id, title, expires_on").eq("active", true).not("expires_on", "is", null),
  ]);
  const warrantyIssues = ((issueRows ?? []) as {
    id: string; work_order_id: string; note: string; photo_paths: string[] | null; created_at: string;
  }[]).map((i) => ({
    id: i.id, workOrderId: i.work_order_id, note: i.note,
    photoCount: i.photo_paths?.length ?? 0, createdAt: i.created_at,
  }));
  const expiringDocs = ((docRows ?? []) as { id: string; title: string; expires_on: string }[])
    .map((d) => ({ ...d, daysLeft: Math.floor((Date.parse(d.expires_on) - now.getTime()) / 86_400_000) }))
    .filter((d) => d.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Cards a person closed off (Tom, 25 Aug) — permanent per key, so the set
  // only ever grows; paged so an old dismissal can't fall off and resurface.
  const dismissedRows = await fetchAll<{ meta: { key?: string } | null }>((from, to) =>
    supabase.from("wo_events").select("meta").eq("type", "card_dismissed").order("id").range(from, to));
  const dismissedKeys = dismissedRows
    .map((r) => r.meta?.key)
    .filter((k): k is string => Boolean(k));

  const ticksByDay: Record<string, number> = {};
  for (const t of tickRows) {
    const day = melbourneDate(new Date(t.created_at));
    ticksByDay[day] = (ticksByDay[day] ?? 0) + 1;
  }

  return {
    input: {
      now,
      workOrders,
      dismissedKeys,
      expenseAsks,
      warrantyIssues,
      offers: ((offers.data ?? []) as unknown as {
        id: string; work_order_id: string; state: string; expires_at: string;
        proposed_start_date: string | null; approval_due_at: string | null;
        contractors: { company_name: string } | null;
      }[]).map((o) => ({
        id: o.id, workOrderId: o.work_order_id, state: o.state, expiresAt: o.expires_at,
        proposedStart: o.proposed_start_date, approvalDueAt: o.approval_due_at,
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
      quietSites: flags.map((f) => ({ workOrderId: f.work_order_id, at: f.created_at, days: f.meta?.days ?? 3 })),
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
      lastUpdateAt: sentUpdateRows
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
    // ⚑13: certificates within 30 days of expiry (or past it) — the console
    // page shows these as an amber banner so a lapsed cert can never be the
    // one on display.
    expiringDocs,
  };
}
