import { test, expect } from "@playwright/test";
import { credentials } from "./helpers";
import {
  contractorIdForEmail,
  createLoopFixture,
  destroyLoopFixture,
  rpcAs,
  serviceClient,
  type LoopFixture,
} from "./fixtures/woLoop";

/**
 * 6c — contractor expenses, end to end (C1 stack), against the acceptance
 * list: no claim without a receipt · ask-first over the threshold (an
 * unapproved over-threshold claim is visible amber, never silent) ·
 * reimbursement lines reconcile to approved claims to the cent · approved
 * claims ride the next invoice and are PAID when it is.
 *
 * RPC-level in each REAL role (rpcAs) — the only honest way to test RLS.
 */

const db = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

const TINY_PDF = Buffer.from("%PDF-1.4\n%%EOF");

let fixture: LoopFixture | null = null;
let migrationMissing = false;
let receiptPath = "";
let preapprovalId = "";
const expenseIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.describe("6c — contractor expenses", () => {
  test.beforeAll(async () => {
    if (!db || !contractor || !staff) return;
    const probe = await db.from("contractor_expenses").select("id").limit(1);
    migrationMissing = Boolean(probe.error);
    if (migrationMissing) return;

    const contractorId = await contractorIdForEmail(db, contractor.email);
    if (!contractorId) return;
    fixture = await createLoopFixture(db, contractorId, [{ heading: "Exterior", labels: ["Walls"] }]);
    // An agreed amount, so a claim invoice exists to carry reimbursements.
    await db.from("work_orders").update({ contractor_payment_cents: 500000 })
      .eq("id", fixture.workOrderId);

    // A receipt in the contractor's OWN prefix (their auth uid).
    const { data: c } = await db.from("contractors").select("profile_id").eq("id", contractorId).single();
    const uid = (c as { profile_id: string }).profile_id;
    receiptPath = `receipts/${uid}/e2e-${Date.now()}-receipt.pdf`;
    await db.storage.from("cost-docs").upload(receiptPath, TINY_PDF, { contentType: "application/pdf", upsert: true });
  });

  test.afterAll(async () => {
    if (!db) return;
    if (receiptPath) await db.storage.from("cost-docs").remove([receiptPath]).catch(() => {});
    await destroyLoopFixture(db, fixture);
  });

  const gate = () => {
    test.skip(!db || !staff || !contractor, "creds/service key missing");
    test.skip(migrationMissing, "needs migration 20261127 on this stack");
    test.skip(!fixture, "fixture not created");
  };

  test("no receipt, no claim", async () => {
    gate();
    const r = await rpcAs(contractor!, "contractor_expense_submit", {
      p_work_order_id: fixture!.workOrderId, p_category: "sundries",
      p_amount_cents: 4200, p_gst_cents: 382, p_receipt_path: "", p_note: "",
      p_preapproval_id: null,
    });
    expect(r).toBe("error:no_receipt");
  });

  test("ask-first: the contractor requests, the office approves with a cap", async () => {
    gate();
    const asked = await rpcAs(contractor!, "expense_preapproval_request", {
      p_work_order_id: fixture!.workOrderId,
      p_description: "Extra undercoat, 10L", p_est_cents: 16000,
    });
    expect(asked.startsWith("ok:")).toBeTruthy();
    preapprovalId = asked.slice(3);

    const decided = await rpcAs(staff!, "expense_preapproval_decide", {
      p_id: preapprovalId, p_approve: true, p_cap_cents: 18000,
    });
    expect(decided.startsWith("ok:")).toBeTruthy();
    const { data } = await db!.from("expense_preapprovals").select("status, cap_cents").eq("id", preapprovalId).single();
    expect(data).toEqual({ status: "approved", cap_cents: 18000 });
  });

  test("a claim under the threshold submits clean", async () => {
    gate();
    const r = await rpcAs(contractor!, "contractor_expense_submit", {
      p_work_order_id: fixture!.workOrderId, p_category: "tip_fees",
      p_amount_cents: 6800, p_gst_cents: 618, p_receipt_path: receiptPath,
      p_note: "Tip run", p_preapproval_id: null,
    });
    expect(r.startsWith("ok:")).toBeTruthy();
    expenseIds.push(r.slice(3));
    const { data } = await db!.from("contractor_expenses")
      .select("over_threshold_unapproved, status").eq("id", r.slice(3)).single();
    expect(data).toEqual({ over_threshold_unapproved: false, status: "submitted" });
  });

  test("over the threshold WITHOUT pre-approval: submits, but flagged amber", async () => {
    gate();
    const r = await rpcAs(contractor!, "contractor_expense_submit", {
      p_work_order_id: fixture!.workOrderId, p_category: "other",
      p_amount_cents: 25000, p_gst_cents: 2272, p_receipt_path: receiptPath,
      p_note: "Emergency hire", p_preapproval_id: null,
    });
    expect(r.startsWith("ok:")).toBeTruthy();
    expenseIds.push(r.slice(3));
    const { data } = await db!.from("contractor_expenses")
      .select("over_threshold_unapproved").eq("id", r.slice(3)).single();
    expect((data as { over_threshold_unapproved: boolean }).over_threshold_unapproved).toBe(true);
  });

  test("over the threshold WITH the approved cap: clean", async () => {
    gate();
    const r = await rpcAs(contractor!, "contractor_expense_submit", {
      p_work_order_id: fixture!.workOrderId, p_category: "materials_topup",
      p_amount_cents: 16450, p_gst_cents: 1495, p_receipt_path: receiptPath,
      p_note: "Extra undercoat 10L", p_preapproval_id: preapprovalId,
    });
    expect(r.startsWith("ok:")).toBeTruthy();
    expenseIds.push(r.slice(3));
    const { data } = await db!.from("contractor_expenses")
      .select("over_threshold_unapproved").eq("id", r.slice(3)).single();
    expect((data as { over_threshold_unapproved: boolean }).over_threshold_unapproved).toBe(false);
  });

  test("AS PC: approve two claims, reject one", async () => {
    gate();
    for (const [i, id] of expenseIds.entries()) {
      const approve = i !== 1; // the flagged emergency hire gets rejected
      const r = await rpcAs(staff!, "contractor_expense_decide", { p_id: id, p_approve: approve });
      expect(r.startsWith("ok:")).toBeTruthy();
    }
    const { data } = await db!.from("contractor_expenses")
      .select("id, status").in("id", expenseIds).order("created_at");
    const statuses = (data as { status: string }[]).map((x) => x.status);
    expect(statuses.sort()).toEqual(["approved", "approved", "rejected"]);
  });

  test("approved expenses ride the next claim invoice to the cent — and pay out with it", async () => {
    gate();
    // 25% claim of the $5,000 agreed = $1,250; reimbursements 68.00 + 164.50.
    const r = await rpcAs(contractor!, "contractor_invoice_request", {
      p_work_order_id: fixture!.workOrderId, p_mode: "percent", p_value: 25,
      p_lines: null, p_invoice_date: null,
    });
    expect(r).toMatch(/^ok:/);
    const invoiceId = r.slice(3);

    const { data } = await db!.from("contractor_invoices")
      .select("total_inc_cents, reimbursement_cents, reimbursement_lines")
      .eq("id", invoiceId).single();
    const ci = data as { total_inc_cents: number; reimbursement_cents: number; reimbursement_lines: { cents: number }[] };
    expect(ci.reimbursement_cents).toBe(6800 + 16450);
    expect(ci.total_inc_cents).toBe(125000 + 6800 + 16450);
    expect(ci.reimbursement_lines.reduce((n, l) => n + l.cents, 0)).toBe(ci.reimbursement_cents);

    // The rejected one stays off it; the approved two are attached.
    const { data: attached } = await db!.from("contractor_expenses")
      .select("id, invoice_id, status").in("id", expenseIds);
    const rows = attached as { id: string; invoice_id: string | null; status: string }[];
    expect(rows.filter((x) => x.invoice_id === invoiceId)).toHaveLength(2);
    expect(rows.find((x) => x.status === "rejected")!.invoice_id).toBeNull();

    // PC approves and pays the invoice → the expenses are PAID with it.
    expect((await rpcAs(staff!, "contractor_invoice_approve", { p_id: invoiceId })).startsWith("ok")).toBeTruthy();
    expect((await rpcAs(staff!, "contractor_invoice_mark_paid", {
      p_id: invoiceId, p_reference: "E2E-REIMB", p_paid_on: null,
    })).startsWith("ok")).toBeTruthy();
    const { data: after } = await db!.from("contractor_expenses")
      .select("status").in("id", expenseIds.filter((_, i) => i !== 1));
    expect((after as { status: string }[]).every((x) => x.status === "paid")).toBe(true);
  });
});
