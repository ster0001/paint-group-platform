import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Portal UX + light mode (brief 25 Oct 2026) · Messages, as the signed-in customer.
 *
 *  G1  Only threads with something in them list; the empty ones sit behind one
 *      "Start a conversation about…" picker.
 *  G2  The badge is UNREAD staff replies (not the message count), gone at zero;
 *      an unread preview reads bold; opening the thread clears it.
 *  G3  Thread header carries the address, the job's status chip and "Open the
 *      estimate"; the assistant is a secondary button; staff bubbles carry an
 *      initial; the composer is on screen without scrolling at 400×860 with
 *      twenty messages in the thread.
 */

const db: SupabaseClient | null = serviceClient();
const SHOTS = "docs/briefs/portal-ux-light-screens";

test.describe("portal Messages — live threads, unread badge, sticky composer", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal Messages suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.msgs.${run}@example.com`;
  let busyId = "";
  let quietId = "";
  const STAFF_REPLIES = 9;

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email, name: "Priya Messages" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    const base = { account_id: acct.data.id as string, level_of_finish: 3, total_cents: 0, status: "sent", source: "customer_intake", sent_at: new Date().toISOString(), builder_state: { blocks: [] } };
    const ests = await sb.from("estimates").insert([
      { ...base, title: "111/25 Bunney Road, Landsborough", share_token: `pm${run}busy` },
      { ...base, title: "53B Talbot Crescent, Kooyong", share_token: `pm${run}quiet` },
    ]).select("id, title");
    if (ests.error) throw new Error(ests.error.message);
    busyId = ests.data.find((e) => e.title.startsWith("111/25"))!.id;
    quietId = ests.data.find((e) => e.title.startsWith("53B"))!.id;

    // Twenty messages: the customer asks, Robyn and Felipe answer, newest last.
    const rows: Array<{ estimate_id: string; direction: string; body: string; author_name: string | null; created_at: string }> = [];
    const start = Date.now() - 20 * 3_600_000;
    for (let i = 0; i < 20; i++) {
      const staff = i % 2 === 1;
      rows.push({
        estimate_id: busyId,
        direction: staff ? "staff" : "customer",
        body: staff ? `Reply number ${i} — yes, that works for us.` : `Question number ${i} about the start date?`,
        author_name: staff ? (i % 4 === 1 ? "Robyn" : "Felipe") : null,
        created_at: new Date(start + i * 3_600_000).toISOString(),
      });
    }
    rows.push({ estimate_id: busyId, direction: "staff", body: "Confirmed for Monday 6 Oct, 7:30am start.", author_name: "Robyn", created_at: new Date(start + 20 * 3_600_000).toISOString() });
    const ins = await sb.from("estimate_messages").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
    mkdirSync(SHOTS, { recursive: true });
  });

  test.afterAll(async () => {
    const sb = db!;
    if (busyId) await sb.from("messages").delete().in("estimate_id", [busyId, quietId]);
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("list, badge, picker, thread header, avatars, composer in view", async ({ page }) => {
    const sb = db!;
    await page.setViewportSize({ width: 400, height: 860 });
    await openMagicLink(page, await magicLinkFor(sb, email));
    await page.goto("/account/messages");

    // G1: one live thread listed; the quiet one is in the picker, not the list.
    const rowsOnPage = page.getByTestId("thread-row");
    await expect(rowsOnPage).toHaveCount(1);
    await expect(rowsOnPage).toContainText("111/25 Bunney Road");
    await expect(rowsOnPage).toContainText("Robyn: Confirmed for Monday 6 Oct");
    const picker = page.getByTestId("start-conversation");
    await expect(picker).toContainText("Start a conversation about");
    await expect(picker.locator("option", { hasText: "53B Talbot Crescent" })).toHaveCount(1);
    expect(await picker.locator("option", { hasText: "111/25 Bunney Road" }).count()).toBe(0);

    // G2: the badge is the unread STAFF replies (the mirror rows never opened), not the 21 messages.
    const mirrored = await sb.from("messages").select("id", { count: "exact", head: true })
      .eq("estimate_id", busyId).eq("provider", "portal").eq("direction", "out").is("read_at", null);
    expect(mirrored.count, "every staff reply is mirrored unread").toBe(STAFF_REPLIES + 2);
    await expect(page.getByTestId("unread-badge")).toHaveText(String(STAFF_REPLIES + 2));
    await expect(page.getByTestId("thread-preview")).toHaveClass(/unread/);
    await expect(page.getByTestId("assistant-widget-launch")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/messages-phone.png`, fullPage: true });

    // B4 / G3: anywhere on the row opens the thread.
    await rowsOnPage.locator(".meta").click();
    await expect(page).toHaveURL(new RegExp(`/account/messages/${busyId}`));
    await expect(page.getByTestId("thread-status")).toHaveText("Ready for you");
    await expect(page.getByTestId("open-estimate")).toHaveAttribute("href", new RegExp(`^/e/pm${run}busy`));
    await expect(page.getByTestId("ask-assistant")).toHaveClass(/btn-ghost/);
    // Staff bubbles carry an initial; Robyn and Felipe are told apart.
    const initials = await page.getByTestId("staff-initial").allTextContents();
    expect(new Set(initials)).toEqual(new Set(["R", "F"]));
    await expect(page.locator(".msg-meta").last()).toContainText(/Robyn · \d+ \w+, \d+:\d\d [ap]m/);
    // The composer is on screen WITHOUT scrolling, over twenty messages.
    await expect(page.getByTestId("composer")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send" })).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/thread-phone.png` });

    // Sending works from the sticky composer.
    await page.getByLabel("Write a message").fill("Thanks — see you Monday.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".msg.mine .msg-body", { hasText: "Thanks — see you Monday." })).toBeVisible({ timeout: 20_000 });

    // Opening the thread read it: back on the list the badge is gone and the preview is plain.
    await page.goto("/account/messages");
    await expect(page.getByTestId("unread-badge")).toHaveCount(0);
    await expect(page.getByTestId("thread-preview")).not.toHaveClass(/unread/);
    await expect(page.getByTestId("thread-preview")).toContainText("You: Thanks — see you Monday.");

    // The picker opens an empty thread.
    await page.getByTestId("start-conversation").locator("select").selectOption(quietId);
    await expect(page).toHaveURL(new RegExp(`/account/messages/${quietId}`));
    await expect(page.getByText("No messages yet — say hello below")).toBeVisible();
  });
});
