import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 16 Sep 2026 — duplicate an estimate from the list.
 *
 * The check as Tom described it: press Duplicate on a row; the builder opens
 * on a NEW estimate (a new number); the list shows it as "address (copy)";
 * the photos on the original are not on the copy; and it is already saved,
 * ready to be edited.
 *
 * The original is seeded with a photo row and a photo sign-off so the spec
 * can prove both are absent from the copy — and still present on the
 * original, because duplicating must never delete anything.
 */
test.describe("duplicate an estimate", () => {
  const staff = credentials("STAFF");
  const db = serviceClient();
  const stamp = Date.now();
  const title = `E2E dup ${stamp}`;
  let sourceId: string | null = null;
  let copyId: string | null = null;

  test.beforeAll(async () => {
    if (!db) return;
    const r = await db.from("estimates").insert({
      title,
      status: "sent",
      level_of_finish: 3,
      total_cents: 456700,
      subtotal_cents: 415200,
      share_token: `e2e-dup-${stamp}-abcdefghijklmnop`,
      sent_at: new Date().toISOString(),
      builder_state: {
        blocks: [{ id: "b1", name: "Lounge", areaType: "room", lines: [] }],
        modSel: { "Level of Finish": "LOF-3" },
        contact: { first_name: "Dup", last_name: "Tester", email: `dup-${stamp}@example.com`, phone: "" },
        jobAddress: { address: `${stamp % 1000} Copy Street`, city: "Clayton", state: "VIC", postal: "3168" },
        photoReview: { signedOffAt: new Date().toISOString(), photos: 1 },
        wizard: { state: { jobType: "interior", details: { damageTier: 2, damagePhotoCount: 3, damageNote: "" } } },
      },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    sourceId = r.data.id as string;
    const p = await db.from("estimate_sources").insert({
      estimate_id: sourceId, kind: "defect_photo", storage_path: `e2e/${stamp}/never-uploaded.jpg`, mime_type: "image/jpeg",
    });
    if (p.error) throw new Error(p.error.message);
  });

  test.afterAll(async () => {
    if (!db) return;
    for (const id of [copyId, sourceId]) if (id) await db.from("estimates").delete().eq("id", id);
  });

  test("Duplicate makes a saved copy with a new number, '(copy)' on the address and no photos", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    await signIn(page, staff!, /\/(home|estimates)/);

    await page.goto(`/estimates?status=all&q=${encodeURIComponent(title)}`);
    const button = page.getByTestId(`duplicate-${sourceId}`);
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();

    // The builder opens on the COPY — a different id, so a different number.
    await expect(page).toHaveURL(/\/quote\?id=/, { timeout: 30_000 });
    copyId = new URL(page.url()).searchParams.get("id");
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(sourceId);
    // Already saved: the header shows its number, not "New".
    await expect(page.getByText(copyId!.slice(0, 8), { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    // What was saved.
    const { data: copy } = await db!.from("estimates")
      .select("title, status, share_token, sent_at, sent_snapshot, total_cents, level_of_finish, builder_state, sources:estimate_sources(id)")
      .eq("id", copyId!).single();
    expect(copy).not.toBeNull();
    expect(copy!.title).toBe(title);
    expect(copy!.status).toBe("draft");
    expect(copy!.share_token).toBeNull();
    expect(copy!.sent_at).toBeNull();
    expect(copy!.sent_snapshot).toBeNull();
    expect(copy!.total_cents).toBe(456700);
    expect(copy!.level_of_finish).toBe(3);
    const state = copy!.builder_state as { blocks: unknown[]; jobAddress: { address: string; city: string }; contact: { first_name: string }; photoReview?: unknown; wizard: { state: { details: { damagePhotoCount: number } } } };
    expect(state.jobAddress.address).toBe(`${stamp % 1000} Copy Street (copy)`);
    expect(state.jobAddress.city).toBe("Clayton");
    expect(state.blocks).toHaveLength(1);
    expect(state.contact.first_name).toBe("Dup");
    expect(state.photoReview).toBeUndefined();
    expect(state.wizard.state.details.damagePhotoCount).toBe(0);
    expect(copy!.sources).toEqual([]);

    // The original keeps its photo — nothing was deleted.
    const { data: orig } = await db!.from("estimates")
      .select("status, share_token, builder_state, sources:estimate_sources(id)").eq("id", sourceId!).single();
    expect(orig!.status).toBe("sent");
    expect(orig!.share_token).toBe(`e2e-dup-${stamp}-abcdefghijklmnop`);
    expect((orig!.builder_state as { photoReview?: unknown }).photoReview).toBeTruthy();
    expect(orig!.sources).toHaveLength(1);

    // And the list shows the copy as "address (copy)".
    await page.goto(`/estimates?status=all&q=${encodeURIComponent(title)}`);
    const row = page.locator("tr", { has: page.getByTestId(`duplicate-${copyId}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(title);
    await expect(row).toContainText(`${stamp % 1000} Copy Street (copy), Clayton`);
    await expect(row.getByTestId(`status-${copyId}`)).toContainText(/draft/i);
  });
});
