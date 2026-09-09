import type { CustomerPayload } from "./view";
import type { PaintSystemLine } from "./systems-view";
import type { SiteAccess } from "./site-access";

/**
 * THE FINISH LINE — estimator journey v2 §3, prototype screen 10.
 *
 * "The detailed range, the summary of everything they told us, and the fixing
 * options chosen by the policy ladder."
 *
 * Two things make this screen worth existing rather than being a button at
 * the bottom of the editor:
 *
 *   1. **It reads their answers back before they commit.** Every row here is
 *      something the price depends on, in their words, with a way to change
 *      it. A customer who accepts a number they cannot check is a complaint
 *      waiting to be made.
 *
 *   2. **It states what is NOT in the range.** Access equipment, structural
 *      repairs, anything nobody has seen. Said here, once, plainly — an
 *      exclusion a customer finds out about later is an argument.
 *
 * Pure: the caller has already priced and routed. Nothing here computes money
 * or decides a tier — it turns what the ladder already decided into sentences.
 */

/** One line of "what you've told us", and where to go and change it. */
export type SummaryRow = {
  key: string;
  /** The customer's own answer, read back. */
  text: string;
  /** The card in the editor that owns it — the "Change" link's target. */
  card: string;
};

export type FinishOption = {
  key: "fix_online" | "send_for_confirmation" | "book_visit";
  icon: string;
  title: string;
  body: string;
};

/**
 * The fixing options, chosen by the ladder — never re-derived here.
 *
 * `canAccept` is the SERVER's verdict (policy.ts), and the two shapes are
 * genuinely different offers: a job that qualifies can have its price fixed
 * on the spot, and one that does not is sent to a person. Both keep a visit
 * available, because §1's rule is that the two doors have no hierarchy.
 */
export function finishOptions(payload: CustomerPayload, fixedPriceText: string): FinishOption[] {
  if (payload.canAccept) {
    return [
      {
        key: "fix_online",
        icon: "✓",
        title: "Fix my price online",
        body: `Everything's confirmed and the job is within what we fix without a visit. Your price becomes ${fixedPriceText} inc. GST, held for 60 days. Nothing to pay now.`,
      },
      {
        key: "book_visit",
        icon: "☎",
        title: "Have a person check it first",
        body: "Happy either way. Send it over and we'll confirm it, or book a visit.",
      },
    ];
  }
  return [
    {
      key: "send_for_confirmation",
      icon: "✓",
      title: "Send for confirmation",
      body: "One of our estimators checks your rooms, systems and photos and fixes your price — usually by the next working day, and usually without a visit. If we do need to see it, we'll say so and offer times.",
    },
    {
      key: "book_visit",
      icon: "☎",
      title: "Book a site visit instead",
      body: "Prefer someone to walk it with you? Pick a time. We arrive with your answers already on the tablet.",
    },
  ];
}

/**
 * What is NOT in the range. Said on the screen where they decide, not in a
 * footer nobody reads — and the walk-the-job promise beside it, because the
 * honest version of an exclusion is "here is what protects you instead".
 */
export const NOT_INCLUDED =
  "Not in this range: access equipment hire, structural repairs, and anything we can't see yet. "
  + "Your painter walks the job with you on the last day — nothing is finished until you say so.";

export type SummaryInput = {
  payload: CustomerPayload;
  systems: PaintSystemLine[];
  access: SiteAccess;
  /** Whole-job extras the customer ticked, in their own words. */
  extras: string[];
  /** Flagged spots, as "a crack, a water mark, flaking". */
  spots: string[];
  /** Rooms with a confirmed size. */
  roomsConfirmed: number;
  roomsTotal: number;
};

/**
 * "What you've told us" — one row per thing the price depends on.
 *
 * Rows that would say nothing are LEFT OUT rather than shown empty. A summary
 * padded with "no extras" and "no spots flagged" teaches people to stop
 * reading it, and the whole value of this screen is that it gets read.
 */
export function summaryRows(input: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = [];

  if (input.roomsTotal > 0) {
    rows.push({
      key: "rooms",
      card: "rooms",
      text: input.roomsConfirmed >= input.roomsTotal
        ? `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"}, sizes confirmed`
        : `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"} — ${input.roomsTotal - input.roomsConfirmed} still to confirm`,
    });
  }

  if (input.systems.length > 0) {
    rows.push({
      key: "systems",
      card: "systems",
      // The painter's own summary, joined — "walls 2 coats · ceilings 1 coat ·
      // skirtings, architraves and door frames 2 coats (one an undercoat)".
      text: input.systems
        .map((s) => `${s.title.toLowerCase()} ${s.coats} ${s.coats === 1 ? "coat" : "coats"}${s.undercoat ? " (one an undercoat)" : ""}`)
        .join(" · "),
    });
  }

  if (input.spots.length > 0) {
    rows.push({
      key: "spots",
      card: "rooms",
      text: `${input.spots.length} ${input.spots.length === 1 ? "spot" : "spots"} flagged — ${listWords(input.spots)}`,
    });
  }

  const accessWords = accessSentence(input.access);
  if (accessWords) rows.push({ key: "access", card: "access", text: accessWords });

  if (input.extras.length > 0) {
    rows.push({ key: "extras", card: "extras", text: listWords(input.extras) });
  }

  return rows;
}

/** The access answers as one sentence, skipping anything not answered. */
function accessSentence(a: SiteAccess): string | null {
  const parts: string[] = [];
  if (a.cleared === "yes") parts.push("rooms cleared");
  else if (a.cleared === "some") parts.push("mostly cleared");
  else if (a.cleared === "no") parts.push("furniture stays");
  if (a.stairwell === "yes") parts.push("a stairwell or void");
  if (a.parking === "hard") parts.push("tricky parking");
  if (a.lift === "yes") parts.push("a lift booking");
  if (a.pets === "yes") parts.push("pets on site");
  return parts.length ? capitalise(parts.join(", ")) : null;
}

function listWords(items: string[]): string {
  const words = items.map((s) => s.toLowerCase());
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The three steps on the hand-off screen (§3, prototype screen 11).
 *
 * Concrete, in order, and counted from what this job actually carries — "8
 * rooms, 3 flagged spots and your photos" rather than a generic reassurance.
 * A customer who has just handed over their job wants to know what happens to
 * it, and vagueness there is what makes people ring to check.
 */
export function handoffSteps(input: {
  roomsTotal: number;
  spots: number;
  photos: number;
  turnaround: string;
}): Array<{ title: string; body: string }> {
  const carried = [
    input.roomsTotal > 0 ? `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"}` : null,
    input.spots > 0 ? `${input.spots} flagged ${input.spots === 1 ? "spot" : "spots"}` : null,
    input.photos > 0 ? `your ${input.photos === 1 ? "photo" : "photos"}` : null,
  ].filter(Boolean) as string[];

  return [
    {
      title: "We check what you've told us",
      body: `${carried.length ? `${capitalise(listWords(carried))}. ` : ""}Anything unclear, we'll message rather than guess.`,
    },
    {
      title: "We fix your price",
      body: `Usually ${input.turnaround}. It arrives by email, with everything itemised.`,
    },
    {
      title: "If we need a look in person, we'll say so",
      body: "Most jobs like this one don't. If yours does, pick a time below and we'll come out.",
    },
  ];
}

/** ⚑ Tom, decision 13: "confirm what you can hold to on a busy week." */
export const DEFAULT_TURNAROUND = "by the next working day";
