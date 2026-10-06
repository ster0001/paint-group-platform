// READ ONLY diagnostic (29 Sep 2026): why does the customer not see options on
// 8A Jupiter Street? Prints the estimate's blocks, option flags and what the
// sent snapshot carries. Reads .env.local. Never writes.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = process.argv[2] ?? "jupiter";
const { data, error } = await db.from("estimates")
  .select("id, title, status, source, share_token, sent_at, accepted_at, selected_options, builder_state, sent_snapshot, presentation_id, updated_at")
  .ilike("title", `%${needle}%`);
if (error) throw error;
for (const e of data) {
  const bs = e.builder_state ?? {}; const snap = e.sent_snapshot ?? {};
  console.log("==", e.id, "|", e.title, "|", e.status, "| sent", e.sent_at, "| accepted", e.accepted_at, "| updated", e.updated_at, "| selected", JSON.stringify(e.selected_options));
  for (const b of bs.blocks ?? []) {
    if (b.kind === "area") {
      const opts = (b.surfaces ?? []).filter((s) => s.isOption).map((s) => `${s.code}${s.hidden ? "(hidden)" : ""}`);
      console.log("  area:", b.name, "| isOption", !!b.isOption, "| optional substrates:", opts.join(", ") || "-");
    } else {
      console.log("  line:", b.name, "| isOption", !!b.isOption, "| hidden", !!b.hidden, "| mode", b.mode, "| custom", b.custom);
    }
  }
  console.log("  snapshot.options:", JSON.stringify((snap.options ?? []).map((o) => ({ id: o.id, title: o.title, priceCents: o.priceCents }))));
  console.log("  snapshot version:", snap.version, "| snapshot lineItems:", (snap.lineItems ?? []).length, "| areas:", (snap.areas ?? []).length);
  const { data: rs } = await db.from("revision_scopes").select("id, status, updated_at").eq("estimate_id", e.id);
  console.log("  revision scopes:", JSON.stringify(rs ?? []));
  console.log("  source:", e.source, "| customer link: https://paint-group-platform.vercel.app/e/" + e.share_token);
  console.log("  presentation blocks:", JSON.stringify((snap.presentation?.blocks ?? []).map((b) => `${b.kind}:${b.enabled}`)));
  const { data: ev } = await db.from("estimate_events").select("type, created_at, payload").eq("estimate_id", e.id).order("created_at", { ascending: false }).limit(8);
  console.log("  last events:", JSON.stringify((ev ?? []).map((x) => `${x.created_at.slice(0, 16)} ${x.type} ${JSON.stringify(x.payload ?? {}).slice(0, 80)}`)));
}
