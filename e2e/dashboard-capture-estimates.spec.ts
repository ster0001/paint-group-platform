import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";

/**
 * Home dashboard v2 · session 0a — capture on estimates + presentations (B1).
 *
 * The dashboard reads; this is what the send action and the customer view now
 * write down for it:
 *   · the customer's "Download estimate (PDF)" is an estimate event;
 *   · send_estimate records WHO sent, refuses without a lead source, and the
 *     first presentation sent gives the account its category — once;
 *   · a staff pick on the estimate fills an account that has no lead source,
 *     the wizard's first touch fills every blank estimate of its account, and
 *     "Not recorded" never propagates;
 *   · the builder refuses Send until the picker is set; Settings shows and
 *     edits the presentation's category label.
 *
 * Writes go through the STAFF'S OWN session where a grant or policy is the
 * thing under test; the service client only seeds and reads back.
 * Everything made here is deleted in afterAll.
 */
const db = serviceClient();
const staff = credentials("STAFF");

const SNAPSHOT_BASE = {
  version: 1,
  company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Capture Customer", contactEmail: "", jobTitle: "Interior repaint", gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 100000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
};

const token = (prefix: string) => `${prefix}${randomBytes(18).toString("base64url")}`;

async function staffClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createSupabaseClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
  if (error) throw new Error(`staff sign-in failed: ${error.message}`);
  return sb;
}

