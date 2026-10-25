/**
 * The whole-job extras sheet — plan §4.5, prototype "Anything we haven't
 * listed".
 *
 * The gap this closes (plan §2.5): extras were never asked. "Anything else"
 * was flagged and never priced, so mould treatment, a ceiling rose, a stain
 * or varnish job and a colour consult all fell out of the estimate entirely.
 *
 * §4.5's rule, verbatim: **named extras price; unusual ones flag.** Those are
 * the only two outcomes here, and they are deliberately not the same control:
 *
 *   · A NAMED extra is a row on the rate card. It is offered because the card
 *     has it, priced at the card's own charge-out, and it lands in the
 *     "Interior - Extras" block. Nothing is hardcoded — add a row to the card
 *     tomorrow and it appears with no code change, exactly as the add panel
 *     works (lib/wizard/add-catalogue.ts). A row that is not on the card is
 *     offered NOWHERE: a tick that cannot price is a lie.
 *   · An UNUSUAL one is a sentence. It is recorded, flagged for the estimator
 *     and NEVER auto-priced — the same rule `addSideCustom` follows.
 *
 * This is a WHOLE-JOB sheet, which is what makes it different from the room
 * card's add panel: mould treatment and a colour consult belong to the job,
 * not to the third bedroom, and asking for them per room would ask four times.
 */

import type { AddOption } from "./add-catalogue";
import { interiorAddOptions } from "./add-catalogue";

/** A card row offered on the sheet. */
export type JobExtra = {
  code: string;
  label: string;
  group: string;
  /** What the customer pays, in whole dollars — the card's own charge-out. */
  priceDollars: number;
};

type LooseRateItem = {
  code: string | null; category: string | null; sub_category?: string | null;
  unit?: string | null; charge_out_cents?: number | null;
  rate_1_coat?: number | string | null; rate_2_coat?: number | string | null; rate_3_coat?: number | string | null;
  default_coats?: number | null;
};

/**
 * Tom, 25 Oct 2026 (item 15): rows a customer is not offered on the whole-job
 * sheet even though the card prices them. Picture rails are a per-metre trim an
 * estimator measures, not a thing a customer ticks.
 */
const NOT_ON_THE_SHEET = new Set(["Picture Rails"]);

/**
 * What ONE of this row costs, in cents — the charge-out times the hours the
 * card allows per item at its default coats. The sheet used to show the
 * charge-out itself ($95 beside a mantle that prices at 2.5 h), which is the
 * hourly rate, not a price (Tom, 25 Oct 2026, item 14). A per-metre row has no
 * per-item price and is not offered.
 */
export function perItemPriceCents(r: LooseRateItem): number {
  const cents = r.charge_out_cents ?? 0;
  if (cents <= 0) return 0;
  if ((r.unit ?? "Hours Per Item") !== "Hours Per Item") return 0;
  const coats = r.default_coats === 1 || r.default_coats === 3 ? r.default_coats : 2;
  const hours = Number(coats === 1 ? r.rate_1_coat : coats === 3 ? r.rate_3_coat : r.rate_2_coat);
  // A row with no hours (the fixture card, an un-timed row) is priced as one hour of its charge-out.
  return Math.round(cents * (Number.isFinite(hours) && hours > 0 ? hours : 1));
}

/**
 * The surfaces a ROOM owns. A whole-job sheet must not offer them again — the
 * customer sets walls and ceilings on the room card, and a second way in is a
 * second answer.
 */
const roomOwned = (o: AddOption) => o.via === "substrate";

/**
 * The extras on offer, derived from the live card.
 *
 * `interiorAddOptions` already decides what a customer may add and what
 * another control owns (cabinetry, allowances, style variants). This reuses
 * that judgement rather than restating it, and keeps only the code-based rows
 * — the whole-job items — with a price attached.
 *
 * A row with no charge-out is dropped: it cannot be presented as a price.
 */
export function jobExtras(rateItems: ReadonlyArray<LooseRateItem>): JobExtra[] {
  const byCode = new Map(rateItems.filter((r) => r.code).map((r) => [r.code as string, r]));
  return interiorAddOptions(rateItems)
    .filter((o) => !roomOwned(o) && !NOT_ON_THE_SHEET.has(o.key))
    .map((o) => {
      const row = byCode.get(o.key);
      const cents = row ? perItemPriceCents(row) : 0;
      return { code: o.key, label: o.label, group: o.group, priceDollars: Math.round(cents / 100) };
    })
    .filter((e) => e.priceDollars > 0);
}

/**
 * §4.5's fourth extra — "help choosing colours" — is not a rate row and never
 * was. It already has a home: `paint.colourHelp = "advice"`, which the CRM
 * reads to raise a colour-advice follow-up (1 Sep). The sheet offers it as a
 * tick so the customer can ask for it here too; it prices nothing.
 */
export const COLOUR_HELP_LABEL = "Help me choose the colours";

/** The maximum an "anything else" note may run to before it is a phone call. */
export const EXTRA_NOTE_MAX = 400;

/**
 * An unusual extra: recorded, flagged, never priced.
 *
 * Returned rather than applied, so the caller decides where it lands — and so
 * the rule that it does NOT become a priced line is visible here rather than
 * buried in a route.
 */
export function extraNoteDeferral(note: string): { what: string; needs: string } | null {
  const text = note.trim().slice(0, EXTRA_NOTE_MAX);
  if (text === "") return null;
  return {
    what: "an extra the customer asked for",
    needs: `not on our card, so it is NOT priced: "${text}" — price it by hand, or say it is out of scope, before this estimate is sent`,
  };
}
