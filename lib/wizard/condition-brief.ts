/**
 * "Anything we should know?" — the condition description, read
 * (Tom, 9 September 2026).
 *
 * *"Maybe we can add describe it alongside the other features — like floorplan
 * plus describe it, or describe the condition overall and tell us if there is
 * anything which needs extra work — then it could come back asking for
 * photos?"*
 *
 * That resolves ⚑14 by dissolving it. "Describe it" stops being a THIRD ROUTE
 * the customer has to choose instead of the other two — the thing plan §2.1
 * complains about, *"a decision about our mechanics, not their house"* — and
 * becomes something they can add to whichever route they took. A floorplan and
 * a description are not alternatives; the plan says where the rooms are and
 * the description says what state they are in, and no drawing has ever shown
 * that.
 *
 * It also leaves the live chat alone, which was Tom's other point: the bubble
 * is a direct line to the office and has nothing to do with this.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS READS FOR, AND WHY IT IS DELIBERATELY NOT THE MODEL
 *
 * One question: **is there anything here that needs more than the standard
 * preparation?** Tom's own list — *"it is only when the paint is peeling, is
 * raw MDF, is badly damaged, or is painted in oil and needs waterbased top
 * coats that additional prep is required"* — is the whole vocabulary, and it
 * is short, concrete and written in words people actually use.
 *
 * So this is a matcher, not a model call. It costs nothing, runs instantly as
 * they type, never invents a defect the words do not contain, and is testable
 * without an API key. What it CANNOT do is judge how bad something is — which
 * is exactly why the answer is *"can you show us a photo of that?"* rather
 * than a price. The photo reader (lib/wizard/photo-defects.ts) judges extent;
 * this only notices that somebody said something worth photographing.
 */

import { SPOT_TAGS } from "./spots";

export type ConditionFinding = {
  /** The spot tag this maps onto — the same vocabulary the room card uses. */
  tag: string;
  /** What the customer is asked to photograph, in their own words. */
  label: string;
  /** The phrase in their description that raised it, so the ask makes sense. */
  matched: string;
};

/**
 * The words people actually use, per tag.
 *
 * Written from how a homeowner describes a wall, not from how a painter does:
 * nobody types "substrate delamination", they type "the paint is coming off".
 * Anything that needs a trade word to match is a rule that will never fire.
 */
const PATTERNS: Array<{ tag: string; label: string; re: RegExp }> = [
  {
    tag: "flaking", label: "the flaking paint",
    re: /\b(peel(?:ing|ed)?|flak(?:ing|y|es)?|blister(?:ing|ed)?|bubbl(?:ing|ed)|coming off|lifting|chipp(?:ing|ed))\b/i,
  },
  {
    tag: "water", label: "the water mark",
    re: /\b(water (?:mark|stain|damage)|damp|leak(?:ed|ing)?|stain(?:ed|ing|s)?\b(?![a-z])|ceiling stain)\b/i,
  },
  {
    tag: "mould", label: "the mould",
    re: /\b(mould|mold|mildew|black spots?)\b/i,
  },
  {
    tag: "crack", label: "the cracks",
    re: /\b(crack(?:s|ed|ing)?|split(?:s|ting)?)\b/i,
  },
  {
    tag: "hole", label: "the holes or dents",
    re: /\b(holes?|dents?|gouges?|damaged?|patch(?:es|ing)? needed|knocked about)\b/i,
  },
  {
    tag: "wallpaper", label: "the wallpaper",
    re: /\b(wall ?paper)\b/i,
  },
  {
    tag: "rot", label: "the rotten timber",
    re: /\b(rot(?:ten|ting)?|soft timber|weatherboards? (?:are )?(?:rotten|gone))\b/i,
  },
  {
    tag: "rust", label: "the rust",
    re: /\b(rust(?:y|ed|ing)?|corro(?:ded|sion))\b/i,
  },
];

/**
 * Two cases from Tom's list that are NOT spot tags — they are properties of a
 * surface rather than damage in a place, so a photo of "the raw MDF" is not a
 * photo of a spot. They still have to be noticed, because both mean real extra
 * hours, so they come back as notes for the estimator instead of a photo ask.
 */
const SURFACE_NOTES: Array<{ key: string; note: string; re: RegExp }> = [
  {
    key: "raw_timber",
    note: "raw MDF or bare timber mentioned — it needs priming before the topcoats",
    re: /\b(raw|bare|unpainted|unfinished|new)\s+(mdf|timber|wood|pine|trims?|skirtings?|doors?|architraves?)\b|\bmdf\b/i,
  },
  {
    key: "oil_to_water",
    note: "oil-based paint mentioned — a bonding primer is needed under water-based enamel",
    re: /\b(oil[- ]based|enamel(?:led)?|solvent[- ]based|gloss(?:y)? (?:trims?|paint))\b/i,
  },
];

export type ConditionRead = {
  /** Things worth a photo, in the order they were mentioned. */
  findings: ConditionFinding[];
  /** Things worth telling the estimator, that a photo would not settle. */
  notes: string[];
  /** True when they wrote something but nothing in it needs extra work. */
  readAndClear: boolean;
};

/** The shortest description worth reading. Below this it is not an answer. */
export const MIN_BRIEF = 12;

/**
 * Read a condition description.
 *
 * Never returns the same tag twice: somebody who mentions cracks in three
 * rooms is asked for a photo of the cracks, once. The room a spot belongs to
 * is settled on the room card, where the customer is already looking at rooms
 * — guessing it from prose would be inventing a location.
 */
export function readConditionBrief(text: string): ConditionRead {
  const clean = (text ?? "").trim();
  if (clean.length < MIN_BRIEF) return { findings: [], notes: [], readAndClear: false };

  const findings: ConditionFinding[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    const m = clean.match(p.re);
    if (!m || seen.has(p.tag)) continue;
    // Only tags the room card can actually offer — one vocabulary, always.
    if (!SPOT_TAGS.some((t) => t.key === p.tag)) continue;
    seen.add(p.tag);
    findings.push({ tag: p.tag, label: p.label, matched: m[0] });
  }

  const notes = SURFACE_NOTES.filter((n) => n.re.test(clean)).map((n) => n.note);
  return { findings, notes, readAndClear: findings.length === 0 && notes.length === 0 };
}

/**
 * What we say back.
 *
 * A photo ask, phrased as one — and never more than a couple of things at
 * once. A customer who wrote three sentences and gets back a list of six
 * photo requests has been punished for being helpful, which is the fastest way
 * to teach them to write nothing next time.
 */
export const MAX_PHOTO_ASKS = 2;

export function photoAsk(read: ConditionRead): string {
  if (read.findings.length === 0) return "";
  const asks = read.findings.slice(0, MAX_PHOTO_ASKS).map((f) => f.label);
  const list = asks.length === 1 ? asks[0] : `${asks[0]} and ${asks[1]}`;
  return `Thanks — that helps. Could you add a photo of ${list}? `
    + "With a photo we can price the repair now; without one we'll still note it and one of our people prices it.";
}
