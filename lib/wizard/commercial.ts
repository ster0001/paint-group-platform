import { DEFAULT_SEGMENTS, kindLeavesForBrief, openCount, resolveSegmentKey, segmentByKey, type CommercialAnswers, type Segment, type SegmentRoute } from "./segments";
import { commercialPricingFrom, commercialWidenPct } from "@/lib/pricing/commercial";
import { settingValue } from "./policy";
import type { CustomerPayload } from "./view";

/**
 * Commercial routing — WHICH DOOR (estimator journey v2 addendum §4, C12).
 *
 * Phase 7a routed a commercial job through seven yes/no gates, any one of
 * which sent it to an appointment. C12 retires the gates as a wall (runsheet:
 * *"height and equipment appear where relevant, hours is a loading, induction
 * and committees live on the brief"*) and routes on the SEGMENT ROW instead:
 *
 *   route = range  → the quick look continues (areas → job → a widened guide
 *                    range, a person confirms; never fix-online, §4.15);
 *   route = brief  → a short brief and a booking (C14), no number anywhere
 *                    (§4.16).
 *
 * Three things override a range segment to the brief, all data or the job:
 *   - the kind answer the row names (health: hospital → the hospital brief);
 *   - any OUTSIDE work (every commercial exterior is priced on site, ruling
 *     10 Sep) — outside → the exterior brief, both → one visit;
 *   - no segment at all — we don't know what sort of site it is yet.
 *
 * The brief's first principle stands: *price online where the variables are
 * bounded, and refuse to guess where they aren't.* What changed is that the
 * bounding is done by the segment's configuration, not by asking a shop owner
 * whether their site needs an induction.
 *
 * Nothing in here is money.
 */

/** A segment key as stored — any string the table (or the legacy map) knows. */
export type CommercialSegment = string;

/** The keys, in tile order, for surfaces that render a picker without the table. */
export const COMMERCIAL_SEGMENTS: readonly string[] = DEFAULT_SEGMENTS.filter((s) => s.tile).map((s) => s.key);
export const SEGMENT_LABEL: Record<string, string> = Object.fromEntries(DEFAULT_SEGMENTS.map((s) => [s.key, s.name]));

export type CommercialRouting = {
  /** The door, or null while the segment is unknown. */
  route: SegmentRoute | null;
  /** True only on the range door: the wizard may price this job (a person still confirms). */
  canPriceOnline: boolean;
  /** Which brief the job leaves for — the segment's own key, "hospital", or "exterior". Null on the range door. */
  briefKey: string | null;
  /** What the estimator (and the lead row) reads, one line per reason. */
  reasons: string[];
  segment: Segment | null;
};

export type RouteInput = {
  segments?: Segment[];
  kind?: string | null;
  jobType?: "interior" | "exterior" | "both";
};

export function routeCommercial(segmentKey: string | null | undefined, input: RouteInput = {}): CommercialRouting {
  const segments = input.segments ?? DEFAULT_SEGMENTS;
  const segment = segmentByKey(segments, segmentKey);
  if (!segment) {
    return { route: null, canPriceOnline: false, briefKey: null, reasons: ["we don't know what sort of site it is yet"], segment: null };
  }
  const reasons: string[] = [];
  // Outside work first: it overrides everything, whatever the tile.
  if (input.jobType === "exterior" || input.jobType === "both") {
    reasons.push(input.jobType === "both"
      ? "inside and outside together — one visit prices both, and the outside is never priced from a form"
      : "a commercial exterior — heights, access equipment and traffic management are priced on site");
    return { route: "brief", canPriceOnline: false, briefKey: "exterior", reasons, segment };
  }
  const kindBrief = kindLeavesForBrief(segment, input.kind ?? null);
  if (kindBrief) {
    reasons.push(`${segment.name.toLowerCase()}: ${input.kind} is priced on site`);
    return { route: "brief", canPriceOnline: false, briefKey: kindBrief, reasons, segment };
  }
  if (segment.route === "brief") {
    reasons.push(segment.brief?.sub.split(" — ")[0] ?? `${segment.name.toLowerCase()} is priced on site`);
    return { route: "brief", canPriceOnline: false, briefKey: segment.key, reasons, segment };
  }
  return { route: "range", canPriceOnline: true, briefKey: null, reasons, segment };
}

/** A stored key, resolved through the legacy map (healthcare → health, industrial → warehouse). */
export function canonicalSegment(key: string | null | undefined): string | null {
  return resolveSegmentKey(key);
}

/**
 * The one line a customer reads on a brief door. Honest about WHY — "we'll
 * need to see it" with no reason reads as a brush-off, and a facilities
 * manager who knows exactly why will trust us more for saying it.
 */
export function gateMessage(routing: CommercialRouting): string {
  if (routing.canPriceOnline) return "";
  if (routing.route == null) return "Pick the closest kind of place and we'll say straight away whether we can price it from here.";
  return "This one is priced on site — from what you've told us, a form can't price it honestly. "
    + "A few quick questions get us ready, then you pick a time.";
}

/**
 * ⚑20 — the widening for a stored commercial state, resolved ONCE for every
 * surface that builds a customer payload (submit, the tighten screen, the
 * edit route). The photo count is the condition-photo count: the open-space
 * photo rides that upload. Zero and null for a residential job.
 */
export function commercialWidenFor(
  state: { commercial?: CommercialAnswers | null; customer?: { propertyKind?: string } | null; details: { damagePhotoCount?: number }; conditionSourceIds?: string[] } | null | undefined,
  settings: Array<{ key: string; value: unknown }>,
  segments: Segment[] = DEFAULT_SEGMENTS,
): { widenPct: number; commercial: CustomerPayload["commercial"] } {
  const a = state?.commercial;
  if (!a || state?.customer?.propertyKind !== "commercial") return { widenPct: 0, commercial: null };
  const segment = segmentByKey(segments, a.segment);
  if (!segment) return { widenPct: 0, commercial: null };
  const pricing = commercialPricingFrom(settingValue(settings, "commercial_pricing"));
  const photos = Math.max(state?.details.damagePhotoCount ?? 0, state?.conditionSourceIds?.length ?? 0);
  const widenPct = commercialWidenPct({
    pattern: segment.config.pattern === "warehouse" ? "warehouse" : "areas",
    openCount: openCount(segment, a),
    photos,
  }, pricing);
  return { widenPct, commercial: { segment: segment.key, name: segment.name, widenPct, photos } };
}
