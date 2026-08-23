/**
 * §3.2 transition matrix — legal moves, illegal moves, and the lock-step
 * check against the canonical SQL seed (the stages.test.ts pattern: the
 * matrix lives in the database; this mirror may never drift from it).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canDelete,
  canTransition,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  OPEN_STATUSES,
  type InvoiceStatus,
} from "./stateMachine";

const CORE = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261112000000_invoicing_core.sql"),
  "utf8",
);

describe("the mirror matches the canonical SQL seed", () => {
  const seedPairs = [
    ...CORE.matchAll(
      /\('(\w+)'::public\.invoice_status,\s*'(\w+)'::public\.invoice_status\)/g,
    ),
  ].map((m) => `${m[1]}->${m[2]}`);

  it("same transitions, same count, nothing extra either side", () => {
    const mirror = INVOICE_TRANSITIONS.map(([f, t]) => `${f}->${t}`);
    expect(new Set(seedPairs)).toEqual(new Set(mirror));
    expect(seedPairs.length).toBe(INVOICE_TRANSITIONS.length);
  });

  it("the enum widening lists every status the mirror knows", () => {
    const ENUM = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261111000000_invoice_status_enum.sql"),
      "utf8",
    );
    // draft/sent/paid/void are original; the widening adds the other four.
    for (const added of ["issued", "viewed", "partially_paid", "written_off"]) {
      expect(ENUM).toContain(`add value if not exists '${added}'`);
    }
    expect(INVOICE_STATUSES).toHaveLength(8);
  });
});

describe("legal transitions", () => {
  it("the happy path: draft → issued → sent → viewed → partially_paid → paid", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("issued", "sent")).toBe(true);
    expect(canTransition("sent", "viewed")).toBe(true);
    expect(canTransition("viewed", "partially_paid")).toBe(true);
    expect(canTransition("partially_paid", "paid")).toBe(true);
  });
  it("a payment can land at any open status", () => {
    for (const s of OPEN_STATUSES) expect(canTransition(s, "paid")).toBe(true);
  });
  it("issued+ can be voided or written off", () => {
    for (const s of OPEN_STATUSES) {
      expect(canTransition(s, "void")).toBe(true);
      expect(canTransition(s, "written_off")).toBe(true);
    }
  });
});

describe("illegal transitions", () => {
  it("a draft can only be issued (or deleted — which is not a transition)", () => {
    for (const to of INVOICE_STATUSES.filter((s) => s !== "issued" && s !== "draft")) {
      expect(canTransition("draft", to)).toBe(false);
    }
  });
  it("nothing ever returns to draft", () => {
    for (const from of INVOICE_STATUSES.filter((s) => s !== "draft")) {
      expect(canTransition(from, "draft")).toBe(false);
    }
  });
  it("paid is terminal — correction is a credit note, not a void", () => {
    for (const to of INVOICE_STATUSES) expect(canTransition("paid", to)).toBe(false);
  });
  it("void and written_off are terminal", () => {
    for (const from of ["void", "written_off"] as InvoiceStatus[]) {
      for (const to of INVOICE_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });
  it("overdue is not a status at all", () => {
    expect((INVOICE_STATUSES as readonly string[]).includes("overdue")).toBe(false);
  });
});

describe("deletion", () => {
  it("drafts are the only deletable money objects", () => {
    expect(canDelete("draft")).toBe(true);
    for (const s of INVOICE_STATUSES.filter((x) => x !== "draft")) {
      expect(canDelete(s)).toBe(false);
    }
  });
});
