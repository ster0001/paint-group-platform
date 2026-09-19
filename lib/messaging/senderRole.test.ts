/**
 * Dashboard 0b — the sender-role rule is one rule in two places: the app
 * (`deriveSenderRole`, for every send through recordMessage) and Postgres
 * (`message_sender_role()` in 20270176, for direct inserts and the backfill).
 * This pins both the kind lists and the rule's shape so they cannot drift.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_KINDS, SYSTEM_KINDS, deriveSenderRole } from "./record";

const FILE = "20270176000000_dashboard_capture_messages.sql";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");

function kindsAfter(label: string): string[] {
  // e.g. "then 'system'" … the `in (...)` list that precedes it
  const fn = sql.match(/create or replace function public\.message_sender_role\([\s\S]*?\$\$;/)?.[0];
  if (!fn) throw new Error("message_sender_role() not found");
  const branch = fn.split(/\bwhen\b/).find((b) => b.includes(`then '${label}'`));
  const m = branch?.match(/p_meta->>'kind' in \(([^)]*)\)/);
  if (!m) throw new Error(`no kind list in the '${label}' branch`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe("dashboard 0b · sender role", () => {
  it("Postgres and the app agree on the staff and system kinds", () => {
    expect(kindsAfter("system")).toEqual([...SYSTEM_KINDS]);
    expect(kindsAfter("staff")).toEqual([...STAFF_KINDS]);
  });
  it("inbound is the customer, whatever else the row says", () => {
    expect(deriveSenderRole({ direction: "in", provider: "resend", automation: "unpaid_invoice_1" })).toBe("customer");
  });
  it("an automation or a campaign is system — outbound, never a reply", () => {
    expect(deriveSenderRole({ direction: "out", provider: "twilio", automation: "deposit_reminder" })).toBe("system");
    expect(deriveSenderRole({ direction: "out", provider: "resend", campaignMessageId: "cm1" })).toBe("system");
    expect(deriveSenderRole({ direction: "out", provider: "resend", kind: "job_welcome" })).toBe("system");
    expect(deriveSenderRole({ direction: "out", provider: "resend", kind: "magic_link" })).toBe("system");
  });
  it("a signed, manual, portal or staff-kind send is a person", () => {
    expect(deriveSenderRole({ direction: "out", provider: "resend", actorProfileId: "u1" })).toBe("staff");
    expect(deriveSenderRole({ direction: "out", provider: "manual" })).toBe("staff");
    expect(deriveSenderRole({ direction: "out", provider: "portal" })).toBe("staff");
    expect(deriveSenderRole({ direction: "out", provider: "resend", kind: "estimate" })).toBe("staff");
    expect(deriveSenderRole({ direction: "out", provider: "twilio", kind: "chat_reply" })).toBe("staff");
  });
  it("the assistant is itself; an explicit role wins; an unsigned legacy shape is unknown", () => {
    expect(deriveSenderRole({ direction: "out", provider: "assistant" })).toBe("assistant");
    expect(deriveSenderRole({ direction: "out", provider: "resend", kind: "estimate", senderRole: "system" })).toBe("system");
    expect(deriveSenderRole({ direction: "out", provider: "resend" })).toBe("unknown");
  });
  it("the migration backfills, keeps failed sends out of the reply clock, and registers itself", () => {
    expect(sql).toContain("where sender_role is null;");
    expect(sql).toMatch(/sender_role in \('staff', 'unknown'\)\s+and new\.status not in \('failed', 'not_configured', 'suppressed', 'bounced'\)/);
    expect(sql).toContain("perform public.customer_thread_opened(array[v_id]);");
    expect(sql).toContain(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`);
  });
});
