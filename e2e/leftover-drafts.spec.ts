import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Leftover drafts (payments-merge brief §6.1, §6.2; migration 20270261).
 *
 *  · §6.2: drafting a final removes the job's unsent deposit draft — the final already includes it.
 *  · §6.1: nothing left to invoice → no $0 final; an unsent deposit draft goes too.
 *  · A SENT deposit is never touched, and a REDRAFT never removes a deposit draft (Tom, 13 Oct).
 *  · Redraft on a stale final with nothing left removes it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `LD${Date.now().toString(36).slice(-6).toUpperCase()}`;
const made: PaymentsJob[] = [];

const invoices = async (estimateId: string) => {
  const { data, error } = await db!.from("invoices").select("id, kind, status, total_inc_cents").eq("estimate_id", estimateId).order("created_at");
  if (error) throw error;
  return (data as { id: string; kind: string; status: string; total_inc_cents: number }[]).map((i) => `${i.kind}:${i.status}:${i.total_inc_cents}`);
};
const draftFinal = async (estimateId: string) => String((await db!.rpc("invoice_draft_final", { p_estimate_id: estimateId })).data);

test.describe("leftover drafts are never created", () => {
  test.setTimeout(180_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    await cleanupPaymentsJobs(db, made);
  });

  test("§6.2: a final drafted at sign-off clears the unsent deposit draft — and only a draft", async () => {
    const unsent = await makePaymentsJob(db!, contractor!.email, stamp, "Unsent", {
      contractCents: 300_000, stage: "closed", startDate: isoDay(-20),
      invoices: [{ kind: "deposit", status: "draft", total: 150_000, due: null }],
    });
    made.push(unsent);
    expect(await draftFinal(unsent.f.estimateId)).toMatch(/^ok:[0-9a-f-]{36}$/);
    // The final is the whole contract (the draft deposit was never invoiced); the deposit draft is gone.
    expect(await invoices(unsent.f.estimateId)).toEqual(["final:draft:300000"]);

    const sent = await makePaymentsJob(db!, contractor!.email, stamp, "Sentdep", {
      contractCents: 300_000, stage: "closed", startDate: isoDay(-20),
      invoices: [{ kind: "deposit", status: "sent", total: 150_000, due: isoDay(-10) }],
    });
    made.push(sent);
    expect(await draftFinal(sent.f.estimateId)).toMatch(/^ok:[0-9a-f-]{36}$/);
    expect(await invoices(sent.f.estimateId)).toEqual(["deposit:sent:150000", "final:draft:150000"]);
  });

  // Tom, 13 Oct: the deposit drafts already beside a final stay — so a REDRAFT never removes one.
  test("a redraft keeps the deposit draft beside the final", async () => {
    const kept = await makePaymentsJob(db!, contractor!.email, stamp, "Keptdep", {
      contractCents: 300_000, stage: "closed", startDate: isoDay(-20),
      invoices: [
        { kind: "deposit", status: "draft", total: 150_000, due: null },
        { kind: "final", status: "draft", total: 300_000, due: null },
      ],
    });
    made.push(kept);
    expect(await draftFinal(kept.f.estimateId)).toMatch(/^ok:[0-9a-f-]{36}$/);
    expect((await invoices(kept.f.estimateId)).sort()).toEqual(["deposit:draft:150000", "final:draft:300000"]);
  });

  test("§6.1: nothing left to invoice drafts no $0 final, and the unsent deposit draft goes with it", async () => {
    const full = await makePaymentsJob(db!, contractor!.email, stamp, "Fullyinv", {
      contractCents: 300_000, stage: "closed", startDate: isoDay(-20),
      invoices: [
        { kind: "progress", status: "sent", total: 300_000, due: isoDay(-5), paid: true },
        { kind: "deposit", status: "draft", total: 150_000, due: null },
      ],
    });
    made.push(full);
    expect(await draftFinal(full.f.estimateId)).toBe("ok:nothing_left");
    expect(await invoices(full.f.estimateId)).toEqual(["progress:sent:300000"]);
  });

  test("Redraft on a stale final with nothing left removes it", async ({ page }) => {
    const stale = await makePaymentsJob(db!, contractor!.email, stamp, "Stalefin", {
      contractCents: 300_000, stage: "closed", startDate: isoDay(-20),
      invoices: [
        { kind: "progress", status: "sent", total: 300_000, due: isoDay(-5), paid: true },
        { kind: "final", status: "draft", total: 300_000, due: null },
      ],
    });
    made.push(stale);
    // The draft final was worked out before the progress claim was issued (its drafted event says nothing was invoiced yet).
    const { data: fin } = await db!.from("invoices").select("id").eq("estimate_id", stale.f.estimateId).eq("kind", "final").single();
    const ev = await db!.from("invoice_events").insert({ invoice_id: (fin as { id: string }).id, type: "drafted", actor_kind: "system", meta: { auto: "final", previously_invoiced_cents: 0 } });
    if (ev.error) throw ev.error;

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/job/${stale.f.estimateId}`);
    const note = page.getByTestId("pm-panel").getByTestId("stale-final");
    await expect(note).toBeVisible({ timeout: 30_000 });
    await note.getByRole("button", { name: "Redraft" }).click();
    await expect.poll(() => invoices(stale.f.estimateId), { timeout: 20_000 }).toEqual(["progress:sent:300000"]);
  });
});
