import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Honest self-assessment harness for Tom's 8 complaints (2026-08-19).
 * Drives the CUSTOMER wizard preview + scope editor and logs what actually
 * happens. Screenshots land in test-results/assess/.
 */
const staff = credentials("STAFF");
const shot = (page: import("@playwright/test").Page, name: string) =>
  page.screenshot({ path: `test-results/assess/${name}.png`, fullPage: true });

test.use({ actionTimeout: 8_000 });

test("walk the customer flow and record reality", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit")) console.log("EDIT-API", r.status(), (await r.text().catch(() => "")).slice(0, 150));
    if (r.url().includes("/api/") && r.status() >= 400) {
      console.log(`API ${r.status()} ${r.url().split("/api/")[1]} :: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    }
  });

  await signIn(page, staff!, /estimates/);

  // ---- 1. EXTERIOR wizard questions (complaint 7) --------------------------
  await page.goto("/estimate");
  await shot(page, "01-estimate-page1");
  await page.getByRole("button", { name: "Exterior", exact: true }).click();
  await shot(page, "02-exterior-selected");
  console.log("PAGE1 exterior text:", (await page.locator(".wz-step").innerText()).replace(/\n+/g, " | ").slice(0, 600));

  // ---- 2. floorplan upload (complaint 2) — real file ----------------------
  await page.getByRole("button", { name: "Interior", exact: true }).click();
  const plan = process.env.HOME + "/Downloads/Leamington floorplan.png";
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Upload a floorplan/ }).click(),
  ]);
  console.log("floorplan chooser multiple =", chooser.isMultiple());
  await chooser.setFiles(plan);
  await page.waitForTimeout(8000);
  await shot(page, "03-after-plan-upload");
  console.log("after upload:", (await page.locator(".wz-step").innerText()).replace(/\n+/g, " | ").slice(0, 400));

  // customer page-1 gate needs suburb + postcode
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  // answer the guardrail questions benignly (No heritage, built after 1970)
  const seg = async (q: string, a: string) => {
    const row = page.locator(".wz-qhead", { hasText: q }).locator("xpath=following-sibling::div[1]").getByRole("button", { name: a, exact: true });
    if (await row.count()) await row.first().click();
  };
  await seg("Heritage listed", "No");

  // ---- facade/photos box behaviour (complaint 3): what does adding a PHOTO
  // do? Use the exterior facade box on a Both job to see its labelling.
  const next = async () => {
    await page.getByRole("button", { name: /Continue|See my estimate|Nearly there/ }).first().click();
    await page.waitForTimeout(500);
    const err = page.locator(".wz-err");
    if (await err.count()) console.log("GATE ERROR:", (await err.first().innerText()).slice(0, 120));
  };
  await next(); // surfaces
  await shot(page, "04-page2-surfaces");
  await next(); // condition
  await next(); // details
  await shot(page, "05-page4-details");
  console.log("PAGE4 text:", (await page.locator(".wz-step").innerText()).replace(/\n+/g, " | ").slice(0, 500));
  // damage tier 3 + photo (complaint 3: are photos actually assessed?)
  const t3 = page.getByRole("button", { name: /a few areas of concern/i });
  const no1970 = page.locator(".wz-qhead", { hasText: "built before 1970" }).locator("xpath=following-sibling::div[1]").getByRole("button", { name: "No", exact: true });
  if (await no1970.count()) await no1970.first().click();
  if (await t3.count()) {
    await t3.click();
    const photoBtn = page.locator(".wz-photo-stub");
    if (await photoBtn.count()) {
      try {
        const [ch2] = await Promise.all([page.waitForEvent("filechooser", { timeout: 4000 }), photoBtn.first().click()]);
        await ch2.setFiles(process.env.HOME + "/Downloads/30 Rodda Front.jpg");
        await page.waitForTimeout(1500);
        console.log("PAGE4 after photo:", (await page.locator(".wz-step").innerText()).replace(/\n+/g, " | ").slice(0, 300));
      } catch { console.log("photo stub present but no file chooser opened"); }
    } else console.log("NO damage-photo control on page 4");
  }
  await next(); // paint
  await next(); // email gate (customer mode)
  const email = page.locator("input[type=email]");
  if (await email.count()) await email.fill("assess-test@example.com");
  await shot(page, "06-before-submit");
  await page.getByRole("button", { name: "See my estimate" }).click();

  // ---- result screen: range? confidence? (complaints 1, 5) ----------------
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    const t = await page.locator("body").innerText();
    if (!/PRICING EVERY SURFACE|READING THE FLOORPLAN/.test(t) || /YOUR ESTIMATE|didn.t work|error/i.test(t)) break;
  }
  await shot(page, "07-result");
  const body = await page.locator("body").innerText();
  console.log("RESULT screen (first 900):", body.replace(/\n+/g, " | ").slice(0, 900));

  // ---- scope editor (complaints 1, 4, 6, 8) -------------------------------
  const open = page.getByRole("link", { name: /Open the editor/i });
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(3000);
    await shot(page, "08-scope-editor");
    console.log("EDITOR text (first 1200):", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 1200));
    // steppers present?
    console.log("stepper buttons:", await page.locator(".sc-st").count());
    // try a toggle (remove a surface)
    const firstCard = page.locator(".sc-rc").first();
    const before = await firstCard.locator(".sc-tl.on").count();
    await firstCard.locator(".sc-tl.on").first().click();
    await page.waitForTimeout(3500);
    console.log("toggle: first-room on-tiles", before, "→", await firstCard.locator(".sc-tl.on").count());
    await shot(page, "09-after-toggle");
    // try room removal
    const x = page.locator(".sc-x").first();
    if (await x.count()) { await x.click(); await page.waitForTimeout(2500); await shot(page, "10-after-remove-room"); }
  } else {
    console.log("NO 'Open the editor' link on result screen");
  }
});
