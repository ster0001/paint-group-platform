import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 7 Oct 2026 (9 Broadway): "weatherboards needs to be listed in the
 * materials section — I updated the names of Baseboards / Back gable /
 * Cladded wall / Base Boards to separate them, and they are still combined".
 *
 * The Materials card is one row per NAME: the substrate's own row sets the
 * defaults; every other name is its own row whose product and colour are
 * pinned on exactly those surfaces. Plus the two things that hid behind it:
 * the base row's colour applies to its areas even when one had its own
 * colour, and the customer's paint card lists every surface and area.
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
  blocks: Array<{ surfaces: Array<{ clientLabel: string; color: string; productName: string | null }> }>;
  materialColours: Record<string, { name: string; hex: string }>;
};
type Snap = { paints: Array<{ name: string; usage: string[]; colours: Array<{ name: string; areas: string[] }> }> };

test.describe("Materials: one row per name (Tom, 7 Oct)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `mcp${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";
  let productA = "";

  test.beforeAll(async () => {
    const { data: products } = await db!.from("products").select("name").order("name").limit(2);
    productA = (products as { name: string }[])[0].name;
    const est = await db!.from("estimates").insert({
      title: `Rows per name ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [
          area(1, "Hall", surface(2, "Walls")),
          area(3, "Hall", surface(5, "Walls", "Merbau", "#65483B")),   // a plain wall given its own colour in the surface editor
          area(4, "Lounge", surface(6, "Feature wall")),                // a renamed wall → its own row
        ],
        modSel: { "Level of Finish": "FIN-3" },
        materials: { "Interior::Walls": productA },
        materialColours: {}, colourMatches: {},
        contact: { first_name: "Rows", last_name: "Customer", email: "", phone: "" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });

  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
    await db!.from("colours").delete().eq("name", colourName);
  });

  test("the substrate keeps its own row, each name gets one, and the figures land on the customer's card", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    if ((await page.getByTestId("materials-toggle").getAttribute("aria-expanded")) !== "true") await page.getByTestId("materials-toggle").click();

    // Two rows: "Walls" (the base, both plain walls) and "Feature wall" (named).
    await expect(page.getByTestId("material-row-label-Interior::Walls")).toHaveText("Walls");
    await expect(page.getByTestId("material-row-label-Interior::Walls::Feature wall")).toHaveText("Feature wall");
    // The base row SAYS one of its walls has its own colour.
    await expect(page.getByTestId("colour-pins-Interior::Walls")).toContainText("1 area own colour");

    // The named row takes its own product — pinned on that wall only.
    const namedPick = page.getByTestId("paint-pick-Interior::Walls::Feature wall");
    await expect(namedPick).toHaveValue("");            // "same as Walls"
    const other = (await namedPick.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).find((v) => v && v !== productA)!;
    await namedPick.selectOption(other);

    // A colour on the base row applies to BOTH plain walls (the override goes).
    const picker = page.getByTestId("material-colour-Interior::Walls");
    await picker.getByRole("button").first().click();
    await picker.getByRole("button", { name: "+ Add a colour" }).click();
    await picker.getByPlaceholder("Colour name").fill(colourName);
    await picker.getByPlaceholder("#hex").fill("#112233");
    await picker.getByRole("button", { name: "Add", exact: true }).click();
    await expect(picker).toContainText(colourName);
    await expect(page.getByTestId("colour-pins-Interior::Walls")).toHaveCount(0);

    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      return (data?.builder_state as State | null)?.materialColours["Interior::Walls"]?.name ?? null;
    }, { timeout: 20_000 }).toBe(colourName);

    const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", estimateId).single();
    const state = data!.builder_state as State;
    expect(state.blocks.map((b) => b.surfaces[0].color)).toEqual(["", "", ""]);
    expect(state.blocks.map((b) => b.surfaces[0].productName)).toEqual([null, null, other]);
    const snap = data!.sent_snapshot as Snap;
    // Two products now, and every surface / area is on its card — not the first three / six.
    const walls = snap.paints.find((p) => p.usage.some((u) => u.startsWith("Walls ·")))!;
    expect(walls.usage).toEqual(["Walls · Hall"]);
    expect(walls.colours).toEqual([{ name: colourName, hex: "#112233", match: false, areas: ["Hall"] }]);
    expect(snap.paints.some((p) => p.usage.includes("Feature wall · Lounge"))).toBe(true);
  });
});
