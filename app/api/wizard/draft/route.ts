import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { WizardState } from "@/lib/wizard/state";
import { progressPct, uploadedSomething } from "@/lib/wizard/progress";
import { estimateDraftValue, type DraftRefData } from "@/lib/wizard/draftValue";
import { loadPricingContext } from "@/lib/pricing/context";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import { ensureAccount } from "@/lib/accounts/link";
import { normaliseEmail, isTestEmail } from "@/lib/accounts/identity";
import { reportError } from "@/lib/monitoring/report";

/**
 * Autosaving a part-finished wizard run (C15).
 *
 * Called as the customer answers, not at the end. It is the ONLY record of
 * somebody who leaves halfway — without it, a person who opens the wizard,
 * answers half the rooms and closes the tab is invisible, and every drop-out
 * funnel has nobody to reach.
 *
 * Three rules it lives by:
 *
 *  · Best-effort, always. A failed autosave must never interrupt somebody
 *    filling in a form. Every error path returns 200 with saved:false; the
 *    wizard neither waits for this nor shows anything when it fails.
 *
 *  · One draft per person. Keyed on the anonymous auth user the wizard already
 *    creates, so answering more of it updates a row rather than laying down a
 *    trail of half-drafts.
 *
 *  · An email means an ACCOUNT, not a login. The account row is created so the
 *    CRM has somebody to attach the draft to; membership still comes only from
 *    the verified magic link (the 3a-1 security rule). Typing an address into a
 *    form must never grant sight of an existing account's data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Partial by definition — this is a form somebody is halfway through. */
  state: z.record(z.string(), z.unknown()),
  /** A returning visitor, counted for the "came back" signal. */
  returning: z.boolean().optional(),
  /** Sent once when they finish, so the draft stops looking abandoned. */
  converted: z.boolean().optional(),
  estimateId: z.string().uuid().optional(),
  /** Where they had got to. The honest measure of how far through they are. */
  page: z.number().int().min(1).max(12).optional(),
  lastPage: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: Request) {
  const quietly = (why: string) => NextResponse.json({ saved: false, why });

  let raw: unknown;
  try { raw = await req.json(); } catch { return quietly("unreadable"); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return quietly("shape");

  // The wizard signs the visitor in anonymously before anything else; without
  // a session there is nothing to key a draft on, and no way to tell two
  // people apart.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return quietly("no session");

  // The state is stored as given. A half-answered form does not satisfy the
  // full schema and is not supposed to — and it cannot be loosened either:
  // wizardStateSchema carries cross-field refinements, so `.partial()` THROWS
  // at runtime ("cannot be used on object schemas containing refinements")
  // while TypeScript accepts it happily. That cost a 500 on every autosave.
  // The signal helpers read defensively, so the raw object is what they want.
  const state = parsed.data.state as Record<string, unknown>;
  const forSignals = state as Partial<WizardState>;

  const contact = (state.contact ?? {}) as { name?: string; email?: string; phone?: string };
  const customer = (state.customer ?? {}) as { email?: string; suburb?: string; postcode?: string };
  const email = normaliseEmail(contact.email || customer.email || "");

  const db = createServiceClient();
  if (!db) return quietly("no service client");

  // An email means an account exists to hang the draft off. Test addresses are
  // skipped: a run from the e2e suite must not create a customer.
  let accountId: string | null = null;
  if (email.includes("@") && !isTestEmail(email)) {
    try {
      const linked = await ensureAccount(db, {
        email,
        name: contact.name?.trim() || null,
        phone: contact.phone?.trim() || null,
      });
      accountId = linked.accountId;
    } catch (e) {
      reportError(e, { where: "wizard.draft.account", bestEffort: true });
    }
  }

  // C15 step 3 · what this run is roughly worth, priced by the submit
  // route's own functions. Only when the answers already satisfy the full
  // schema — a dollar figure built on guesses puts calls on the wrong desks —
  // and never allowed to break the save: est_value_cents simply stays null.
  let estValueCents: number | null = null;
  try {
    const [ctx, { data: rulesRows }, { data: aliasRows }, { data: defectRows }, { data: typicalRows }] =
      await Promise.all([
        loadPricingContext(db),
        db.from("room_type_scope_rules").select("room_type, surface_type, is_option, requires_confirm, notes").eq("version", SCOPE_VERSION),
        db.from("room_name_aliases").select("alias, room_type").eq("version", SCOPE_VERSION),
        db.from("defect_prep_rates").select("defect_type, unit, hours_sev1, hours_sev2, hours_sev3").eq("version", SCOPE_VERSION),
        db.from("room_type_defaults").select("room_type, typical_length_m, typical_width_m").eq("version", 3),
      ]);
    const refs = {
      rules: rulesRows ?? [], aliases: aliasRows ?? [],
      defectRates: defectRows ?? [], typicals: typicalRows ?? [],
    } as DraftRefData;
    const value = estimateDraftValue(state, refs, ctx);
    if ("totalCents" in value) estValueCents = value.totalCents;
  } catch (e) {
    reportError(e, { where: "wizard.draft.value", bestEffort: true });
  }

  const now = new Date().toISOString();
  const row = {
    user_id: user.id,
    account_id: accountId,
    name: contact.name?.trim() || null,
    email: email || null,
    phone: contact.phone?.trim() || null,
    job_type: (state.jobType as string) ?? null,
    suburb: (customer.suburb as string) ?? null,
    postcode: (customer.postcode as string) ?? null,
    state,
    progress_pct: progressPct(forSignals, parsed.data.page, parsed.data.lastPage),
    uploaded: uploadedSomething(forSignals),
    ...(estValueCents != null ? { est_value_cents: estValueCents } : {}),
    last_seen_at: now,
    ...(parsed.data.converted ? { converted_at: now, estimate_id: parsed.data.estimateId ?? null } : {}),
  };

  try {
    const { data: existing } = await db.from("wizard_drafts")
      .select("id, visits").eq("user_id", user.id).is("converted_at", null).maybeSingle();

    if (existing) {
      await db.from("wizard_drafts").update({
        ...row,
        // Coming BACK is the strongest signal there is, so it is counted
        // rather than inferred from timestamps later.
        ...(parsed.data.returning ? { visits: ((existing.visits as number) ?? 1) + 1 } : {}),
      }).eq("id", existing.id);
      return NextResponse.json({ saved: true, id: existing.id });
    }

    // The race the probe run caught: submit converts the draft server-side,
    // then a trailing autosave (or the client's own convert echo) arrives and
    // finds no open row — and would found a NEW one, resurrecting a person
    // who just finished onto the drop-out list. A conversion in the last few
    // minutes means these stragglers belong to the finished run.
    if (!parsed.data.converted) {
      const { data: justDone } = await db.from("wizard_drafts")
        .select("id, converted_at").eq("user_id", user.id)
        .not("converted_at", "is", null)
        .order("converted_at", { ascending: false }).limit(1).maybeSingle();
      if (justDone?.converted_at
          && Date.now() - new Date(justDone.converted_at as string).getTime() < 10 * 60_000) {
        return NextResponse.json({ saved: false, why: "just finished" });
      }
    }

    const { data: inserted, error } = await db.from("wizard_drafts")
      .insert({ ...row, started_at: now }).select("id").single();
    if (error) { reportError(error, { where: "wizard.draft.insert", bestEffort: true }); return quietly("insert"); }
    return NextResponse.json({ saved: true, id: inserted.id });
  } catch (e) {
    reportError(e, { where: "wizard.draft", bestEffort: true });
    return quietly("threw");
  }
}
