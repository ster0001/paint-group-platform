import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Portal gaps — induction brief §8 Step 3b (rulings I5, M4, M10).
 *
 * AS THE CONTRACTOR, on a real job: Request more (item + quantity) → a
 * wo_material_requests row and a PC Command card; the office replies Ordered
 * on the job → the reply shows on the painter's job page. No work today
 * (rained off) → a no_work_requested day flag and a PC card; Confirm turns it
 * into the marked no_work day (the request row is gone). Certificates "I will
 * add this later" → certificates_deferred_at + a contractor_events row, Home
 * shows the deferred line, and the certificate sweep runs without texting a
 * painter who is offerable (the certificate is on file).
 *
 * Rows: one loop fixture on the e2e contractor (destroyLoopFixture removes the
 * request and the flags with the job); certificates_deferred_at is put back in
 * afterAll, with the events this run wrote.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";

let contractorId = "";
let job: LoopFixture | null = null;
let requestId = "";
let flagId = "";
let deferredBefore: string | null = null;
const startedAt = new Date().toISOString();

async function until<T>(label: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test.describe.configure({ mode: "serial" });

test.describe("portal gaps — materials, no work today, certificates later", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId).toBeTruthy();
    job = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls", "Ceilings"] }]);
    const { data } = await db!.from("contractors").select("certificates_deferred_at").eq("id", contractorId).single();
    deferredBefore = (data as { certificates_deferred_at: string | null }).certificates_deferred_at;
  });

  test.afterAll(async () => {
    await db!.from("contractors").update({ certificates_deferred_at: deferredBefore }).eq("id", contractorId);
    await db!.from("contractor_events").delete().eq("contractor_id", contractorId).in("type", ["certificates_deferred", "certificate_reminder_sent"]).gte("created_at", startedAt);
    await destroyLoopFixture(db!, job);
  });

  test("as the contractor: Request more sends an item and quantity to the office", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await page.getByTestId("materials-request-open").click();
    await page.getByTestId("materials-item").fill("Wash&Wear Low Sheen Natural White");
    await page.getByTestId("materials-quantity").fill("10 L");
    await page.getByTestId("materials-send").click();
    await expect(page.getByTestId("materials-request-msg")).toContainText("Sent to the office");
    const row = await until("material request row", async () => {
      const { data } = await db!.from("wo_material_requests").select("id, status, item, quantity, contractor_id").eq("work_order_id", job!.workOrderId).maybeSingle();
      return data as { id: string; status: string; item: string; quantity: string; contractor_id: string } | null;
    });
    requestId = row.id;
    expect(row.status).toBe("requested");
    expect(row.quantity).toBe("10 L");
    expect(row.contractor_id).toBe(contractorId);
    await expect(page.getByTestId(`materials-request-${requestId}`)).toHaveAttribute("data-status", "requested");
    const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", job!.workOrderId).eq("type", "material_requested");
    expect(ev?.length ?? 0, "an event row").toBe(1);
  });

  test("as PC: the card is on PC Command; Ordered on the job answers it, and the painter sees the reply", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`gap-card-material_request:work_order:${job!.workOrderId}:${requestId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("needs more materials");
    await expect(card).toContainText("Wash&Wear Low Sheen Natural White × 10 L");
    await card.getByTestId(`gap-card-open-material_request:work_order:${job!.workOrderId}:${requestId}`).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${job!.workOrderId}`));
    await page.getByTestId(`material-reply-${requestId}`).fill("Ordered. Dulux Preston from 7 am tomorrow.");
    await page.getByTestId(`material-ordered-${requestId}`).click();
    await expect(page.getByTestId(`material-answer-${requestId}`)).toContainText("Dulux Preston", { timeout: 20_000 });
    const { data } = await db!.from("wo_material_requests").select("status, reply, replied_at").eq("id", requestId).single();
    const r = data as { status: string; reply: string; replied_at: string | null };
    expect(r.status).toBe("ordered");
    expect(r.replied_at).toBeTruthy();
    await page.goto("/pc");
    await expect(page.getByTestId(`gap-card-material_request:work_order:${job!.workOrderId}:${requestId}`)).toHaveCount(0);

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    const line = page.getByTestId(`materials-request-${requestId}`);
    await expect(line).toHaveAttribute("data-status", "ordered");
    await expect(line).toContainText("Dulux Preston");
  });

  test("as the contractor: No work today (rained off) asks the office", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await page.getByTestId("no-work-open").click();
    await page.getByTestId("no-work-reason-rained-off").click();
    await page.getByTestId("no-work-send").click();
    await expect(page.getByTestId("no-work-msg")).toContainText("Sent to the office");
    const flag = await until("no_work_requested flag", async () => {
      const { data } = await db!.from("wo_day_flags").select("id, flag, reason, day").eq("work_order_id", job!.workOrderId).maybeSingle();
      return data as { id: string; flag: string; reason: string; day: string } | null;
    });
    flagId = flag.id;
    expect(flag.flag).toBe("no_work_requested");
    expect(flag.reason).toBe("Rained off");
    await expect(page.getByTestId(`no-work-flag-${flagId}`)).toHaveAttribute("data-flag", "no_work_requested");
    // Asking twice for the same day is one row, not two.
    await page.reload();
    await page.getByTestId("no-work-open").click();
    await page.getByTestId("no-work-reason-rained-off").click();
    await page.getByTestId("no-work-send").click();
    await expect(page.getByTestId("no-work-msg")).toContainText(/already|Sent to the office/);
    const { data: all } = await db!.from("wo_day_flags").select("id").eq("work_order_id", job!.workOrderId);
    expect(all?.length ?? 0).toBe(1);
  });

  test("as PC: Confirm on the card turns the request into the marked day", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`gap-card-no_work_requested:work_order:${job!.workOrderId}:${flagId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Rained off");
    await card.getByTestId(`gap-card-open-no_work_requested:work_order:${job!.workOrderId}:${flagId}`).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${job!.workOrderId}`));
    await page.getByTestId(`no-work-confirm-${flagId}`).click();
    await expect(page.getByTestId("no-work-msg")).toContainText(/marked|no work/i, { timeout: 20_000 });
    const { data } = await db!.from("wo_day_flags").select("id, flag").eq("work_order_id", job!.workOrderId);
    const flags = (data ?? []) as { id: string; flag: string }[];
    expect(flags.map((f) => f.flag)).toEqual(["no_work"]);
    expect(flags[0].id, "the request row is gone, a marked day stands in its place").not.toBe(flagId);
    await page.goto("/pc");
    await expect(page.getByTestId(`gap-card-no_work_requested:work_order:${job!.workOrderId}:${flagId}`)).toHaveCount(0);
  });

  test("as the contractor: I will add this later — recorded, shown on Home, and the sweep leaves an insured painter alone", async ({ page, request }) => {
    test.skip(!SECRET, "set CRON_SECRET to call the sweep");
    await db!.from("contractors").update({ certificates_deferred_at: null }).eq("id", contractorId);
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal");
    const insuranceAction = page.getByTestId("action-insurance");
    const needsCertificate = (await insuranceAction.count()) > 0;
    if (needsCertificate) {
      await page.getByTestId("certificates-later").click();
      await expect(page.getByTestId("certificates-deferred")).toBeVisible({ timeout: 20_000 });
    } else {
      // The e2e painter has a certificate on file: the button is not offered, so defer by the same RPC the button calls.
      const { createClient } = await import("@supabase/supabase-js");
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
      const s = await anon.auth.signInWithPassword({ email: contractor!.email, password: contractor!.password });
      expect(s.error?.message ?? "").toBe("");
      const r = await anon.rpc("contractor_defer_certificates");
      expect(r.error?.message ?? "").toBe("");
      expect(r.data).toBe("ok:deferred");
    }
    const { data: c } = await db!.from("contractors").select("certificates_deferred_at, offerable").eq("id", contractorId).single();
    const row = c as { certificates_deferred_at: string | null; offerable: boolean };
    expect(row.certificates_deferred_at).toBeTruthy();
    const { data: ev } = await db!.from("contractor_events").select("type").eq("contractor_id", contractorId).eq("type", "certificates_deferred").gte("created_at", startedAt);
    expect(ev?.length ?? 0).toBe(1);

    // Back-date the tap past the first rung and run the sweep: an offerable painter is never texted.
    await db!.from("contractors").update({ certificates_deferred_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq("id", contractorId);
    const res = await request.get("/api/cron/campaign-sweep?only=certificates&force=1", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { certificates?: { reminded: number; stopped: number } | null };
    expect(body.certificates, "the sweep reports its certificates leg").toBeTruthy();
    const { data: sent } = await db!.from("contractor_events").select("id").eq("contractor_id", contractorId).eq("type", "certificate_reminder_sent").gte("created_at", startedAt);
    if (row.offerable) expect(sent?.length ?? 0, "an insured painter is not reminded").toBe(0);
    else expect(sent?.length ?? 0, "an uninsured painter past day 2 is reminded once").toBe(1);

    // Tom, 19 Oct 2026: the "no public liability on file" card is no longer on
    // PC Command — the reminder texts above are the whole of it there.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-testid^="gap-card-insurance_missing:contractor:${contractorId}:"]`)).toHaveCount(0);
  });
});
