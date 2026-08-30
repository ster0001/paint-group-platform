/**
 * One-off, idempotent product import.
 *
 * Reads design/reference/products.json (exported from paint-group-products.xlsx)
 * and upserts the catalogue into `public.products`, keyed by product name.
 *
 * Rules (per the build brief):
 *  - properties_chips split on " | " -> properties text[]
 *  - "See PDS" and "—" import as NULL (never as literal strings)
 *  - source_notes containing "CONFIRM" -> customer_visible = false, else true
 *  - Match existing rate-card products by internal_alias and ENRICH them in place
 *    (keeping their existing name, price, coverage, wastage — so rate_items.default_product
 *    and existing estimates keep resolving). Genuinely new products are inserted.
 *  - Never deletes or renames. Logs unmatched existing products for reconciliation.
 *  - Price is never written — Tom fills it in.
 *
 * Auth: uses SUPABASE_SERVICE_ROLE_KEY if present (bypasses RLS); otherwise signs
 * in with IMPORT_EMAIL / IMPORT_PASSWORD against the anon key (must be a staff user).
 *
 * Run:  npx tsx scripts/import-products.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

type Raw = {
  category: string; brand: string; product_name: string; internal_alias: string | null;
  finish_sheen: string | null; surface_use: string | null; customer_blurb: string | null;
  properties_chips: string | null; coverage_m2_per_L: string | null; recoat: string | null;
  guarantee_warranty: string | null; product_url: string | null; photo_url: string | null;
  source_notes: string | null;
};

// Known alias -> existing product name matches (existing records are enriched in
// place, keeping their name so references stay intact). Everything else inserts new.
const ALIAS_TO_EXISTING: Record<string, string> = {
  "Haymes Expressions": "Haymes Expressions Wall",
  "Wash and Wear": "Dulux Wash and Wear",
  "W&W Super Hide": "Dulux Wash and Wear Super Hide",
  "Dulux Professional": "Dulux Professional Wall",
  "Expressions Ceiling White": "Haymes Expressions Ceiling",
  "Trim Plus (internal name)": "Haymes Trim Plus",
  "Weathershield": "Dulux Weathershield",
  "Solarscreen": "Berger Solarscreen",
  "Acratex": "Dulux AcraTex",
  "Total Prep": "Dulux Total Prep",
};

const EXTERIOR_CATEGORIES = new Set(["Exterior walls", "Texture & membrane"]);

const nullify = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === "" || t === "—" || t === "-" || /^see pds$/i.test(t)) return null;
  return t;
};
const splitProps = (v: string | null): string[] =>
  (v ?? "").split(" | ").map((s) => s.trim()).filter(Boolean);

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL");
  if (service) return { supabase: createClient(url, service), needsLogin: false as const };
  if (!anon) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY + IMPORT_EMAIL/IMPORT_PASSWORD");
  return { supabase: createClient(url, anon), needsLogin: true as const };
}

async function main() {
  const rows = JSON.parse(readFileSync(resolve("design/reference/products.json"), "utf8")) as Raw[];
  const { supabase, needsLogin } = client();
  if (needsLogin) {
    const email = process.env.IMPORT_EMAIL, password = process.env.IMPORT_PASSWORD;
    if (!email || !password) throw new Error("Set IMPORT_EMAIL / IMPORT_PASSWORD (a staff user) or SUPABASE_SERVICE_ROLE_KEY");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  const { data: existing } = await supabase.from("products").select("id, name");
  const byName = new Map((existing ?? []).map((p) => [p.name as string, p.id as string]));
  const touched = new Set<string>();
  const insertedNew: string[] = [];

  for (const r of rows) {
    const brand = (r.brand ?? "").trim();
    const productName = (r.product_name ?? "").trim();
    const alias = nullify(r.internal_alias);
    const targetName = (alias && ALIAS_TO_EXISTING[alias]) || `${brand} ${productName}`;
    const customerVisible = !/CONFIRM/i.test(r.source_notes ?? "");
    const isExterior = EXTERIOR_CATEGORIES.has(r.category) || /exterior/i.test(productName);

    // Fields common to insert + update (never price/coverage-number/wastage).
    const fields = {
      brand,
      finish: nullify(r.finish_sheen),
      category: nullify(r.category),
      internal_alias: alias,
      blurb: nullify(r.customer_blurb),
      properties: splitProps(r.properties_chips),
      guarantee: nullify(r.guarantee_warranty),
      product_url: nullify(r.product_url),
      coverage_m2_per_l: nullify(r.coverage_m2_per_L),
      recoat: nullify(r.recoat),
      customer_visible: customerVisible,
      source_notes: nullify(r.source_notes),
    };

    const existingId = byName.get(targetName);
    if (existingId) {
      const { error } = await supabase.from("products").update(fields).eq("id", existingId);
      if (error) throw error;
      touched.add(targetName);
    } else {
      const { error } = await supabase.from("products").upsert(
        { name: targetName, type: isExterior ? "Exterior" : "Interior", ...fields },
        { onConflict: "name" },
      );
      if (error) throw error;
      touched.add(targetName);
      insertedNew.push(targetName);
    }
  }

  // Reconciliation logs (never deletes anything).
  const untouched = (existing ?? []).map((p) => p.name as string).filter((n) => !touched.has(n));
  console.log(`\n✓ Imported ${rows.length} rows (${insertedNew.length} new, ${rows.length - insertedNew.length} matched existing).`);
  if (insertedNew.length) {
    console.log(`\nInserted as NEW products (no rate-card alias match — reconcile if any duplicate an existing record):`);
    insertedNew.forEach((n) => console.log("  +", n));
  }
  if (untouched.length) {
    console.log(`\nExisting products NOT in the spreadsheet (left untouched — reconcile manually):`);
    untouched.forEach((n) => console.log("  ·", n));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
