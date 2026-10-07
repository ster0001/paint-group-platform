import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 7 Oct 2026 (9 Broadway): "updating the colours isn't updating in the
 * estimate" — five weatherboard areas carried a per-area colour override, so
 * the Materials row's new colour skipped them and nothing said so; the row's
 * label had lost the plain "Weatherboards" once some areas were relabelled;
 * and the customer's paint card only listed the first three surfaces, so a
 * renamed "Base boards" never appeared on it.
 *
 *   · the Materials row says "N areas own colour" with a one-tap reset;
 *   · picking the row's colour applies it everywhere (clears the overrides);
 *   · the row label keeps the substrate while any area still uses it;
 *   · the paint card lists every surface and every colour's areas.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");
const colourName = `Pin ${run}`;

const surface = (id: number, label: string, color = "", colorHex = "") => ({
  id, code: "Walls", internalLabel: label, clientLabel: label, coats: 2, count: 1,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color, colorHex,
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});
const area = (id: number, name: string, s: ReturnType<typeof surface>) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
  isOption: false, description: "", open: false, media: [], surfaces: [s],
});

type State = {
  blocks: Array<{ surfaces: Array<{ clientLabel: string; color: string }> }>;
  materialColours: Record<string, { name: string; hex: string }>;
};
type Snap = { paints: Array<{ usage: string[]; colours: Array<{ name: string; areas: string[] }> }> };

test.describe("Materials colour applies everywhere; labels and paint cards complete (Tom, 7 Oct)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `mcp${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";

  test.beforeAll(async () => {
    const { data: product } = await db!.from("products").select("name").order("name").limit(1).single();
    const est = await db!.from("estimates").insert({
      title: `Colour pins ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [
          area(1, "Hall", surface(2, "Walls")),
          // The lounge was given its own colour in the surface editor.
          area(3, "Lounge", surface(4, "Feature wall", "Merbau", "#65483B")),
        ],
        modSel: { "Level of Finish": "FIN-3" },
        materials: { "Interior::Walls": (product as { name: string }).name },
        materialColours: {}, colourMatches: {},
        contact: { first_name: "Pins", last_name: "Customer", email: "", phone: "" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });

  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
    await db!.from("colours").delete().eq("name", colourName);
  });

  test("the row names the override, keeps the substrate in its label, and the picked colour reaches every area and the customer's card", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    if ((await page.getByTestId("materials-toggle").getAttribute("aria-expanded")) !== "true") await page.getByTestId("materials-toggle").click();

    // Label: the plain substrate stays while the Hall still uses it.
    await expect(page.getByTestId("material-row-label-Interior::Walls")).toHaveText("Walls / Feature wall");
    // The override is VISIBLE on the row now.
    await expect(page.getByTestId("colour-pins-Interior::Walls")).toContainText("1 area own colour");

    // Pick the row's colour (a new one, so the library's contents don't matter).
    const picker = page.getByTestId("material-colour-Interior::Walls");
    await picker.getByRole("button").first().click();
    await picker.getByRole("button", { name: "+ Add a colour" }).click();
    await picker.getByPlaceholder("Colour name").fill(colourName);
    await picker.getByPlaceholder("#hex").fill("#112233");
    await picker.getByRole("button", { name: "Add", exact: true }).click();
    await expect(picker).toContainText(colourName);
    // …and it applied everywhere: the override is gone.
    await expect(page.getByTestId("colour-pins-Interior::Walls")).toHaveCount(0);

    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      return (data?.builder_state as State | null)?.materialColours["Interior::Walls"]?.name ?? null;
    }, { timeout: 20_000 }).toBe(colourName);

    const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", estimateId).single();
    const state = data!.builder_state as State;
    expect(state.blocks.map((b) => b.surfaces[0].color)).toEqual(["", ""]);
    const snap = data!.sent_snapshot as Snap;
    // Every surface, every area — not the first three / six.
    expect(snap.paints[0].usage).toEqual(["Walls · Hall", "Feature wall · Lounge"]);
    expect(snap.paints[0].colours).toEqual([{ name: colourName, hex: "#112233", match: false, areas: ["Hall", "Lounge"] }]);
  });
});
