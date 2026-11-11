import { z } from "zod";

/**
 * The lead's page (automations ruling A‑F, Tom 11 Nov 2026): a wizard
 * customer who has seen their range gets a token page with that range and the
 * chat, before any estimate is sent. CLAUDE.md: customers see SNAPSHOTS — so
 * the page never reads the live draft. The wizard's submit route writes this
 * snapshot (server-side, from the range it has just priced) onto the draft
 * estimate as `lead_snapshot`; `/e/[token]` renders only what is in it.
 *
 * Re-pricing (the quote stage, an edited answer) writes a fresh snapshot: the
 * page always shows the last range the customer was shown. Pure; client-safe.
 */
export const LEAD_SNAPSHOT_VERSION = 1;

const cents = z.number().int().nonnegative();
export const leadSnapshotSchema = z.object({
  version: z.literal(LEAD_SNAPSHOT_VERSION),
  kind: z.literal("lead"),
  rangeLoCents: cents,
  rangeHiCents: cents,
  /** A "both" job's two halves, as the gate showed them. */
  parts: z.object({
    interior: z.object({ rangeLoCents: cents, rangeHiCents: cents }),
    exterior: z.object({ rangeLoCents: cents, rangeHiCents: cents }),
  }).nullable(),
  jobType: z.enum(["interior", "exterior", "both"]).nullable(),
  /** The first name only — the page is reached by a link, so it carries no more of them than a greeting needs. */
  firstName: z.string().max(80),
  address: z.string().max(250),
  /** The Paint Home hand-off (a bigger job): the page says someone will come and look. */
  biggerJob: z.boolean(),
  pricedAt: z.string().datetime(),
}).refine((s) => s.rangeHiCents >= s.rangeLoCents, { message: "range high below low" });
export type LeadSnapshot = z.infer<typeof leadSnapshotSchema>;

export type LeadSnapshotInput = {
  rangeLoCents: number; rangeHiCents: number;
  parts?: { interior: { rangeLoCents: number; rangeHiCents: number }; exterior: { rangeLoCents: number; rangeHiCents: number } } | null;
  jobType?: string | null;
  contactName: string | null | undefined;
  address: string | null | undefined;
  biggerJob: boolean;
  now: Date;
};

const JOB_TYPES = new Set(["interior", "exterior", "both"]);
const round = (n: number) => Math.max(0, Math.round(n));
const pair = (p: { rangeLoCents: number; rangeHiCents: number }) => ({ rangeLoCents: round(p.rangeLoCents), rangeHiCents: round(p.rangeHiCents) });

/** The snapshot for a range just shown, or null when there is no usable range to keep. */
export function buildLeadSnapshot(i: LeadSnapshotInput): LeadSnapshot | null {
  if (!Number.isFinite(i.rangeLoCents) || !Number.isFinite(i.rangeHiCents) || i.rangeHiCents <= 0) return null;
  const snap = {
    version: LEAD_SNAPSHOT_VERSION, kind: "lead" as const,
    ...pair({ rangeLoCents: i.rangeLoCents, rangeHiCents: i.rangeHiCents }),
    parts: i.parts ? { interior: pair(i.parts.interior), exterior: pair(i.parts.exterior) } : null,
    jobType: i.jobType && JOB_TYPES.has(i.jobType) ? (i.jobType as LeadSnapshot["jobType"]) : null,
    firstName: (i.contactName ?? "").trim().split(/\s+/)[0]?.slice(0, 80) ?? "",
    address: (i.address ?? "").trim().slice(0, 250),
    biggerJob: i.biggerJob,
    pricedAt: i.now.toISOString(),
  };
  const ok = leadSnapshotSchema.safeParse(snap);
  return ok.success ? ok.data : null;
}

/** What the page renders: the stored snapshot, or null when it is not a valid one (never a guess). */
export function parseLeadSnapshot(v: unknown): LeadSnapshot | null {
  const ok = leadSnapshotSchema.safeParse(v);
  return ok.success ? ok.data : null;
}

/** "$6,400 – $7,900", whole dollars, as the gate prints it. */
export const leadMoney = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;
