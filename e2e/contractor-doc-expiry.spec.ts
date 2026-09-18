import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";

/**
 * Insurance certificates carry their expiry (Tom, 18 Sep 2026).
 *
 * The bug: the portal uploaded the moment a file was picked, so a date typed
 * afterwards never reached the row and the certificate read NO EXPIRY. Now:
 *  1. The file is staged; Upload is disabled for an insurance kind until the
 *     expiry is entered, and the row lands with the date.
 *  2. The database refuses an insurance row with no expiry (20270169) — even
 *     through the service role.
 *  3. A row already on file with no date can have one set in place.
 * Everything made here is removed at the end.
 */
const creds = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF expiry e2e");

let contractorId: string | null = null;
const made: string[] = [];
const paths: string[] = [];

test.describe("insurance certificates carry their expiry", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to read the contractor row");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    contractorId = await contractorIdForEmail(db!, creds!.email);
    await db!.from("contractor_documents").delete().eq("contractor_id", contractorId!).like("name", "expiry-e2e%");
  });

  test.afterAll(async () => {
    if (!contractorId) return;
    await db!.from("contractor_documents").delete().eq("contractor_id", contractorId!).like("name", "expiry-e2e%");
    if (paths.length) await db!.storage.from("contractor-docs").remove(paths);
  });

  test("Upload waits for the expiry on an insurance kind, then saves the date with the file", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    await page.locator("#dockind").selectOption("insurance");
    await expect(page.getByTestId("doc-expiry-needed")).toBeVisible();
    await page.getByTestId("doc-choose").click({ trial: true });
    await page.locator('input[type="file"]').last().setInputFiles({ name: "expiry-e2e-pl.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByTestId("doc-pending")).toContainText("expiry-e2e-pl.pdf");
    // File chosen, no date: nothing uploads.
    await expect(page.getByTestId("doc-upload")).toBeDisabled();
    const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1);
    const iso = expires.toISOString().slice(0, 10);
    await page.locator("#docexp").fill(iso);
    await expect(page.getByTestId("doc-expiry-needed")).toHaveCount(0);
    await expect(page.getByTestId("doc-upload")).toBeEnabled();
    await page.getByTestId("doc-upload").click();
    await expect(page.locator("body")).toContainText(`Uploaded, expiring ${iso}`, { timeout: 20_000 });
    await expect(page.locator(".doc", { hasText: "expiry-e2e-pl.pdf" })).toContainText(`EXPIRES ${iso}`);

    const { data } = await db!.from("contractor_documents").select("id, expires_on, file_url").eq("contractor_id", contractorId!).eq("name", "expiry-e2e-pl.pdf").single();
    const row = data as { id: string; expires_on: string | null; file_url: string };
    expect(row.expires_on).toBe(iso);
    made.push(row.id); paths.push(row.file_url);
  });

  test("the database refuses an insurance row with no expiry, whoever writes it", async () => {
    const path = `${contractorId}/expiry-e2e-noexp.pdf`;
    const up = await db!.storage.from("contractor-docs").upload(path, PDF, { contentType: "application/pdf", upsert: true });
    expect(up.error).toBeNull();
    paths.push(path);
    for (const kind of ["insurance", "workcover"]) {
      const { error } = await db!.from("contractor_documents").insert({
        contractor_id: contractorId!, kind, name: `expiry-e2e-${kind}.pdf`, file_url: path, expires_on: null,
      });
      expect(error?.message ?? "", kind).toContain("needs its expiry date");
    }
    // Clearing the date on a saved certificate is refused too.
    const { error: cleared } = await db!.from("contractor_documents").update({ expires_on: null }).eq("id", made[0]);
    expect(cleared?.message ?? "").toContain("needs its expiry date");
  });

  test("a licence already on file with no date gets one set in place", async ({ page }) => {
    const path = `${contractorId}/expiry-e2e-lic.pdf`;
    const up = await db!.storage.from("contractor-docs").upload(path, PDF, { contentType: "application/pdf", upsert: true });
    expect(up.error).toBeNull();
    paths.push(path);
    const { data, error } = await db!.from("contractor_documents").insert({
      contractor_id: contractorId!, kind: "licence", name: "expiry-e2e-lic.pdf", file_url: path, expires_on: null,
    }).select("id").single();
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    made.push(id);

    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    const row = page.locator(".doc", { hasText: "expiry-e2e-lic.pdf" });
    await expect(row).toContainText("NO EXPIRY");
    await expect(page.getByTestId(`doc-save-expiry-${id}`)).toBeDisabled();
    const iso = "2028-06-30";
    await page.getByTestId(`doc-set-expiry-${id}`).locator('input[type="date"]').fill(iso);
    await page.getByTestId(`doc-save-expiry-${id}`).click();
    await expect(page.locator("body")).toContainText(`Expiry saved — ${iso}`, { timeout: 15_000 });
    await expect(page.locator(".doc", { hasText: "expiry-e2e-lic.pdf" })).toContainText(`EXPIRES ${iso}`);
    const { data: after } = await db!.from("contractor_documents").select("expires_on").eq("id", id).single();
    expect((after as { expires_on: string | null }).expires_on).toBe(iso);
  });
});
