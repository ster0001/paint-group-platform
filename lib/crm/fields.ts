/**
 * CRM v2 P5 — the field registry (deep dive §4.3.2).
 *
 * Every fact an audience rule can ask about is ONE entry here: a label, a
 * type, the crm_account_facts column it reads, and (for lists) where its
 * options come from. The builder renders the menu and the editors from this
 * table; lib/crm/segments.ts compiles a rule into the {col, op, v} primitives
 * that migration 20270126's crm_audience_where turns into SQL. Adding a field
 * is one entry — and, when the fact is new, one column on the facts row.
 *
 * Rules are a FORM, not a query language: a field, an operator the type
 * allows, a value of the shape the type expects. Nothing here parses text.
 */

import { LANES } from "./stage";
import { LOST_REASONS, RELATIONSHIP_STATES, STATE_LABEL } from "./states";
import { SOURCES } from "./attribution";

export type FieldType =
  | "enum"      // one of a fixed list (multi-select; "is any of" / "is none of")
  | "bool"      // yes / no — a computed truth (has had work done, opened their estimate…)
  | "number"    // a count
  | "money"     // cents in the database, dollars on screen
  | "minutes"   // seconds in the database, minutes on screen
  | "days"      // a timestamp, asked about as "more/less than N days ago" (or never)
  | "due"       // a FUTURE timestamp, asked about as "due within N days" / "already passed"
  | "text"      // a free list of words, matched case-insensitively (suburb)
  | "tags"      // a text[] column: has any / has all / has none
  | "owner"     // a staff member, or nobody
  | "campaign"; // a campaign key: received / not received

export type Primitive = { col: string; op: string; v?: unknown };

export type FieldDef = {
  key: string;
  label: string;
  group: string;
  /** One line under the label in the menu — what it means in the office's words. */
  help: string;
  type: FieldType;
  /** The facts column, for every type except bool. */
  col?: string;
  /** bool: the primitive that is TRUE when the answer is yes. "No" is its NOT. */
  truthy?: Primitive[];
  /** enum: the fixed options. */
  options?: Array<{ value: string; label: string }>;
  /** enum/owner/campaign: options the page resolves at render time. */
  optionSource?: "tags" | "owners" | "campaigns" | "lostReasons";
  /** days: "more than N days ago" also matches NEVER (last contact — it has been forever). */
  neverIsOlder?: boolean;
};

const lanes = LANES.map((l) => ({ value: l.key, label: l.label }));
const permits = [
  { value: "allowed", label: "Yes" }, { value: "unknown", label: "Not asked" }, { value: "declined", label: "No" },
];
const jobTypes = [{ value: "interior", label: "Interior" }, { value: "exterior", label: "Exterior" }];

