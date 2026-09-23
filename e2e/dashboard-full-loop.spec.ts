import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor, TINY_SIGNATURE_PNG } from "./helpers";
import {
  completePreStart, completePrep, contractorIdForEmail, createLoopFixture, customerIdForEmail,
  destroyLoopFixture, rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 6 — the full loop against the tiles (brief
 * Part D, session 6): one job goes estimate sent → accepted → booked → live
 * → variation → sign-off → invoice → payment, and after every step the
 * affected tiles have moved by EXACTLY the expected amount for every role —
 * read through the one export route (`X-Metric-Value`), as each login, so
 * the role gate is exercised on every read (403 where a role has no tile).
 * The fixture is torn down in afterAll.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const home = /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/;

type Role = "owner" | "pc" | "sales" | "finance";
const ROLES: Role[] = ["owner", "pc", "sales", "finance"];
const TOTAL = 1_842_000;
const exGst = (c: number) => Math.round(c / 1.1);

type Reading = number | "403";
type Snapshot = Record<string, Record<Role, Reading>>;

test.describe.configure({ mode: "serial" });

test.describe("dashboard · session 6 · the whole loop moves every tile by exactly what happened", () => {
  test.skip(!staff || !contractor || !customer || !db, missingCreds("CUSTOMER") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  test.setTimeout(240_000);
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  const temp: Record<Exclude<Role, "owner">, { email: string; id: string }> = {
    pc: { email: `pg.e2e.pc6.${run}@example.com`, id: "" },
    sales: { email: `pg.e2e.sales6.${run}@example.com`, id: "" },
    finance: { email: `pg.e2e.fin6.${run}@example.com`, id: "" },
  };
  const pages: Partial<Record<Role, Page>> = {};
  let masterId = ""; let masterWasOwner = false; let job: LoopFixture | null = null;
  let contractorId = ""; let signoffToken = ""; let variationId = ""; let finalInvoiceId = ""; let finalTotal = 0;
  let base: Snapshot = {};

  const read = async (page: Page, key: string): Promise<Reading> => {
    // who=team: a sales login defaults to Mine, and the fixture's estimates are sent by the master (20 Sep audit).
    const r = await page.request.get(`/api/reporting/export?metric=${key}&preset=month&who=team`);
    if (r.status() === 403) return "403";
    expect(r.status(), key).toBe(200);
    return Number(r.headers()["x-metric-value"]);
  };
  const snap = async (keys: string[]): Promise<Snapshot> => {
    const out: Snapshot = {};
    for (const k of keys) { out[k] = {} as Record<Role, Reading>; for (const role of ROLES) out[k][role] = await read(pages[role]!, k); }
    return out;
  };
  /** After a step: every listed tile moved by exactly `delta` for the roles that see it, and stayed 403 for the rest. */
  const expectMoved = async (before: Snapshot, moves: Record<string, number>, seenBy: Record<string, Role[]>) => {
    const after = await snap(Object.keys(moves));
    for (const [k, delta] of Object.entries(moves)) {
      for (const role of ROLES) {
        if (seenBy[k].includes(role)) expect(after[k][role], `${k} as ${role}`).toBe((before[k][role] as number) + delta);
        else expect(after[k][role], `${k} as ${role} is money or not theirs`).toBe("403");
      }
    }
    return after;
  };
  const SEES: Record<string, Role[]> = {
    "sales.estimates_sent": ["owner", "sales"], "sales.sales_count": ["owner", "sales"], "sales.sales_cents": ["owner", "sales"],
    "pl.contracts_signed_ex": ["owner"], "pl.revenue_received_ex": ["owner"],
    "pc.jobs_to_schedule": ["owner", "pc"], "pc.in_progress": ["owner", "pc"], "pc.variations_open": ["owner", "pc"], "pc.awaiting_signoff": ["owner", "pc"],
    "contractors.variations_raised": ["owner", "pc"],
    "inv.unsent_cents": ["owner", "finance"], "inv.outstanding_cents": ["owner", "finance"], "inv.received_cents": ["owner", "finance"],
  };
  const ALL = Object.keys(SEES);
  const photoFor = async (kind: string, area = "") => {
    const { data, error } = await db!.from("wo_photos").insert({ work_order_id: job!.workOrderId, kind, area, storage_path: `wo/${job!.workOrderId}/${kind}-${Math.random().toString(36).slice(2)}.jpg` }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  };
  const stage = async () => ((await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single()).data as { stage: string }).stage;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    masterId = (await userIdFor(staff!)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data, error } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    if (error) throw new Error(error.message);
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);
    for (const role of ["pc", "sales", "finance"] as const) {
      const made = await db!.auth.admin.createUser({ email: temp[role].email, password, email_confirm: true });
      if (made.error) throw new Error(made.error.message);
      temp[role].id = made.data.user!.id;
      const prof = await db!.from("profiles").upsert({ id: temp[role].id, role: "staff", name: `${role} ${run}`, is_owner: false, staff_access: {}, staff_roles: [role] }, { onConflict: "id" });
      if (prof.error) throw new Error(prof.error.message);
    }
    // The job starts as a DRAFT estimate with an unoffered work order: nothing on any tile yet.
    contractorId = (await contractorIdForEmail(db!, contractor!.email)) ?? "";
    const customerId = await customerIdForEmail(db!, customer!.email);
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls — weatherboard", "Windows × 3"] }, { heading: "Left", labels: ["Eaves — 9 m"] }], customerId);
    const e1 = await db!.from("estimates").update({ status: "draft", sent_at: null, accepted_at: null, total_cents: TOTAL, accepted_total_cents: null, title: `Loop ${run}`, accepted_name: "Melissa Hartley", lead_source: "referral" }).eq("id", job.estimateId);
    if (e1.error) throw new Error(e1.error.message);
    const w1 = await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null, contractor_payment_cents: 786_000 }).eq("id", job.workOrderId);
    if (w1.error) throw new Error(w1.error.message);
    // One signed-in page per role; page.request carries its cookies.
    for (const role of ROLES) {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await signIn(page, role === "owner" ? staff! : { email: temp[role].email, password }, home);
      pages[role] = page;
    }
    base = await snap(ALL);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (job) { await db.from("payments").delete().eq("invoice_id", finalInvoiceId || "00000000-0000-4000-8000-000000000000"); await destroyLoopFixture(db, job); }
    for (const role of ["pc", "sales", "finance"] as const) if (temp[role].id) await db.auth.admin.deleteUser(temp[role].id);
    if (masterId && !masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
    for (const p of Object.values(pages)) await p?.context().close();
  });

  test("0 · the baseline reads as each role: money and P&L are 403 outside owner", async () => {
    for (const k of ALL) for (const role of ROLES) expect(typeof base[k][role] === "number" || base[k][role] === "403", `${k} as ${role}`).toBe(true);
    expect(base["pl.contracts_signed_ex"].pc).toBe("403"); expect(base["pl.contracts_signed_ex"].sales).toBe("403"); expect(base["pl.contracts_signed_ex"].finance).toBe("403");
    expect(base["sales.sales_cents"].pc).toBe("403"); expect(base["inv.outstanding_cents"].sales).toBe("403"); expect(base["pc.in_progress"].finance).toBe("403");
  });

  test("1 · sent: Estimates sent +1 for sales and owner", async () => {
    const r = await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString(), sent_by_user_id: masterId }).eq("id", job!.estimateId);
    if (r.error) throw new Error(r.error.message);
    await expectMoved(base, { "sales.estimates_sent": 1 }, SEES);
  });

  test("2 · accepted: Sales +$18,420 and +1, Contracts signed +ex GST for the owner only, Jobs to schedule +1", async () => {
    const r = await db!.from("estimates").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_total_cents: TOTAL }).eq("id", job!.estimateId);
    if (r.error) throw new Error(r.error.message);
    await expectMoved(base, { "sales.sales_count": 1, "sales.sales_cents": TOTAL, "pl.contracts_signed_ex": exGst(TOTAL), "pc.jobs_to_schedule": 1 }, SEES);
  });

  test("3 · booked: the offer accepted takes it off Jobs to schedule", async () => {
    const sent = await rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: contractorId, p_start: new Date().toISOString().slice(0, 10), p_end: null, p_note: "" });
    expect(sent).toMatch(/^ok|offered/);
    const { data: offer } = await db!.from("booking_offers").select("id").eq("work_order_id", job!.workOrderId).eq("state", "offered").single();
    expect(await rpcAs(contractor!, "respond_to_offer", { p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "" })).toMatch(/accepted/);
    expect(await stage()).toBe("pre_start");
    await expectMoved(base, { "pc.jobs_to_schedule": 0 }, SEES);
  });

  test("4 · live: the pre-start list done, In progress +1", async () => {
    await db!.from("work_orders").update({ colours: { Weathershield: { name: "Vivid White", hex: "#fff", status: "confirmed" } } }).eq("id", job!.workOrderId);
    await completePreStart(db!, staff!, job!.workOrderId);
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "in_progress" })).toBe("ok:in_progress");
    await expectMoved(base, { "pc.in_progress": 1, "pc.jobs_to_schedule": 0 }, SEES);
  });

  test("5 · variation: raised +1 open and +1 raised; signed by the customer takes it off open", async () => {
    const photoId = await photoFor("variation");
    const raised = await rpcAs(contractor!, "wo_raise_variation", { p_work_order_id: job!.workOrderId, p_category: "rot", p_comment: "Three lower boards on the left are soft.", p_photo_ids: [photoId], p_est_hours: 3 });
    expect(raised).toMatch(/^ok:/);
    variationId = raised.slice(3);
    const afterRaise = await expectMoved(base, { "pc.variations_open": 1, "contractors.variations_raised": 1 }, SEES);
    const priced = await rpcAs(staff!, "wo_price_variation", { p_variation_id: variationId, p_price_cents: 84_000, p_inputs: { hours: 3 }, p_priced_lines: [{ label: "Labour", cents: 84_000 }], p_hours: 3 });
    expect(priced).toMatch(/^ok:/);
    expect(await rpcAs(customer!, "wo_customer_sign_variation", { p_token: priced.slice(3), p_name: "Loop Customer", p_signature: TINY_SIGNATURE_PNG })).toBe("ok:approved");
    const early = await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId });
    if (early !== "ok:accepted") {
      expect(await rpcAs(staff!, "wo_release_variation", { p_variation_id: variationId })).toBe("ok:released");
      expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId })).toBe("ok:accepted");
    }
    await expectMoved(afterRaise, { "pc.variations_open": -1, "contractors.variations_raised": 0 }, SEES);
  });

  test("6 · finished and checked: the pack goes to the customer, Awaiting sign-off +1, In progress back", async () => {
    const { data: surfaces } = await db!.from("wo_surfaces").select("id, heading").eq("work_order_id", job!.workOrderId);
    for (const s of (surfaces as { id: string; heading: string }[])) {
      await photoFor("before", s.heading); await photoFor("completion", s.heading);
      expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toBe("ok:done");
    }
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "completion_prep" })).toBe("ok:completion_prep");
    expect(await rpcAs(staff!, "wo_seed_prep_checklist", { p_work_order_id: job!.workOrderId })).toMatch(/^ok:/);
    await completePrep(db!, staff!, job!.workOrderId);
    const { data: check, error } = await db!.from("wo_qa_checks").insert({ work_order_id: job!.workOrderId, kind: "final" }).select("id").single();
    if (error) throw new Error(error.message);
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "qa" })).toBe("ok:qa");
    // A pass needs every standard on the check ticked first (wo-qa.spec is the pattern).
    const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", (check as { id: string }).id).order("sort");
    for (const it of (items ?? []) as { id: string }[]) expect(await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: it.id, p_done: true })).toBe("ok:done");
    expect(await rpcAs(staff!, "wo_record_qa", { p_check_id: (check as { id: string }).id, p_result: "pass", p_notes: "Clean.", p_rectify: [] })).toMatch(/^ok:pass/);
    const delivered = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: job!.workOrderId });
    expect(delivered).toMatch(/^ok:/);
    signoffToken = delivered.slice(3);
    if ((await stage()) !== "walkthrough") expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "walkthrough" })).toBe("ok:walkthrough");
    await expectMoved(base, { "pc.awaiting_signoff": 1, "pc.in_progress": 0 }, SEES);
  });

  test("7 · signed off: Awaiting sign-off back, the final invoice drafted → Unsent + its total for finance and owner", async ({ browser }) => {
    // The customer signs from their own (anonymous) browser, as on every sign-off spec — not from a staff session.
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`/s/${signoffToken}`);
    await page.getByTestId("approve-Front").click();
    await page.getByTestId("approve-Left").click();
    await page.context().close();
    // A remote signature needs the walkthrough first unless the office records the client cannot attend (wo-full-loop does the same).
    expect(await rpcAs(staff!, "wo_mark_client_unavailable", { p_work_order_id: job!.workOrderId })).toMatch(/^ok/);
    // The signature itself through the RPC the page calls, so a refusal says WHY (the page only says "try again").
    const signed = await rpcAsJson<unknown>(customer!, "wo_sign", { p_token: signoffToken, p_name: "Melissa Hartley", p_kind: "remote", p_device: "e2e" });
    expect(String(typeof signed === "string" ? signed : JSON.stringify(signed)), "wo_sign").toMatch(/^ok/);
    expect(await stage()).toBe("closed");
    const { data: inv, error } = await db!.from("invoices").select("id, status, total_inc_cents").eq("estimate_id", job!.estimateId).eq("kind", "final").single();
    if (error) throw new Error(error.message);
    const f = inv as { id: string; status: string; total_inc_cents: number };
    expect(f.status).toBe("draft");
    finalInvoiceId = f.id; finalTotal = f.total_inc_cents;
    expect(finalTotal).toBeGreaterThan(0);
    await expectMoved(base, { "pc.awaiting_signoff": 0, "inv.unsent_cents": finalTotal }, SEES);
  });

  test("8 · issued: Outstanding + the total, Unsent back", async () => {
    expect(await rpcAs(staff!, "invoice_issue", { p_invoice_id: finalInvoiceId })).toMatch(/^ok/);
    await expectMoved(base, { "inv.outstanding_cents": finalTotal, "inv.unsent_cents": 0 }, SEES);
  });

  test("9 · paid: Received + the total (finance, owner), Revenue received + ex GST (owner only), Outstanding back", async () => {
    expect(await rpcAs(staff!, "invoice_record_payment", { p_invoice_id: finalInvoiceId, p_method: "bank_transfer", p_amount_cents: finalTotal, p_reference: `loop ${run}` })).toMatch(/^ok/);
    await expectMoved(base, { "inv.received_cents": finalTotal, "pl.revenue_received_ex": exGst(finalTotal), "inv.outstanding_cents": 0 }, SEES);
  });

  test("10 · the whole loop, net: every right-now tile is back where it started; every period tile carries exactly this job", async () => {
    await expectMoved(base, {
      "pc.jobs_to_schedule": 0, "pc.in_progress": 0, "pc.variations_open": 0, "pc.awaiting_signoff": 0,
      "sales.estimates_sent": 1, "sales.sales_count": 1, "sales.sales_cents": TOTAL, "pl.contracts_signed_ex": exGst(TOTAL),
      "contractors.variations_raised": 1, "inv.unsent_cents": 0, "inv.outstanding_cents": 0, "inv.received_cents": finalTotal, "pl.revenue_received_ex": exGst(finalTotal),
    }, SEES);
  });
});
