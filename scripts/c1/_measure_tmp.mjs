import { chromium } from "@playwright/test";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.test.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const base = "http://localhost:3103"; const S = process.argv[2];
import { createClient } from "@supabase/supabase-js";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!/qarfyjrz/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("not the test project");
const link = await db.auth.admin.generateLink({ type: "magiclink", email: env.E2E_STAFF_EMAIL });
const masterId = link.data.user.id;
const before = (await db.from("profiles").select("is_owner").eq("id", masterId).single()).data.is_owner;
await db.from("profiles").update({ is_owner: true }).eq("id", masterId);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(base + "/login");
await page.getByLabel("Email").fill(env.E2E_STAFF_EMAIL); await page.getByLabel("Password").fill(env.E2E_STAFF_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(/\/(home|estimates)/, { timeout: 30000 });
console.log("landed on", new URL(page.url()).pathname);
for (let i = 0; i < 3; i++) {
  const t0 = Date.now(); await page.goto(base + "/home"); await page.getByTestId("home").waitFor({ timeout: 60000 });
  console.log(`run ${i+1}: ${Date.now()-t0} ms page · loaders ${await page.getByTestId("home").getAttribute("data-timings")}`);
}
await page.screenshot({ path: `${S}/home-desktop.png`, fullPage: false });
const m = await ctx.newPage(); await m.setViewportSize({ width: 375, height: 812 });
await m.goto(base + "/home"); await m.getByTestId("home").waitFor({ timeout: 60000 });
for (const y of [0, 812, 1624, 2436]) { await m.evaluate((y) => window.scrollTo(0, y), y); await m.waitForTimeout(200); await m.screenshot({ path: `${S}/home-mobile-${y}.png` }); }
const hasHScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log("mobile horizontal scroll:", hasHScroll, "scrollWidth", await m.evaluate(() => document.documentElement.scrollWidth));
const mock = await ctx.newPage(); await mock.setViewportSize({ width: 375, height: 812 });
await mock.goto("http://localhost:3199/home-dashboard-light-mockup.html"); for (const y of [0, 812]) { await mock.evaluate((y) => window.scrollTo(0, y), y); await mock.waitForTimeout(200); await mock.screenshot({ path: `${S}/mock-mobile-${y}.png` }); }
await browser.close();
await db.from("profiles").update({ is_owner: before }).eq("id", masterId); console.log("owner restored to", before);