export const FIELDS: FieldDef[] = [
  // ---- who they are --------------------------------------------------------
  { key: "stage", label: "Stage", group: "Who they are", help: "The lane on the board, worked out by the rules", type: "enum", col: "stage", options: lanes },
  { key: "relationship_state", label: "Status", group: "Who they are", help: "Active, delayed, do not contact, lost", type: "enum", col: "relationship_state",
    options: RELATIONSHIP_STATES.filter((s) => s !== "archived").map((s) => ({ value: s, label: STATE_LABEL[s] })) },
  { key: "temperature", label: "Temperature", group: "Who they are", help: "Your own hot / warm / cold", type: "enum", col: "temperature",
    options: [{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }] },
  { key: "tags", label: "Tags", group: "Who they are", help: "From the office tag list", type: "tags", col: "tags", optionSource: "tags" },
  { key: "owner_id", label: "Owner", group: "Who they are", help: "Whose customer they are", type: "owner", col: "owner_id", optionSource: "owners" },
  { key: "source", label: "Lead source", group: "Who they are", help: "How they first found you", type: "enum", col: "source",
    options: SOURCES.map((s) => ({ value: s.key, label: s.label })) },
  { key: "account_type", label: "Account type", group: "Who they are", help: "Residential or trade", type: "enum", col: "account_type",
    options: [{ value: "residential", label: "Residential" }, { value: "trade", label: "Trade" }] },
  { key: "suburb", label: "Suburb", group: "Who they are", help: "One or more, comma-separated", type: "text", col: "suburb" },
  { key: "is_customer", label: "Has had work done", group: "Who they are", help: "Accepted a quote — a customer, not just an enquiry", type: "bool",
    truthy: [{ col: "won_cents", op: "gt", v: 0 }] },
  // ---- may we --------------------------------------------------------------
  { key: "permit_email", label: "Marketing email", group: "May we", help: "Their answer on email", type: "enum", col: "permit_email", options: permits },
  { key: "permit_sms", label: "Marketing texts", group: "May we", help: "Their answer on texts", type: "enum", col: "permit_sms", options: permits },
  { key: "permit_phone", label: "Phone calls", group: "May we", help: "Their answer on calls", type: "enum", col: "permit_phone", options: permits },
  // ---- their quotes --------------------------------------------------------
  { key: "job_types", label: "Job type", group: "Their quotes", help: "Interior, exterior — from ANY estimate, won or not", type: "tags", col: "job_types", options: jobTypes },
  { key: "last_estimate_status", label: "Latest quote", group: "Their quotes", help: "What happened to the newest estimate", type: "enum", col: "last_estimate_status",
    options: [{ value: "sent", label: "Sent, no answer" }, { value: "accepted", label: "Accepted" }, { value: "declined", label: "Declined" },
      { value: "lapsed", label: "Lapsed" }, { value: "draft", label: "Still a draft" }, { value: "none", label: "No estimate" }] },
  { key: "was_quoted", label: "Was quoted", group: "Their quotes", help: "Has ever been given a price", type: "bool", truthy: [{ col: "estimates_count", op: "gt", v: 0 }] },
  { key: "has_open_quote", label: "Has an open quote", group: "Their quotes", help: "A sent estimate nobody has answered", type: "bool", truthy: [{ col: "open_value_cents", op: "gt", v: 0 }] },
  { key: "quoted_cents", label: "Latest quote value", group: "Their quotes", help: "The newest estimate's total", type: "money", col: "quoted_cents" },
  { key: "open_value_cents", label: "Open quote value", group: "Their quotes", help: "Everything sent and unanswered, added up", type: "money", col: "open_value_cents" },
  { key: "won_cents", label: "Won value", group: "Their quotes", help: "Every accepted quote, added up", type: "money", col: "won_cents" },
  { key: "estimates_count", label: "Number of quotes", group: "Their quotes", help: "How many estimates, ever", type: "number", col: "estimates_count" },
  { key: "last_sent_at", label: "Estimate sent", group: "Their quotes", help: "Days since the newest estimate went out", type: "days", col: "last_sent_at" },
  { key: "opened", label: "Opened their estimate", group: "Their quotes", help: "Has ever opened an estimate we sent", type: "bool", truthy: [{ col: "opened_count", op: "gt", v: 0 }] },
  { key: "opened_count", label: "Times opened", group: "Their quotes", help: "How many separate looks at their estimates", type: "number", col: "opened_count" },
  { key: "dwell_seconds", label: "Time spent reading", group: "Their quotes", help: "Minutes on their estimate pages, all visits", type: "minutes", col: "dwell_seconds" },
  { key: "last_opened_at", label: "Last opened", group: "Their quotes", help: "Days since they last looked", type: "days", col: "last_opened_at" },
  { key: "last_accepted_at", label: "Accepted", group: "Their quotes", help: "Days since they last accepted a quote", type: "days", col: "last_accepted_at" },
  { key: "last_declined_at", label: "Declined", group: "Their quotes", help: "Days since they last declined a quote", type: "days", col: "last_declined_at" },
  { key: "decline_reason", label: "Decline reason", group: "Their quotes", help: "What they typed when they declined", type: "text", col: "decline_reason" },
  { key: "lost_reason", label: "Lost reason", group: "Their quotes", help: "The reason the office chose", type: "enum", col: "lost_reason",
    options: LOST_REASONS.map((r) => ({ value: r.key, label: r.label })) },
  // ---- their journey -------------------------------------------------------
  { key: "draft_bucket", label: "Wizard bucket", group: "Their journey", help: "Where their online estimate got to", type: "enum", col: "draft_bucket",
    options: [{ value: "online_now", label: "Online now" }, { value: "ready_call", label: "Asked for a call" }, { value: "ready_visit", label: "Asked for a visit" },
      { value: "needs_help", label: "Needs help" }, { value: "dropped", label: "Dropped out" }, { value: "priced_no_request", label: "Priced, no request" }] },
  { key: "has_draft", label: "Started an online estimate", group: "Their journey", help: "Has a wizard session on file", type: "bool", truthy: [{ col: "draft_bucket", op: "notnull" }] },
  { key: "draft_last_seen_at", label: "Last in the wizard", group: "Their journey", help: "Days since they were last in their online estimate", type: "days", col: "draft_last_seen_at" },
  // ---- contact -------------------------------------------------------------
  { key: "last_contact_at", label: "Last contact", group: "Contact", help: "Any touch at all — a call, a message, a quote", type: "days", col: "last_contact_at", neverIsOlder: true },
  { key: "last_contact_channel", label: "Last contact was by", group: "Contact", help: "How the last touch happened", type: "enum", col: "last_contact_channel",
    options: [{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }, { value: "sms", label: "Text" }, { value: "visit", label: "Visit" }] },
  { key: "last_inbound_at", label: "They last wrote or rang", group: "Contact", help: "Days since a message or call FROM them", type: "days", col: "last_inbound_at" },
  { key: "last_staff_contact_at", label: "Someone here last reached out", group: "Contact", help: "Days since the office logged a call, email or text", type: "days", col: "last_staff_contact_at" },
  { key: "next_followup_at", label: "Follow-up date", group: "Contact", help: "A dated follow-up on the record", type: "due", col: "next_followup_at" },
  // ---- jobs and money ------------------------------------------------------
  { key: "last_job_completed_at", label: "Last job finished", group: "Jobs & money", help: "Days since the last job wrapped up", type: "days", col: "last_job_completed_at" },
  { key: "last_job_completed_type", label: "Last job was", group: "Jobs & money", help: "Interior or exterior, from the last finished job", type: "enum", col: "last_job_completed_type", options: jobTypes },
  { key: "repaint_due_at", label: "Repaint due", group: "Jobs & money", help: "From the last job and the repaint years in Settings", type: "due", col: "repaint_due_at" },
  { key: "invoice_state", label: "Invoice", group: "Jobs & money", help: "The newest invoice on any of their jobs", type: "enum", col: "invoice_state",
    options: [{ value: "none", label: "None" }, { value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }] },
  // ---- campaigns -----------------------------------------------------------
  { key: "campaigns_received", label: "Received campaign", group: "Campaigns", help: "Has been sent a message from this campaign", type: "campaign", col: "campaigns_received", optionSource: "campaigns" },
];

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const FIELD_GROUPS = [...new Set(FIELDS.map((f) => f.group))];

