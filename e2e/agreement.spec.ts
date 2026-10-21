import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, drawSignature, missingCreds, signIn, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, rpcAs, rpcAsJson, serviceClient } from "./fixtures/woLoop";

/**
 * The subcontractor agreement in the portal — contractor-agreement brief §10.
 *
 * A new contractor, invited the way the office does it, with their company
 * details in: a blank ABN sends them to Profile with the field named; a
 * complete record shows the document with their business name, ABN and
 * address in place; they scroll to the end, tick, sign on the screen and
 * submit; exactly one contractor_agreements row and one document row exist,
 * a second tap cannot make another, the PDF is in the bucket within thirty
 * seconds and opens; the Documents card and the home tile tell the truth
 * before and after; another contractor's download is a 404; the office can
 * read it and a customer cannot.
 *
 * Rows: one painter (auth, profile, contractor, invite), one agreement, one
 * document, two bucket objects — all removed in afterAll.
 */
const staff = credentials("STAFF");
const other = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const run = Date.now().toString(36);
const painter = { email: `pg.e2e.agree.${run}@example.com`, password: `Agree-${run}-pw!`, name: "Agree Painter", userId: "", contractorId: "" };
const PROFILE = { company_name: "Agree Painter Pty Ltd", abn: "51824753556", address: "4 Brush Lane, Oakleigh VIC 3166" };
let agreementId = "";

