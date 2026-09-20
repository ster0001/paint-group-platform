/**
 * C1 · seed one SENT estimate with a presentation attached (and one without)
 * on the TEST project, so the live-progress phone can be walked by hand.
 *
 *   set -a; source .env.test.local; set +a; node scripts/c1/seed-live-progress.mjs
 *
 * Prints the two /e/<token> URLs. Refuses production like every C1 tool.
 * Cleanup: node scripts/c1/seed-live-progress.mjs --remove
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv, refuseProduction } from "./env.mjs";

loadTestEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
refuseProduction(url);
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MARK = "C1 live-progress walk";
if (process.argv.includes("--remove")) {
  const { error, count } = await db.from("estimates").delete({ count: "exact" }).eq("title", MARK);
  if (error) throw error;
  console.log(`removed ${count} estimate(s)`);
  process.exit(0);
}

const PHOTO = (n) => `${url}/storage/v1/object/public/estimate-media/c1-live-${n}.jpg`;
const company = { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "Sam Estimator", estimatorTitle: "Estimator", estimatorPhone: "", logoUrl: "" };
const paint = (name, brand, category, role) => ({ name, brand, category, role, finish: "Low sheen", colourName: "", colourHex: "", blurb: "", properties: [], guarantee: "", photoUrl: "", customerVisible: true, isPrep: false, usage: [] });
const snapshot = (pres) => ({
  version: 1, company, estRef: `EST-C1LP`, contactName: "Casey Livesey", contactEmail: "", jobAddress: "43 Sample Street, Alphington VIC 3078", jobTitle: "Interior repaint",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: ["Two coats throughout"], exclusions: [], terms: "Sample terms.",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 800000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [
    { id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }, { label: "Ceiling", coats: 2, product: "Haymes Expressions Ceiling" }], photos: [PHOTO(1), PHOTO(2)] },
    { id: "2", title: "Dining", descriptionHtml: "", priceCents: 150000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }], photos: [PHOTO(3)] },
    { id: "3", title: "Bed 1", descriptionHtml: "", priceCents: 150000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }], photos: [PHOTO(4)] },
    { id: "4", title: "Bed 2", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }], photos: [] },
    { id: "5", title: "Hallway", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }], photos: [] },
    { id: "6", title: "Study", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "Dulux Wash & Wear" }], photos: [] },
  ],
  paints: [paint("Expressions Ceiling", "Haymes", "Interior ceilings", "Ceilings"), paint("Wash & Wear", "Dulux", "Interior walls", "Walls")],
  presentation: pres ? { blocks: [{ kind: "capability_panel", content: { title: "A few extra details", cards: [{ icon: "🛡", heading: "$20M public liability", body: "Certificate of currency supplied with this estimate." }] } }] } : null,
});

const out = [];
for (const pres of [true, false]) {
  const token = `c1lp${pres ? "p" : "n"}${randomBytes(12).toString("base64url")}`;
  const { error } = await db.from("estimates").insert({
    title: MARK, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
    sent_at: new Date().toISOString(), total_cents: 880000,
    builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    sent_snapshot: snapshot(pres),
  });
  if (error) throw error;
  out.push(`${pres ? "with presentation:   " : "without presentation:"} http://localhost:3105/e/${token}`);
}
console.log(out.join("\n"));
