/**
 * Lead source on an estimate — home dashboard v2, session 0a (Part B1).
 *
 * The account is the source of truth (its first touch, or a staff pick); the
 * estimate carries a copy for cohort reporting. The vocabulary is the CRM's
 * attribution list — one list, so "where did this job come from" reads the
 * same on the Sources report, the builder picker and the dashboard. The
 * database mirrors it in `public.lead_source_keys()` (20270175); the unit test
 * beside this file fails when the two drift.
 *
 * `unknown` renders as "Not recorded". It is what legacy rows were backfilled
 * to; a person may also pick it deliberately. It never propagates to an
 * account that has no source — it is the absence of knowledge, not knowledge.
 */
import { SOURCES, sourceLabel, type SourceKey } from "@/lib/crm/attribution";

export type LeadSource = SourceKey;

/** The picker's options, in the CRM's order. */
export const LEAD_SOURCE_OPTIONS: ReadonlyArray<{ key: LeadSource; label: string }> = SOURCES;

export const NOT_RECORDED: LeadSource = "unknown";

export function leadSourceLabel(key: string | null | undefined): string {
  return key ? sourceLabel(key) : "Not recorded";
}

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && SOURCES.some((s) => s.key === value);
}

/** What the builder says when Send is pressed without a lead source. */
export const LEAD_SOURCE_REQUIRED = "Pick where this lead came from (Lead source, under Job) before sending.";