async function restAs(creds: { email: string; password: string }, path: string): Promise<{ status: number; body: unknown }> {
  const token = await accessTokenFor(creds);
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function signedRows() {
  const { data, error } = await db!.from("contractor_agreements").select("id, status, source, version, merged, signed_name, signed_ip, signed_user_agent, body_sha256, countersigned_name, countersigned_at, pdf_path, expires_on, commencement_on").eq("contractor_id", painter.contractorId).order("signed_at");
  expect(error?.message ?? "").toBe("");
  return (data ?? []) as { id: string; status: string; source: string; version: number; merged: Record<string, string>; signed_name: string; signed_ip: string | null; signed_user_agent: string; body_sha256: string; countersigned_name: string | null; countersigned_at: string | null; pdf_path: string | null; expires_on: string; commencement_on: string }[];
}

async function openAsPainter(page: Page) {
  await signIn(page, painter, /\/portal/);
}

test.describe("subcontractor agreement — read, sign, keep", () => {
  test.skip(!staff || !other || !customer || !db, missingCreds("STAFF"));

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const token = await rpcAs(staff!, "create_contractor_invite", { p_email: painter.email, p_name: painter.name, p_company: PROFILE.company_name, p_tier: null, p_days: 7 });
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const made = await db!.auth.admin.createUser({ email: painter.email, password: painter.password, email_confirm: true, user_metadata: { name: painter.name } });
    expect(made.error?.message ?? "").toBe("");
    painter.userId = made.data.user!.id;
    expect(await rpcAs(painter, "redeem_contractor_invite", { p_token: token })).toBe("ok");
    painter.contractorId = (await contractorIdForEmail(db!, painter.email))!;
    // Module 1 done except the ABN: the first test is about the blank.
    const up = await db!.from("contractors").update({ company_name: PROFILE.company_name, abn: null, address: PROFILE.address, phone: "0400 000 099", tour_seen_at: new Date().toISOString() }).eq("id", painter.contractorId);
    expect(up.error?.message ?? "").toBe("");
  });

  test.afterAll(async () => {
    if (!db || !painter.contractorId) return;
    const { data: objs } = await db.storage.from("contractor-docs").list(`${painter.contractorId}/agreements`);
    const paths = ((objs ?? []) as { name: string }[]).map((o) => `${painter.contractorId}/agreements/${o.name}`);
    if (paths.length) await db.storage.from("contractor-docs").remove(paths);
    await db.from("contractor_documents").delete().eq("contractor_id", painter.contractorId);
    await db.from("contractor_agreements").delete().eq("contractor_id", painter.contractorId);
    await db.from("contractors").delete().eq("id", painter.contractorId);
    await db.from("profiles").delete().eq("id", painter.userId);
    await db.auth.admin.deleteUser(painter.userId);
    await db.from("contractor_invites").delete().eq("email", painter.email);
  });

  test("a blank ABN sends them to Profile with the field named; the home tile says offers wait", async ({ page }) => {
    await openAsPainter(page);
    await expect(page.getByTestId("action-agreement")).toContainText(/Read and sign your subcontractor agreement/);
    await expect(page.getByTestId("action-agreement")).toContainText(/Job offers wait/);
    await page.goto("/portal/agreement");
    await expect(page.getByTestId("agreement-incomplete")).toBeVisible();
    await expect(page.getByTestId("agreement-missing-contractor.abn")).toContainText(/ABN/);
    await expect(page.getByTestId("agreement-missing-contractor.company_name")).toHaveCount(0);
    await page.goto("/portal/profile");
    await expect(page.getByTestId("profile-agreement-chip")).toHaveText("Not signed");
    const up = await db!.from("contractors").update({ abn: PROFILE.abn }).eq("id", painter.contractorId);
    expect(up.error?.message ?? "").toBe("");
  });

  test("they read it with their details in place, scroll to the end, tick, sign; one row, one document, a PDF within 30 s", async ({ page }) => {
    test.setTimeout(120_000);
    await openAsPainter(page);
    await page.goto("/portal/agreement");
    const read = page.getByTestId("agreement-read");
    await expect(read).toBeVisible();
    await expect(read).toContainText("Agree Painter Pty Ltd");
    await expect(read).toContainText("51 824 753 556");
    await expect(read).toContainText("4 Brush Lane, Oakleigh VIC 3166");
    await expect(read).toContainText("13. Post agreement obligations");
    await expect(read).not.toContainText("{{");
    // Nothing wakes before the end is reached.
    await expect(page.getByTestId("agreement-sign")).toBeDisabled();
    await expect(page.getByTestId("agreement-tick")).toBeDisabled();
    await page.getByTestId("agreement-sign-foot").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("agreement-sign-foot")).toHaveAttribute("data-reached-end", "true");
    await page.getByTestId("agreement-tick").click();
    await expect(page.getByTestId("agreement-name")).toHaveValue(painter.name);
    await drawSignature(page);
    await expect(page.getByTestId("agreement-sign")).toBeEnabled();
    await page.getByTestId("agreement-sign").click();
    await expect(page).toHaveURL(/\/portal\/agreement\?signed=1/, { timeout: 30_000 });
    await expect(page.getByTestId("agreement-just-signed")).toContainText(/PDF copy is on its way/);
    await expect(page.getByTestId("agreement-signed-line")).toContainText(/^Signed .* · v1/);

    const rows = await signedRows();
    expect(rows).toHaveLength(1);
    const a = rows[0];
    agreementId = a.id;
    expect(a.status).toBe("signed");
    expect(a.source).toBe("portal");
    expect(a.version).toBe(1);
    expect(a.signed_name).toBe(painter.name);
    expect(a.merged["contractor.abn"]).toBe("51 824 753 556");
    expect(a.merged["contractor.company_name"]).toBe(PROFILE.company_name);
    expect(a.merged["agreement.commencement_on"]).toBe(a.commencement_on);
    expect(a.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.signed_user_agent).toMatch(/Chrome|Chromium|HeadlessChrome/);
    expect(a.countersigned_name).toContain("Tom Roman");
    expect(a.countersigned_at).toBeTruthy();
    // Schedule M: twelve months from commencement.
    expect(new Date(a.expires_on).getTime() - new Date(a.commencement_on).getTime()).toBeGreaterThan(360 * 86_400_000);

    const { data: docs } = await db!.from("contractor_documents").select("id, kind, name, file_url, contractor_agreement_id").eq("contractor_id", painter.contractorId).eq("kind", "agreement");
    expect(docs).toHaveLength(1);
    expect((docs![0] as { contractor_agreement_id: string }).contractor_agreement_id).toBe(a.id);

    // The PDF: rendered once, attached once, within thirty seconds.
    let pdfPath: string | null = null;
    for (let i = 0; i < 30 && !pdfPath; i++) {
      await page.waitForTimeout(1000);
      pdfPath = (await signedRows())[0].pdf_path;
    }
    expect(pdfPath, "pdf_path within 30 s").toBeTruthy();
    const { data: file, error: dlErr } = await db!.storage.from("contractor-docs").download(pdfPath!);
    expect(dlErr?.message ?? "").toBe("");
    const bytes = Buffer.from(await file!.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(20_000);
    const { data: doc2 } = await db!.from("contractor_documents").select("file_url").eq("contractor_agreement_id", a.id).single();
    expect((doc2 as { file_url: string }).file_url).toBe(pdfPath);
    // The copy went out (or the dispatcher said why), and said so on the record.
    let sent: unknown[] = [];
    for (let i = 0; i < 20 && sent.length === 0; i++) {
      await page.waitForTimeout(1000);
      sent = (await db!.from("contractor_events").select("id, detail").eq("contractor_id", painter.contractorId).eq("type", "agreement_pdf_sent")).data ?? [];
    }
    expect(sent).toHaveLength(1);

    // The screens now say Signed, and the PDF downloads through their own session.
    await page.reload();
    await expect(page.getByTestId("agreement-download")).toBeVisible();
    const dl = await page.request.get(`/portal/agreement/pdf?id=${a.id}`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"] ?? "").toContain("pdf");
    await page.goto("/portal/profile");
    await expect(page.getByTestId("profile-agreement-chip")).toHaveText("Signed");
    await expect(page.getByTestId("profile-agreement-download")).toBeVisible();
    await page.goto("/portal");
    await expect(page.getByTestId("action-agreement")).toHaveCount(0);
  });

  test("a second tap cannot create a second row", async () => {
    const again = await rpcAsJson<{ status: string; id: string }>(painter, "agreement_sign", {
      p_version: 1, p_signed_name: painter.name, p_signature_path: `${painter.contractorId}/agreements/signature-00000000-0000-4000-8000-000000000000.png`,
      p_ip: "203.0.113.9", p_user_agent: "spec", p_body_sha256: "ab".repeat(32),
    });
    expect(again.status).toBe("exists");
    expect(again.id).toBe(agreementId);
    expect(await signedRows()).toHaveLength(1);
    // The PDF is attached exactly once.
    const att = await db!.rpc("agreement_attach_pdf", { p_agreement_id: agreementId, p_path: "x/agreements/other.pdf" });
    expect(String(att.data)).toBe("error:pdf_immutable");
  });

  test("another contractor gets a 404 and reads nothing; the office reads it; a customer reads nothing", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, other!, /\/portal/);
    const dl = await page.request.get(`/portal/agreement/pdf?id=${agreementId}`);
    expect(dl.status()).toBe(404);
    await ctx.close();
    expect(await rpcAsJson(other!, "agreement_status", { p_contractor_id: painter.contractorId })).toBeNull();
    const otherRows = await restAs(other!, `contractor_agreements?contractor_id=eq.${painter.contractorId}&select=id`);
    expect(otherRows.status).toBe(200);
    expect(otherRows.body).toEqual([]);

    const office = await rpcAsJson<{ signed: { id: string } | null; gate: string }>(staff!, "agreement_status", { p_contractor_id: painter.contractorId });
    expect(office.signed?.id).toBe(agreementId);
    expect(office.gate).toBe("ok");

    expect(await rpcAsJson(customer!, "agreement_status", { p_contractor_id: painter.contractorId })).toBeNull();
    const customerRows = await restAs(customer!, `contractor_agreements?select=id`);
    expect(customerRows.body).toEqual([]);
    const customerVersions = await restAs(customer!, `agreement_versions?select=version`);
    // The wording itself is not secret — every signed-in user may read the version row; the signed rows are.
    expect(customerVersions.status).toBe(200);
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonRows = await anon.from("contractor_agreements").select("id");
    expect(anonRows.error?.code === "42501" || (anonRows.data ?? []).length === 0).toBe(true);
  });
});
