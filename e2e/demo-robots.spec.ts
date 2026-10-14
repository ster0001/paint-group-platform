import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";

/**
 * 12 Demo Street — the robots (induction brief §8 Step 2, §4.1).
 *
 * AS THE CONTRACTOR, every module's "On your phone" step on the practice job,
 * with the office and the customer answering as robots through the SAME RPCs
 * a person uses: accept the offer (M10) → the robot office acknowledges on the
 * thread; ask a question (M7) → "your Project Coordinator will call you
 * today"; change the finish date with a reason (M7, ruling 4) → logged, noted;
 * the pre-start list, a before photo and the stage ticks (M10) — the
 * before-photo gate still holds; the DEMO text sent by staff (M6, ruling I12)
 * is answered by a photo; raise a variation (M8) → priced → customer-approved
 * → released → accepted; finish, start the walk-through (M9) → the demo
 * customer approves three rooms and flags the hallway → fix, Fixed → the
 * customer walks again and it comes back clean (ruling 6) → sign → the invoice
 * draft appears; submit it (M11) → approved by the robot; claim an expense →
 * approved; block a day (M12). AS STAFF the Induction grid shows every step
 * ticked for this painter, and the painter's own banner shows the same list.
 *
 * The robot delay is shortened to 300 ms for the run (settings.demo_rules) and
 * restored in afterAll; the demo is removed in afterAll.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let contractorId = "";
let contractorUid = "";
let woId = "";
let savedRules: Record<string, unknown> | null = null;
let savedPhone: string | null = null;

const dayPlus = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

async function removeDemo(cid: string) {
  const { data } = await db!.from("work_orders").select("id, estimate_id").eq("contractor_id", cid).eq("is_demo", true);
  for (const wo of (data ?? []) as { id: string; estimate_id: string }[]) {
    for (const t of ["timesheet_entries", "contractor_invoices", "job_costs", "contractor_expenses", "expense_preapprovals", "material_costs"]) {
      const r = await db!.from(t).delete().eq("work_order_id", wo.id).eq("is_demo", true);
      expect(r.error?.message ?? "", `${t} cleanup`).toBe("");
    }
    await db!.from("invoices").delete().eq("estimate_id", wo.estimate_id).eq("is_demo", true);
    const r = await db!.from("estimates").delete().eq("id", wo.estimate_id).eq("is_demo", true);
    expect(r.error?.message ?? "", "estimate cleanup").toBe("");
  }
}

/** Poll the demo job's thread for a staff (robot) message containing `text`. */
async function robotSaid(text: string, timeoutMs = 20_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { data } = await db!.from("wo_messages").select("body, author_kind, wo_message_threads!inner(work_order_id)")
      .eq("wo_message_threads.work_order_id", woId).eq("author_kind", "staff").order("created_at", { ascending: false }).limit(5);
    const hit = ((data ?? []) as { body: string }[]).find((m) => m.body.includes(text));
    if (hit) return hit.body;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the robot never said "${text}" on ${woId}`);
}

async function until<T>(label: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function stage(): Promise<string> {
  const { data } = await db!.from("work_orders").select("stage").eq("id", woId).single();
  return (data as { stage: string }).stage;
}

async function openJob(page: Page) {
  await page.goto(`/portal/jobs/${woId}`);
  await expect(page.getByTestId("demo-banner")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("12 Demo Street — the robots answer every module", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    contractorUid = (await userIdFor(contractor!))!;
    expect(contractorId && contractorUid).toBeTruthy();
    await removeDemo(contractorId);
    const { data: rules } = await db!.from("settings").select("value").eq("key", "demo_rules").maybeSingle();
    savedRules = ((rules as { value: Record<string, unknown> } | null)?.value) ?? null;
    const up = await db!.from("settings").upsert({ key: "demo_rules", value: { ...(savedRules ?? {}), robotDelayMs: 300 } }, { onConflict: "key" });
    expect(up.error?.message ?? "").toBe("");
    // The DEMO text needs a mobile on file; the test login may have none. Set one for the run, put it back after.
    const { data: c } = await db!.from("contractors").select("phone").eq("id", contractorId).single();
    savedPhone = (c as { phone: string | null }).phone;
    if (!savedPhone) expect((await db!.from("contractors").update({ phone: "0400 000 000" }).eq("id", contractorId)).error?.message ?? "").toBe("");
    const seeded = await rpcAs(contractor!, "demo_property_seed", { p_contractor_id: null });
    expect(seeded).toMatch(/^ok:/);
    woId = seeded.slice(3);
  });

  test.afterAll(async () => {
    if (savedRules) await db!.from("settings").upsert({ key: "demo_rules", value: savedRules }, { onConflict: "key" });
    if (contractorId && !savedPhone) await db!.from("contractors").update({ phone: null }).eq("id", contractorId);
    if (contractorId) await removeDemo(contractorId);
  });

  test("M10: accept the offer — the robot office acknowledges on the thread, no customer sends", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    await page.getByTestId("offer-bar-accept").click();
    await until("stage pre_start", async () => (await stage()) === "pre_start");
    await robotSaid("Booked");
    const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", woId).eq("type", "appt_confirm_sent");
    expect(ev?.length ?? 0, "no customer confirmation leaves the practice job").toBe(0);
  });

  test("M7: ask a question — the Project Coordinator (robot) replies in seconds", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    await page.getByTestId("msg-input").fill("Which white for the ceiling?");
    await page.getByTestId("msg-send").click();
    await robotSaid("Project Coordinator will call you today");
    await page.reload();
    await expect(page.getByTestId("msg-list")).toContainText("Project Coordinator will call you today");
  });

  test("M7: change the finish date with a reason — logged, and the robot notes it", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    const { data: wo } = await db!.from("work_orders").select("end_date").eq("id", woId).single();
    const newDate = dayPlus((wo as { end_date: string }).end_date, 1);
    await page.getByTestId("finish-date-change").click();
    await page.getByTestId("finish-date-input").fill(newDate);
    await page.getByTestId("finish-date-reason").fill("Extra prep in the hallway");
    await page.getByTestId("finish-date-save").click();
    await expect(page.getByTestId("finish-date-msg")).toContainText("Date moved");
    const ev = await until("finish_date_changed event", async () => {
      const { data } = await db!.from("wo_events").select("meta").eq("work_order_id", woId).eq("type", "finish_date_changed").limit(1);
      return (data?.[0] as { meta: { reason?: string; to?: string } } | undefined) ?? null;
    });
    expect(ev.meta.reason).toBe("Extra prep in the hallway");
    expect(ev.meta.to).toBe(newDate);
    await robotSaid("Noted. We will update the customer and the walk-through.");
  });

  test("M10: pre-start, a before photo, start the job, move a surface — the gates hold", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);   // seeds the pre-start list on view
    // The pre-start list is real: colours confirmed, every required item answered, exactly like a real job.
    await db!.from("work_orders").update({ colours: { "Dulux Wash&Wear Low Sheen": { status: "confirmed", name: "Natural White" }, "Dulux Ceiling White": { status: "confirmed", name: "Ceiling White" }, "Dulux Aquanamel Semi Gloss": { status: "confirmed", name: "Vivid White" } } }).eq("id", woId);
    const { data: items } = await db!.from("wo_checklist_items").select("id, auto_key, required, kind").eq("work_order_id", woId).eq("phase", "pre_start");
    for (const i of (items ?? []) as { id: string; auto_key: string | null; required: boolean; kind: string | null }[]) {
      if (i.auto_key || !i.required) continue;
      const r = i.kind === "yes_no"
        ? await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: i.id, p_answer: "yes", p_note: "Nothing extra — practice job" })
        : await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true });
      expect(r).toMatch(/^ok:/);
    }
    // Start is refused until a before photo exists — the same gate as a real job.
    const { data: surfaces } = await db!.from("wo_surfaces").select("id, heading, label").eq("work_order_id", woId).eq("rectification", false).order("sort");
    const walls = (surfaces as { id: string; heading: string; label: string }[]).find((s) => s.heading === "Bedroom 1" && s.label === "Walls")!;
    expect(await rpcAs(contractor!, "wo_record_photo", { p_work_order_id: woId, p_kind: "before", p_storage_path: `wo/${woId}/e2e-before.jpg`, p_surface_id: null, p_area: "Bedroom 1", p_caption: "" })).toMatch(/^ok:/);
    await page.reload();
    await page.getByTestId("start-job-button").click();
    await until("stage in_progress", async () => (await stage()) === "in_progress");
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls.id, p_to: "prepped" })).toMatch(/^ok:/);
    expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: walls.id, p_to: "done" })).toMatch(/^ok:/);
  });

  test("M6: staff send the DEMO text; a photo answers it", async ({ page }) => {
    await signIn(page, staff!, /\/home/);
    await page.goto(`/pc/wo/${woId}`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("demo-prompt").click();
    await expect(page.getByTestId("demo-message")).toContainText("DEMO text", { timeout: 20_000 });
    const moment = await until("moment row", async () => {
      const { data } = await db!.from("wo_reminder_moments").select("id, answered_at, is_demo").eq("work_order_id", woId).maybeSingle();
      return (data as { id: string; answered_at: string | null; is_demo: boolean } | null) ?? null;
    });
    expect(moment.is_demo).toBe(true);
    expect(moment.answered_at).toBeNull();
    const { data: sent } = await db!.from("messages").select("body, is_demo").eq("work_order_id", woId).order("created_at", { ascending: false }).limit(1);
    const m = (sent?.[0] as { body: string; is_demo: boolean } | undefined);
    expect(m?.body ?? "").toMatch(/^DEMO: /);
    expect(m?.is_demo).toBe(true);
    // The painter's next photo answers it (trigger wo_reminder_moment_answer).
    expect(await rpcAs(contractor!, "wo_record_photo", { p_work_order_id: woId, p_kind: "progress", p_storage_path: `wo/${woId}/e2e-progress.jpg`, p_surface_id: null, p_area: "Bedroom 1", p_caption: "" })).toMatch(/^ok:/);
    await until("moment answered", async () => {
      const { data } = await db!.from("wo_reminder_moments").select("answered_at").eq("id", moment.id).single();
      return (data as { answered_at: string | null }).answered_at;
    });
  });

  test("M8: raise a variation — priced, customer-approved and released by the robots; the painter accepts", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    await page.getByTestId("raise-variation").click();
    await page.getByTestId("category-extra_scope").click();
    await page.getByTestId("variation-comment").fill("Fourth door, hallway, not in scope");
    await page.getByTestId("variation-hours").fill("1.5");
    await page.getByTestId("variation-file").setInputFiles({ name: "door.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("variation-photo")).toContainText("1 added", { timeout: 20_000 });
    await page.getByTestId("send-variation").click();
    await expect(page.getByTestId("variation-message")).toContainText("Sent to the office");
    const v = await until("variation released", async () => {
      const { data } = await db!.from("wo_variations").select("id, status, released_at, price_cents, contractor_delta_cents, is_demo")
        .eq("work_order_id", woId).like("comment", "%Fourth door%").maybeSingle();
      const row = data as { id: string; status: string; released_at: string | null; price_cents: number | null; contractor_delta_cents: number | null; is_demo: boolean } | null;
      return row && row.status === "customer_approved" && row.released_at ? row : null;
    }, 30_000);
    expect(v.is_demo).toBe(true);
    expect(v.price_cents).toBe(Math.round(1.5 * 11_000));
    await robotSaid("priced and the customer has approved it");
    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: v.id })).toBe("ok:accepted");
  });

  test("M11: claim an expense on the practice job — approved by the robot office", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/money");
    await page.getByTestId("expense-open").click();
    await page.getByTestId("expense-file").setInputFiles({ name: "parking.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await page.getByTestId("expense-job").selectOption(woId);
    await page.getByTestId("expense-cat-parking").click();
    await page.getByTestId("expense-dollars").fill("20");
    await page.getByTestId("expense-send").click();
    await expect(page.getByTestId("expense-message")).toBeVisible({ timeout: 30_000 });
    const ex = await until("expense approved", async () => {
      const { data } = await db!.from("contractor_expenses").select("id, status, is_demo").eq("work_order_id", woId).maybeSingle();
      const row = data as { id: string; status: string; is_demo: boolean } | null;
      return row?.status === "approved" ? row : null;
    }, 30_000);
    expect(ex.is_demo).toBe(true);
    await robotSaid("Expense approved");
  });

  test("M9: finish → walk-through — three rooms approved, the hallway flagged, Fixed, walked again, signed", async ({ page }) => {
    // Every surface done, a completion photo, the completion-prep list — the same gates as a real job.
    const { data: surfaces } = await db!.from("wo_surfaces").select("id, state").eq("work_order_id", woId).eq("rectification", false);
    for (const s of (surfaces ?? []) as { id: string; state: string }[]) {
      if (s.state !== "done") expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toMatch(/^ok:/);
    }
    expect(await rpcAs(contractor!, "wo_record_photo", { p_work_order_id: woId, p_kind: "completion", p_storage_path: `wo/${woId}/e2e-done.jpg`, p_surface_id: null, p_area: "Lounge", p_caption: "" })).toMatch(/^ok:/);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: woId })).toMatch(/^ok:/);
    const { data: prep } = await db!.from("wo_checklist_items").select("id, auto_key, required, kind").eq("work_order_id", woId).eq("phase", "completion_prep");
    for (const i of (prep ?? []) as { id: string; auto_key: string | null; required: boolean; kind: string | null }[]) {
      if (i.auto_key || !i.required) continue;
      const r = i.kind === "yes_no"
        ? await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: i.id, p_answer: "yes", p_note: "Nothing extra — practice job" })
        : await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true });
      expect(r).toMatch(/^ok:/);
    }
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: woId })).toBe("ok:walkthrough");

    // Start the walk-through on the phone: the demo customer approves three rooms and flags the hallway.
    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    await page.getByTestId("start-walkthrough").click();
    await expect(page).toHaveURL(/\/s\//, { timeout: 20_000 });
    const areas = await until("hallway flagged", async () => {
      const { data } = await db!.from("wo_signoff").select("areas").eq("work_order_id", woId).single();
      const a = (data as { areas: Record<string, { flagged_at?: string; approved_at?: string }> }).areas ?? {};
      return a.Hallway?.flagged_at ? a : null;
    });
    for (const room of ["Bedroom 1", "Bedroom 2", "Lounge"]) expect(areas[room]?.approved_at, `${room} approved on the first walk`).toBeTruthy();
    expect(await stage()).toBe("in_progress");
    await robotSaid("flagged the hallway");

    // Fix it: tick the rectification row, then Fixed — the customer walks again (ruling 6).
    const { data: rect } = await db!.from("wo_surfaces").select("id").eq("work_order_id", woId).eq("rectification", true);
    for (const r of (rect ?? []) as { id: string }[]) expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: r.id, p_to: "done" })).toMatch(/^ok:/);
    await openJob(page);
    await expect(page.getByTestId("walkthrough-bar")).toHaveAttribute("data-phase", "rectified");
    await page.getByTestId("walkthrough-bar-start").click();
    await expect(page.getByTestId("walkthrough-bar-msg")).toContainText("walking through again");
    await until("back at walkthrough, hallway approved", async () => {
      const { data } = await db!.from("wo_signoff").select("areas").eq("work_order_id", woId).single();
      const a = (data as { areas: Record<string, { approved_at?: string }> }).areas ?? {};
      return a.Hallway?.approved_at && (await stage()) === "walkthrough" ? true : null;
    });
    await robotSaid("walked through again");

    // Sign on the phone (walk-through mode's session token — the on-device sign).
    const session = await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: woId });
    expect(session).toMatch(/^ok:/);
    const signed = await fetch(`${URL}/rest/v1/rpc/wo_sign_drawn`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: session.slice(3), p_signature: PNG, p_device: "e2e" }) }).then((r) => r.json());
    expect(String(signed)).toBe("ok:signed");
    expect(await stage()).toBe("closed");
    const { data: ci } = await db!.from("contractor_invoices").select("id, status, is_demo").eq("work_order_id", woId);
    expect(ci?.length, "the sign-off drafted the practice invoice").toBe(1);
    expect((ci![0] as { status: string; is_demo: boolean }).status).toBe("draft");
    expect((ci![0] as { is_demo: boolean }).is_demo).toBe(true);
  });

  test("M11: submit the invoice and claim an expense — approved by the robot office; M12: block a day", async ({ page }) => {
    const { data: ci } = await db!.from("contractor_invoices").select("id").eq("work_order_id", woId).single();
    const invoiceId = (ci as { id: string }).id;
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${invoiceId}`);
    await page.getByTestId("submit-invoice").click();
    // The page re-renders as the submitted invoice: the variation from Module 8 is on it.
    await expect(page.locator("body")).toContainText("Submitted", { timeout: 20_000 });
    await expect(page.locator("body")).toContainText("Approved variations");
    await until("invoice approved", async () => {
      const { data } = await db!.from("contractor_invoices").select("status").eq("id", invoiceId).single();
      return (data as { status: string }).status === "approved";
    });
    await robotSaid("Invoice approved");

    const start = dayPlus(new Date().toISOString().slice(0, 10), 10);
    const blk = await db!.from("contractor_unavailability").insert({ contractor_id: contractorId, start_date: start, end_date: start, reason: "E2E day off", source: "contractor", created_by: contractorUid });
    expect(blk.error?.message ?? "").toBe("");
  });

  test("as staff: the Induction grid and the painter's banner show the same checklist", async ({ page }) => {
    await signIn(page, staff!, /\/home/);
    await page.goto("/pc/demo");
    const row = page.getByTestId(`demo-row-${contractorId}`);
    await expect(row).toBeVisible();
    for (const key of ["accept", "photo", "stage", "prompt", "question", "finish_date", "variation", "walkthrough", "invoice", "expense", "block_day"]) {
      await expect(page.getByTestId(`demo-step-${contractorId}-${key}`), key).toHaveAttribute("data-done", "true");
    }
    await expect(page.getByTestId(`demo-step-${contractorId}-gcal`)).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId(`demo-done-${contractorId}`)).toContainText("11");

    await signIn(page, contractor!, /\/portal/);
    await openJob(page);
    const list = page.getByTestId("demo-checklist");
    await expect(list.locator("[data-done='true']")).toHaveCount(11);
    await expect(list.getByTestId("demo-step-gcal")).toHaveAttribute("data-done", "false");
  });
});
