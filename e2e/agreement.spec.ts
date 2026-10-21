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
/** On the books before the portal agreement (agreement_kind = existing): asked, then the paper copy uploaded by the office. */
const legacy = { email: `pg.e2e.agree2.${run}@example.com`, password: `Agree2-${run}-pw!`, name: "Legacy Painter", userId: "", contractorId: "" };
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PROFILE = { company_name: "Agree Painter Pty Ltd", abn: "51824753556", address: "4 Brush Lane, Oakleigh VIC 3166" };
let agreementId = "";
let currentVersion = 1;

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

async function makePainter(p: { email: string; password: string; name: string; userId: string; contractorId: string }, company: string) {
  const token = await rpcAs(staff!, "create_contractor_invite", { p_email: p.email, p_name: p.name, p_company: company, p_tier: null, p_days: 7 });
  expect(token).toMatch(/^[0-9a-f]{48}$/);
  const made = await db!.auth.admin.createUser({ email: p.email, password: p.password, email_confirm: true, user_metadata: { name: p.name } });
  expect(made.error?.message ?? "").toBe("");
  p.userId = made.data.user!.id;
  expect(await rpcAs(p, "redeem_contractor_invite", { p_token: token })).toBe("ok");
  p.contractorId = (await contractorIdForEmail(db!, p.email))!;
}

async function removePainter(p: { email: string; userId: string; contractorId: string }) {
  if (!p.contractorId) return;
  const { data: objs } = await db!.storage.from("contractor-docs").list(`${p.contractorId}/agreements`);
  const paths = ((objs ?? []) as { name: string }[]).map((o) => `${p.contractorId}/agreements/${o.name}`);
  if (paths.length) await db!.storage.from("contractor-docs").remove(paths);
  await db!.from("contractor_documents").delete().eq("contractor_id", p.contractorId);
  await db!.from("contractor_agreements").delete().eq("contractor_id", p.contractorId);
  await db!.from("contractors").delete().eq("id", p.contractorId);
  await db!.from("profiles").delete().eq("id", p.userId);
  await db!.auth.admin.deleteUser(p.userId);
  await db!.from("contractor_invites").delete().eq("email", p.email);
}

