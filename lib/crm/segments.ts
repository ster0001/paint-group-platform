/**
 * Audiences (CRM v2 P5, deep dive §4.3.1–4.3.4) — one evaluator, still.
 *
 * An audience is a rule TREE one level deep: match ALL of the groups, where
 * each group matches ANY or ALL of its rules, and any rule can be negated.
 * That is the pivot-style if / and / or / not the office asked for. Deeper
 * nesting is deliberately not offered — it is how lists quietly double.
 *
 * Nothing here loads customers. A rule compiles to {col, op, v} primitives
 * (lib/crm/fields.ts says which) and migration 20270126's crm_audience_*
 * functions evaluate them in SQL over crm_account_facts. The preview, the
 * campaign sweep, the dry run and the send-time guard all call those — so the
 * number someone builds a list against is the number the campaign acts on.
 */

import { z } from "zod";
import { FIELD_BY_KEY, FIELDS, OPS, type FieldDef, type Primitive, type Rule } from "./fields";

export type { Rule } from "./fields";
export type RuleGroup = { match: "all" | "any"; rules: Rule[] };
export type Audience = { groups: RuleGroup[] };

const ruleSchema = z.object({
  field: z.string().min(1).max(40),
  op: z.string().min(1).max(30),
  value: z.unknown().optional(),
  not: z.boolean().optional(),
});
export const audienceSchema: z.ZodType<Audience> = z.object({
  groups: z.array(z.object({
    match: z.enum(["all", "any"]),
    rules: z.array(ruleSchema).max(20),
  })).max(10),
});

export const emptyAudience = (): Audience => ({ groups: [{ match: "all", rules: [] }] });

export function ruleCount(a: Audience): number {
  return a.groups.reduce((n, g) => n + g.rules.length, 0);
}

export type Segment = {
  key: string;
  name: string;
  /** Shown under the name in the builder, in the office's words. */
  description: string;
  audience: Audience;
  /** A standing segment ships with the product; editable like any other. */
  standing?: boolean;
};

// ---- compiling ---------------------------------------------------------------

/** What the database receives: primitives only, never field names. */
export type CompiledRules = { groups: Array<{ match: "all" | "any"; rules: Array<{ p: Primitive[]; not?: boolean }> }> };

export class RuleError extends Error {}

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
const num = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new RuleError(`${what} needs a number.`);
  return n;
};
const pair = (v: unknown, what: string): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) throw new RuleError(`${what} needs two numbers.`);
  const [a, b] = [num(v[0], what), num(v[1], what)];
  return a <= b ? [a, b] : [b, a];
};

/** One rule → the primitives that mean it. Throws RuleError on a rule the form would never produce. */
export function compileRule(rule: Rule): { p: Primitive[]; not?: boolean } {
  const f: FieldDef | undefined = FIELD_BY_KEY[rule.field];
  if (!f) throw new RuleError(`"${rule.field}" isn't a field.`);
  if (!OPS[f.type].some((o) => o.op === rule.op)) throw new RuleError(`"${rule.op}" doesn't fit ${f.label}.`);
  const col = f.col ?? "";
  let p: Primitive[];
  let not = rule.not === true;
  switch (f.type) {
    case "enum": {
      const list = strings(rule.value);
      if (list.length === 0) throw new RuleError(`${f.label}: pick at least one.`);
      p = [{ col, op: rule.op === "is" ? "in" : "nin", v: list }];
      break;
    }
    case "bool": {
      p = f.truthy ?? [];
      if (rule.value === false) not = !not;
      break;
    }
    case "number": case "money": case "minutes": {
      if (rule.op === "between") { const [a, b] = pair(rule.value, f.label); p = [{ col, op: "between", v: [a, b] }]; }
      else p = [{ col, op: rule.op === "more_than" ? "gt" : "lt", v: num(rule.value, f.label) }];
      break;
    }
    case "days": {
      if (rule.op === "never") p = [{ col, op: "null" }];
      else if (rule.op === "ever") p = [{ col, op: "notnull" }];
      else if (rule.op === "more_than_days") p = [{ col, op: f.neverIsOlder ? "older_or_never" : "older", v: num(rule.value, f.label) }];
      else p = [{ col, op: "newer", v: num(rule.value, f.label) }];
      break;
    }
    case "due": {
      if (rule.op === "never") p = [{ col, op: "null" }];
      else if (rule.op === "passed") p = [{ col, op: "past" }];
      else if (rule.op === "ahead") p = [{ col, op: "future" }];
      else p = [{ col, op: "within", v: num(rule.value, f.label) }, { col, op: "future" }];
      break;
    }
    case "text": {
      const list = strings(rule.value);
      if (list.length === 0) throw new RuleError(`${f.label}: type at least one.`);
      p = [{ col, op: "in_ci", v: list }];
      break;
    }
    case "tags": {
      const list = strings(rule.value);
      if (list.length === 0) throw new RuleError(`${f.label}: pick at least one.`);
      if (rule.op === "has_none") { p = [{ col, op: "any", v: list }]; not = !not; }
      else p = [{ col, op: rule.op === "has_all" ? "all" : "any", v: list }];
      break;
    }
    case "owner": {
      if (rule.op === "nobody") p = [{ col, op: "null" }];
      else if (rule.op === "anybody") p = [{ col, op: "notnull" }];
      else {
        const list = strings(rule.value);
        if (list.length === 0) throw new RuleError("Owner: pick someone.");
        p = [{ col, op: "in", v: list }];
      }
      break;
    }
    case "campaign": {
      const list = strings(rule.value);
      if (list.length === 0) throw new RuleError("Pick a campaign.");
      p = [{ col, op: "any", v: list }];
      if (rule.op === "not_received") not = !not;
      break;
    }
  }
  return not ? { p, not: true } : { p };
}

