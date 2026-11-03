/**
 * A PaintScout job as an EDITABLE DRAFT estimate, priced by this system's rate
 * card (Tom, 4 Nov 2026: "add this property into estimates from Paint Scout …
 * the pricing updated based on the new system pricing, and it is editable").
 *
 * Reads the quote share page (customer, job address, exclusions, PaintScout's
 * total) and the work-order share page (every line with its quantity, coats,
 * paint and hours), builds the builder's blocks on real rate codes with NO
 * price or hours overrides (lib/import/draft/build.ts), and writes one draft
 * estimate the builder opens and re-prices like any other.
 *
 *   npx tsx scripts/import/paintscout-draft.ts parse --quote <url|file> --wo <url|file>   # the pages, no database
 *   npx tsx scripts/import/paintscout-draft.ts check --quote … --wo …                     # + priced on the active card; nothing written
 *   npx tsx scripts/import/paintscout-draft.ts run   --quote … --wo …                     # writes the draft (twice is once)
 *     --save-dir <dir>   keep each page's text (re-runnable from the files)
 *     --finish <1-5>     level of finish (default 3)
 *     --lead-source <key> where the job came from (lib/crm/attribution SOURCES, e.g. referral, repeat_customer);
 *                        left blank, the builder asks for it on the first save
 *
 * Production needs IMPORT_ALLOW_PRODUCTION=1 (scripts/import/target.ts). A
 * second run finds the first draft by its PaintScout quote number and skips.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseWorkOrderText } from "../../lib/import/booked/workorder-text";
import { parseQuoteText } from "../../lib/import/draft/quote-text";
import { buildDraftFromWorkOrder } from "../../lib/import/draft/build";
import { loadBookedWriteContext, newShareToken } from "../../lib/import/booked/write";
import { ensureAccountAndProperty } from "../../lib/accounts/link";
import { isLeadSource } from "../../lib/estimate/leadSource";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cmd = argv[0];
const quoteSrc = flag("--quote");
const woSrc = flag("--wo");
const saveDir = flag("--save-dir");
const finish = Number(flag("--finish") ?? 3);
const leadSource = flag("--lead-source") ?? null;
const ORIGIN = "paintscout-draft";
const nameMapSchema = z.array(z.object({ paintscout_item: z.string(), side: z.enum(["interior", "exterior"]), platform_rate_code: z.string() }));

function usage(): never {
  console.error("usage: paintscout-draft.ts parse|check|run --quote <url|file> --wo <url|file> [--save-dir d] [--finish 1-5]");
  process.exit(1);
}
const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function pageText(source: string, name: string): Promise<{ text: string; url: string }> {
  if (!/^https?:\/\//i.test(source)) {
    if (!existsSync(source)) throw new Error(`${source}: no such file`);
    return { text: readFileSync(source, "utf8"), url: "" };
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(source, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(() => document.body.innerText.length > 800, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    const text = await page.evaluate(() => document.body.innerText);
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      writeFileSync(resolve(saveDir, name), text);
    }
    return { text, url: source };
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!cmd || !["parse", "check", "run"].includes(cmd) || !quoteSrc || !woSrc) usage();
  if (!(finish >= 1 && finish <= 5)) throw new Error("--finish expects 1–5");
  if (leadSource != null && !isLeadSource(leadSource)) throw new Error(`--lead-source "${leadSource}" is not a lead source`);
  const q = await pageText(quoteSrc, "quote.txt");
  const w = await pageText(woSrc, "work-order.txt");
  const quote = parseQuoteText(q.text);
  const wo = parseWorkOrderText(w.text);
  const qNo = quote.quoteNo ?? wo.quoteNo;

  console.log(`quote ${quote.quoteNo ?? "?"} · work order ${wo.quoteNo ?? "?"}${quote.quoteNo && wo.quoteNo && quote.quoteNo !== wo.quoteNo ? "  ⚠ THE TWO PAGES ARE DIFFERENT QUOTES" : ""}`);
  console.log(`  contact: ${quote.names.join(" + ") || "(none read)"}${quote.company ? ` · ${quote.company}` : ""}`);
  console.log(`  emails: ${quote.emails.join(", ") || "(none)"} · phone: ${quote.phones.join(", ") || "(none)"}`);
  console.log(`  job address: ${quote.jobAddress ? `${quote.jobAddress.street}, ${quote.jobAddress.suburb} ${quote.jobAddress.state} ${quote.jobAddress.postcode}` : "(none read)"}`);
  console.log(`  exclusions: ${quote.exclusions.join("; ") || "(none)"}`);
  console.log(`  PaintScout: ${quote.totalCents != null ? `${money(quote.totalCents)} inc GST` : "total not read"} · ${wo.hoursFromLines} h on ${wo.areas.length} areas${wo.totalHours != null && Math.abs(wo.totalHours - wo.hoursFromLines) > 0.011 ? `  ⚠ banner says ${wo.totalHours} h` : ""}`);
  if (quote.quoteNo && wo.quoteNo && quote.quoteNo !== wo.quoteNo) { console.error("\nREFUSED — the quote and the work order are different PaintScout jobs."); process.exit(2); }
  if (!quote.jobAddress) { console.error("\nREFUSED — no job address read from the quote page."); process.exit(2); }
  if (cmd === "parse") return;

  const target = resolveImportTarget("paintscout-draft.ts", { needsDatabase: true });
  const db = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const nameMap = nameMapSchema.parse(JSON.parse(readFileSync(resolve(process.cwd(), "docs/imports/substrate-name-map.json"), "utf8")));
  const wctx = await loadBookedWriteContext(db);
  const draft = buildDraftFromWorkOrder(wo, quote, wctx.pricing, nameMap, { levelOfFinish: finish, quoteUrl: q.url || undefined, workOrderUrl: w.url || undefined });

  console.log(`\n${draft.title} · ${draft.builderState.blocks.length} blocks · finish ${finish}`);
  for (const r of draft.report) console.log(`  · ${r}`);
  const t = draft.totals;
  console.log(`  platform price: ${money(t.totalCents)} inc GST (subtotal ${money(t.subtotalCents)}) · ${t.contractorHours.toFixed(2)} h · materials cost ${money(t.materialsCostCents)}`);
  if (quote.totalCents != null) {
    const d = t.totalCents - quote.totalCents;
    console.log(`  vs PaintScout: ${money(quote.totalCents)} → ${d >= 0 ? "+" : "−"}${money(Math.abs(d))} (${((d / quote.totalCents) * 100).toFixed(1)}%) · hours ${wo.hoursFromLines} → ${t.contractorHours.toFixed(2)}`);
  }

  const { data: existing, error: exErr } = await db.from("estimates").select("id, number, status")
    .eq("external_ref->>origin", ORIGIN).eq("external_ref->>quote_no", qNo ?? "").limit(1).maybeSingle();
  if (exErr) throw new Error(`estimates: ${exErr.message}`);
  if (existing) {
    console.log(`\nexists: estimate ${existing.number ?? ""} (${existing.id}, ${existing.status}) already imported from quote ${qNo} — nothing written`);
    return;
  }
  if (cmd === "check") { console.log("\ncheck: nothing written"); return; }

  const ja = quote.jobAddress;
  const linked = await ensureAccountAndProperty(db, {
    email: quote.emails[0] ?? null, name: quote.names[0] ?? quote.company ?? null, phone: quote.phones[0] ?? null,
    address: { street: ja.street, suburb: ja.suburb, postcode: ja.postcode, state: ja.state },
  });
  const { data: row, error } = await db.from("estimates").insert({
    title: draft.title, status: "draft", source: "manual",
    rate_card_id: wctx.card.id, rate_card_version: wctx.card.version,
    level_of_finish: finish, subtotal_cents: t.subtotalCents, total_cents: t.totalCents, lead_source: leadSource,
    builder_state: draft.builderState, share_token: newShareToken(),
    account_id: linked.accountId, property_id: linked.propertyId,
    external_ref: { origin: ORIGIN, quote_no: qNo, quote_url: q.url || null, work_order_url: w.url || null, paintscout_total_cents: quote.totalCents },
  }).select("id, number").single();
  if (error) throw new Error(`estimates insert: ${error.message}`);
  console.log(`\nok: draft estimate ${row.number ?? ""} · ${draft.title} · open /quote?id=${row.id}${leadSource ? "" : " · choose its lead source on the first save"}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
