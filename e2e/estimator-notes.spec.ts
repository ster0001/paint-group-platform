import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 4 Oct 2026: "an estimator notes section at the top … add notes or a
 * voice recording … added in the PC command page in the project … internal
 * … not for contractors".
 *
 * One estimate with an issued work order. The staff user types a note at the
 * top of the builder and records a voice memo (Chromium's fake microphone);
 * both appear on the project's PC page; the contractor's work-order page and
 * the customer's estimate page carry no trace of the note text; a contractor
 * session cannot read the table or the bucket. Everything made here is
 * removed after.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const TITLE = `Estimator Notes ${run}`;
const SECRET = `gate code ${run} is 4471 — do not tell the painter`;
let estimateId = "";
let workOrderId = "";
let shareToken = "";
let estimateToken = "";

test.describe("estimator notes: typed + voice, builder → PC command, never the painter", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the estimate");
  // A fake microphone so the Record button has something to record.
  test.use({
    viewport: { width: 1400, height: 900 },
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    permissions: ["microphone"],
  });

  test.beforeAll(async () => {
    estimateToken = `${run}en${"t".repeat(24)}`.slice(0, 32);
    const { data: est, error: estErr } = await db!.from("estimates")
      .insert({ status: "accepted", source: "manual", level_of_finish: 3, title: TITLE, accepted_at: new Date().toISOString(), share_token: estimateToken })
      .select("id").single();
    if (estErr) throw new Error(`estimate: ${estErr.message}`);
    estimateId = (est as { id: string }).id;
    const woRef = `WO-E2EN${run.slice(-4)}`;
    shareToken = `${run}en${"w".repeat(24)}`.slice(0, 32);
    const { data: wo, error: woErr } = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: woRef, share_token: shareToken,
      stage: "pre_start", status: "issued", issued_at: new Date().toISOString(),
      wo_snapshot: {
        version: 1, woRef, status: "issued", jobTitle: TITLE,
        jobAddress: "1 Test St, Brunswick, VIC, 3000",
        contactFirstName: "Test", contactPhone: "", startDate: null,
        accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
        contractorName: "", contractorPaymentCents: 0, materials: [], areas: [],
        exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
      },
    }).select("id").single();
    if (woErr) throw new Error(`work order: ${woErr.message}`);
    workOrderId = (wo as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    // Rows cascade from the estimate; the recordings do not — remove them by prefix.
    if (estimateId) {
      const { data: files } = await db.storage.from("estimator-notes").list(estimateId);
      if (files && files.length > 0) await db.storage.from("estimator-notes").remove(files.map((f) => `${estimateId}/${f.name}`));
    }
    if (workOrderId) await db.from("work_orders").delete().eq("id", workOrderId);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
  });

  test("type a note and record a memo at the top of the builder; both read on the PC project page", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);

    const card = page.getByTestId("estimator-notes");
    await expect(card).toBeVisible({ timeout: 30_000 });
    // At the top: before the estimate header.
    const cardBox = await card.boundingBox();
    const headerBox = await page.locator("text=Estimate").first().boundingBox();
    if (cardBox && headerBox) expect(cardBox.y).toBeLessThanOrEqual(headerBox.y + 1);
    await card.getByTestId("estimator-notes-toggle").click();

    await page.getByTestId("estimator-note-input").fill(SECRET);
    await page.getByTestId("estimator-note-save").click();
    const notes = page.getByTestId("estimator-note");
    await expect(notes).toHaveCount(1, { timeout: 20_000 });
    await expect(notes.first()).toContainText(SECRET);
    await expect(page.getByTestId("estimator-notes-count")).toHaveText("1 note");

    // ---- voice: record ~2 seconds from the fake microphone -------------------
    await page.getByTestId("estimator-note-record").click();
    const stop = page.getByTestId("estimator-note-stop");
    await expect(stop).toBeVisible();
    await page.waitForTimeout(2200);
    await stop.click();
    await expect(page.locator('[data-testid="estimator-note"][data-kind="voice"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("estimator-note-audio")).toHaveAttribute("src", /estimator-notes/);
    await page.screenshot({ path: test.info().outputPath("builder-notes.png") });

    const { data: rows, error } = await db!.from("estimate_notes").select("kind, body, audio_path, duration_seconds").eq("estimate_id", estimateId).order("created_at");
    if (error) throw new Error(error.message);
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({ kind: "text", body: SECRET });
    expect(rows![1].kind).toBe("voice");
    expect(String(rows![1].audio_path)).toMatch(new RegExp(`^${estimateId}/\\d+\\.(webm|mp4|ogg)$`));
    expect(Number(rows![1].duration_seconds)).toBeGreaterThanOrEqual(1);

    // ---- the project's PC command page shows the same notes -------------------
    await page.goto(`/pc/wo/${workOrderId}`);
    const pcCard = page.getByTestId("estimator-notes");
    await expect(pcCard).toBeVisible({ timeout: 30_000 });
    await expect(pcCard.getByTestId("estimator-note")).toHaveCount(2, { timeout: 20_000 });
    await expect(pcCard).toContainText(SECRET);
    await expect(pcCard.getByTestId("estimator-note-audio")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("pc-notes.png") });

    // Delete the text note from the PC page; the builder agrees.
    await pcCard.locator('[data-testid="estimator-note"][data-kind="text"]').getByTestId("estimator-note-delete").click();
    await expect(pcCard.getByTestId("estimator-note")).toHaveCount(1, { timeout: 20_000 });
  });

  test("the contractor's job sheet and the customer's estimate carry no trace of the note; a painter cannot read the table or the bucket", async ({ page, request }) => {
    test.setTimeout(90_000);
    const { error } = await db!.from("estimate_notes").insert({ estimate_id: estimateId, kind: "text", body: SECRET });
    if (error) throw new Error(error.message);

    // Server-rendered HTML, fetched raw: the words must not be in it at all.
    for (const path of [`/w/${shareToken}`, `/e/${estimateToken}`]) {
      const res = await request.get(path);
      const html = await res.text();
      expect(html, `${path} leaked the estimator note`).not.toContain("4471");
      expect(html, `${path} leaked the estimator note`).not.toContain("estimator-notes");
    }

    if (contractor) {
      const { createClient } = await import("@supabase/supabase-js");
      const asPainter = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const signed = await asPainter.auth.signInWithPassword({ email: contractor.email, password: contractor.password });
      if (signed.error) throw new Error(signed.error.message);
      const table = await asPainter.from("estimate_notes").select("id").eq("estimate_id", estimateId);
      const bucket = await asPainter.storage.from("estimator-notes").list(estimateId);
      await asPainter.auth.signOut().catch(() => {});
      // RLS: no policy for a contractor → zero rows, no error. The bucket likewise lists nothing.
      expect(table.error).toBeNull();
      expect(table.data ?? []).toHaveLength(0);
      expect(bucket.data ?? []).toHaveLength(0);
    }
    void page;
  });
});
