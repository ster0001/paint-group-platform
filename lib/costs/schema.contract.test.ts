/**
 * Contract tests over the 6a cost-intake migration — migration-text pinning
 * (the schema.contract.test.ts pattern): undoing a DB-level guarantee fails
 * `npm test` on every commit, no database needed. The live proof happens
 * after Tom pastes the SQL: docs/manual-tests/cost-capture-6a.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(process.cwd(), "supabase/migrations");
const SQL = readFileSync(resolve(MIG, "20261122000000_cost_intake.sql"), "utf8");

describe("the pipeline is service/staff gated — never client-writable", () => {
  it("cost_intake has RLS with a staff read policy and revoked writes", () => {
    expect(SQL).toMatch(/foreach t in array array\['cost_intake'\]/);
    expect(SQL).toContain("revoke insert, update, delete on public.%I from authenticated, anon");
  });
  it("the door and extraction writers are service-role only", () => {
    for (const fn of ["cost_intake_insert", "cost_intake_set_extraction", "material_cost_sync_airtable"]) {
      const body = SQL.slice(SQL.indexOf(`function public.${fn}(`));
      expect(body).toContain("raise exception 'cost_intake_service_only'");
    }
    expect(SQL).toMatch(/grant execute on function public\.cost_intake_insert[\s\S]{0,120}to service_role/);
  });
  it("staff mutations check is_staff()", () => {
    for (const fn of ["cost_intake_confirm", "cost_intake_reject", "job_cost_record", "job_cost_approve", "job_cost_mark_paid", "material_cost_assign"]) {
      const body = SQL.slice(SQL.indexOf(`function public.${fn}(`));
      expect(body).toContain("if not public.is_staff() then return 'error:not_staff'");
    }
  });
});

describe("the idempotency door is 3-state (the stripe_event_insert shape)", () => {
  it("new / retry / done, keyed on message_id", () => {
    expect(SQL).toContain("on conflict (message_id) do nothing");
    expect(SQL).toMatch(/return case when v_extract = 'pending' then 'retry:' \|\| v_id\s*\n\s*else 'done:' \|\| v_id end/);
  });
});

describe("no cost row without a source document", () => {
  it("confirm refuses an intake with no stored document", () => {
    expect(SQL).toContain("if coalesce(trim(v.raw_doc_path), '') = '' then return 'error:no_document'");
  });
  it("manual entry requires a staff-prefix document path", () => {
    expect(SQL).toMatch(/p_doc_path not like 'receipts\/%' then\s*\n\s*return 'error:no_document'/);
  });
});

describe("duplicates cannot create two rows", () => {
  it("guard (a): same vendor + invoice number, across doors", () => {
    expect(SQL).toContain("lower(coalesce(ci.extracted ->> 'invoice_no', '')) = lower(v_invoice_no)");
  });
  it("guard (b): same total + date + sender domain within the Settings window", () => {
    expect(SQL).toContain("lower(split_part(ci.from_email, '@', 2)) = v_domain");
    expect(SQL).toContain("public.cost_setting_num('{duplicateWindowDays}', 7)");
  });
  it("a flagged duplicate parks — status set, no destination insert in that path", () => {
    expect(SQL).toMatch(/set status = 'duplicate', duplicate_of = v_dup/);
  });
  it("the manual door refuses a duplicate loudly", () => {
    expect(SQL).toContain("return 'error:duplicate'");
  });
  it("the airtable door is idempotent by record id at both layers", () => {
    expect(SQL).toContain("where airtable_record_id = trim(p_record_id)");
    expect(SQL).toContain("'airtable:' || trim(p_record_id)");
  });
});

describe("⚑A1/⚑19 auto-confirm is OFF and unimplemented", () => {
  it("the setting seeds false", () => {
    expect(SQL).toContain("'autoConfirmExactRef', false");
  });
  it("no code path confirms without auth.uid() except the airtable safety net", () => {
    // cost_intake_confirm is the only email-door path to 'confirmed', and it
    // records the confirming person.
    const confirmBody = SQL.slice(
      SQL.indexOf("function public.cost_intake_confirm("),
      SQL.indexOf("function public.cost_intake_reject("),
    );
    expect(confirmBody).toContain("confirmed_by = auth.uid()");
  });
});

describe("the job code (⚑A3/⚑21) — PG-<job number>", () => {
  it("job_no exists, backfilled oldest-first, defaulted, unique, not null", () => {
    expect(SQL).toContain("add column if not exists job_no integer");
    expect(SQL).toMatch(/row_number\(\) over \(order by created_at, id\)/);
    expect(SQL).toContain("alter column job_no set default nextval('public.job_no_seq')");
    expect(SQL).toContain("alter column job_no set not null");
    expect(SQL).toContain("create unique index if not exists work_orders_job_no_key");
  });
});

describe("the bucket ships with its storage.objects policies (house law)", () => {
  it("cost-docs is private with explicit read/write/delete policies", () => {
    expect(SQL).toMatch(/values \('cost-docs', 'cost-docs', false/);
    for (const p of ["cost_docs_objects_read", "cost_docs_objects_write", "cost_docs_objects_delete"]) {
      expect(SQL).toContain(`create policy ${p} on storage.objects`);
    }
    // staff uploads stay inside their own receipts prefix
    expect(SQL).toContain("name like 'receipts/' || auth.uid()::text || '/%'");
  });
});

describe("readback discipline", () => {
  it("the file ends by selecting what it just made", () => {
    expect(SQL).toContain("job_no_missing_backfill");
    expect(SQL).toContain("relrowsecurity");
    expect(SQL).toMatch(/from storage\.buckets where id = 'cost-docs'/);
    expect(SQL).toContain("polname like 'cost_docs%'");
  });
});