test.describe("dashboard 0a · capture on estimates", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  const made = { estimates: [] as string[], accounts: [] as string[], presentations: [] as string[] };

  async function account(tag: string): Promise<string> {
    const r = await db!.from("accounts").insert({ email: `pg.e2e.cap-${run}-${tag}@example.com`, name: `Capture ${tag} ${run}` }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    made.accounts.push(r.data.id as string);
    return r.data.id as string;
  }
  async function presentation(name: string, category_label = ""): Promise<string> {
    const r = await db!.from("presentations").insert({ name, description: "", is_default: false, category_label }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    made.presentations.push(r.data.id as string);
    return r.data.id as string;
  }
  async function estimate(extra: Record<string, unknown>): Promise<{ id: string; token: string }> {
    const share_token = token("cap");
    const r = await db!.from("estimates").insert({
      status: "draft", source: "manual", level_of_finish: 3, title: `Capture ${run}`,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      share_token, sent_snapshot: { ...SNAPSHOT_BASE, estRef: share_token.slice(0, 8).toUpperCase(), jobAddress: `1 Capture St ${run}` },
      total_cents: 110000, subtotal_cents: 100000,
      ...extra,
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    made.estimates.push(r.data.id as string);
    return { id: r.data.id as string, token: share_token };
  }
  const events = async (id: string, type: string) => {
    const r = await db!.from("estimate_events").select("id").eq("estimate_id", id).eq("type", type);
    if (r.error) throw new Error(r.error.message);
    return r.data.length;
  };
  const accountRow = async (id: string) => {
    const r = await db!.from("accounts").select("lead_source, category").eq("id", id).single();
    if (r.error) throw new Error(r.error.message);
    return r.data as { lead_source: string | null; category: string | null };
  };
  const estimateRow = async (id: string) => {
    const r = await db!.from("estimates").select("status, lead_source, sent_by_user_id").eq("id", id).single();
    if (r.error) throw new Error(r.error.message);
    return r.data as { status: string; lead_source: string | null; sent_by_user_id: string | null };
  };

  test.afterAll(async () => {
    if (!db) return;
    if (made.estimates.length) await db.from("estimates").delete().in("id", made.estimates);
    if (made.accounts.length) await db.from("crm_events").delete().in("account_id", made.accounts);
    if (made.accounts.length) await db.from("accounts").delete().in("id", made.accounts);
    if (made.presentations.length) await db.from("presentations").delete().in("id", made.presentations);
  });

  test("the customer's download is an estimate event; a draft's token records nothing", async ({ browser, request }) => {
    const sent = await estimate({ status: "sent", sent_at: new Date().toISOString(), lead_source: "unknown" });
    const draft = await estimate({});

    const anon = await browser.newContext();
    const page = await anon.newPage();
    try {
      // Headless Chromium has no print dialog to open; the ping is what we test.
      await page.addInitScript(() => { window.print = () => undefined; });
      await page.goto(`/e/${sent.token}`);
      await page.getByTestId("download-estimate").click();
      await expect.poll(() => events(sent.id, "downloaded"), { timeout: 15_000 }).toBe(1);
    } finally {
      await anon.close();
    }

    const r = await request.post("/api/estimates/downloaded", { data: { token: draft.token } });
    expect(r.status()).toBe(200);
    const unknown = await request.post("/api/estimates/downloaded", { data: { token: token("nope") } });
    expect(unknown.status()).toBe(200); // same answer for an unknown token — nothing to enumerate
    expect(await events(draft.id, "downloaded")).toBe(0);
  });

  test("send records the sender, needs a lead source, and the first presentation categorises the account once", async () => {
    const staffId = await userIdFor(staff!);
    expect(staffId).toBeTruthy();
    const sb = await staffClient();
    try {
      const acct = await account("send");
      const interior = await presentation(`Interior ${run}`);          // label defaults to the name
      const exterior = await presentation(`Exterior ${run}`, `Outside ${run}`);
      const first = await estimate({ account_id: acct, presentation_id: interior });

      // No lead source → the server refuses. Nothing changes.
      const refused = await sb.rpc("send_estimate", { p_estimate_id: first.id, p_expected_status: "draft", p_valid_until: null });
      expect(refused.error).toBeNull();
      expect(refused.data).toBe("error:lead_source_required");
      expect((await estimateRow(first.id)).status).toBe("draft");

      // The staff pick goes through THEIR session — the column grant is under test.
      const pick = await sb.from("estimates").update({ lead_source: "referral" }).eq("id", first.id);
      expect(pick.error).toBeNull();

      const sent = await sb.rpc("send_estimate", { p_estimate_id: first.id, p_expected_status: "draft", p_valid_until: null });
      expect(sent.data).toBe("ok:sent");
      expect(await estimateRow(first.id)).toEqual({ status: "sent", lead_source: "referral", sent_by_user_id: staffId });
      expect(await accountRow(acct)).toEqual({ lead_source: "referral", category: `Interior ${run}` });

      // The sender is server-owned: a staff session cannot write it.
      const forged = await sb.from("estimates").update({ sent_by_user_id: staffId }).eq("id", first.id);
      expect(forged.error?.code).toBe("42501");

      // A second estimate, other presentation, other source: the account keeps its first facts.
      const second = await estimate({ account_id: acct, presentation_id: exterior, lead_source: "social" });
      const again = await sb.rpc("send_estimate", { p_estimate_id: second.id, p_expected_status: "draft", p_valid_until: null });
      expect(again.data).toBe("ok:sent");
      expect(await accountRow(acct)).toEqual({ lead_source: "referral", category: `Interior ${run}` });
      expect((await estimateRow(second.id)).lead_source).toBe("social");
    } finally {
      await sb.auth.signOut().catch(() => undefined);
    }
  });

  test("the wizard's first touch fills the account and its blank estimates; Not recorded never propagates", async () => {
    const acct = await account("touch");
    const blank = await estimate({ account_id: acct });
    expect((await estimateRow(blank.id)).lead_source).toBeNull();

    const touch = await db!.from("crm_events").insert({
      account_id: acct, estimate_id: blank.id, type: "first_touch_recorded", source: "system",
      payload: { source: "paid_google", detail: "gclid" }, dedupe_key: `first_touch:${acct}`,
    });
    expect(touch.error).toBeNull();
    expect(await accountRow(acct)).toEqual({ lead_source: "paid_google", category: null });
    expect((await estimateRow(blank.id)).lead_source).toBe("paid_google");

    // A later estimate for that account inherits it at birth.
    const later = await estimate({ account_id: acct });
    expect((await estimateRow(later.id)).lead_source).toBe("paid_google");

    // "Not recorded" on an estimate is not knowledge — the account stays blank.
    const quiet = await account("quiet");
    await estimate({ account_id: quiet, lead_source: "unknown" });
    expect(await accountRow(quiet)).toEqual({ lead_source: null, category: null });
  });

  test("the builder refuses Send until a lead source is picked, and saves the pick", async ({ page }) => {
    const draft = await estimate({});
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${draft.id}`);
    const picker = page.getByTestId("lead-source-picker");
    await expect(picker).toHaveValue("");

    await page.getByRole("button", { name: /^Send/ }).first().click();
    await expect(page.getByText("Pick where this lead came from")).toBeVisible();

    await picker.selectOption("referral");
    await page.getByTestId("builder-save").click();
    await expect.poll(async () => (await estimateRow(draft.id)).lead_source, { timeout: 15_000 }).toBe("referral");
  });

  test("Settings shows a presentation's category and lets the office change it", async ({ page }) => {
    const id = await presentation(`Labelled ${run}`);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/settings#presentations");
    await expect(page.getByTestId(`presentation-category-${id}`)).toHaveText(`Labelled ${run}`);

    const row = page.getByTestId(`presentation-row-${id}`);
    await row.getByRole("button", { name: "Edit" }).click();
    const label = page.getByTestId("presentation-category-label");
    await label.fill(`Exterior ${run}`);
    await label.blur();
    await expect.poll(async () => {
      const r = await db!.from("presentations").select("category_label").eq("id", id).single();
      return (r.data as { category_label: string } | null)?.category_label ?? r.error?.message;
    }, { timeout: 15_000 }).toBe(`Exterior ${run}`);

    // Blank means "same as the name" — the server fills it, the screen shows it.
    await label.fill("");
    await label.blur();
    await expect(label).toHaveValue(`Labelled ${run}`, { timeout: 15_000 });
  });
});