/** The whole tree, ready for crm_audience_*. An audience with no finished rule matches nobody. */
export function compileAudience(a: Audience): CompiledRules {
  return {
    groups: a.groups
      .map((g) => ({ match: g.match, rules: g.rules.map(compileRule) }))
      .filter((g) => g.rules.length > 0),
  };
}

// ---- describing -----------------------------------------------------------------

const money = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-AU");
const days = (n: number) => (n % 365 === 0 && n >= 365 ? `${n / 365} year${n === 365 ? "" : "s"}` : n % 30 === 0 && n >= 60 ? `${n / 30} months` : `${n} day${n === 1 ? "" : "s"}`);

/** A rule in the office's words: { field, op, value } for a read-only row. */
export function describeRule(
  rule: Rule,
  names: { owners?: Record<string, string>; campaigns?: Record<string, string>; tags?: Record<string, string> } = {},
): { field: string; op: string; value: string; not: boolean } {
  const f = FIELD_BY_KEY[rule.field];
  const not = rule.not === true;
  if (!f) return { field: rule.field, op: rule.op, value: String(rule.value ?? ""), not };
  const opLabel = OPS[f.type].find((o) => o.op === rule.op)?.label ?? rule.op;
  const label = (v: string) =>
    f.options?.find((o) => o.value === v)?.label
    ?? names.owners?.[v] ?? names.campaigns?.[v] ?? names.tags?.[v] ?? v;
  const list = strings(rule.value).map(label).join(", ");
  switch (f.type) {
    case "bool": return { field: f.label, op: "is", value: rule.value === false ? "no" : "yes", not };
    case "money": return {
      field: f.label, op: opLabel.replace(" $", ""),
      value: rule.op === "between" ? pair(rule.value, f.label).map(money).join(" – ") : money(num(rule.value, f.label)), not,
    };
    case "number": return { field: f.label, op: opLabel, value: rule.op === "between" ? pair(rule.value, f.label).join(" – ") : String(rule.value), not };
    case "minutes": return { field: f.label, op: opLabel, value: `${Math.round(num(rule.value, f.label) / 60)} min`, not };
    case "days":
      if (rule.op === "never" || rule.op === "ever") return { field: f.label, op: opLabel, value: "", not };
      return { field: f.label, op: rule.op === "more_than_days" ? "more than" : "within the last", value: `${days(num(rule.value, f.label))}${rule.op === "more_than_days" ? " ago" : ""}`, not };
    case "due":
      if (rule.op === "within_days") return { field: f.label, op: "within the next", value: days(num(rule.value, f.label)), not };
      return { field: f.label, op: opLabel, value: "", not };
    case "owner":
      if (rule.op !== "is") return { field: f.label, op: opLabel, value: "", not };
      return { field: f.label, op: "is", value: list, not };
    default: return { field: f.label, op: opLabel, value: list, not };
  }
}

// ---- the lists that ship --------------------------------------------------------

const all = (rules: Rule[]): Audience => ({ groups: [{ match: "all", rules }] });