test.describe("subcontractor agreement — read, sign, keep", () => {
  test.skip(!staff || !other || !customer || !db, missingCreds("STAFF"));

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await makePainter(painter, PROFILE.company_name);
    // Module 1 done except the ABN: the first test is about the blank.
    const up = await db!.from("contractors").update({ company_name: PROFILE.company_name, abn: null, address: PROFILE.address, phone: "0400 000 099", tour_seen_at: new Date().toISOString() }).eq("id", painter.contractorId);
    expect(up.error?.message ?? "").toBe("");
    await makePainter(legacy, "Legacy Painter Pty Ltd");
    // On the books before the feature: the migration marks them existing; the spec sets it the same way. Refresher induction, so only the agreement gate is in play.
    const up2 = await db!.from("contractors").update({ company_name: "Legacy Painter Pty Ltd", abn: "41639780108", address: "25/25-27 Bunney Road, Oakleigh", phone: "0400 000 098", tour_seen_at: new Date().toISOString(), agreement_kind: "existing", induction_kind: "refresher" }).eq("id", legacy.contractorId);
    expect(up2.error?.message ?? "").toBe("");
    // The finish standards gate sits in front of the agreement gate in send_offer and the trigger: confirm them, so the offer test reaches the agreement.
    for (const sec of ["levels", "rules", "time", "interior", "exterior", "defect"]) await rpcAs(legacy, "standards_ack_section", { p_section: sec });
  });

  test.afterAll(async () => {
    if (!db) return;
    await removePainter(painter);
    await removePainter(legacy);
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
    await expect(page.getByTestId("agreement-signed-line")).toContainText(/^Signed .* · v\d+/);

    const rows = await signedRows();
    expect(rows).toHaveLength(1);
    const a = rows[0];
    agreementId = a.id;
    expect(a.status).toBe("signed");
    expect(a.source).toBe("portal");
    expect(a.version).toBeGreaterThanOrEqual(1);   // the current version (v2 since 21 Oct)
    currentVersion = a.version;
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
    const again = await rpcAsJson<{ status: string; id: string; reason?: string }>(painter, "agreement_sign", {
      p_version: currentVersion, p_signed_name: painter.name, p_signature_path: `${painter.contractorId}/agreements/signature-00000000-0000-4000-8000-000000000000.png`,
      p_ip: "203.0.113.9", p_user_agent: "spec", p_body_sha256: "ab".repeat(32),
    });
    expect(again.status, JSON.stringify(again)).toBe("exists");
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

  test("the office: an existing contractor is asked, the grace window runs out and offers stop, the paper copy is uploaded and offers flow", async ({ page }) => {
    test.setTimeout(120_000);
    // Before anything: on the books, not asked, offers flow (ruling 14) — and they are on the queue as not asked.
    expect(String((await db!.rpc("agreement_gate_of", { p_contractor_id: legacy.contractorId })).data)).toBe("ok");
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const cell = page.getByTestId(`agreement-${legacy.contractorId}`);
    await expect(cell).toContainText("Agreement: Not signed · not asked yet");
    await expect(page.getByTestId(`agreement-${painter.contractorId}`)).toContainText(/Agreement: Signed v\d+/);
    await page.getByTestId(`agreement-request-${legacy.contractorId}`).click();
    await expect(cell).toContainText(/Asked[,.]/, { timeout: 20_000 });   // C1 has no SMS provider: "Asked, but the message was not sent (not_configured)"
    const { data: ev } = await db!.from("contractor_events").select("type, detail").eq("contractor_id", legacy.contractorId).in("type", ["agreement_requested", "agreement_request_sent"]);
    expect((ev ?? []).map((e) => (e as { type: string }).type).sort()).toEqual(["agreement_request_sent", "agreement_requested"]);
    await page.reload();
    await expect(cell).toContainText(/Not signed · asked .*, offers stop/);

    // The grace window runs out: the gate bites in the RPC and in the trigger, with the same word.
    const past = await db!.from("contractors").update({ agreement_grace_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", legacy.contractorId);
    expect(past.error?.message ?? "").toBe("");
    expect(String((await db!.rpc("agreement_gate_of", { p_contractor_id: legacy.contractorId })).data)).toBe("agreement_unsigned");
    const { data: anyJob } = await db!.from("work_orders").select("id").eq("is_demo", false).limit(1).single();
    const blocked = await db!.from("booking_offers").insert({ work_order_id: (anyJob as { id: string }).id, contractor_id: legacy.contractorId, state: "offered", start_date: "2030-01-06", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(blocked.error?.message ?? "").toContain("agreement_unsigned");

    // The office uploads the paper copy with the date it was signed.
    await page.goto(`/contractors/${legacy.contractorId}`);
    const card = page.getByTestId("agreement-card");
    await expect(card).toHaveAttribute("data-gate", "agreement_unsigned");
    await expect(page.getByTestId("agreement-gate")).toContainText(/no job offers/);
    await page.getByTestId("agreement-upload-date").fill("2026-03-03");
    await page.getByTestId("agreement-upload-version").selectOption("");
    await page.getByTestId("agreement-upload-file").setInputFiles({ name: "signed-agreement.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
    await page.getByTestId("agreement-upload").click();
    await expect(page.getByTestId("agreement-msg")).toContainText(/^Added\./, { timeout: 20_000 });
    await expect(page.getByTestId("agreement-line")).toContainText(/^Uploaded · 3 Mar 2026/);
    await expect(page.getByTestId("agreement-download")).toBeVisible();
    const { data: rows } = await db!.from("contractor_agreements").select("source, status, version, pdf_path, expires_on, commencement_on").eq("contractor_id", legacy.contractorId);
    expect(rows).toHaveLength(1);
    const r = rows![0] as { source: string; status: string; version: number | null; pdf_path: string; expires_on: string; commencement_on: string };
    expect(r).toMatchObject({ source: "uploaded", status: "signed", version: null, commencement_on: "2026-03-03", expires_on: "2027-03-03" });
    expect(r.pdf_path).toMatch(new RegExp(`^${legacy.contractorId}/agreements/upload-[0-9a-f-]{36}\\.pdf$`));
    const { data: doc } = await db!.from("contractor_documents").select("kind, file_url").eq("contractor_id", legacy.contractorId).eq("kind", "agreement").single();
    expect((doc as { file_url: string }).file_url).toBe(r.pdf_path);
    expect(String((await db!.rpc("agreement_gate_of", { p_contractor_id: legacy.contractorId })).data)).toBe("ok");
    await page.goto("/contractors");
    await expect(cell).toContainText(/Agreement: Uploaded · 3 Mar 2026/);
    await expect(page.getByTestId(`agreement-request-${legacy.contractorId}`)).toHaveCount(0);
  });

  test("the contractor whose paper copy was uploaded sees the same card and can download it; they are not asked to sign", async ({ page }) => {
    await signIn(page, legacy, /\/portal/);
    await expect(page.getByTestId("action-agreement")).toHaveCount(0);
    await page.goto("/portal/profile");
    await expect(page.getByTestId("profile-agreement-chip")).toHaveText("Signed");
    await expect(page.getByTestId("profile-agreement-line")).toContainText(/Signed 3 Mar 2026 · signed on paper/);
    const dl = await page.request.get("/portal/agreement/pdf");
    expect(dl.status()).toBe(200);
    await page.goto("/portal/agreement");
    await expect(page.getByTestId("agreement-signed")).toBeVisible();
    await expect(page.getByTestId("agreement-read")).toHaveCount(0);
  });
});
