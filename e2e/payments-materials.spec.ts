import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge, Step 6 — the Materials block (docs/briefs/claude-code-brief-payments-merge.md §4.6).
 *
 *  · Every row opens its original document (View).
 *  · Confirm on a job found = confirmed AND approved (⚑P9), filed as materials (§6.9).
 *  · Pick a job, Not for a job (overhead — leaves the to-match queue, §6.8).
 *  · Delete keeps the row and its document, counts nowhere, and Restore puts it back.
 *  · A possible duplicate is dismissed, not written twice.
 *  · Paid per supplier with Undo (⚑P10).
 *  · The block's "to check" count equals the intake queue.
 *  · A customer can't call any of it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PM6${Date.now().toString(36).slice(-5).toUpperCase()}`;
const PAGE = "/invoicing?tab=mat";
const BUCKET = "cost-docs";
const DOC = `bills/e2e/${stamp}.pdf`;
const DOMAIN = `${stamp.toLowerCase()}.invalid`;
const made: PaymentsJob[] = [];
const intakeIds: string[] = [];
let vendorId = "";
const noJobIds: string[] = [];

// The smallest PDF a browser will open.
const PDF = "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";

async function doc(label: string, opts: { totalCents: number; woId?: string | null; status?: "pending" | "duplicate"; duplicateOf?: string; unread?: boolean }) {
  const { data, error } = await db!.from("cost_intake").insert({
    source: "email", message_id: `e2e-${stamp}-${label}`, raw_doc_path: DOC, from_email: `invoices@${DOMAIN}`, subject: `Invoice ${label}`,
    extract_status: opts.unread ? "failed" : "extracted", match_reason: opts.woId ? "address" : "none", status: opts.status ?? "pending",
    proposed_wo_id: opts.woId ?? null, proposed_vendor_id: vendorId, duplicate_of: opts.duplicateOf ?? null,
    extracted: { supplier: `${stamp} Paints Pty Ltd`, invoice_no: `${stamp}-${label}`, invoice_date: isoDay(-1), total_cents: opts.totalCents, gst_cents: Math.round(opts.totalCents / 11), order_ref: `${label} ref` },
  }).select("id").single();
  if (error) throw error;
  intakeIds.push(data!.id as string);
  return data!.id as string;
}
const intakeRow = async (id: string) => (await db!.from("cost_intake").select("status, confirmed_at, resulting_type, resulting_id").eq("id", id).single()).data as
  { status: string; confirmed_at: string | null; resulting_type: string | null; resulting_id: string | null };
const costOf = async (intakeId: string) => (await db!.from("job_costs").select("id, status, category, work_order_id").eq("intake_id", intakeId).maybeSingle()).data as
  { id: string; status: string; category: string; work_order_id: string } | null;
const row = (page: Page, label: string) => page.locator(".pm [data-testid=pm-materials] .prow", { hasText: `${stamp}-${label}` });

test.describe("Payments → Materials — a customer can't reach it", () => {
  test("an anonymous session is refused by every new materials function", async () => {
    const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const nobody = "00000000-0000-4000-8000-000000000000";
    for (const [fn, args] of [
      ["cost_intake_confirm_materials", { p_id: nobody }], ["cost_intake_not_for_job", { p_id: nobody }], ["cost_intake_restore", { p_id: nobody }],
      ["job_cost_void", { p_id: nobody }], ["job_cost_restore", { p_id: nobody }], ["job_cost_unpay", { p_id: nobody }],
    ] as const) {
      const { data, error } = await visitor.rpc(fn, args);
      expect(error?.code === "42501" || data === "error:not_staff", `${fn}: ${JSON.stringify(data ?? error)}`).toBe(true);
    }
  });
});

