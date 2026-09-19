/**
 * Home dashboard v2 · session 0a — the capture migration and the app agree.
 *
 * The migration is pasted by hand, so the repo has to pin what it promises:
 *   · the lead-source vocabulary in Postgres equals the CRM's SOURCES list
 *     (one list; the picker, the check constraint and the report read the same);
 *   · send_estimate writes the sender, refuses without a lead source, and
 *     records the presentation and lead source on the 'sent' event;
 *   · the sender column is server-owned (never granted to `authenticated`);
 *   · the file registers itself in _prod_migrations under its own name.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_KEYS } from "@/lib/crm/attribution";
import { LEAD_SOURCE_OPTIONS, LEAD_SOURCE_REQUIRED, NOT_RECORDED, isLeadSource, leadSourceLabel } from "./leadSource";

const FILE = "20270175000000_dashboard_capture_estimates.sql";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8");

function sqlLeadSourceKeys(): string[] {
  const m = sql.match(/create or replace function public\.lead_source_keys\(\)[\s\S]*?select array\[([\s\S]*?)\];/);
  if (!m) throw new Error("lead_source_keys() not found in the migration");
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

function sendEstimateBody(): string {
  const m = sql.match(/create or replace function public\.send_estimate\([\s\S]*?\$\$;/);
  if (!m) throw new Error("send_estimate not found in the migration");
  return m[0];
}

describe("dashboard 0a · lead-source vocabulary", () => {
  it("Postgres and the CRM carry the same keys in the same order", () => {
    expect(sqlLeadSourceKeys()).toEqual([...SOURCE_KEYS]);
  });
  it("the picker offers every key and nothing else", () => {
    expect(LEAD_SOURCE_OPTIONS.map((o) => o.key)).toEqual([...SOURCE_KEYS]);
  });
  it("'unknown' is Not recorded, and only known keys pass the guard", () => {
    expect(leadSourceLabel(NOT_RECORDED)).toBe("Not recorded");
    expect(leadSourceLabel(null)).toBe("Not recorded");
    expect(leadSourceLabel("referral")).toBe("Referral");
    expect(isLeadSource("referral")).toBe(true);
    expect(isLeadSource("Google search")).toBe(false);
    expect(isLeadSource(null)).toBe(false);
  });
  it("both tables carry the check constraint against that one function", () => {
    expect(sql).toMatch(/estimates_lead_source_check[\s\S]*?lead_source = any \(public\.lead_source_keys\(\)\)/);
    expect(sql).toMatch(/accounts_lead_source_check[\s\S]*?lead_source = any \(public\.lead_source_keys\(\)\)/);
  });
});

describe("dashboard 0a · send_estimate", () => {
  const body = sendEstimateBody();
  it("refuses to send without a lead source, with the reason the action translates", () => {
    expect(body).toContain("if v_e.lead_source is null then return 'error:lead_source_required'; end if;");
    expect(LEAD_SOURCE_REQUIRED.length).toBeGreaterThan(10);
  });
  it("writes the sender once — first send wins, like sent_at", () => {
    expect(body).toContain("sent_by_user_id = coalesce(sent_by_user_id, auth.uid())");
    expect(body).toContain("sent_at = coalesce(sent_at, now())");
  });
  it("keeps the guards the 20260903 boundary had", () => {
    for (const guard of ["error:not_staff", "error:not_found", "conflict:accepted", "error:not_saved", "error:nothing_to_send"]) {
      expect(body).toContain(guard);
    }
    expect(body).toContain("and status::text = p_expected_status");
  });
  it("records the presentation and lead source on the 'sent' event", () => {
    expect(body).toMatch(/'sent', jsonb_build_object\([\s\S]*?'presentation_id', v_e\.presentation_id, 'lead_source', v_e\.lead_source\)/);
  });
});

describe("dashboard 0a · ownership and bookkeeping", () => {
  it("staff may write lead_source; the sender column is never granted", () => {
    expect(sql).toContain("grant update (lead_source) on public.estimates to authenticated;");
    expect(sql).not.toMatch(/grant update \([^)]*sent_by_user_id[^)]*\)/);
  });
  it("the account is written once and never overwritten", () => {
    // Every write onto accounts from an estimate or a first touch is guarded
    // by "is null" — the first fact wins, later ones never replace it.
    const accountWrites = [...sql.matchAll(/update public\.accounts[\s\S]*?;/g)].map((m) => m[0]);
    expect(accountWrites.length).toBeGreaterThanOrEqual(5);
    for (const w of accountWrites) expect(w).toMatch(/(lead_source|category) is null/);
  });
  it("'unknown' never propagates from an estimate to its account", () => {
    expect(sql).toContain("if new.lead_source is not null and new.lead_source <> 'unknown' then");
  });
  it("ends with a read-back and registers itself under its own filename", () => {
    const tail = sql.slice(-3000);
    expect(tail).toMatch(/new_columns_expect_5/);
    expect(tail).toContain(`insert into public._prod_migrations(name) values ('${FILE}') on conflict (name) do nothing;`);
  });
});
