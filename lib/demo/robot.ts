import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { after } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

/**
 * The Paint Group robot (induction brief §4.2, Tom's ruling 2, 14 Oct 2026).
 *
 * Inside 12 Demo Street the office and the customer are robots. Nothing
 * special runs for them: the robot is a staff login ("Paint Group robot",
 * created by scripts/create-demo-robot.ts) that the server signs in by a
 * one-time link and uses to call the SAME RPCs a person would — so every
 * gate, event and audit trail is the real one. The customer side needs no
 * login at all: the demo job's own token links, like a real customer.
 *
 * Timing (⚑7): the reply comes a few seconds after the painter's tap, from
 * `after()` in the server action that handled the tap — the only sub-minute
 * path the platform has (the fastest cron is five minutes). The delay is
 * `settings.demo_rules.robotDelayMs`.
 */

export type DemoRules = { robotDelayMs: number; robotEmail: string; robotName: string };

const DEFAULT_RULES: DemoRules = { robotDelayMs: 5000, robotEmail: "robot@paintgroup.com.au", robotName: "Paint Group robot" };

export async function demoRules(service: SupabaseClient): Promise<DemoRules> {
  const { data, error } = await service.from("settings").select("value").eq("key", "demo_rules").maybeSingle();
  if (error) reportError(error, { where: "demo.rules", bestEffort: true });
  const v = (data as { value?: Partial<DemoRules> } | null)?.value ?? {};
  return {
    robotDelayMs: typeof v.robotDelayMs === "number" ? v.robotDelayMs : DEFAULT_RULES.robotDelayMs,
    robotEmail: typeof v.robotEmail === "string" && v.robotEmail ? v.robotEmail : DEFAULT_RULES.robotEmail,
    robotName: typeof v.robotName === "string" && v.robotName ? v.robotName : DEFAULT_RULES.robotName,
  };
}

/** Is this work order the practice job? A point read; demo rows are the contractor's own. */
export async function isDemoWorkOrder(service: SupabaseClient, workOrderId: string): Promise<boolean> {
  const { data, error } = await service.from("work_orders").select("is_demo").eq("id", workOrderId).maybeSingle();
  if (error) { reportError(error, { where: "demo.isDemo", bestEffort: true, extra: { workOrderId } }); return false; }
  return (data as { is_demo?: boolean } | null)?.is_demo === true;
}

/**
 * A supabase-js client signed in as the robot: `auth.admin.generateLink`
 * (magic link) then `verifyOtp` on a fresh anon client — the same two calls
 * the customer magic-link login makes, with no password stored anywhere.
 * `is_staff()` is true for it because scripts/create-demo-robot.ts set the
 * profile's role.
 */
export async function robotClient(service: SupabaseClient, rules?: DemoRules): Promise<SupabaseClient> {
  const r = rules ?? (await demoRules(service));
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: r.robotEmail });
  if (link.error || !link.data?.properties?.hashed_token) {
    throw new Error(`demo robot: no login for ${r.robotEmail} — run scripts/create-demo-robot.ts (${link.error?.message ?? "no token"})`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("demo robot: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await client.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (v.error || !v.data.session) throw new Error(`demo robot: sign-in failed (${v.error?.message ?? "no session"})`);
  return client;
}

/** A token-only (anon) client: the demo customer, who signs with the job's own links. */
export function customerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("demo customer: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Run a robot after the response has gone, `delayMs` later. Errors are
 * reported, never thrown into the painter's request. `label` names the robot
 * in the error monitor.
 */
export function robotAfter(label: string, delayMs: number, fn: () => Promise<void>): void {
  after(async () => {
    try {
      await sleep(delayMs);
      await fn();
    } catch (e) {
      reportError(e, { where: `demo.robot.${label}` });
    }
  });
}

/** The customer's "signature" on the demo — any drawn PNG; this one is 1×1, over the RPC's 100-char floor. */
export const DEMO_SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
