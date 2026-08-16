/**
 * Seed the pre-written "Commercial" presentation (all fields editable in Settings).
 * Idempotent — skips if a presentation named "Commercial" already exists.
 * Media/doc paths are left blank; Tom uploads the real assets in Settings.
 *
 * Auth: SUPABASE_SERVICE_ROLE_KEY, or IMPORT_EMAIL/IMPORT_PASSWORD (staff) + anon key.
 * Run:  npx tsx scripts/seed-commercial-presentation.ts
 */
import { createClient } from "@supabase/supabase-js";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL");
  if (service) return { supabase: createClient(url, service), needsLogin: false as const };
  if (!anon) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY + IMPORT_EMAIL/IMPORT_PASSWORD");
  return { supabase: createClient(url, anon), needsLogin: true as const };
}

const BLOCKS = [
  {
    kind: "video", position: 0, enabled: true,
    content: {
      title: "Watch us work at this scale",
      description: "Time-lapse from a recent exterior program for a national pharmacy retailer — completed after hours, zero trading interruption.",
      videos: [{
        url: "", storage_path: "", poster_path: "",
        caption_title: "Chemist Warehouse exterior repaint",
        caption_sub: "Moorabbin · Completed over 6 nights · Dulux Weathershield system",
        duration_label: "02:14 · Time-lapse",
      }],
    },
  },
  {
    kind: "before_after_gallery", position: 1, enabled: true,
    content: {
      title: "Warehouse exteriors, before and after",
      description: "Drag the line across each project.",
      pairs: [
        { before_path: "", after_path: "", info_title: "Distribution warehouse", info_subtitle: "Dandenong South · Monument + Surfmist · 4,100 m²" },
        { before_path: "", after_path: "", info_title: "Manufacturing facility & office", info_subtitle: "Clayton · Brand colours to parapet · After-hours" },
      ],
    },
  },
  {
    kind: "review_set", position: 2, enabled: true,
    content: {
      title: "What commercial clients say",
      footer_line: "5.0 ★ from 85+ Google reviews — these three mention commercial exterior work.",
      reviews: [
        { body: "Painted our entire ==warehouse exterior== over two weekends. Zero disruption to dispatch, site left spotless every morning.", reviewer_title: "Operations Manager", company_name: "Logistics", source: "Google review" },
        { body: "Best ==commercial painters== we've used across our sites. SWMS and inductions handled before we asked. Program ran to the day.", reviewer_title: "Facilities Manager", company_name: "Retail group", source: "Google review" },
        { body: "Repainted our factory ==out of hours== — arrived 6 pm, gone by 5 am, production never stopped. Invoicing clean and to quote.", reviewer_title: "Plant Manager", company_name: "Manufacturing", source: "Google review" },
      ],
    },
  },
  {
    kind: "capability_panel", position: 3, enabled: true,
    content: {
      title: "The detail your procurement team will ask for",
      cards: [
        { icon: "🛡", heading: "$20M public liability", body: "Certificate of currency supplied with this estimate and re-issued annually for your compliance file.", attachment: { label: "Certificate of currency ↓", doc_path: "" } },
        { icon: "🌙", heading: "Out-of-hours & staged programs", body: "Nights, weekends and staged areas programmed around trading and production." },
        { icon: "📋", heading: "SWMS & site inductions", body: "Site-specific SWMS issued before start; all crew inducted to your site requirements. Master Painters member, Dulux & Haymes accredited.", attachment: { label: "Sample SWMS ↓", doc_path: "" } },
        { icon: "📈", heading: "One contact, live reporting", body: "A dedicated project coordinator, photo progress updates in your portal, and variations approved in writing before any extra work." },
      ],
    },
  },
];

async function main() {
  const { supabase, needsLogin } = client();
  if (needsLogin) {
    const email = process.env.IMPORT_EMAIL, password = process.env.IMPORT_PASSWORD;
    if (!email || !password) throw new Error("Set IMPORT_EMAIL / IMPORT_PASSWORD or SUPABASE_SERVICE_ROLE_KEY");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  const { data: existing } = await supabase.from("presentations").select("id").eq("name", "Commercial").maybeSingle();
  if (existing) { console.log("✓ 'Commercial' presentation already exists — nothing to do."); return; }

  const { data: pres, error } = await supabase.from("presentations")
    .insert({ name: "Commercial", description: "Commercial exterior programs — capability, proof and process.", is_default: true })
    .select("id").single();
  if (error) throw error;

  const rows = BLOCKS.map((b) => ({ presentation_id: pres.id, kind: b.kind, position: b.position, enabled: b.enabled, content: b.content }));
  const { error: bErr } = await supabase.from("presentation_blocks").insert(rows);
  if (bErr) throw bErr;
  console.log(`✓ Seeded 'Commercial' presentation (${rows.length} blocks). Upload media/docs in Settings → Presentations.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
