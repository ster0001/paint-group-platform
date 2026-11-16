import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";
import { MONEY_RANGE, passOtpIfShown, quickNext } from "./drive";

/**
 * Automations ruling A‑F (Tom, 11 Nov 2026): a lead gets a token page with
 * their range, as a SNAPSHOT, and the chat — before any estimate is sent.
 *
 *  1. An ANONYMOUS customer walks the wizard on a phone to their range.
 *     The draft estimate now has a share token and a lead snapshot whose
 *     range is the one the gate printed.
 *  2. In a fresh browser (the link opened from a text, no session), /e/<token>
 *     shows the lead page: their first name, the address, the same range, and
 *     the chat. Their message lands on the estimate's thread.
 *  3. The office replies (a staff row on estimate_messages): the customer's
 *     page shows it, signed by the company.
 *  4. The page is the SNAPSHOT: the draft re-priced underneath (builder_state
 *     changed) does not move the range on the page.
 *  5. An unknown token is still a 404.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const suburb = `E2E LeadAF ${run}`;
const NAME = `Lena Lead${run}`;

const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 30_000 });

test.describe("The lead page (A‑F) — range snapshot + chat before an estimate is sent", () => {
  test.skip(!db, "service key needed");
  let estimateId = "";
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("id").eq("suburb", suburb);
    for (const r of rows ?? []) await db.from("crm_events").delete().eq("wizard_draft_id", r.id);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    if (estimateId) {
      await db.from("crm_events").delete().eq("estimate_id", estimateId);
      await db.from("estimate_messages").delete().eq("estimate_id", estimateId);
      await db.from("estimates").delete().eq("id", estimateId);
    }
  });

  test("an anonymous lead opens their range by link, chats, and sees the office reply", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    // 1 · the wizard, on a phone, no login.
    const custCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const cust = await custCtx.newPage();
    const parts = new URLSearchParams({ street: "9 Lead Street", suburb, state: "VIC", postcode: "3070", address: `9 Lead Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await cust.goto(`${baseURL}/estimate?${parts.toString()}`);
    await cust.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(cust.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await at(cust, "what");
    await cust.getByTestId("ql-jobtype-interior").tap();
    await at(cust, "property");
    await cust.getByTestId("ql-kind-house").tap();
    await at(cust, "beds");
    await cust.getByTestId("ql-bedrooms-3").click();
    await at(cust, "storeys");
    await cust.getByTestId("ql-storeys-single").click();
    await at(cust, "job");
    await cust.getByTestId("ql-scope-whole").click();
    await at(cust, "surfaces");
    await quickNext(cust);
    await at(cust, "rooms");
    await quickNext(cust);
    await at(cust, "colours");
    await cust.getByTestId("ql-colours-same").click();
    await at(cust, "condition");
    await cust.getByTestId("ql-condition-good").click();
    await at(cust, "living");
    await cust.getByTestId("ql-occupied-no").click();
    await at(cust, "details");
    await cust.getByTestId("gate-name").fill(NAME);
    await cust.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await cust.getByTestId("gate-email").fill(`pg.e2e.leadaf.${run}@example.com`);
    await expect(cust.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await cust.getByTestId("ql-next").tap();
    await passOtpIfShown(cust);
    const gate = cust.getByTestId("wzm-gate");
    await expect(gate).toBeVisible({ timeout: 90_000 });
    await expect(cust.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    const gateRange = (await cust.getByTestId("gate-range").textContent())!.trim();
    estimateId = (await gate.getAttribute("data-estimate-id")) ?? "";
    expect(estimateId).not.toBe("");

    // The draft holds a token and the snapshot of what the gate printed.
    let token = "";
    await expect.poll(async () => {
      const { data, error } = await db!.from("estimates").select("share_token, sent_at, lead_snapshot").eq("id", estimateId).maybeSingle();
      if (error) throw new Error(error.message);
      const r = data as { share_token: string | null; sent_at: string | null; lead_snapshot: { kind?: string; firstName?: string } | null } | null;
      token = r?.share_token ?? "";
      return Boolean(r && r.share_token && r.share_token.length >= 24 && !r.sent_at && r.lead_snapshot?.kind === "lead" && r.lead_snapshot.firstName === "Lena");
    }, { timeout: 20_000, message: "the lead snapshot and its token are written at the range" }).toBe(true);
    await custCtx.close();

    // 2 · the link, opened in a fresh browser with no session.
    const linkCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await linkCtx.newPage();
    await page.goto(`${baseURL}/e/${token}`);
    await expect(page.getByTestId("lead-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lead-greeting")).toContainText("Hi Lena");
    await expect(page.getByTestId("lead-address")).toContainText("9 Lead Street");
    await expect(page.getByTestId("lead-range")).toHaveText(gateRange);
    // The page names nobody beyond the first name and carries no line items or accept panel.
    await expect(page.locator("body")).not.toContainText(`Lead${run}`);
    await expect(page.locator("#accept")).toHaveCount(0);

    const chat = page.getByTestId("lead-chat");
    await chat.getByPlaceholder("Type your message…").fill(`Can you start in December? ${run}`);
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.locator(".chatrow.mine .chatbody").last()).toContainText(`Can you start in December? ${run}`);
    await expect.poll(async () => {
      const { count, error } = await db!.from("estimate_messages").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId).eq("direction", "customer");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 15_000 }).toBe(1);

    // 3 · the office answers on the same thread.
    const reply = await db!.from("estimate_messages").insert({ estimate_id: estimateId, direction: "staff", body: `Yes, early December works ${run}`, author_name: "Felipe" });
    if (reply.error) throw new Error(reply.error.message);
    await page.reload();
    await expect(page.getByTestId("lead-chat").locator(".chatrow.theirs")).toContainText(`Yes, early December works ${run}`, { timeout: 20_000 });
    await expect(page.getByTestId("lead-chat").locator(".chatrow.theirs .chatmeta")).toContainText("Felipe");

    // 4 · the snapshot, not the live draft: re-price the draft underneath and the page holds.
    const { data: est, error: estErr } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
    if (estErr) throw new Error(estErr.message);
    const bs = (est as { builder_state: Record<string, unknown> }).builder_state;
    const moved = await db!.from("estimates").update({ builder_state: { ...bs, guideRange: { loCents: 100, hiCents: 200, jobType: "interior" } } }).eq("id", estimateId);
    if (moved.error) throw new Error(moved.error.message);
    await page.reload();
    await expect(page.getByTestId("lead-range")).toHaveText(gateRange);

    // 5 · a token nobody holds is a 404.
    const miss = await page.goto(`${baseURL}/e/${randomBytes(30).toString("base64url")}`);
    expect(miss?.status()).toBe(404);
    await linkCtx.close();
  });
});
