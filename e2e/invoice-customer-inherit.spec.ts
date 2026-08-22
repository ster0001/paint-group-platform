import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";

/**
 * A2 · the live half of the invoice/customer contract.
 *
 * `lib/invoicing/contract.test.ts` proves the SQL names `customer_id`. This
 * proves the running database actually COPIES it — which the contract test
 * cannot, because a subselect that names the right column can still return
 * the wrong row.
 *
 * Why this test exists at all: today `accept_estimate` writes null, because
 * nothing in the product sets `estimates.customer_id` (70 of 71 rows null,
 * see docs/briefs/customer-identity-link.md). A test against real data would
 * therefore pass while proving nothing. So the fixture sets the customer on
 * the estimate ITSELF, and the assertion is inheritance, not presence.
 *
 * When the identity link lands, this test needs no change — it already
 * describes the behaviour that work is meant to produce.
 */
const db: SupabaseClient | null = serviceClient();

test.describe("an invoice inherits the estimate's customer", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the A2 inheritance proof");
  test.skip(process.env.E2E_A2_READY !== "1",
    "needs migration 20261026000000_invoices_customer_link applied");

  test("accept_estimate copies customer_id onto the deposit invoice", async () => {
    const sb = db!;
    let estimateId: string | null = null;

    // A real customers row — three exist on the project; any one proves the copy.
    const { data: customer, error: custErr } = await sb
      .from("customers").select("id").limit(1).single();
    if (custErr) throw new Error(`no customers row to test with: ${custErr.message}`);
    const customerId = customer.id as string;

    try {
      const token = `a2test${Math.abs(Date.now() % 1e10)}${process.pid}`;

      // status 'sent' with a level of finish, or estimates_finish_required_when_sent
      // refuses it. The snapshot is where accept_estimate takes the money from —
      // the caller's numbers are ignored on purpose, so it must be present.
      const { data: est, error: estErr } = await sb.from("estimates").insert({
        title: "A2 inheritance proof",
        status: "sent",
        level_of_finish: 3,
        customer_id: customerId,
        share_token: token,
        total_cents: 100_000,
        builder_state: { blocks: [] },
        sent_snapshot: { totals: { totalCents: 100_000 }, depositPct: 50 },
      }).select("id").single();
      if (estErr) throw new Error(estErr.message);
      estimateId = est.id as string;

      const { data: result, error: rpcErr } = await sb.rpc("accept_estimate", {
        p_token: token, p_name: "A2 Test", p_options: {},
        p_total_cents: 0, p_deposit_cents: 0,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      expect(result).toBe("accepted");

      const { data: invoice } = await sb.from("invoices")
        .select("id, customer_id, estimate_id, amount_cents")
        .eq("estimate_id", estimateId).single();

      // The point of the whole batch, in one line.
      expect(invoice!.customer_id).toBe(customerId);
      // And the deposit still comes from the snapshot, not the caller's zero.
      expect(invoice!.amount_cents).toBe(50_000);
    } finally {
      // TEARDOWN ORDER IS THE POINT (A2 §4): estimate_id is now ON DELETE
      // RESTRICT, so the invoice must go first or the estimate delete is
      // refused. Every other teardown in this suite needs the same change.
      if (estimateId) {
        await sb.from("invoices").delete().eq("estimate_id", estimateId);
        await sb.from("work_orders").delete().eq("estimate_id", estimateId);
        await sb.from("estimate_events").delete().eq("estimate_id", estimateId);
        await sb.from("estimates").delete().eq("id", estimateId);
      }
    }
  });

  test("the RESTRICT constraint refuses an estimate that still has an invoice", async () => {
    const sb = db!;
    let estimateId: string | null = null;
    try {
      const { data: est } = await sb.from("estimates").insert({
        title: "A2 restrict proof", status: "draft", builder_state: { blocks: [] },
      }).select("id").single();
      estimateId = est!.id as string;

      await sb.from("invoices").insert({
        estimate_id: estimateId, status: "draft", amount_cents: 1234,
      });

      // Not the revoke — the service role may delete. This is the FK talking.
      const refused = await sb.from("estimates").delete().eq("id", estimateId);
      expect(refused.error).not.toBeNull();
      expect(refused.error!.code).toBe("23503"); // foreign_key_violation
    } finally {
      if (estimateId) {
        await sb.from("invoices").delete().eq("estimate_id", estimateId);
        await sb.from("estimates").delete().eq("id", estimateId);
      }
    }
  });
});
