import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { rpcAs, serviceClient } from "./fixtures/woLoop";

/**
 * Tom's board and estimate batch, 18 Sep 2026 — five items in one sitting.
 *
 *   1. An employee's lane on the calendar reads like a contractor's (the
 *      transparent block), keeping the star.
 *   2. A search box at the top of the unscheduled tray.
 *   3. The tray ordered by ACCEPTED-LONGEST-AGO first.
 *   4. A search box on the paint list in the estimate's job settings, A-Z.
 *   5. A third quality-check setting: none.
 *
 * And the report that came with them: "Saulius Ginetas (employee) is coming
 * up as not offerable, even though he should be". `offerable` means "can be
 * sent an OFFER", which an employee never is — they are ASSIGNED, and
 * `assign_job` never reads the flag. So the flag was right and the screens
 * were wrong: the list called it a failure, the compliance line marked them
 * down for public liability they are never asked for, and "Ready for work
 * only" hid them from the board entirely. All three are asserted here.
 *
 * Everything this file creates, it removes.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const EMP_NAME = `E2E Employee ${run}`;
let empUserId = "";
let empContractorId = "";

/** Three tray jobs, accepted at known times, with findable titles. */
const TRAY = [
  { key: "old", title: `Tray Oldest ${run}`, suburb: "Brunswick", days: 30 },
  { key: "mid", title: `Tray Middle ${run}`, suburb: "Northcote", days: 14 },
  { key: "new", title: `Tray Newest ${run}`, suburb: "Brunswick", days: 1 },
];
const trayIds: Record<string, { estimateId: string; workOrderId: string; woRef: string }> = {};

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

