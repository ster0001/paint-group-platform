/**
 * The "Paint Group robot" staff login (induction brief §4.2, Tom's ruling 2,
 * 14 Oct 2026): the account the server signs in as to play the office inside
 * 12 Demo Street. Nobody logs into it by hand. Idempotent — run it again and
 * it just confirms.
 *
 *   npx tsx scripts/create-demo-robot.ts                      # test project
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/create-demo-robot.ts --prod
 *
 * The email comes from settings.demo_rules.robotEmail (20270263). The auth
 * user is created with email_confirm (no password, no invite mail); the
 * profile becomes role staff with staff_roles {pc}, which is what is_staff()
 * and the PC gates read.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveSeedTarget } from "./seed-target.mjs";
import { authUserIdByEmail } from "../lib/auth/userByEmail";

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

async function main() {
  loadEnv();
  resolveSeedTarget("create-demo-robot");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } });

  const { data: rules, error: rulesErr } = await db.from("settings").select("value").eq("key", "demo_rules").maybeSingle();
  if (rulesErr) throw new Error(`settings.demo_rules: ${rulesErr.message}`);
  const v = (rules as { value?: { robotEmail?: string; robotName?: string } } | null)?.value ?? {};
  const email = v.robotEmail ?? "robot@paintgroup.com.au";
  const name = v.robotName ?? "Paint Group robot";

  let userId = await authUserIdByEmail(db, email);
  if (!userId) {
    const created = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message ?? "no user"}`);
    userId = created.data.user.id;
    console.log(`created auth user ${email}`);
  } else {
    console.log(`auth user ${email} exists`);
  }

  // handle_new_user made a customer profile; it becomes the robot's staff profile.
  const { error: pErr } = await db.from("profiles")
    .update({ role: "staff", name, contact: email, staff_roles: ["pc"] }).eq("id", userId);
  if (pErr) throw new Error(`profiles: ${pErr.message}`);

  const { data: check } = await db.from("profiles").select("role, staff_roles, name").eq("id", userId).single();
  console.log("profile:", check);
  console.log(`\nPaint Group robot is ready: ${email} (${userId})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
