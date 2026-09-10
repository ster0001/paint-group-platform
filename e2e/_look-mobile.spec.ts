import { test } from "@playwright/test";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { mkdirSync } from "node:fs";
const OUT = process.env.LOOK_OUT ?? "test-results/look-mobile";
mkdirSync(OUT, { recursive: true });

/**
 * Diagnostic, not a gate (Tom, 10 Sep: "you can't scroll left to right in
 * phone view"): walks the staff pages at phone width and prints, per page,
 * the layout viewport vs the device width, the elements that reach past the
 * right edge, and the ancestor chain of the first table (overflow / min-width)
 * — the three numbers that found the clipped tables, the unwrapped builder
 * toolbar and the escaped sr-only span. Screenshots land in LOOK_OUT.
 * LOOK_PAGES=/estimates,/contacts narrows it; LOOK_ONLY_BUILDER=1 skips to
 * the builder.
 */
test.describe("mobile look", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  test("staff pages at phone width", async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, credentials("STAFF")!, /\/estimates/);
    const pages = process.env.LOOK_ONLY_BUILDER ? [] : process.env.LOOK_PAGES ? process.env.LOOK_PAGES.split(",") : ["/estimates", "/pc", "/pc/flow", "/pc/schedule", "/invoices", "/invoicing", "/contacts", "/crm", "/contractors", "/settings", "/proving"];
    for (const p of pages) {
      await page.goto(p).catch(() => {});
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => {
        const vw = window.innerWidth;
        const doc = document.documentElement;
        const wide: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > 414 && r.width < 20000) {
            const cls = (el.className && typeof el.className === "string") ? el.className.split(" ").slice(0, 5).join(".") : "";
            wide.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
            if (wide.length >= 10) break;
          }
        }
        const chain: string[] = [];
        let n: HTMLElement | null = document.querySelector("table");
        while (n && n !== document.body) {
          const cs = getComputedStyle(n);
          chain.push(`${n.tagName.toLowerCase()}.${(typeof n.className === "string" ? n.className : "").split(" ").slice(0, 4).join(".")} w=${Math.round(n.getBoundingClientRect().width)} ox=${cs.overflowX} minw=${cs.minWidth} disp=${cs.display}`);
          n = n.parentElement;
        }
        return { vw, scrollW: doc.scrollWidth, bodyOverflowX: getComputedStyle(document.body).overflowX, htmlOverflowX: getComputedStyle(doc).overflowX, wide, chain };
      });
      const meta = await page.evaluate(() => ({ meta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "(none)", scale: window.visualViewport?.scale, docW: document.documentElement.getBoundingClientRect().width, bodyW: document.body.getBoundingClientRect().width }));
      console.log(`PAGE ${p} url=${page.url()} vw=${info.vw} scrollW=${info.scrollW} body=${info.bodyOverflowX} html=${info.htmlOverflowX} meta="${meta.meta}" scale=${meta.scale} docW=${meta.docW} bodyW=${meta.bodyW}`);
      for (const w of info.wide) console.log(`   ↳ ${w}`);
      for (const c of info.chain) console.log(`   ⤴ ${c}`);
      await page.screenshot({ path: `${OUT}/m-${p.replace(/\//g, "_") || "root"}.png`, fullPage: false });
    }
    // The builder, on a draft with a few blocks.
    const db = serviceClient();
    const { data: est } = await db!.from("estimates").select("id").eq("status", "draft").not("builder_state", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (est?.id) {
      await page.goto(`/quote?id=${est.id}`);
      await page.waitForTimeout(3000);
      const info = await page.evaluate(() => {
        const wide: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > 414 && r.width < 20000) {
            const cls = (el.className && typeof el.className === "string") ? el.className.split(" ").slice(0, 6).join(".") : "";
            wide.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(r.right)} w=${Math.round(r.width)} testid=${el.dataset.testid ?? ""}`);
            if (wide.length >= 12) break;
          }
        }
        return { vw: window.innerWidth, scrollW: document.documentElement.scrollWidth, wide };
      });
      console.log(`PAGE builder url=${page.url()} vw=${info.vw} scrollW=${info.scrollW}`);
      for (const w of info.wide) console.log(`   ↳ ${w}`);
      await page.screenshot({ path: `${OUT}/m-builder.png`, fullPage: false });
    }
  });
});
