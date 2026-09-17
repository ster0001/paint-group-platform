import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";

/**
 * WorkCover on Insurance & licences (Tom, 17 Sep 2026): "ask for WorkCover
 * certificates as well as the public liability policy; the gate passes on
 * public liability alone, but WorkCover is required if they have any other
 * workers working with them."
 *
 * Three rules, in the contractor's own session:
 *   1. The section asks for both, and WorkCover is a document type they can pick.
 *   2. A crew bigger than one with no WorkCover on file is TOLD it is required
 *      — on the profile and as a Home action item. A crew of one is not.
 *   3. It is never a gate: the e2e contractor is offerable on their public
 *      liability alone, and stays so with and without a WorkCover row.
 */
const creds = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let contractorId: string | null = null;
let crewBefore: number | null = null;
let workcoverDocId: string | null = null;
let docPath = "";

async function setCrew(n: number) {
  const { error } = await db!.from("contractors").update({ crew_size: n }).eq("id", contractorId!);
  if (error) throw new Error(`crew_size: ${error.message}`);
}

test.describe("WorkCover asked for, never a gate", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to read the contractor row");

  test.beforeAll(async () => {
    contractorId = await contractorIdForEmail(db!, creds!.email);
    docPath = `${contractorId}/workcover-e2e.pdf`;
    const { data } = await db!.from("contractors").select("crew_size").eq("id", contractorId!).single();
    crewBefore = (data as { crew_size: number | null } | null)?.crew_size ?? 1;
    // Start from a clean slate: any WorkCover row a broken run left behind.
    await db!.from("contractor_documents").delete().eq("contractor_id", contractorId!).eq("kind", "workcover");
  });

  test.afterAll(async () => {
    if (!contractorId) return;
    if (workcoverDocId) await db!.from("contractor_documents").delete().eq("id", workcoverDocId);
    if (docPath) await db!.storage.from("contractor-docs").remove([docPath]);
    await setCrew(crewBefore ?? 1);
  });

  test("the section asks for public liability AND WorkCover, and WorkCover is a document type", async ({ page }) => {
    await setCrew(1);
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    const section = page.locator(".card", { has: page.getByRole("heading", { name: /insurance & licences/i }) });
    await expect(section).toContainText(/public liability certificate/i);
    await expect(section).toContainText(/WorkCover certificate/i);
    await expect(section).toContainText(/required if you have any other workers/i);
    await expect(section.locator("#dockind option", { hasText: /WorkCover/ })).toHaveCount(1);
    // A crew of one is not told WorkCover is required.
    await expect(page.getByTestId("workcover-required")).toHaveCount(0);
  });

  test("a crew bigger than one with no WorkCover on file is told it is required — and stays offerable", async ({ page }) => {
    await setCrew(3);
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    await expect(page.getByTestId("workcover-required")).toContainText(/3 painters .* WorkCover certificate is required/i);
    // The gate is public liability alone: still Ready for work with no WorkCover.
    await expect(page.locator("body")).toContainText(/ready for work/i);

    await page.goto("/portal");
    await expect(page.locator(".act", { hasText: /WorkCover certificate/i })).toBeVisible();
    await expect(page.locator(".act", { hasText: /WorkCover certificate/i })).toContainText(/Needed/);
  });

  test("a WorkCover row is accepted by the database and does not move the offerable flag", async ({ page }) => {
    const { data: before } = await db!.from("contractors").select("offerable").eq("id", contractorId!).single();
    // The database checks the file is real and in this contractor's folder
    // (20260831) and the expiry sane (20260908): upload first, a year out.
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF workcover e2e");
    const up = await db!.storage.from("contractor-docs").upload(docPath, pdf, { contentType: "application/pdf", upsert: true });
    expect(up.error).toBeNull();
    const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1);
    const { data: row, error } = await db!.from("contractor_documents").insert({
      contractor_id: contractorId!, kind: "workcover", name: "workcover-e2e.pdf",
      file_url: docPath, expires_on: expires.toISOString().slice(0, 10),
    }).select("id").single();
    expect(error).toBeNull();
    workcoverDocId = (row as { id: string }).id;
    const { data: after } = await db!.from("contractors").select("offerable").eq("id", contractorId!).single();
    expect((after as { offerable: boolean }).offerable).toBe((before as { offerable: boolean }).offerable);

    // Uploaded (being checked) already counts as on file: the note goes.
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    await expect(page.locator(".doc", { hasText: /WorkCover insurance/ })).toBeVisible();
    await expect(page.getByTestId("workcover-required")).toHaveCount(0);
  });
});