/** The operators each type offers, with the words the builder shows. */
export const OPS: Record<FieldType, Array<{ op: string; label: string }>> = {
  enum: [{ op: "is", label: "is any of" }, { op: "is_not", label: "is none of" }],
  bool: [{ op: "is", label: "is" }],
  number: [{ op: "more_than", label: "more than" }, { op: "less_than", label: "less than" }, { op: "between", label: "between" }],
  money: [{ op: "more_than", label: "more than $" }, { op: "less_than", label: "less than $" }, { op: "between", label: "between $" }],
  minutes: [{ op: "more_than", label: "more than" }, { op: "less_than", label: "less than" }],
  days: [{ op: "more_than_days", label: "more than … days ago" }, { op: "less_than_days", label: "within the last … days" }, { op: "never", label: "never" }, { op: "ever", label: "ever" }],
  due: [{ op: "within_days", label: "within the next … days" }, { op: "passed", label: "already passed" }, { op: "ahead", label: "still ahead" }, { op: "never", label: "not set" }],
  text: [{ op: "is", label: "is any of" }],
  tags: [{ op: "has_any", label: "has any of" }, { op: "has_all", label: "has all of" }, { op: "has_none", label: "has none of" }],
  owner: [{ op: "is", label: "is" }, { op: "nobody", label: "is nobody" }, { op: "anybody", label: "is somebody" }],
  campaign: [{ op: "received", label: "received" }, { op: "not_received", label: "not received" }],
};

/** A blank rule for the menu — the first operator, an empty value of the right shape. */
export function blankRule(key: string): Rule {
  const f = FIELD_BY_KEY[key];
  const op = OPS[f.type][0].op;
  switch (f.type) {
    case "bool": return { field: key, op, value: true };
    case "number": return { field: key, op, value: 1 };
    case "money": return { field: key, op, value: 500_000 };
    case "minutes": return { field: key, op, value: 60 };
    case "days": return { field: key, op, value: 7 };
    case "due": return { field: key, op, value: 30 };
    case "text": case "tags": case "owner": case "campaign": case "enum": return { field: key, op, value: f.options?.length ? [f.options[0].value] : [] };
  }
}

export type Rule = { field: string; op: string; value?: unknown; not?: boolean };
