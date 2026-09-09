/**
 * The remote-confirmation pack — estimator journey v2 §5, ⚑7.
 *
 * "The console shows the confirmed tree, the flagged spots with photos, the
 * derived systems and the access answers; the estimator either fixes the
 * price and sends it, asks a question in-thread, or books a visit. This is how
 * jobs get quoted without being looked at."
 *
 * The point of this module is that it INVENTS NOTHING and DUPLICATES NOTHING.
 * Every part of the pack already exists somewhere in the estimate — this
 * assembles them into the one view a person needs to decide, in the order
 * they decide in:
 *
 *   1. Can I fix this from here at all?      (⚑7's verdict)
 *   2. What did they actually confirm?       (the tree)
 *   3. What did they tell me is wrong?       (the spots, with photos)
 *   4. What have we assumed on their behalf? (the derived systems)
 *   5. What will make it slower?             (the access answers)
 *   6. What is still open?                   (the deferrals)
 *
 * If a person cannot answer "fix it, ask, or visit" from this, the pack is
 * missing something — not the estimator.
 */

import { remoteConfirmVerdict, type RemoteConfirmVerdict, type WizardPolicySettings } from "./policy";
import { paintSystemsView, type PaintSystemLine } from "./systems-view";
import { customerRoomView, type CustomerScopeRoom } from "./scope-editor";
import { SITE_ACCESS_RULES, type SiteAccess } from "./site-access";
import { ROOM_CONDITION_LABEL } from "./spots";
import type { PaintSystems } from "@/lib/pricing/systems";
import type { ScopeRule } from "@/lib/extract/scope";
import type { WizardDeferred } from "./view";
import type { WizardState } from "./state";

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string;
  surfaces?: Array<Record<string, unknown>>;
};

/** One room, as the estimator reads it: what is painted, and what is wrong. */
export type DeskCheckRoom = {
  areaId: number;
  name: string;
  m2: number | null;
  /** The surfaces actually ON, in the customer's words. */
  painting: string[];
  /** "Better than the rest" / "Worse than the rest"; absent when the same. */
  condition: string | null;
  spots: CustomerScopeRoom["spots"];
};

export type DeskCheckPack = {
  /** ⚑7 — may this be fixed without a visit? */
  verdict: RemoteConfirmVerdict;
  totalCents: number;
  hasExterior: boolean;
  rooms: DeskCheckRoom[];
  /** Every repair across the job, so nothing hides inside a collapsed room. */
  spotCount: number;
  /** How many of those a person still has to price (⚑6 sent them here). */
  spotsToPrice: number;
  systems: PaintSystemLine[];
  /** The access answers that cost time, already in words. */
  access: string[];
  /** Everything still open on the estimate — the review gate's own list. */
  open: WizardDeferred[];
  /** True when nothing is open and the verdict is eligible: fix and send. */
  clean: boolean;
};

const isInteriorArea = (b: LooseBlock) => b.kind === "area" && b.type !== "Exterior";

/**
 * Assemble the pack. Pure: blocks and answers in, a decision aid out. No
 * database, no clock, no rate card — the total is passed in because pricing
 * is the engine's job and this must never become a second opinion about money.
 */
export function deskCheckPack(
  blocks: readonly LooseBlock[],
  state: Pick<WizardState, "condition" | "details" | "paint">,
  opts: {
    totalCents: number;
    rules: ScopeRule[];
    deferred: WizardDeferred[];
    policy: WizardPolicySettings;
    systems?: PaintSystems;
  },
): DeskCheckPack {
  const hasExterior = blocks.some((b) => b.kind === "area" && b.type === "Exterior");
  const verdict = remoteConfirmVerdict(opts.totalCents, hasExterior, opts.policy);

  const rooms: DeskCheckRoom[] = [];
  for (const b of blocks) {
    if (!isInteriorArea(b)) continue;
    const view = customerRoomView(b, opts.rules);
    rooms.push({
      areaId: view.areaId,
      name: view.name,
      m2: view.m2,
      painting: view.tiles.filter((t) => t.on).map((t) => (t.count ? `${t.label} ×${t.count}` : t.label)),
      // "Same as the rest" is the default and says nothing — only a room the
      // customer called out is worth the estimator's eye.
      condition: view.condition === "same" ? null : ROOM_CONDITION_LABEL[view.condition],
      spots: view.spots,
    });
  }

  const allSpots = rooms.flatMap((r) => r.spots);
  const access: string[] = [];
  const answers = (state.details as { siteAccess?: SiteAccess }).siteAccess ?? {};
  for (const [field, value] of Object.entries(answers)) {
    const rule = SITE_ACCESS_RULES[`${field}:${value}`];
    if (rule) access.push(rule.needs);
  }
  if (answers.pets === "yes") access.push("pets on site");

  return {
    verdict,
    totalCents: opts.totalCents,
    hasExterior,
    rooms,
    spotCount: allSpots.length,
    spotsToPrice: allSpots.filter((s) => s.prepHr <= 0).length,
    systems: paintSystemsView(state, blocks, opts.systems),
    access,
    open: opts.deferred,
    // "Clean" is deliberately strict: an open deferral means somebody wrote
    // down that they did not know something. Fixing a price over the top of
    // that is exactly the failure remote confirmation would be blamed for.
    clean: verdict.eligible && opts.deferred.length === 0,
  };
}

/** The three outcomes §5 names, and when each is the obvious one. */
export const DESK_CHECK_OUTCOMES = ["fix", "ask", "visit"] as const;
export type DeskCheckOutcome = (typeof DESK_CHECK_OUTCOMES)[number];

/**
 * What the pack RECOMMENDS. Advisory only — the estimator picks, always. A
 * recommendation that could not be overridden would be self-serve wearing a
 * person's name.
 */
export function recommendedOutcome(pack: DeskCheckPack): DeskCheckOutcome {
  if (!pack.verdict.eligible) return "visit";
  if (pack.open.length > 0 || pack.spotsToPrice > 0) return "ask";
  return "fix";
}
