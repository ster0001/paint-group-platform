import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { ledger, type LedgerInput } from "@/lib/invoicing/ledger";

/**
 * A2-04 · The two ledgers must agree.
 *
 * `lib/invoicing/ledger.ts` and the SQL `public.invoice_ledger` are twins: the
 * TS one is what screens import, the SQL one is the authority inside
 * transactions. The audit (2026-08-28) found the twin was never diffed:
 *
 *   · ledger() has 15 unit tests and ZERO callers in the app;
 *   · schema.contract.test.ts pins the migration TEXT — it reads the .sql off
 *     disk and greps it, with no database involved;
 *   · so nothing compared the two implementations' ARITHMETIC.
 *
 * Change a constant in the TS ledger and 15 tests fail while behaviour is
 * unaffected. Change the live SQL and behaviour changes while nothing fails.
 * That is the inverse of what the suite appeared to offer, on the money path —
 * and it bites harder here because SQL is pasted by hand, so the migration file
 * can match while the database does not.
 *
 * This spec closes it. One fixture exercising every branch where the two could
 * disagree, then:
 *
 *   1. read the rows back from the database
 *   2. compute the ledger in TS from those rows
 *   3. call invoice_ledger_staff through a REAL staff session
 *   4. require all six figures to match
 *
 * Step 4 alone would pass if both sides were wrong in the same way, so the
 * expected figures are asserted too. Parity AND correctness, not parity alone.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const ACCEPTED = 1_000_000; // $10,000

/** Every figure distinct, so a wrong one names itself. */
const EXPECTED = {
  accepted_total_cents: ACCEPTED,
  variations_cents: 30_000,          // +50,000 approved, −20,000 credit
  adjusted_contract_cents: 1_030_000,
  invoiced_cents: 735_000,           // 760,000 issued+ … − 25,000 credit note
  paid_cents: 80_000,                // succeeded only
  balance_cents: 950_000,            // adjusted − paid
};

let fixture: LoopFixture | null = null;
let invoiceIds: string[] = [];

const tok = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