/** Seed data and the fallback for a database the migration has not reached. */
export const STANDING_SEGMENTS: Segment[] = [
  {
    key: "past_customers", name: "Past customers", standing: true,
    description: "People who accepted a quote and had the work done. Not people we quoted and lost.",
    audience: all([
      { field: "is_customer", op: "is", value: true },
      { field: "permit_email", op: "is_not", value: ["declined"] },
    ]),
  },
  {
    key: "interior_no_exterior", name: "Interior customers with no exterior job", standing: true,
    description: "You painted their inside. Nobody has ever quoted their outside.",
    audience: all([
      { field: "is_customer", op: "is", value: true },
      { field: "job_types", op: "has_any", value: ["interior"] },
      { field: "job_types", op: "has_any", value: ["exterior"], not: true },
      { field: "permit_email", op: "is_not", value: ["declined"] },
      { field: "stage", op: "is_not", value: ["job_on"] },
    ]),
  },
  {
    key: "exteriors_due_repaint", name: "Exteriors due a repaint", standing: true,
    description: "Exterior work finished more than seven years ago, and quiet for a year.",
    audience: all([
      { field: "is_customer", op: "is", value: true },
      { field: "last_job_completed_type", op: "is", value: ["exterior"] },
      { field: "last_job_completed_at", op: "more_than_days", value: 2555 },
      { field: "last_contact_at", op: "more_than_days", value: 365 },
      { field: "permit_email", op: "is_not", value: ["declined"] },
      { field: "stage", op: "is_not", value: ["job_on"] },
    ]),
  },
];

// ---- lists built before P5 --------------------------------------------------------

/**
 * The flat AND list a segment carried until today, translated. Every rule that
 * has a home becomes one; the few that read the wizard draft's progress have
 * no facts column and are reported back so the office can re-check the list.
 */
export function legacyToAudience(criteria: unknown): { audience: Audience; dropped: string[] } {
  const rules: Rule[] = [];
  const dropped: string[] = [];
  const months = (m: number) => Math.round(m * 30.4375);
  for (const c of Array.isArray(criteria) ? (criteria as Array<Record<string, unknown>>) : []) {
    const op = String(c.op ?? "");
    switch (c.field) {
      case "job_type": {
        const v = String(c.value);
        const rule: Rule = v === "both"
          ? { field: "job_types", op: "has_all", value: ["interior", "exterior"] }
          : { field: "job_types", op: "has_any", value: [v] };
        rules.push(op === "is_not" ? { ...rule, not: true } : rule);
        break;
      }
      case "has_job_type": rules.push({ field: "job_types", op: "has_any", value: [String(c.value)], not: true }); break;
      case "completed": rules.push({ field: "last_job_completed_at", op: op === "more_than" ? "more_than_days" : "less_than_days", value: months(Number(c.months) || 0) }); break;
      case "job_value": rules.push({ field: "won_cents", op: "between", value: [Number(c.minCents) || 0, Number(c.maxCents) || 0] }); break;
      case "quoted": rules.push({ field: "was_quoted", op: "is", value: c.value !== false }); break;
      case "is_customer": rules.push({ field: "is_customer", op: "is", value: c.value !== false }); break;
      case "last_contact": rules.push({ field: "last_contact_at", op: op === "more_than" ? "more_than_days" : "less_than_days", value: months(Number(c.months) || 0) }); break;
      case "suburb": rules.push({ field: "suburb", op: "is", value: strings(c.value) }); break;
      case "temperature": rules.push({ field: "temperature", op: "is", value: strings(c.value) }); break;
      case "status": {
        for (const v of strings(c.value)) {
          if (v === "unsubscribed") rules.push({ field: "permit_email", op: "is_not", value: ["declined"] });
          else if (v === "open_work") rules.push({ field: "stage", op: "is_not", value: ["job_on"] });
          else if (v === "snoozed") rules.push({ field: "next_followup_at", op: "ahead", not: true });
        }
        break;
      }
      case "abandoned_draft": rules.push({ field: "has_draft", op: "is", value: c.value !== false }); break;
      case "draft_age": rules.push({ field: "draft_last_seen_at", op: op === "more_than" ? "more_than_days" : "less_than_days", value: Math.max(1, Math.round((Number(c.hours) || 0) / 24)) }); break;
      case "draft_progress": case "draft_uploaded": case "draft_visits":
        dropped.push(String(c.field)); break;
      default: dropped.push(String(c.field ?? "?"));
    }
  }
  return { audience: all(rules), dropped };
}

/** Every field, for the builder's menu. Re-exported so screens import one module. */
export { FIELDS, FIELD_BY_KEY };
