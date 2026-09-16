/**
 * Airtable → CRM import · the value mappings (brief §2, §3, R2–R4).
 *
 * The transform (docs/imports/airtable-crm-import/transform.py) writes the
 * CSVs in its own vocabulary; the database has its own CHECK constraints
 * (20270125 crm_status_model, 20261207 crm_judgement, lib/crm/events.ts).
 * Every translation between the two lives here, pure and unit-tested, so the
 * loader never carries a literal the tests cannot see.
 */

import type { LostReason } from "@/lib/crm/states";

// ---- accounts ---------------------------------------------------------------

/** CSV `lost_reason` → accounts.lost_reason (CHECK in 20270125). Tom, 16 Sep:
 *  competitor → went_with_someone_else, other → something_else, no_response →
 *  something_else with a state note saying so (there is no closer value). */
export function mapLostReason(csv: string): { lostReason: LostReason; stateNote: string | null } | null {
  switch (csv.trim().toLowerCase()) {
    case "competitor": return { lostReason: "went_with_someone_else", stateNote: null };
    case "other": return { lostReason: "something_else", stateNote: null };
    case "no_response": return { lostReason: "something_else", stateNote: "No response (Airtable)" };
    case "": return null;
    default: throw new Error(`unknown lost_reason "${csv}"`);
  }
}

export type Temperature = "hot" | "warm" | "cold";

/** CSV `temperature` → accounts.temperature; blank stays null. */
export function mapTemperature(csv: string): Temperature | null {
  const v = csv.trim().toLowerCase();
  if (v === "") return null;
  if (v === "hot" || v === "warm" || v === "cold") return v;
  throw new Error(`unknown temperature "${csv}"`);
}

/** The pack's hyphenated tags → the platform's underscore keys (crm_tags.key).
 *  `real-estate` is the tag that already existed as `real_estate` (20270129). */
export const TAG_KEYS: Record<string, string> = {
  "airtable-import": "airtable_import",
  "agency": "agency",
  "kay-and-burton": "kay_and_burton",
  "real-estate": "real_estate",
  "commercial": "commercial",
};

export function mapTags(csv: string): string[] {
  const out = new Set<string>();
  for (const raw of csv.split(",")) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const key = TAG_KEYS[t];
    if (!key) throw new Error(`unknown tag "${t}"`);
    out.add(key);
  }
  return [...out].sort();
}

export type RelationshipState = "active" | "lost";

export function mapRelationshipState(csv: string): RelationshipState {
  const v = csv.trim().toLowerCase();
  if (v === "active" || v === "lost") return v;
  throw new Error(`unknown relationship_state "${csv}"`);
}

// ---- estimates ----------------------------------------------------------------

export const ESTIMATE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export function mapEstimateStatus(csv: string): EstimateStatus {
  const v = csv.trim().toLowerCase() as EstimateStatus;
  if ((ESTIMATE_STATUSES as readonly string[]).includes(v)) return v;
  throw new Error(`unknown estimate status "${csv}"`);
}

export const SIZE_BANDS = ["under_10k", "10_to_20k", "over_20k"] as const;

export function mapSizeBand(csv: string): (typeof SIZE_BANDS)[number] | null {
  const v = csv.trim();
  if (v === "") return null;
  if ((SIZE_BANDS as readonly string[]).includes(v)) return v as (typeof SIZE_BANDS)[number];
  throw new Error(`unknown size_band "${csv}"`);
}

/** Level of finish: 2 | 3 | 4, or null on a draft (the CHECK allows 1–4, the
 *  pack only ever writes 2–4). A non-draft row with no level is a transform
 *  bug, not something to default here — R2 already defaulted it to 3. */
export function mapLevelOfFinish(csv: string, status: EstimateStatus): 2 | 3 | 4 | null {
  const v = csv.trim();
  if (v === "") {
    if (status === "draft") return null;
    throw new Error(`a ${status} estimate has no level_of_finish`);
  }
  const n = Number(v);
  if (n === 2 || n === 3 || n === 4) return n;
  throw new Error(`unknown level_of_finish "${csv}"`);
}

// ---- jobs ---------------------------------------------------------------------

export const JOB_STATUSES = ["completed", "in_progress", "scheduled", "accepted_unscheduled", "cancelled", "on_hold"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function mapJobStatus(csv: string): JobStatus {
  const v = csv.trim().toLowerCase() as JobStatus;
  if ((JOB_STATUSES as readonly string[]).includes(v)) return v;
  throw new Error(`unknown job status "${csv}"`);
}

// ---- events --------------------------------------------------------------------

/** What the CSV calls an event → the catalogue kind (lib/crm/events.ts) and
 *  the payload in the catalogue's shape. The CSV's own keys ride along under
 *  their original names so nothing the transform knew is thrown away. */
export type MappedEvent = { type: string; payload: Record<string, unknown> };

const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

export function mapEvent(csvType: string, payload: Record<string, unknown>): MappedEvent {
  const dateConfidence = typeof payload.date_confidence === "string" ? payload.date_confidence : undefined;
  const base: Record<string, unknown> = { ...payload, origin: payload.origin ?? "airtable_import" };
  if (dateConfidence) base.dateConfidence = dateConfidence;
  switch (csvType) {
    case "account_created":
      return { type: "account_created", payload: { ...base, via: "import" } };
    case "estimate_sent":
      return { type: "estimate_sent", payload: { ...base, totalCents: int(payload.total_cents) ?? 0, channel: "link" } };
    case "estimate_accepted":
      return { type: "estimate_accepted", payload: { ...base, totalCents: int(payload.total_cents) ?? 0 } };
    case "estimate_declined": {
      const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : undefined;
      return { type: "estimate_declined", payload: { ...base, ...(reason ? { reason } : {}) } };
    }
    case "estimate_lapsed":
      return { type: "estimate_lapsed", payload: { ...base, ...(int(payload.total_cents) != null ? { totalCents: int(payload.total_cents) } : {}) } };
    case "job_started":
    case "job_completed": {
      const ref = shortRef(payload.quote_number);
      return { type: csvType, payload: { ...base, ...(ref ? { workOrderNo: ref } : {}) } };
    }
    case "note": {
      // The catalogue's note is `note_added { body }`; the author (Tom /
      // Robyn / blank) rides along so the timeline can say who wrote it.
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) throw new Error("a note with no text");
      const author = typeof payload.author === "string" && payload.author.trim() ? payload.author.trim() : undefined;
      const { text: _t, author: _a, ...rest } = base;
      void _t; void _a;
      return { type: "note_added", payload: { ...rest, body: text.slice(0, 2000), ...(author ? { author } : {}) } };
    }
    default:
      throw new Error(`unknown event type "${csvType}"`);
  }
}

function shortRef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? `PS-${v.trim()}`.slice(0, 30) : undefined;
}