test.describe("the TS ledger and the SQL ledger agree", () => {
  test.skip(!staff || !contractor || !db, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error("no contractors row for the E2E contractor");
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Ledger", labels: ["Wall"] }]);

    await db!.from("estimates")
      .update({ accepted_total_cents: ACCEPTED, total_cents: ACCEPTED })
      .eq("id", fixture.estimateId);

    // ---- variations: only customer_approved + contractor_accepted count, a
    // credit subtracts, and an unpriced one is ignored by both sides.
    const v = (status: string, price: number | null, credit = false) => ({
      work_order_id: fixture!.workOrderId, category: "extra",
      status, price_cents: price, credit,
    });
    const { error: vErr } = await db!.from("wo_variations").insert([
      v("customer_approved", 50_000),
      v("contractor_accepted", 20_000, true),
      v("raised", 99_000),
      v("priced", 88_000),
      v("declined", 77_000),
      v("cancelled", 66_000),
      v("customer_approved", null),
    ]);
    if (vErr) throw new Error(`variations: ${vErr.message}`);

    // ---- invoices: draft and void are excluded; everything else counts,
    // written_off included. invoices_draft_unnumbered forces number/status
    // to agree, so a draft carries no number and the rest do.
    const inv = (status: string, total: number, n: number) => ({
      estimate_id: fixture!.estimateId, kind: "progress", status,
      number: status === "draft" ? null : `E2E-LP-${n}`,
      token: tok(),
      subtotal_ex_cents: total - Math.round(total / 11),
      gst_cents: Math.round(total / 11),
      total_inc_cents: total, amount_cents: total,
    });
    const { data: made, error: iErr } = await db!.from("invoices").insert([
      inv("draft", 100_000, 1), inv("void", 200_000, 2), inv("issued", 300_000, 3),
      inv("sent", 150_000, 4), inv("viewed", 120_000, 5), inv("partially_paid", 90_000, 6),
      inv("paid", 60_000, 7), inv("written_off", 40_000, 8),
    ]).select("id, status");
    if (iErr) throw new Error(`invoices: ${iErr.message}`);
    invoiceIds = (made as { id: string }[]).map((r) => r.id);
    const issued = (made as { id: string; status: string }[]).find((r) => r.status === "issued")!;

    const { error: cErr } = await db!.from("credit_notes").insert({
      invoice_id: issued.id, reason: "E2E ledger parity",
      subtotal_ex_cents: 25_000 - Math.round(25_000 / 11),
      gst_cents: Math.round(25_000 / 11), total_inc_cents: 25_000,
    });
    if (cErr) throw new Error(`credit note: ${cErr.message}`);

    // ---- payments: succeeded only.
    const pay = (status: string, amount: number) => ({
      invoice_id: issued.id, amount_cents: amount, status, method: "bank_transfer",
    });
    const { error: pErr } = await db!.from("payments").insert([
      pay("succeeded", 80_000), pay("failed", 500_000),
      pay("pending", 400_000), pay("refunded", 300_000),
    ]);
    if (pErr) throw new Error(`payments: ${pErr.message}`);
  });

  test.afterAll(async () => {
    if (!db || !fixture) return;
    // credit_notes -> invoices is RESTRICT, so these go before the invoices
    // destroyLoopFixture deletes. Leaving them would leak the fixture.
    if (invoiceIds.length) await db.from("credit_notes").delete().in("invoice_id", invoiceIds);
    await destroyLoopFixture(db, fixture);
  });

  test("six figures, computed twice, identical — and right", async () => {
    // ---- the SQL twin, through a real staff session (never the service key:
    // invoice_ledger is revoked from authenticated, the _staff wrapper is not).
    const sqlRows = await rpcAsJson<Record<string, number>[]>(
      staff!, "invoice_ledger_staff", { p_estimate_id: fixture!.estimateId },
    );
    expect(Array.isArray(sqlRows) && sqlRows.length === 1,
      `invoice_ledger_staff returned ${JSON.stringify(sqlRows)} — is the login staff?`).toBe(true);
    const sql = sqlRows[0];

    // ---- the TS twin, over the SAME rows the SQL one just read.
    const [{ data: est }, { data: vars }, { data: invs }, { data: pays }] = await Promise.all([
      db!.from("estimates").select("accepted_total_cents, total_cents").eq("id", fixture!.estimateId).single(),
      db!.from("wo_variations").select("status, price_cents, credit").eq("work_order_id", fixture!.workOrderId),
      db!.from("invoices").select("id, status, total_inc_cents").eq("estimate_id", fixture!.estimateId),
      db!.from("payments").select("status, amount_cents").in("invoice_id", invoiceIds),
    ]);
    const { data: creds } = await db!.from("credit_notes")
      .select("total_inc_cents").in("invoice_id", invoiceIds);

    const input: LedgerInput = {
      acceptedTotalCents: (est as { accepted_total_cents: number | null; total_cents: number | null })
        .accepted_total_cents ?? (est as { total_cents: number }).total_cents ?? 0,
      variations: ((vars ?? []) as { status: string; price_cents: number | null; credit: boolean }[])
        .map((r) => ({ status: r.status, priceCents: r.price_cents, credit: r.credit })),
      invoices: ((invs ?? []) as { status: string; total_inc_cents: number }[])
        .map((r) => ({ status: r.status as never, totalIncCents: r.total_inc_cents })),
      creditNoteTotalsIncCents: ((creds ?? []) as { total_inc_cents: number }[]).map((r) => r.total_inc_cents),
      payments: ((pays ?? []) as { status: string; amount_cents: number }[])
        .map((r) => ({ status: r.status as never, amountCents: r.amount_cents })),
    };
    const ts = ledger(input);

    // ---- 1. the twins agree, field by field, so a mismatch names itself
    const pairs: [string, number, number][] = [
      ["accepted_total_cents", ts.acceptedTotalCents, Number(sql.accepted_total_cents)],
      ["variations_cents", ts.variationsCents, Number(sql.variations_cents)],
      ["adjusted_contract_cents", ts.adjustedContractCents, Number(sql.adjusted_contract_cents)],
      ["invoiced_cents", ts.invoicedCents, Number(sql.invoiced_cents)],
      ["paid_cents", ts.paidCents, Number(sql.paid_cents)],
      ["balance_cents", ts.balanceCents, Number(sql.balance_cents)],
    ];
    for (const [field, tsVal, sqlVal] of pairs) {
      expect(tsVal, `${field}: lib/invoicing/ledger.ts says ${tsVal}, public.invoice_ledger says ${sqlVal}`)
        .toBe(sqlVal);
    }

    // ---- 2. …and both are RIGHT. Parity alone would pass if the two drifted
    // together, which is exactly what a hand-pasted migration makes possible.
    for (const [field, tsVal] of pairs) {
      expect(tsVal, `${field} is not the expected figure`).toBe(EXPECTED[field as keyof typeof EXPECTED]);
    }

    // ---- 3. every figure is an integer number of cents, on both sides.
    for (const [field, tsVal, sqlVal] of pairs) {
      expect(Number.isInteger(tsVal), `${field} (TS) is not integer cents`).toBe(true);
      expect(Number.isInteger(sqlVal), `${field} (SQL) is not integer cents`).toBe(true);
    }
  });
});
