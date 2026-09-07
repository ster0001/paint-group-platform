import { describe, expect, it } from "vitest";
import {
  audienceSchema, compileAudience, compileRule, describeRule, legacyToAudience, RuleError, STANDING_SEGMENTS,
  type Audience,
} from "./segments";
import { blankRule, FIELDS, OPS } from "./fields";


describe("compileRule — a form row becomes primitives the database understands", () => {
  it("an enum is IN / NOT IN, never SQL", () => {
    expect(compileRule({ field: "stage", op: "is", value: ["estimate_sent", "lapsed"] }))
      .toEqual({ p: [{ col: "stage", op: "in", v: ["estimate_sent", "lapsed"] }] });
    expect(compileRule({ field: "temperature", op: "is_not", value: ["cold"] }))
      .toEqual({ p: [{ col: "temperature", op: "nin", v: ["cold"] }] });
  });

  it("a yes/no field is its truthy primitive; 'no' is the NOT of it", () => {
    expect(compileRule({ field: "is_customer", op: "is", value: true })).toEqual({ p: [{ col: "won_cents", op: "gt", v: 0 }] });
    expect(compileRule({ field: "is_customer", op: "is", value: false })).toEqual({ p: [{ col: "won_cents", op: "gt", v: 0 }], not: true });
    // NOT on a "no" is a "yes" again — double negation must not stick.
    expect(compileRule({ field: "opened", op: "is", value: false, not: true })).toEqual({ p: [{ col: "opened_count", op: "gt", v: 0 }] });
  });

  it("'more than N days ago' on last contact also matches never — it has been forever", () => {
    expect(compileRule({ field: "last_contact_at", op: "more_than_days", value: 365 }))
      .toEqual({ p: [{ col: "last_contact_at", op: "older_or_never", v: 365 }] });
    // …but on "estimate sent" never must NOT match: nobody was sent anything.
    expect(compileRule({ field: "last_sent_at", op: "more_than_days", value: 3 }))
      .toEqual({ p: [{ col: "last_sent_at", op: "older", v: 3 }] });
  });

  it("'due within N days' is in the future AND inside the window", () => {
    expect(compileRule({ field: "repaint_due_at", op: "within_days", value: 90 }))
      .toEqual({ p: [{ col: "repaint_due_at", op: "within", v: 90 }, { col: "repaint_due_at", op: "future" }] });
    expect(compileRule({ field: "repaint_due_at", op: "passed" })).toEqual({ p: [{ col: "repaint_due_at", op: "past" }] });
  });

  it("tags: any / all / none", () => {
    expect(compileRule({ field: "tags", op: "has_any", value: ["strata", "vip"] })).toEqual({ p: [{ col: "tags", op: "any", v: ["strata", "vip"] }] });
    expect(compileRule({ field: "tags", op: "has_all", value: ["strata"] })).toEqual({ p: [{ col: "tags", op: "all", v: ["strata"] }] });
    expect(compileRule({ field: "tags", op: "has_none", value: ["difficult"] })).toEqual({ p: [{ col: "tags", op: "any", v: ["difficult"] }], not: true });
  });

  it("money between puts the numbers the right way round", () => {
    expect(compileRule({ field: "won_cents", op: "between", value: [900_000, 100_000] }))
      .toEqual({ p: [{ col: "won_cents", op: "between", v: [100_000, 900_000] }] });
  });

  it("campaign history: received / not received", () => {
    expect(compileRule({ field: "campaigns_received", op: "not_received", value: ["spring-x1"] }))
      .toEqual({ p: [{ col: "campaigns_received", op: "any", v: ["spring-x1"] }], not: true });
  });

  it("refuses what the form would never produce, loudly", () => {
    expect(() => compileRule({ field: "made_up", op: "is", value: [] })).toThrow(RuleError);
    expect(() => compileRule({ field: "stage", op: "more_than", value: 3 })).toThrow(RuleError);
    expect(() => compileRule({ field: "stage", op: "is", value: [] })).toThrow(/pick at least one/);
    expect(() => compileRule({ field: "won_cents", op: "more_than", value: "lots" })).toThrow(/needs a number/);
  });

  it("every field's every operator compiles from its blank rule", () => {
    for (const f of FIELDS) {
      for (const { op } of OPS[f.type]) {
        const r = { ...blankRule(f.key), op };
        if (Array.isArray(r.value) && r.value.length === 0) r.value = ["x"];
        if (op === "between") r.value = [1, 2];
        expect(() => compileRule(r), `${f.key} ${op}`).not.toThrow();
      }
    }
  });
});