test.describe("board and paint usability, 18 Sep", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the fixtures");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    // ---- an employee with no insurance on file, which is the normal state ----
    const created = await db!.auth.admin.createUser({
      email: `pg.e2e.emp.${run}@example.com`, password: `Employee-${run}-pw!`,
      email_confirm: true, user_metadata: { name: EMP_NAME },
    });
    if (created.error || !created.data.user) throw new Error(`create employee: ${created.error?.message}`);
    empUserId = created.data.user.id;
    const prof = await db!.from("profiles").update({ role: "contractor", name: EMP_NAME }).eq("id", empUserId);
    if (prof.error) throw new Error(prof.error.message);
    const c = await db!.from("contractors")
      .insert({ profile_id: empUserId, tier: "B", active: true, company_name: "", employment_type: "employee" })
      .select("id, offerable").single();
    if (c.error) throw new Error(c.error.message);
    empContractorId = (c.data as { id: string }).id;
    // The premise of the whole report: the flag IS false, and correctly so.
    expect((c.data as { offerable: boolean }).offerable, "an employee has no public liability, so cannot be OFFERED").toBe(false);

    // ---- three jobs awaiting dates -------------------------------------------
    for (const t of TRAY) {
      const { data: est, error: estErr } = await db!.from("estimates")
        .insert({ status: "accepted", source: "manual", level_of_finish: 3, title: t.title, accepted_at: daysAgo(t.days) })
        .select("id").single();
      if (estErr) throw new Error(`tray estimate: ${estErr.message}`);
      const estimateId = (est as { id: string }).id;
      const woRef = `WO-E2EB${run.slice(-4)}${t.key}`;
      const { data: wo, error: woErr } = await db!.from("work_orders").insert({
        estimate_id: estimateId, wo_ref: woRef,
        share_token: `${run}${t.key}${"x".repeat(24)}`.slice(0, 32),
        stage: "pre_start", status: "issued", issued_at: daysAgo(t.days),
        wo_snapshot: {
          version: 1, woRef, status: "issued", jobTitle: t.title,
          // Four parts: the board reads the suburb as the second-last but one,
          // the shape a real Places address has.
          jobAddress: `1 Test St, ${t.suburb}, VIC, 3000`,
          contactFirstName: "Test", contactPhone: "", startDate: null,
          accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
          contractorName: "", contractorPaymentCents: 0, materials: [], areas: [],
          exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
        },
      }).select("id").single();
      if (woErr) throw new Error(`tray work order: ${woErr.message}`);
      trayIds[t.key] = { estimateId, workOrderId: (wo as { id: string }).id, woRef };
    }
  });

  test.afterAll(async () => {
    for (const k of Object.keys(trayIds)) {
      await db!.from("work_orders").delete().eq("id", trayIds[k].workOrderId);
      await db!.from("estimates").delete().eq("id", trayIds[k].estimateId);
    }
    if (empContractorId) await db!.from("contractors").delete().eq("id", empContractorId);
    if (empUserId) {
      const r = await db!.auth.admin.deleteUser(empUserId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  // -------------------------------------------------------------------------
  test("an employee is never called 'Not offerable', and is never marked down for insurance", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const badge = page.getByTestId(`badge-${empContractorId}`);
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await expect(badge).toHaveText("Employee · assigned");
    await expect(badge).not.toContainText("Not offerable");

    // The row they sit in must not carry a contractor's compliance verdict.
    const row = page.locator("div").filter({ has: page.getByTestId(`badge-${empContractorId}`) }).last();
    await expect(row).not.toContainText("No current insurance");
  });

  test("'Ready for work only' keeps employees on the board", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    const lane = page.locator(`[data-contractor-id="${empContractorId}"]`);
    await expect(lane).toBeVisible({ timeout: 30_000 });

    // The filter popover hangs off the STICKY header, so let the page settle at
    // the top first — scrolling it into view moves the popover with the header
    // and the click lands on the lane behind where it used to be.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("filters-open").click();
    const onlyReady = page.getByTestId("filter-offerable");
    await expect(onlyReady).toBeVisible();
    // No force: the popover was UNCLICKABLE in the console until the header was
    // made positioned again (schedule.css), so this click is part of the test.
    await onlyReady.check();
    await expect(onlyReady).toBeChecked();
    // Was hidden entirely before the fix — the report that started this.
    await expect(lane).toBeVisible();
    await expect(page.getByTestId("lane-employee").first()).toBeVisible();
  });

  test("the month, day and date stay locked at the top while the contractors scroll", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    // A short laptop, so the handful of lanes on the test board overflows the
    // timeline. Tom's board has dozens on a full screen — the same condition.
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/pc/schedule");
    await expect(page.getByTestId("board-header")).toBeVisible({ timeout: 30_000 });

    const read = () => page.evaluate(() => {
      const tl = document.querySelector(".sb .tl") as HTMLElement;
      const h = document.querySelector('[data-testid="board-header"]') as HTMLElement;
      const row = document.querySelector(".sb .crow") as HTMLElement;
      return {
        tlTop: tl.getBoundingClientRect().top,
        headerTop: h.getBoundingClientRect().top,
        rowTop: row.getBoundingClientRect().top,
        scrolled: tl.scrollTop,
        maxScroll: tl.scrollHeight - tl.clientHeight,
      };
    });

    const before = await read();
    expect(before.maxScroll, "the timeline is its own scroller and this board overflows it")
      .toBeGreaterThan(0);
    // On screen, and ending at the bottom of it: the timeline is sized to the
    // space it has, which is what gives the lanes somewhere to scroll.
    expect(before.tlTop, "the timeline starts on screen").toBeGreaterThan(0);
    const bottomGap = await page.evaluate(() => {
      const tl = document.querySelector(".sb .tl") as HTMLElement;
      return window.innerHeight - tl.getBoundingClientRect().bottom;
    });
    expect(bottomGap, "the timeline runs to the bottom of the screen").toBeGreaterThanOrEqual(0);
    expect(bottomGap, "and not far short of it").toBeLessThan(40);

    await page.evaluate(() => {
      const tl = document.querySelector(".sb .tl") as HTMLElement;
      tl.scrollTop = tl.scrollHeight;
    });
    const after = await read();

    // The contractors moved by exactly what was scrolled…
    expect(after.scrolled).toBe(before.maxScroll);
    expect(Math.round(before.rowTop - after.rowTop), "the lanes moved with the scroll")
      .toBe(Math.round(after.scrolled));
    // …and the dates did not move at all.
    expect(Math.round(after.headerTop), "the dates stayed put").toBe(Math.round(before.headerTop));
    expect(Math.abs(after.headerTop - after.tlTop), "flush with the top of the timeline")
      .toBeLessThanOrEqual(1);

    // And they are genuinely on top: a lane scrolling past does not cover them.
    const covered = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="board-header"]') as HTMLElement;
      // A day cell, not the header's own centre — the header is as wide as the
      // whole timeline, so its midpoint is off the side of the screen.
      const cell = document.querySelector(".sb .dh .cell:not(.lanehead)") as HTMLElement;
      const r = cell.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return Boolean(el && h.contains(el));
    });
    expect(covered, "nothing scrolls over the top of the dates").toBe(true);
  });

  test("the tray searches, and puts the longest wait at the top", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    const cards = page.locator('[data-testid="tray-job"]');
    await expect(cards.filter({ hasText: TRAY[0].title })).toBeVisible({ timeout: 30_000 });

    // Ordering: of OUR three, oldest-accepted comes first.
    const refs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-wo-ref") ?? ""));
    const mine = refs.filter((r) => r.includes(`E2EB${run.slice(-4)}`));
    expect(mine, "accepted longest ago at the top, most recent at the bottom")
      .toEqual([trayIds.old.woRef, trayIds.mid.woRef, trayIds.new.woRef]);

    // Search by title…
    await page.getByTestId("tray-search").fill(TRAY[1].title);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-wo-ref", trayIds.mid.woRef);

    // …by reference…
    await page.getByTestId("tray-search").fill(trayIds.new.woRef);
    await expect(cards).toHaveCount(1);

    // …and by suburb, which matches two of ours.
    await page.getByTestId("tray-search").fill(`Brunswick`);
    const bySuburb = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-wo-ref") ?? ""));
    expect(bySuburb).toContain(trayIds.old.woRef);
    expect(bySuburb).toContain(trayIds.new.woRef);
    expect(bySuburb).not.toContain(trayIds.mid.woRef);

    // Nothing matching says so rather than showing an empty box.
    await page.getByTestId("tray-search").fill(`zzz-no-such-job-${run}`);
    await expect(page.getByTestId("tray-no-match")).toBeVisible();
  });

  test("quality checks cycle first jobs → every job → none, and 'none' stops them being scheduled", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const button = page.getByTestId(`qa-mode-${empContractorId}`);
    await expect(button).toHaveText("QA: first jobs", { timeout: 20_000 });
    await button.click();
    await expect(button).toHaveText("QA: every job", { timeout: 20_000 });
    await button.click();
    await expect(button).toHaveText("QA: none", { timeout: 20_000 });

    const { data: row, error } = await db!.from("contractors")
      .select("qa_mode, requires_qa").eq("id", empContractorId).single();
    if (error) throw new Error(error.message);
    expect(row).toMatchObject({ qa_mode: "none", requires_qa: false });

    // A job of theirs schedules NO checks…
    const job = trayIds.old;
    await db!.from("work_orders").update({ contractor_id: empContractorId, qa_required: false }).eq("id", job.workOrderId);
    await db!.from("wo_qa_checks").delete().eq("work_order_id", job.workOrderId);
    expect(await rpcAs(staff!, "wo_schedule_qa", { p_work_order_id: job.workOrderId })).toBe("ok:0");
    const { count: none } = await db!.from("wo_qa_checks")
      .select("id", { count: "exact", head: true }).eq("work_order_id", job.workOrderId);
    expect(none, "no checks for a painter set to none").toBe(0);

    // …but a job TICKED for a check when it was booked still gets one.
    await db!.from("work_orders").update({ qa_required: true }).eq("id", job.workOrderId);
    const made = await rpcAs(staff!, "wo_schedule_qa", { p_work_order_id: job.workOrderId });
    expect(made.startsWith("ok:"), `expected ok:n, got ${made}`).toBe(true);
    expect(Number(made.slice(3)), "the office ticking one job still wins").toBeGreaterThan(0);

    // Back round to the start, and the old boolean follows.
    await page.reload();
    await button.click();
    await expect(button).toHaveText("QA: first jobs", { timeout: 20_000 });
    await db!.from("wo_qa_checks").delete().eq("work_order_id", job.workOrderId);
    await db!.from("work_orders").update({ contractor_id: null, qa_required: false }).eq("id", job.workOrderId);
  });

  test("the paint list searches and reads A-Z, and never drops the paint already chosen", async ({ page }) => {
    test.setTimeout(180_000);
    const { data: est, error } = await db!.from("estimates").insert({
      title: `Paint search ${run}`, status: "draft", source: "manual", level_of_finish: 3,
      builder_state: {
        // The Materials card only exists once something needs painting.
        blocks: [{
          id: 1, kind: "area", name: "Hall", type: "Interior", areaType: "room", L: 4, W: 2, H: 2.4,
          isOption: false, description: "", open: false, media: [], surfaces: [{
            id: 2, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", coats: 2, count: 1,
            hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
            rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
            productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null,
            unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false,
            useCustomRate: false, customRate: null, open: false,
          }],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {},
        colourMatches: {}, contact: { first_name: "Paint", last_name: "Search", email: "", phone: "" },
      },
    }).select("id").single();
    if (error) throw new Error(error.message);
    const estimateId = (est as { id: string }).id;

    try {
      await signIn(page, staff!, /\/(home|estimates)/);
      await page.goto(`/quote?id=${estimateId}`);
      await page.waitForLoadState("networkidle");
      // The card is open by default, so the box is simply there.
      const search = page.getByTestId("paint-search");
      await expect(search).toBeVisible({ timeout: 30_000 });
      const select = page.getByTestId("paint-pick-Interior::Walls");

      // A-Z, by eye and by assertion.
      const before = await select.locator("option").evaluateAll((o) =>
        o.map((x) => x.textContent?.trim() ?? "").filter((t) => t && !t.startsWith("—")));
      const sorted = [...before].sort((a, b) => a.localeCompare(b, "en-AU", { sensitivity: "base" }));
      expect(before, "the paints read A-Z").toEqual(sorted);

      // Whatever is chosen on this row must survive every search — a <select>
      // whose value is missing from its options silently displays the FIRST one
      // instead, which is how every trim once read the wrong product (30 Aug).
      const chosen = await select.inputValue();
      expect(chosen, "the row starts on a real product").not.toBe("");

      // Typing narrows every dropdown at once.
      const term = before.find((n) => !n.toLowerCase().includes(chosen.toLowerCase().split(" ")[0]))?.split(" ")[0]
        ?? before[0].split(" ")[0];
      await search.fill(term);
      const after = await select.locator("option").evaluateAll((o) =>
        o.map((x) => x.textContent?.trim() ?? "").filter((t) => t && !t.startsWith("—")));
      expect(after.length).toBeLessThan(before.length);
      expect(after.every((n) => n.toLowerCase().includes(term.toLowerCase()) || n === chosen),
        `every paint left matches "${term}", except the one already chosen: ${after.join(" | ")}`).toBe(true);
      expect(after, "the chosen paint is never filtered away").toContain(chosen);
      expect(await select.inputValue(), "and the row still reads as itself").toBe(chosen);

      // Clearing the box puts them all back, still A-Z.
      await search.fill("");
      const cleared = await select.locator("option").evaluateAll((o) =>
        o.map((x) => x.textContent?.trim() ?? "").filter((t) => t && !t.startsWith("—")));
      expect(cleared).toEqual(before);
    } finally {
      await db!.from("estimates").delete().eq("id", estimateId);
    }
  });
});
