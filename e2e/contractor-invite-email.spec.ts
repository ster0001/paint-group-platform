import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 18 Sep 2026: "send an invitation link to them when registering on the
 * platform — via email". Staff create the invite with "Email them the link
 * now" ticked; the platform sends (and records) the email; the row says so;
 * "Email again" resends. On a server without an email key the send is
 * recorded as not sent and the office is told to copy the link instead —
 * either way a `messages` row exists for the invite address.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const EMAIL = `pg.e2e.invite.${run}@example.com`;

test.describe("emailing a contractor invitation", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let inviteId = "";

  test.afterAll(async () => {
    if (!db) return;
    await db.from("messages").delete().eq("to_address", EMAIL);
    await db.from("contractor_invites").delete().ilike("email", EMAIL);
  });

  test("create & email: the invite exists, the email is recorded, the row says whether it went", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/contractors");
    await page.getByRole("button", { name: /Invite a contractor/ }).click();
    await page.locator("input[type=email]").first().fill(EMAIL);
    await page.getByLabel(/Their name/).fill(`Ivy Invite ${run}`);
    await expect(page.getByLabel(/Email them the link now/)).toBeChecked();
    await page.getByTestId("invite-create").click();

    // The invite row.
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_invites").select("id, emailed_at, emailed_count").ilike("email", EMAIL).maybeSingle();
      inviteId = (data as { id: string } | null)?.id ?? "";
      return inviteId;
    }, { timeout: 20_000 }).not.toBe("");
    // The send is recorded whatever happened to it.
    await expect.poll(async () => {
      const { data } = await db!.from("messages").select("id, status").eq("to_address", EMAIL).order("created_at", { ascending: false }).limit(1);
      return (data?.[0] as { status?: string } | undefined)?.status ?? "";
    }, { timeout: 20_000 }).toMatch(/^(sent|not_configured|failed)$/);
    const { data: msg } = await db!.from("messages").select("status, subject, body, meta").eq("to_address", EMAIL).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m = msg as { status: string; subject: string; body: string; meta: { kind?: string } };
    expect(m.meta?.kind).toBe("contractor_invite");
    expect(m.subject).toMatch(/invited to join/i);
    expect(m.body).toContain(`/join/`);
    expect(m.body).toMatch(/works until/);

    const { data: inv } = await db!.from("contractor_invites").select("emailed_at, emailed_count").eq("id", inviteId).single();
    const row = inv as { emailed_at: string | null; emailed_count: number };
    if (m.status === "sent") {
      expect(row.emailed_at).not.toBeNull();
      expect(row.emailed_count).toBe(1);
      await expect(page.getByTestId(`invite-emailed-${inviteId}`)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Invitation emailed to/)).toBeVisible();
    } else {
      // No email key on this server: honest about it, and never marked as emailed.
      expect(row.emailed_at).toBeNull();
      expect(row.emailed_count).toBe(0);
      await expect(page.getByText(/Email isn't configured on this server/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`invite-not-emailed-${inviteId}`)).toBeVisible({ timeout: 20_000 });
    }
  });

  test("Email the link / Email again from the waiting list records a second send", async ({ page }) => {
    test.skip(!inviteId, "needs the invite from the first test");
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/contractors");
    const btn = page.getByTestId(`invite-email-${inviteId}`);
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();
    await expect.poll(async () => {
      const { count } = await db!.from("messages").select("id", { count: "exact", head: true }).eq("to_address", EMAIL);
      return count ?? 0;
    }, { timeout: 20_000 }).toBe(2);
  });

  test("a revoked invite cannot be emailed", async ({ page }) => {
    test.skip(!inviteId, "needs the invite from the first test");
    await db!.from("contractor_invites").update({ revoked_at: new Date().toISOString() }).eq("id", inviteId);
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/contractors");
    // Revoked invites leave the waiting list; the action refuses on its own too.
    await expect(page.getByTestId(`invite-email-${inviteId}`)).toHaveCount(0);
  });
});
