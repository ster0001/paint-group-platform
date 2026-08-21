/**
 * Contract tests over the loop's migrations.
 *
 * These assert the SQL Tom is about to paste actually says what the brief and
 * his decisions require. They are cheap, they run in CI, and they catch the two
 * things that would be expensive to discover live: a table that ships without
 * its three-way RLS, and the deemed-sign-off switch quietly defaulting on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", f), "utf8");
const TABLES = read("20260927000000_wo_loop_tables.sql");
const SETTINGS = read("20260928000000_wo_loop_settings.sql");
const MACHINE = read("20260926000000_wo_loop_stage_machine.sql");

const LOOP_TABLES = [
  "wo_checklist_items", "wo_surfaces", "wo_photos",
  "wo_variations", "wo_updates", "wo_qa_checks", "wo_signoff",
];

describe("every loop table is created and locked down", () => {
  for (const t of LOOP_TABLES) {
    it(`creates ${t}`, () => {
      expect(TABLES).toContain(`create table if not exists public.${t} (`);
    });
  }

  it("RLS's all seven the same way, three roles each", () => {
    // The policies are generated from this array, so the array IS the guarantee.
    for (const t of LOOP_TABLES) expect(TABLES).toContain(`'${t}'`);
    expect(TABLES).toContain("enable row level security");
    expect(TABLES).toContain("public.is_staff()");
    expect(TABLES).toContain("public.current_contractor_id()");
    expect(TABLES).toContain("c.profile_id = auth.uid()");
  });

  it("gives no client role a write on any of them", () => {
    expect(TABLES).toContain("revoke insert, update, delete on public.%I from authenticated");
  });

  it("keeps the site-photo bucket private", () => {
    expect(TABLES).toMatch(/'wo-photos'[\s\S]*?false/);
    expect(TABLES).toContain("set public = false");
  });

  it("puts rectification work in the same tick list, not a parallel one", () => {
    expect(TABLES).toMatch(/rectification\s+boolean not null default false/);
  });

  it("keeps money out of the browser's reach on variations", () => {
    expect(TABLES).toMatch(/price_cents\s+integer check \(price_cents is null or price_cents >= 0\)/);
    expect(TABLES).toMatch(/contractor_delta_cents\s+integer check/);
  });
});

describe("the ⚑ decisions ship as settings, with Tom's defaults", () => {
  it("stores them under one key", () => {
    expect(SETTINGS).toContain("insert into public.settings (key, value) values ('wo_loop'");
    expect(SETTINGS).toContain("on conflict (key) do nothing");
  });

  // The one that matters legally: the clause is not cleared yet, so nothing may
  // auto-sign a customer's job. If this ever flips, it must be a deliberate edit
  // that also updates this test.
  it("ships deemed sign-off OFF", () => {
    expect(SETTINGS).toContain("'deemedEnabled', false");
  });

  it("lets the clock and the nudge ladder run", () => {
    expect(SETTINGS).toContain("'clockEnabled', true");
    expect(SETTINGS).toContain("'residentialHours', 72");
    expect(SETTINGS).toContain("jsonb_build_array(0, 24, 48)");
  });

  it("keeps a human between the customer's yes and the contractor's offer", () => {
    expect(SETTINGS).toContain("'variationRelease', 'pc'");
  });

  it("does not let a thin photo record block a QA pass", () => {
    expect(SETTINGS).toContain("'thinRecordBlocksQa', false");
  });

  it("starts the warranty at sign-off", () => {
    expect(SETTINGS).toContain("'warrantyStart', 'signoff_date'");
  });
});

describe("the machine itself", () => {
  it("derives status instead of storing a second one", () => {
    expect(MACHINE).toContain("create or replace function public.wo_derive_status");
    expect(MACHINE).toContain("status = public.wo_derive_status(p_to, issued_at)");
  });

  it("backfills every existing row so none is stage-less", () => {
    expect(MACHINE).toContain("where w.stage is null");
    expect(MACHINE).toContain("alter table public.work_orders alter column stage set not null");
  });

  it("never lets a caller claim to be the system", () => {
    // wo_advance_stage derives the actor from the session; 'system' is only ever
    // passed by the trigger, which callers cannot reach.
    expect(MACHINE).toMatch(/wo_advance_stage[\s\S]*?public\.is_staff\(\)[\s\S]*?v_kind := 'staff'/);
    expect(MACHINE).not.toMatch(/wo_advance_stage\([^)]*p_actor_kind/);
  });

  it("keeps the stage honest when a booking is cancelled or declined", () => {
    expect(MACHINE).toContain("create trigger booking_offers_stage_sync");
    expect(MACHINE).toMatch(/'cancelled', 'declined', 'expired', 'withdrawn'/);
  });

  it("leaves a gate hook for each later step to fill", () => {
    expect(MACHINE).toContain("create or replace function public.wo_gate_blocked");
  });
});
