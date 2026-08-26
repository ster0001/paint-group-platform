/**
 * Contract tests over the 3a-1 identity migration — migration-text pinning
 * (the invoicing pattern): these run in `npm test` with no database, so
 * undoing a DB-level guarantee fails on every commit. The live proof happens
 * after Tom pastes the SQL: docs/manual-tests/portal-3a1-identity.md, and
 * e2e/account-rls.spec.ts proves the policies through real sessions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261128000000_customer_accounts.sql"),
  "utf8",
);

describe("accounts — one account model, residential vs trade is a column", () => {
  it("account_type is constrained to residential | trade", () => {
    expect(SQL).toMatch(/account_type in \('residential', 'trade'\)/);
  });
  it("email identity is unique case-insensitively", () => {
    expect(SQL).toMatch(/create unique index if not exists accounts_email_key on public\.accounts \(lower\(email\)\)/);
  });
  it("RLS is enabled in the same file that creates the tables (CLAUDE.md law)", () => {
    expect(SQL).toContain("alter table public.accounts enable row level security");
    expect(SQL).toContain("alter table public.account_users enable row level security");
  });
});

describe("the account chain is guarded, not hoped", () => {
  it("estimates, invoices and properties reference accounts ON DELETE RESTRICT", () => {
    const restricts = SQL.match(/references public\.accounts \(id\) on delete restrict/g) ?? [];
    expect(restricts.length).toBe(3);
  });
  it("membership questions go through a SECURITY DEFINER helper (the RLS-subquery lesson)", () => {
    expect(SQL).toMatch(/function public\.is_account_member[\s\S]*?security definer/);
  });
  it("every invoice inherits its estimate's account via a BEFORE INSERT trigger — no insert site can forget", () => {
    expect(SQL).toMatch(/create trigger t_invoices_inherit_account before insert on public\.invoices/);
  });
  it("properties dedupe per account by the normalised address key", () => {
    expect(SQL).toMatch(/create unique index if not exists properties_account_address_key\s*\n\s*on public\.properties \(account_id, address_norm\)/);
  });
});

describe("the role-view rule holds — customers read the chain, never the money rows", () => {
  it("members may select accounts, their membership and properties", () => {
    expect(SQL).toContain("create policy accounts_member_select");
    expect(SQL).toContain("create policy account_users_self_select");
    expect(SQL).toContain("create policy properties_member_select");
  });
  it("no customer/member select policy is created on estimates or invoices (builder_state carries margins)", () => {
    expect(SQL).not.toMatch(/create policy \w+ on public\.estimates\s+for select to authenticated using \(public\.is_account_member/);
    expect(SQL).not.toMatch(/create policy \w+ on public\.invoices\s+for select to authenticated using \(public\.is_account_member/);
  });
  it("new estimates columns follow the column-grant pattern (20260903 lesson)", () => {
    expect(SQL).toContain("grant update (account_id, property_id) on public.estimates to authenticated");
  });
});

describe("read-backs exist — a migration running is not its statements applying", () => {
  it("the file ends with read-back selects over pg_class, pg_policy, pg_proc and pg_constraint", () => {
    for (const probe of ["from pg_class", "from pg_policy", "from pg_proc", "from pg_constraint", "from pg_trigger"]) {
      expect(SQL).toContain(probe);
    }
  });
});
