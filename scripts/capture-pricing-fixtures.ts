/**
 * Capture golden pricing fixtures from the dev database.
 *
 * This is the safety net for the pricing extraction: it records every existing
 * estimate's pricing INPUTS plus the subtotal/total the app stored for it, so
 * the extracted `lib/pricing` can be asserted to reproduce each one to the cent.
 *
 * The stored totals were computed by the ORIGINAL in-component code, which is
 * what makes them an independent check rather than a circular one.
 *
 * Deliberately captures ONLY what pricing reads. Titles, contacts, addresses,
 * notes, descriptions and media are dropped — they don't affect a single cent,
 * and CLAUDE.md forbids real customer data in fixtures.
 *
 * Run:  npx tsx scripts/capture-pricing-fixtures.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const OUT = "lib/pricing/__fixtures__/golden-estimates.json";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}

/** Only the surface fields the maths reads. */
function slimSurface(s: Record<string, unknown>) {
  const keep = [
    "code", "coats", "count", "prepHr", "hidden",
    "measureL", "measureH", "qtyOverride", "rateOverride", "paintingHrOverride",
    "useCustomRate", "customRate", "coverageOverride", "volumeOverride",
    "unitPriceOverride", "priceOverride", "productName",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (s[k] !== undefined) out[k] = s[k];
  return out;
}

/** Only the block fields the maths reads — no prose, no media, no names. */
function slimBlock(b: Record<string, unknown>) {
  if (b.kind === "area") {
    return {
      kind: "area",
      type: b.type,
      areaType: b.areaType,
      L: b.L, W: b.W, H: b.H,
      isOption: b.isOption ?? false,
      surfaces: ((b.surfaces as Record<string, unknown>[]) ?? []).map(slimSurface),
    };
  }
  return {
    kind: "line",
    type: b.type,
    mode: b.mode,
    hours: b.hours, rate: b.rate,
    qty: b.qty, unitPrice: b.unitPrice,
    custom: b.custom, cost: b.cost, woHours: b.woHours,
    isOption: b.isOption ?? false,
  };
}

/** Only the reference fields the maths reads — no blurbs, no company profile. */
const slimRateItem = (r: Record<string, unknown>) => ({
  category: r.category, code: r.code, unit: r.unit, sub_category: r.sub_category,
  rate_1_coat: r.rate_1_coat, rate_2_coat: r.rate_2_coat, rate_3_coat: r.rate_3_coat, rate_4_coat: r.rate_4_coat,
  charge_out_cents: r.charge_out_cents, default_product: r.default_product,
  metres_per_litre: r.metres_per_litre, litres_per_item_per_coat: r.litres_per_item_per_coat,
  default_coats: r.default_coats,
});
const slimModifier = (m: Record<string, unknown>) => ({ code: m.code, group_name: m.group_name, multiplier: m.multiplier });
const slimProduct = (p: Record<string, unknown>) => ({ name: p.name, coverage: p.coverage, price_per_litre: p.price_per_litre, wastage_pct: p.wastage_pct });
/** Settings the maths reads. `company_profile` and friends carry business
 *  contact details and are deliberately excluded. */
const PRICING_SETTING_KEYS = [
  "Materials markup", "GST", "Sundries per job — interior", "Sundries per job — exterior",
  "Contractor rate", "Contractor offer — % of estimated hours",
];
/** Identical to the builder's own normaliser, so the same keys resolve. */
const normKey = (k: string) => k.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
const slimSettings = (rows: Record<string, unknown>[]) => {
  const want = new Set(PRICING_SETTING_KEYS.map(normKey));
  const kept = rows.filter((s) => want.has(normKey(String(s.key))));
  const missing = [...want].filter((w) => !kept.some((k) => normKey(String(k.key)) === w));
  if (missing.length) console.warn(`  ! pricing settings absent from the database: ${missing.join(", ")}`);
  return kept.map((s) => ({ key: s.key, value: s.value }));
};

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: process.env.STAFF_EMAIL ?? "pg.sam.staff@gmail.com",
    password: process.env.STAFF_PASSWORD ?? "painttest123",
  });
  if (authErr) throw new Error(`staff sign-in failed: ${authErr.message}`);

  // The reference data the builder loads — the ACTIVE rate card, as the app does.
  // Same selection the builder page makes, so the fixture matches what the app sees.
  const { data: card, error: cardErr } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
  if (cardErr || !card) throw new Error(`no active rate card: ${cardErr?.message ?? "none found"}`);
  const [{ data: rateItems }, { data: modifiers }, { data: products }, { data: settings }] = await Promise.all([
    sb.from("rate_items").select("*").eq("rate_card_id", card.id).order("category").order("sub_category"),
    sb.from("modifiers").select("*").eq("active", true),
    sb.from("products").select("*"),
    sb.from("settings").select("*"),
  ]);

  const { data: estimates } = await sb
    .from("estimates")
    .select("id, builder_state, subtotal_cents, total_cents, rate_card_version")
    .not("builder_state", "is", null)
    .order("created_at");

  const cases = [];
  for (const e of estimates ?? []) {
    const bs = e.builder_state as Record<string, unknown> | null;
    if (!bs || !Array.isArray(bs.blocks) || bs.blocks.length === 0) continue;
    cases.push({
      // A stable label that carries no customer information.
      ref: `est-${String(e.id).slice(0, 8)}`,
      rateCardVersion: e.rate_card_version,
      stored: { subtotalCents: e.subtotal_cents, totalCents: e.total_cents },
      input: {
        blocks: (bs.blocks as Record<string, unknown>[]).map(slimBlock),
        modSel: bs.modSel ?? {},
        materials: bs.materials ?? {},
        discountPct: bs.discountPct ?? 0,
        discountMode: bs.discountMode ?? "pct",
        discountFixedCents: bs.discountFixedCents ?? 0,
        hourlyRateOverride: bs.hourlyRateOverride ?? null,
        contractorRateOverride: bs.contractorRateOverride ?? null,
      },
    });
  }

  const fixture = {
    capturedAt: new Date().toISOString(),
    note: "Golden fixtures for the pricing extraction. Inputs + the totals the ORIGINAL in-component code stored. No customer data.",
    activeRateCardVersion: card.version,
    reference: {
      rateItems: (rateItems ?? []).map(slimRateItem),
      modifiers: (modifiers ?? []).map(slimModifier),
      products: (products ?? []).map(slimProduct),
      settings: slimSettings(settings ?? []),
    },
    cases,
  };

  mkdirSync("lib/pricing/__fixtures__", { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));

  console.log(`captured ${cases.length} estimates → ${OUT}`);
  if (!rateItems?.length) throw new Error("no rate items for the active card — fixture would be useless");
  console.log(`reference: ${rateItems?.length} rate items, ${modifiers?.length} modifiers, ${products?.length} products, ${settings?.length} settings`);
  for (const c of cases) {
    console.log(`  ${c.ref}  blocks=${c.input.blocks.length}  stored subtotal=${c.stored.subtotalCents} total=${c.stored.totalCents}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