describe("compileAudience — groups", () => {
  it("keeps ALL-of-groups / ANY-or-ALL-in-group, and drops an empty group", () => {
    const a: Audience = { groups: [
      { match: "all", rules: [{ field: "is_customer", op: "is", value: true }] },
      { match: "any", rules: [{ field: "suburb", op: "is", value: ["Kew"] }, { field: "tags", op: "has_any", value: ["vip"] }] },
      { match: "any", rules: [] },
    ] };
    const c = compileAudience(a);
    expect(c.groups).toHaveLength(2);
    expect(c.groups[1].match).toBe("any");
    expect(c.groups[1].rules[0]).toEqual({ p: [{ col: "suburb", op: "in_ci", v: ["Kew"] }] });
  });

  it("the standing lists all compile and pass the schema", () => {
    for (const s of STANDING_SEGMENTS) {
      expect(audienceSchema.safeParse(s.audience).success).toBe(true);
      expect(compileAudience(s.audience).groups[0].rules.length).toBeGreaterThan(1);
    }
  });
});

describe("describeRule — the read-only row", () => {
  it("speaks the office's words, not column names", () => {
    expect(describeRule({ field: "last_job_completed_at", op: "more_than_days", value: 2555 }))
      .toEqual({ field: "Last job finished", op: "more than", value: "7 years ago", not: false });
    expect(describeRule({ field: "won_cents", op: "between", value: [100_000, 900_000] }))
      .toEqual({ field: "Won value", op: "between", value: "$1,000 – $9,000", not: false });
    expect(describeRule({ field: "permit_sms", op: "is_not", value: ["declined"] }))
      .toEqual({ field: "Marketing texts", op: "is none of", value: "No", not: false });
    expect(describeRule({ field: "owner_id", op: "is", value: ["u1"] }, { owners: { u1: "Sam" } }).value).toBe("Sam");
    expect(describeRule({ field: "job_types", op: "has_any", value: ["exterior"], not: true }).not).toBe(true);
  });
});

describe("legacyToAudience — lists built before P5", () => {
  it("carries every rule that has a home, as one ALL group", () => {
    const { audience, dropped } = legacyToAudience([
      { field: "is_customer", op: "is", value: true },
      { field: "job_type", op: "is", value: "interior" },
      { field: "has_job_type", op: "is_not", value: "exterior" },
      { field: "completed", op: "more_than", months: 84 },
      { field: "last_contact", op: "more_than", months: 12 },
      { field: "suburb", op: "is", value: ["Kew", "Balwyn"] },
      { field: "status", op: "is_not", value: ["unsubscribed", "open_work", "snoozed"] },
      { field: "draft_age", op: "more_than", hours: 48 },
    ]);
    expect(dropped).toEqual([]);
    expect(audience.groups[0].match).toBe("all");
    expect(audience.groups[0].rules).toEqual([
      { field: "is_customer", op: "is", value: true },
      { field: "job_types", op: "has_any", value: ["interior"] },
      { field: "job_types", op: "has_any", value: ["exterior"], not: true },
      { field: "last_job_completed_at", op: "more_than_days", value: 2557 },
      { field: "last_contact_at", op: "more_than_days", value: 365 },
      { field: "suburb", op: "is", value: ["Kew", "Balwyn"] },
      { field: "permit_email", op: "is_not", value: ["declined"] },
      { field: "stage", op: "is_not", value: ["job_on"] },
      { field: "next_followup_at", op: "ahead", not: true },
      { field: "draft_last_seen_at", op: "more_than_days", value: 2 },
    ]);
    expect(() => compileAudience(audience)).not.toThrow();
  });

  it("names the rules it could not carry instead of dropping them silently", () => {
    const { audience, dropped } = legacyToAudience([
      { field: "abandoned_draft", op: "is", value: true },
      { field: "draft_progress", op: "less_than", pct: 80 },
      { field: "draft_uploaded", op: "is", value: true },
    ]);
    expect(dropped).toEqual(["draft_progress", "draft_uploaded"]);
    expect(audience.groups[0].rules).toEqual([{ field: "has_draft", op: "is", value: true }]);
  });
});
