import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";
import { logCrmEvent } from "@/lib/crm/events";
import { canAct, priceToFix, type ConfirmationRow } from "@/lib/wizard/confirmation-actions";

/**
 * POST /api/confirmations/:id — fix, ask, visit (C6, plan §2.6).
 *
 * "The estimator's day is the queue, with three actions per card." The
 * desk-check screen still LINKS to the flows that own each of those — prices
 * change in the builder, questions happen in the thread, visits in the visit
 * flow, and a fourth place to change money would be a fourth place for it to go
 * wrong. What this adds is the RECORD.
 *
 * C6's accept line is "a fixed price can only originate from the RPC". This is
 * that one door: it decides, writes `fixed_price_cents`, and is idempotent, so
 * a double-click cannot fix a price twice or send two emails.
 *
 * Staff only, and deliberately not a customer surface at all — C7 gives the
 * customer their own path to fixing a price, through the ladder, which is a
 * different decision with different rules.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["fix_price", "ask_question", "book_visit"]),
  /** fix_price: the number to fix, or absent to accept the central estimate. */
  priceCents: z.number().int().positive().max(100_000_000).optional(),
  /** ask_question: what to ask. Auto-send is OFF — staff send it themselves. */
  question: z.string().trim().min(1).max(2000).optional(),
  /** book_visit: the slot label, passed to the existing scheduling. */
  slot: z.string().trim().max(80).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const staff = await requireStaff(supabase);
  if (!staff) return NextResponse.json({ error: "Staff only." }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Unreadable." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That input isn't valid." }, { status: 400 });
  }
  const { action } = parsed.data;

  const { data: row, error: readErr } = await supabase
    .from("confirmation_requests")
    .select("id, estimate_id, status, kind, fixed_price_cents, pack")
    .eq("id", id).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "No such confirmation." }, { status: 404 });

  /**
   * IDEMPOTENCY, before anything else.
   *
   * A double-click on "fix the price" must not fix it twice or send a second
   * email. The terminal states are the guard, and repeating the action that
   * PRODUCED the current state answers 200 with what already happened rather
   * than an error — the estimator's second click is not a mistake to shout
   * about, it is a click that arrived after the first one worked.
   */
  const already =
    (action === "fix_price" && row.status === "fixed")
    || (action === "book_visit" && row.status === "visit_booked");
  if (already) {
    return NextResponse.json({
      ok: true, repeated: true, status: row.status,
      fixedPriceCents: row.fixed_price_cents ?? null,
    });
  }

  const verdict = canAct(row as unknown as ConfirmationRow, action);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 409 });

  const patch: Record<string, unknown> = { status: verdict.nextStatus };
  let fixedCents: number | null = null;

  if (action === "fix_price") {
    const pack = (row.pack ?? {}) as { totalCents?: number };
    // The engine's own figure, frozen into the pack at send. Accepting takes
    // THAT (⚑8), never the top of the band a customer was shown — being
    // quoted a range and charged its ceiling is a dishonest quote.
    const price = priceToFix({
      enteredCents: parsed.data.priceCents ?? null,
      centralCents: Number(pack.totalCents) || 0,
    });
    if (!price.ok) return NextResponse.json({ error: price.reason }, { status: 400 });
    fixedCents = price.cents;
    patch.fixed_price_cents = price.cents;
    patch.fixed_at = new Date().toISOString();
  }

  /**
   * The write is CONDITIONAL on the status we read.
   *
   * Two estimators on the same card, or one on a phone and a laptop, is the
   * same race C3 found in the customer's draft. Without the predicate the
   * second write wins silently and the first person's action disappears.
   */
  const { data: updated, error: writeErr } = await supabase
    .from("confirmation_requests")
    .update(patch).eq("id", id).eq("status", row.status)
    .select("id, status, fixed_price_cents").maybeSingle();
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });
  if (!updated) {
    return NextResponse.json({ error: "Somebody else just acted on this one — reload and look again." }, { status: 409 });
  }

  /**
   * The measured tree goes to the PROPERTY when a price is fixed (§8.3).
   *
   * This is the moment the tree stops being a guess: a person has looked at it
   * and put a number on it. Every later quick look on this address seeds from
   * here rather than from scratch, which is the whole point of §8.3 and the
   * reason a trade account is worth having.
   *
   * Best-effort and reported: failing to seed a future quote must not undo a
   * price that is now fixed and sent.
   */
  if (action === "fix_price") {
    try {
      const { data: est } = await supabase.from("estimates")
        .select("builder_state, account_id").eq("id", row.estimate_id).maybeSingle();
      const tree = (est?.builder_state as { blocks?: unknown[] } | null)?.blocks ?? null;
      if (tree && est?.account_id) {
        const { data: prop } = await supabase.from("properties")
          .select("id").eq("customer_id", est.account_id).limit(1).maybeSingle();
        if (prop?.id) {
          await supabase.from("properties")
            .update({ measured_tree: tree, measured_at: new Date().toISOString() })
            .eq("id", prop.id);
        }
      }
    } catch (e) {
      reportError(e, { where: "confirmations.measuredTree", bestEffort: true, extra: { id } });
    }

    await logCrmEvent(supabase, {
      type: "price_fixed",
      estimateId: row.estimate_id,
      source: "staff",
      payload: { totalCents: fixedCents ?? 0, kind: row.kind },
    }).catch((e) => reportError(e, { where: "confirmations.priceFixedEvent", bestEffort: true }));
  }

  if (action === "book_visit") {
    await logCrmEvent(supabase, {
      type: "visit_booked_from_wizard",
      estimateId: row.estimate_id,
      source: "staff",
      payload: { when: parsed.data.slot ?? "to be arranged" },
    }).catch((e) => reportError(e, { where: "confirmations.visitEvent", bestEffort: true }));
  }

  return NextResponse.json({
    ok: true, repeated: false,
    status: updated.status,
    fixedPriceCents: updated.fixed_price_cents ?? null,
  });
}
