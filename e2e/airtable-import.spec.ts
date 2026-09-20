import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";
import { credentials, missingCreds, signIn } from "./helpers";
import { buildWorkQueue } from "../lib/crm/work-queue";

/**
 * Airtable → CRM import (brief rev 3, 16 Sep 2026), on the real screens.
 *
 * Both loaders run against the SYNTHETIC pack in e2e/fixtures/airtable-pack
 * (five made-up customers, one signed job with the numbers of quote 3623) —
 * never the real pack, which holds real people and is not in the repo.
 *
 *   Part A · history: the record, the timeline with its real dates, the
 *            lost customer still lost, the agency's company name and
 *            contacts, the follow-up task, Today's cards by temperature,
 *            the read-only estimate view, the portal's history list.
 *   Part B · the signed job: accepted silently (no message, no offer, no
 *            invoice), in the Unscheduled tray with the Airtable note, priced
 *            to the cent, and revisable through Revision → Working scope.
 *   Part C · the handover door: a Zap record becomes the same kind of job,
 *            twice is once, and "hours to confirm" appears on Today.
 *   And the whole thing run twice changes nothing.
 *
 * Everything the run creates it removes (afterAll → purge by import name).
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const IMPORT_A = `e2e-airtable-${run}`;
const IMPORT_B = `e2e-booked-${run}`;
const PACK = resolve(process.cwd(), "e2e/fixtures/airtable-pack");
const JUSTIN = "pg.e2e.airtable.justin@example.com";
const AGNES = "pg.e2e.airtable.agnes@example.com";
const LORNA = "pg.e2e.airtable.lorna@example.com";
const MELISSA = "pg.e2e.airtable.melissa@example.com";
const HANDOVER_EMAIL = `pg.e2e.airtable.hana.${run}@example.com`;
const HANDOVER_QUOTE = `9${run.slice(0, 3).replace(/[a-f]/g, "7")}`;

function loader(script: string, args: string[]): { out: string; ok: boolean } {
  const r = spawnSync("npx", ["tsx", `scripts/import/${script}`, ...args], { encoding: "utf8", env: process.env, timeout: 240_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { out, ok: r.status === 0 };
}

async function accountByEmail(sb: SupabaseClient, email: string) {
  const { data } = await sb.from("accounts").select("id, name, company_name, tags, relationship_state, lost_reason, state_note, temperature, followup_due_at, followup_note, source, created_at").eq("email", email).maybeSingle();
  return data as { id: string; name: string; company_name: string | null; tags: string[]; relationship_state: string; lost_reason: string | null; state_note: string | null; temperature: string | null; followup_due_at: string | null; followup_note: string | null; source: string; created_at: string } | null;
}

test.describe.configure({ mode: "serial" });

test.describe("Airtable → CRM import", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the loaders");
  test.skip(!staff, missingCreds("STAFF"));

  let justinId = "";
  let justinAccepted = "";
  let bookedEstimateId = "";
  let bookedShareToken = "";
  let bookedWoId = "";
  let secondRunOut = "";

  test.beforeAll(async () => {
    const a = loader("airtable-crm.ts", ["import", PACK, "--import-name", IMPORT_A]);
    expect(a.ok, a.out).toBe(true);
    const b = loader("paintscout-booked.ts", ["import", resolve(PACK, "booked"), "--import-name", IMPORT_B]);
    expect(b.ok, b.out).toBe(true);
    // Twice is once.
    secondRunOut = loader("airtable-crm.ts", ["import", PACK, "--import-name", IMPORT_A]).out
      + loader("paintscout-booked.ts", ["import", resolve(PACK, "booked"), "--import-name", IMPORT_B]).out;
  });

  test.afterAll(async () => {
    loader("paintscout-booked.ts", ["purge", "--import-name", IMPORT_B]);
    loader("airtable-crm.ts", ["purge", "--import-name", IMPORT_A]);
    if (db) {
      // The handover door writes under its own fixed import name; its rows go by email and its keys by quote.
      await db.from("crm_import_keys").delete().eq("import", "airtable-handover").in("key", [`bk_${HANDOVER_QUOTE}`, `bk_${HANDOVER_QUOTE}:wo`, `acc_q${HANDOVER_QUOTE}`]);
      await destroyAccountChain(db, HANDOVER_EMAIL);
      await destroyAccountChain(db, MELISSA);
      for (const e of [JUSTIN, MELISSA, HANDOVER_EMAIL]) await deleteUserByEmail(db, e);
    }
  });

  test("running both loaders a second time inserts and updates nothing", async () => {
    expect(secondRunOut).not.toMatch(/inserted [1-9]/);
    expect(secondRunOut).not.toMatch(/updated [1-9]/);
    expect(secondRunOut).toMatch(/"exists":1/);
  });

  test("acceptance 3 · Justin: account, property, accepted estimate, the timeline with its real dates", async () => {
    const sb = db!;
    const justin = await accountByEmail(sb, JUSTIN);
    expect(justin).not.toBeNull();
    justinId = justin!.id;
    expect(justin!.source).toBe("airtable");
    expect(justin!.created_at.slice(0, 10)).toBe("2025-11-30");
    expect(justin!.tags).toEqual(["airtable_import"]);
    // R9: the open follow-up became the platform's follow-up task.
    // 9 am Melbourne on the Airtable date — read it back in Melbourne, not UTC.
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(justin!.followup_due_at!))).toBe("2027-01-15");
    expect(justin!.followup_note).toContain("Airtable");

    const { data: prop } = await sb.from("properties").select("suburb, postcode, address_norm, source").eq("account_id", justinId).maybeSingle();
    expect(prop).toMatchObject({ suburb: "Blackburn", postcode: "3130", source: "airtable" });

    const { data: ests } = await sb.from("estimates").select("id, status, total_cents, subtotal_cents, level_of_finish, source, external_ref, sent_at, accepted_at, valid_until").eq("account_id", justinId).order("created_at");
    const accepted = (ests ?? []).find((e) => e.status === "accepted")!;
    expect(accepted).toMatchObject({ total_cents: 2354201, subtotal_cents: 2140183, level_of_finish: 3, source: "airtable", valid_until: null });
    expect((accepted.external_ref as { quote_url?: string }).quote_url).toContain("paintscout");
    justinAccepted = accepted.id as string;
    // The draft with no figure imported at $0, still a draft.
    expect((ests ?? []).find((e) => e.status === "draft")).toMatchObject({ total_cents: 0 });

    const { data: events } = await sb.from("crm_events").select("type, occurred_at, recorded_at, source, payload").eq("estimate_id", justinAccepted).order("occurred_at");
    const kinds = (events ?? []).map((e) => e.type);
    expect(kinds.filter((k) => k === "note_added")).toHaveLength(6);
    expect(kinds).toContain("estimate_sent");
    expect(kinds).toContain("estimate_accepted");
    expect(kinds).not.toContain("job_started");
    const sent = (events ?? []).find((e) => e.type === "estimate_sent")!;
    expect(String(sent.occurred_at).slice(0, 10)).toBe("2025-12-05");
    const acc = (events ?? []).find((e) => e.type === "estimate_accepted")!;
    expect(String(acc.occurred_at).slice(0, 10)).toBe("2026-04-13");
    expect(acc.source).toBe("airtable_import");
    // Exactly one estimate_accepted — the lifecycle trigger stayed quiet (§5).
    expect(kinds.filter((k) => k === "estimate_accepted")).toHaveLength(1);
    // Acceptance 6: every imported event is historical.
    for (const e of events ?? []) expect(new Date(e.occurred_at as string).getTime()).toBeLessThan(new Date(e.recorded_at as string).getTime());
    expect((events ?? []).filter((e) => e.type === "note_added" && (e.payload as { author?: string }).author === "Tom")).toHaveLength(3);

    const { data: jobs } = await sb.from("crm_jobs").select("status, quote_url, contractor_offer_cents").eq("account_id", justinId);
    expect(jobs).toEqual([expect.objectContaining({ status: "scheduled", contractor_offer_cents: 1284000 })]);
    const { data: wos } = await sb.from("work_orders").select("id").eq("estimate_id", justinAccepted);
    expect(wos).toEqual([]);
  });

  test("R1 / R3 / R4 · the agency's company name and contacts; the lost customer stays lost and cold; the lapsed quote is expired", async () => {
    const sb = db!;
    const agnes = await accountByEmail(sb, AGNES);
    expect(agnes).toMatchObject({ company_name: "Example & Burton", temperature: "warm" });
    expect(agnes!.tags).toEqual(["agency", "airtable_import", "kay_and_burton", "real_estate"]);
    const { data: contacts } = await sb.from("account_contacts").select("name, is_primary").eq("account_id", agnes!.id).order("name");
    expect((contacts ?? []).filter((c) => !c.is_primary).map((c) => c.name)).toEqual(["Jennifer Example", "Rod Example"]);

    const lorna = await accountByEmail(sb, LORNA);
    expect(lorna).toMatchObject({ relationship_state: "lost", lost_reason: "went_with_someone_else", temperature: "cold" });
    const { data: lornaEsts } = await sb.from("estimates").select("status").eq("account_id", lorna!.id).order("status");
    expect((lornaEsts ?? []).map((e) => e.status)).toEqual(["declined", "expired"]);

    const { data: facts } = await sb.from("crm_account_facts").select("stage, won_cents, search").eq("account_id", agnes!.id).maybeSingle();
    expect(facts?.search).toContain("example & burton");
    const { data: lornaFacts } = await sb.from("crm_account_facts").select("stage").eq("account_id", lorna!.id).maybeSingle();
    expect(lornaFacts?.stage).toBe("lost");
    const { data: justinFacts } = await sb.from("crm_account_facts").select("stage, won_cents").eq("account_id", justinId).maybeSingle();
    expect(justinFacts?.won_cents).toBe(2354201);
    expect(justinFacts?.stage).not.toBe("enquiry_unfinished");
  });

  test("acceptance 7 · staff: the imported estimate opens read-only with the banner and the PaintScout link", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${justinAccepted}`);
    await expect(page.getByTestId("imported-banner")).toBeVisible();
    await expect(page.getByTestId("paintscout-quote-link")).toHaveAttribute("href", /paintscout/);
    await expect(page.getByTestId("imported-total")).toContainText("23,542.01");
    await expect(page.getByTestId("imported-status")).toHaveText("Accepted");
    expect(await page.getByRole("button", { name: /^Save/ }).count()).toBe(0);

    // The record: company name, the "before the platform" jobs, the timeline.
    const agnes = await accountByEmail(db!, AGNES);
    await page.goto(`/crm/customers/${agnes!.id}`);
    await expect(page.getByTestId("record-company")).toHaveText("Example & Burton");
    await expect(page.getByTestId("record-imported")).toBeVisible();
    await page.goto(`/crm/customers/${justinId}`);
    await expect(page.getByTestId("history-jobs")).toContainText("56 Main Street");
    await expect(page.getByTestId("history-jobs")).toContainText("Booked");
    await expect(page.locator("#history").locator("xpath=following-sibling::*")).toContainText("rang, will catch up in the new year");

    // Estimates home: history sits behind its own chip, never in "All".
    await page.goto("/estimates?status=accepted");
    await expect(page.getByTestId("source-history")).toBeVisible();
    await expect(page.locator("tr", { hasText: "56 Main Street" })).toHaveCount(0);
    await page.goto("/estimates?status=accepted&built=history");
    await expect(page.locator("tr", { hasText: "56 Main Street" }).first()).toBeVisible();
  });

  test("Tom, 16 Sep · Today chases the imported quotes of hot and warm customers only", async () => {
    // The one evaluator Today reads (lib/crm/work-queue.ts) — the C1 queue
    // carries thousands of driver items across pages, so the screen is read
    // through its own function rather than scrolled.
    const sb = db!;
    const queue = await buildWorkQueue(sb);
    const followups = queue.items.filter((i) => i.kind === "followup_due");
    const agnes = await accountByEmail(sb, AGNES);
    const colin = await accountByEmail(sb, "pg.e2e.airtable.colin@example.com");
    expect(followups.some((i) => i.accountId === justinId)).toBe(true);
    expect(followups.some((i) => i.accountId === agnes!.id)).toBe(true);
    expect(followups.some((i) => i.accountId === colin!.id)).toBe(false);
  });

  test("Part B · the signed job: accepted silently, in the tray with the Airtable note, to the cent", async () => {
    const sb = db!;
    const melissa = await accountByEmail(sb, MELISSA);
    expect(melissa).not.toBeNull();
    const { data: est } = await sb.from("estimates").select("id, status, total_cents, subtotal_cents, accepted_total_cents, accepted_at, share_token, source, sent_snapshot, builder_state, external_ref").eq("account_id", melissa!.id).eq("source", "paintscout").single();
    expect(est).toMatchObject({ status: "accepted", total_cents: 203280, subtotal_cents: 184800, accepted_total_cents: 203280 });
    expect(String(est!.accepted_at).slice(0, 10)).toBe("2026-08-26");
    bookedEstimateId = est!.id as string;
    bookedShareToken = est!.share_token as string;
    const snap = est!.sent_snapshot as { areas: Array<{ title: string; priceCents: number }>; estRef: string };
    expect(snap.areas.map((a) => [a.title, a.priceCents])).toEqual([["Interior Preparation", 19000], ["Kitchen", 151550], ["Cleaning", 14250]]);
    expect(snap.estRef).toBe(bookedShareToken.slice(0, 8).toUpperCase());
    const state = est!.builder_state as { sizeUpliftDisabled: boolean; woDoc: { areas: Array<{ surfaces: Array<{ hours: number }> }> } };
    expect(state.sizeUpliftDisabled).toBe(true);
    expect(state.woDoc.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + s.hours, 0)).toBe(17.5);

    const { data: wo } = await sb.from("work_orders").select("id, wo_ref, status, stage, contractor_id, start_date, contractor_payment_cents, access_notes").eq("estimate_id", bookedEstimateId).single();
    expect(wo).toMatchObject({ wo_ref: "PS-9623", status: "issued", stage: "offered", contractor_id: null, start_date: null, contractor_payment_cents: 96000, access_notes: "" });
    bookedWoId = wo!.id as string;
    const { data: notes } = await sb.from("wo_booking_notes").select("note").eq("work_order_id", bookedWoId);
    expect(notes).toEqual([{ note: "Airtable: booked 29–30 Sep 2026, no painter assigned." }]);

    // Silent: no offer, no message, no invoice, the office marker and the welcome claim present.
    const { count: offers } = await sb.from("booking_offers").select("id", { count: "exact", head: true }).eq("work_order_id", bookedWoId);
    expect(offers).toBe(0);
    const { count: messages } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("account_id", melissa!.id);
    expect(messages).toBe(0);
    const { count: invoices } = await sb.from("invoices").select("id", { count: "exact", head: true }).eq("estimate_id", bookedEstimateId);
    expect(invoices).toBe(0);
    const { data: marks } = await sb.from("estimate_events").select("type").eq("estimate_id", bookedEstimateId);
    expect((marks ?? []).map((m) => m.type).sort()).toEqual(["accepted", "office_accept_notified"]);
    const { data: claim } = await sb.from("automation_claims").select("rung").eq("automation_key", "customer_accepted_welcome").eq("entity_id", bookedEstimateId);
    expect(claim).toHaveLength(1);
    const { data: ev } = await sb.from("crm_events").select("type, occurred_at, source").eq("estimate_id", bookedEstimateId);
    expect(ev).toEqual([expect.objectContaining({ type: "estimate_accepted", source: "airtable_import" })]);
    expect(String(ev![0].occurred_at).slice(0, 10)).toBe("2026-08-26");
  });

  test("Tom, 17 Sep · every imported job gets the draft deposit an acceptance would have drafted; a draft counts for nothing", async () => {
    const sb = db!;
    const check = loader("draft-deposits.ts", ["check", "--import-name", IMPORT_B]);
    expect(check.ok, check.out).toBe(true);
    expect(check.out).toContain("1 to draft · $1016.40 in draft deposits");
    const run = loader("draft-deposits.ts", ["run", "--import-name", IMPORT_B]);
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain('done: {"drafted":1}');

    const { data: inv, error } = await sb.from("invoices").select("id, kind, status, total_inc_cents, subtotal_ex_cents, gst_cents, work_order_id, number, issued_on").eq("estimate_id", bookedEstimateId);
    expect(error).toBeNull();
    // The document's own 50% (brief B1.4, IMPORT_DEPOSIT_PCT) of $2,032.80 inc = $1,016.40 inc, GST inside it; unnumbered, unissued.
    expect(inv).toEqual([expect.objectContaining({ kind: "deposit", status: "draft", total_inc_cents: 101640, gst_cents: 9240, subtotal_ex_cents: 92400, work_order_id: bookedWoId, number: null, issued_on: null })]);
    const { data: lines } = await sb.from("invoice_lines").select("description, amount_ex_cents, gst_cents").eq("invoice_id", inv![0].id);
    expect(lines).toEqual([{ description: "Deposit — 50% of the contract price, payable on acceptance", amount_ex_cents: 92400, gst_cents: 9240 }]);
    const { data: events } = await sb.from("invoice_events").select("type, meta").eq("invoice_id", inv![0].id);
    expect(events).toEqual([expect.objectContaining({ type: "drafted", meta: expect.objectContaining({ auto: "import" }) })]);

    // A draft is invisible to the ledger (invoice_ledger skips draft/void), so the final at sign-off still bills the whole contract.
    // Twice is once.
    const again = loader("draft-deposits.ts", ["run", "--import-name", IMPORT_B]);
    expect(again.out).toContain('done: {"exists":1}');
    const { count } = await sb.from("invoices").select("id", { count: "exact", head: true }).eq("estimate_id", bookedEstimateId);
    expect(count).toBe(1);
  });

  test("Part B · staff see the tray card and the PaintScout strip", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    const card = page.getByTestId("tray-job").filter({ hasText: "2 Example Crescent stage 3" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Airtable: booked 29–30 Sep 2026, no painter assigned.");
    await page.goto(`/quote?id=${bookedEstimateId}`);
    await expect(page.getByTestId("paintscout-strip")).toContainText("quote 9623");
    await expect(page.getByTestId("paintscout-quote-link")).toHaveAttribute("href", /paintscout/);
  });

  test("B3.6 · Revision → Working scope: add a hallway, the diff and the variation price it, the estimate total stands", async ({ page }) => {
    const sb = db!;
    await signIn(page, staff!, /\/(home|estimates)/);
    // Open once so the working scope exists (clone-on-first-open).
    await page.goto(`/quote?id=${bookedEstimateId}&mode=revision`);
    await expect(page.getByTestId("revision-badge")).toBeVisible();
    await expect(page.getByTestId("revision-no-changes")).toBeVisible();

    const { data: scope } = await sb.from("wo_working_scopes").select("working_state").eq("estimate_id", bookedEstimateId).single();
    const working = scope!.working_state as { blocks: Array<{ id: number; surfaces?: Array<{ id: number }> }> };
    const maxId = working.blocks.reduce((m, b) => Math.max(m, b.id, ...(b.surfaces ?? []).map((s) => s.id)), 0);
    const kitchen = working.blocks.find((b) => (b as { name?: string }).name === "Kitchen") as { surfaces: Array<Record<string, unknown>> };
    const template = kitchen.surfaces.find((s) => s.internalLabel === "Walls")!;
    const hallway = {
      id: maxId + 1, kind: "area", name: "Hallway", type: "Interior", areaType: "room", L: 0, W: 0, H: 0, isOption: false, description: "", open: false, media: [],
      surfaces: [{ ...template, id: maxId + 2, qtyOverride: 20, count: 20, paintingHrOverride: 2, priceOverride: 250, crewNote: "20 m²" }],
    };
    const { data: saved } = await sb.rpc("wo_save_working_scope", { p_estimate_id: bookedEstimateId, p_state: { ...working, blocks: [...working.blocks, hallway] } })
      .then(async (r) => (r.error ? { data: `error:${r.error.message}` } : r));
    // The RPC is staff-only; the service role has no is_staff() — save through the page instead when refused.
    if (saved !== "ok") {
      const { error } = await sb.from("wo_working_scopes").update({ working_state: { ...working, blocks: [...working.blocks, hallway] } }).eq("estimate_id", bookedEstimateId);
      expect(error).toBeNull();
    }

    await page.goto(`/quote?id=${bookedEstimateId}&mode=revision`);
    await expect(page.getByTestId("revision-changes")).toBeVisible();
    await expect(page.getByTestId("revision-changes").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("revision-changes")).toContainText("275.00");
    await page.getByTestId("draft-variations").click();
    await expect(page.getByTestId("drafted-list")).toBeVisible({ timeout: 20_000 });
    const { data: vars } = await sb.from("wo_variations").select("price_cents, status, credit").eq("work_order_id", bookedWoId).not("revision_block_ref", "is", null);
    expect(vars).toEqual([expect.objectContaining({ price_cents: 27500, credit: false })]);
    const { data: after } = await sb.from("estimates").select("total_cents, accepted_total_cents").eq("id", bookedEstimateId).single();
    expect(after).toEqual({ total_cents: 203280, accepted_total_cents: 203280 });
  });

  test("acceptance 8 · the customer, after a magic link, sees the history in the portal", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, JUSTIN));
    await page.waitForURL(/\/account/);
    await expect(page.getByText("My estimates")).toBeVisible();
    await expect(page.getByTestId("portal-history").first()).toContainText("From our records");
    await expect(page.locator(".job", { hasText: "56 Main Street" }).first()).toBeVisible();

    await page.goto(await magicLinkFor(sb, MELISSA));
    await page.waitForURL(/\/account/);
    await page.locator(".job", { hasText: "2 Example Crescent stage 3" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/e/${bookedShareToken}`));
    await expect(page.locator("body")).toContainText("2,032.80");
  });

  test("Part C · the handover door: a Zap record lands in the tray once, with hours to confirm", async ({ page, request }) => {
    const secret = process.env.AIRTABLE_SYNC_SECRET ?? "";
    test.skip(!secret, "AIRTABLE_SYNC_SECRET is not set for this stack");
    const record = {
      record_id: `recE2E${run}`, view: "future_booked_jobs", quote_no: HANDOVER_QUOTE, project_name: `14 Handover Street ${run}`, status: "Job Booked",
      first_name: "Hana", last_name: "Handover", email: HANDOVER_EMAIL, phone: "0491 570 157", address: `14 Handover Street`, suburb: "Testville", postcode: "3000",
      job_type: "Interior Residential", level_of_finish: "Level 3", start_date: "2026-10-05", end_date: "2026-10-07", workers: "2",
      painter_email: "nobody@example.com", painter_accepted: "", offered_amount: "1200", invoice_amount: "3300", estimated_hours: "20",
      notes: "", quote_url: "https://app.paintscout.com/view/?u=e2e", work_order_url: "",
      ps_items: [{ name: "Interior Preparation", price: "300" }, { name: "Lounge", price: "2000" }, { name: "Cleaning", price: "700" }],
      ps_total_hours: "20", ps_subtotal: "3000", ps_total_inc: "3300", ps_status: "accepted", ps_accepted_at: "2026-09-10T03:00:00Z",
    };
    const unauthorised = await request.post("/api/inbound/airtable-jobs", { data: record });
    expect(unauthorised.status()).toBe(401);
    const bad = await request.post("/api/inbound/airtable-jobs", { data: { ...record, quote_no: "" }, headers: { authorization: `Bearer ${secret}` } });
    expect(bad.status()).toBe(400);
    const first = await request.post("/api/inbound/airtable-jobs", { data: record, headers: { authorization: `Bearer ${secret}` } });
    expect(first.ok()).toBe(true);
    expect((await first.json()).results[record.record_id]).toMatch(/^created/);
    const again = await request.post("/api/inbound/airtable-jobs", { data: record, headers: { authorization: `Bearer ${secret}` } });
    expect((await again.json()).results[record.record_id]).toMatch(/^exists/);
    // Tom's Zap retest, 17 Sep: a quote the pack import already wrote (Part B's 9623) must not become a second job.
    const dup = await request.post("/api/inbound/airtable-jobs", { data: { ...record, record_id: `recDUP${run}`, quote_no: "9623" }, headers: { authorization: `Bearer ${secret}` } });
    expect((await dup.json()).results[`recDUP${run}`]).toMatch(/^exists/);
    const { count: jobs9623 } = await db!.from("work_orders").select("id", { count: "exact", head: true }).eq("wo_ref", "PS-9623");
    expect(jobs9623).toBe(1);

    const sb = db!;
    const hana = await accountByEmail(sb, HANDOVER_EMAIL);
    const { data: est } = await sb.from("estimates").select("id, total_cents, status, external_ref").eq("account_id", hana!.id).single();
    expect(est).toMatchObject({ total_cents: 330000, status: "accepted" });
    expect((est!.external_ref as { hours_pending: boolean }).hours_pending).toBe(true);
    const { count: offers } = await sb.from("booking_offers").select("id", { count: "exact", head: true }).eq("work_order_id", (await sb.from("work_orders").select("id").eq("estimate_id", est!.id).single()).data!.id);
    expect(offers).toBe(0);
    const { data: note } = await sb.from("crm_events").select("payload").eq("account_id", hana!.id).eq("type", "note_added").maybeSingle();
    expect((note?.payload as { body: string }).body).toContain("Imported from Airtable view future booked jobs");

    const queue = await buildWorkQueue(sb);
    expect(queue.items.some((i) => i.kind === "hours_to_confirm" && i.subjectRef.id === est!.id)).toBe(true);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${est!.id}`);
    await expect(page.getByTestId("hours-pending")).toBeVisible();
  });
});