test.describe("Payments → Materials — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    const up = await db!.storage.from(BUCKET).upload(DOC, new Blob([PDF], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    if (up.error) throw up.error;
    const { data, error } = await db!.from("vendors").insert({ name: `${stamp} Paints Pty Ltd`, default_category: "materials", sender_domains: [DOMAIN] }).select("id").single();
    if (error) throw error;
    vendorId = data!.id as string;
  });

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    await db.from("material_costs").delete().in("intake_id", intakeIds);
    if (noJobIds.length) await db.from("material_costs").delete().in("id", noJobIds);
    await db.from("job_costs").delete().in("intake_id", intakeIds);
    await db.from("cost_intake").delete().in("id", intakeIds);
    await cleanupPaymentsJobs(db, made);
    await db.from("vendors").delete().eq("id", vendorId);
    await db.storage.from(BUCKET).remove([DOC]);
  });

  test("confirm, pick a job, not for a job, delete and restore, dismiss, view — and pay the supplier with Undo", async ({ page }) => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Matjob", { contractCents: 300_000, stage: "in_progress", startDate: isoDay(-3), invoices: [] });
    made.push(j);
    const found = await doc("FOUND", { totalCents: 52_008, woId: j.f.workOrderId });
    const nojob = await doc("NOJOB", { totalCents: 2_990 });
    const overhead = await doc("OVERHEAD", { totalCents: 14_347 });
    const junk = await doc("JUNK", { totalCents: 1_000 });
    const dup = await doc("DUP", { totalCents: 52_008, status: "duplicate", duplicateOf: found });

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(PAGE);
    const block = page.locator(".pm [data-testid=pm-materials]");
    await expect(row(page, "FOUND")).toContainText("Matjob St", { timeout: 30_000 });
    await expect(row(page, "FOUND")).toContainText("GST $47.28");   // kept from the old intake card (Tom, 13 Oct)
    await expect(page.getByTestId("pm-suppliers")).toContainText(new RegExp(`${stamp}\\$703\\.45`, "i"));   // one clean name; the duplicate isn't counted

    // The block's count is the intake queue (non-duplicate, waiting).
    const { count: queue } = await db!.from("cost_intake").select("id", { count: "exact", head: true }).eq("status", "pending").is("resulting_id", null);
    await expect(page.getByTestId("pm-ledger")).toContainText(`${queue} to check`);

    // View opens the original document.
    await row(page, "FOUND").getByRole("button", { name: "View" }).click();
    const sheet = page.getByRole("dialog", { name: "Captured document" });
    await expect(sheet.locator("iframe")).toHaveAttribute("src", /token=/, { timeout: 20_000 });
    await sheet.getByRole("button", { name: "Close" }).click();

    // Confirm on the job found = confirmed and approved, as materials.
    await row(page, "FOUND").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByTestId("pm-toast")).toContainText("confirmed to");
    expect(await costOf(found)).toMatchObject({ status: "approved", category: "materials", work_order_id: j.f.workOrderId });
    expect((await intakeRow(found)).status).toBe("confirmed");

    // No job found: pick one.
    await row(page, "NOJOB").getByRole("button", { name: "Pick a job" }).click();
    const picker = page.getByRole("dialog", { name: "Which job is this for?" });
    await picker.getByLabel("Search jobs").fill(`${stamp} Matjob`);
    await picker.getByRole("button", { name: new RegExp(`${stamp} Matjob St`) }).click();
    await expect.poll(async () => (await costOf(nojob))?.work_order_id, { timeout: 20_000 }).toBe(j.f.workOrderId);

    // Not for a job: overhead, out of the to-match queue.
    await row(page, "OVERHEAD").getByRole("button", { name: "Not for a job" }).click();
    await expect.poll(async () => (await intakeRow(overhead)).resulting_type, { timeout: 20_000 }).toBe("material_cost");
    const { data: mc } = await db!.from("material_costs").select("work_order_id, overhead").eq("intake_id", overhead).single();
    expect(mc).toEqual({ work_order_id: null, overhead: true });

    // Delete keeps it (rejected, document still there) and Restore puts it back.
    await row(page, "JUNK").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("pm-toast")).toContainText("deleted");
    expect((await intakeRow(junk)).status).toBe("rejected");
    await page.reload();
    await page.getByTestId("pm-deleted").locator("summary").click();
    await row(page, "JUNK").getByRole("button", { name: "Restore" }).click();
    await expect.poll(async () => (await intakeRow(junk)).status, { timeout: 20_000 }).toBe("pending");

    // A possible duplicate is dismissed — never written twice.
    await page.reload();
    await block.locator(".prow", { hasText: "Possible duplicate" }).filter({ has: page.getByRole("button", { name: "Dismiss" }) }).first().getByRole("button", { name: "Dismiss" }).click();
    await expect.poll(async () => (await intakeRow(dup)).confirmed_at, { timeout: 20_000 }).not.toBeNull();
    expect(await costOf(dup)).toBeNull();

    // Paid per supplier, one press, with Undo.
    await page.reload();
    const supplierRow = block.locator(".prow.grp", { hasText: new RegExp(stamp, "i") });
    await supplierRow.getByRole("button", { name: /✓ Paid \$549\.98/ }).click();     // $520.08 + $29.90
    await expect.poll(async () => [(await costOf(found))?.status, (await costOf(nojob))?.status], { timeout: 20_000 }).toEqual(["paid", "paid"]);
    await page.getByTestId("pm-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => [(await costOf(found))?.status, (await costOf(nojob))?.status], { timeout: 20_000 }).toEqual(["approved", "approved"]);
  });

  // 8c — what only the old Payables tab did: any category, typed amounts, materials with no job.
  test("Record as a cost: an unread docket filed as rubbish with typed amounts; a no-job material assigned to its job", async ({ page }) => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Costjob", { contractCents: 300_000, stage: "in_progress", startDate: isoDay(-3), invoices: [] });
    made.push(j);
    const unread = await doc("UNREAD", { totalCents: 0, unread: true });
    const { data: mc, error } = await db!.from("material_costs").insert({ supplier: `${stamp} Paints`, amount_cents: 14_347, order_ref: `${stamp}-NOJOB`, source: "airtable" }).select("id").single();
    if (error) throw error;
    noJobIds.push(mc!.id as string);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(PAGE);
    await row(page, "UNREAD").getByRole("button", { name: "Record as a cost…" }).click();
    const sheet = page.getByRole("dialog", { name: "Record as a cost" });
    await sheet.getByRole("button", { name: "Rubbish" }).click();
    await sheet.getByLabel("Job").fill(`${stamp} Costjob`);
    await sheet.getByRole("button", { name: new RegExp(`${stamp} Costjob St`) }).click();
    await sheet.getByLabel("Total inc GST ($)").fill("220");
    await expect(sheet.getByLabel("GST ($)", { exact: true })).toHaveValue("20.00");
    await sheet.getByRole("button", { name: "Record $220.00" }).click();
    await expect.poll(async () => await costOf(unread), { timeout: 20_000 }).toMatchObject({ category: "rubbish", work_order_id: j.f.workOrderId, status: "recorded" });
    const { data: amounts } = await db!.from("job_costs").select("amount_ex_cents, gst_cents, doc_path").eq("intake_id", unread).single();
    expect(amounts).toEqual({ amount_ex_cents: 20_000, gst_cents: 2_000, doc_path: DOC });   // the document rode along

    // No job yet → Assign to a job.
    await page.reload();
    const noJob = page.getByTestId("pm-no-job").locator(`[data-material="${mc!.id}"]`);
    await expect(noJob).toContainText("$143.47", { timeout: 30_000 });
    await noJob.getByRole("button", { name: "Assign to a job" }).click();
    const picker = page.getByRole("dialog", { name: "Which job is this for?" });
    await picker.getByLabel("Search jobs").fill(`${stamp} Costjob`);
    await picker.getByRole("button", { name: new RegExp(`${stamp} Costjob St`) }).click();
    await expect.poll(async () => ((await db!.from("material_costs").select("work_order_id").eq("id", mc!.id).single()).data as { work_order_id: string | null }).work_order_id, { timeout: 20_000 })
      .toBe(j.f.workOrderId);
  });
});

