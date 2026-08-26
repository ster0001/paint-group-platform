/**
 * 3a-4 · The Project Timeline: one vertical feed per job, built entirely
 * from what the WO loop already captures. Pure over its inputs; the server
 * component supplies rows and signs photo URLs separately.
 *
 * Standing rulings honoured here:
 *  - QA is OURS (Tom, 23 Aug): a PASSED check renders as a friendly
 *    milestone with no workings and no photos; a FAILED check never renders
 *    at all — rectification is invisible, the job simply reads in progress.
 *  - Updates render only once SENT (PC-approved). Draft text never leaks.
 *  - Declined variations are recorded, never deleted — they render kindly.
 *  - Customer-level words only: Not started / Being prepped / First coat /
 *    Done ✓. No internal stage names, no acronyms.
 */

export type ChipCls = "cyan" | "amber" | "emerald" | "clay" | "mut";

export type TimelineSurface = { heading: string; label: string; state: "todo" | "prepped" | "done"; sort: number };

export type TimelinePhotoRow = { id: string; kind: string; area: string; caption: string; created_at: string };

export type TimelineUpdate = { for_date: string; text: string; sent_at: string };

export type TimelineVariation = {
  id: string;
  status: string;
  category: string;
  comment: string;
  price_cents: number | null;
  customer_token: string | null;
  customer_responded_at: string | null;
  created_at: string;
};

export type TimelineInput = {
  surfaces: TimelineSurface[];
  updates: TimelineUpdate[]; // SENT only — the caller filters
  photos: TimelinePhotoRow[]; // before/progress/completion only — caller filters qa + variation out
  variations: TimelineVariation[];
  underwayAt: string | null; // first stage_changed → in_progress
  readyAt: string | null; // stage_changed → walkthrough
  qaPassedAt: string | null;
  walkthroughFor: string | null; // yyyy-mm-dd
  signedAt: string | null;
  depositPaidOn: string | null; // yyyy-mm-dd
  depositCents: number | null;
  todayYmd: string;
};

export type TimelineItem = {
  key: string;
  at: string; // ISO — sort key
  dayYmd: string;
  live: boolean;
  title: string;
  body: string;
  chip: { cls: ChipCls; label: string } | null;
  photoIds: string[];
  cta: { label: string; href: string } | null;
  amountCents: number | null;
};

export type AreaRollup = { heading: string; chip: { cls: ChipCls; label: string } };

const VARIATION_CATEGORY: Record<string, string> = {
  rot: "Timber repair",
  damage: "Damage repair",
  extra_scope: "Extra work",
  customer_request: "Something you asked for",
};

export function melbourneDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

/** Friendly day heading: "Today · Friday 21 August" / "Friday 21 August".
 * The calendar date is formatted as itself in UTC — no Melbourne offset is
 * ever written down (the CLAUDE.md date rule). */
export function dayHeading(dayYmd: string, todayYmd: string): string {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  return dayYmd === todayYmd ? `Today · ${label}` : label;
}

/** A sortable ISO anchor inside a Melbourne calendar day: noon UTC of that
 * date is 22:00–23:00 the SAME day in Melbourne, whatever the season. */
function dayAnchor(ymd: string): string {
  return `${ymd}T12:00:00Z`;
}

export function areaRollups(surfaces: readonly TimelineSurface[]): AreaRollup[] {
  const headings = [...new Set([...surfaces].sort((a, b) => a.sort - b.sort).map((s) => s.heading))];
  return headings.map((heading) => {
    const group = surfaces.filter((s) => s.heading === heading);
    const done = group.filter((s) => s.state === "done").length;
    const prepped = group.filter((s) => s.state === "prepped").length;
    let chip: AreaRollup["chip"];
    if (done === group.length && group.length > 0) chip = { cls: "emerald", label: "Done ✓" };
    else if (done > 0) chip = { cls: "cyan", label: "First coat" };
    else if (prepped > 0) chip = { cls: "amber", label: "Being prepped" };
    else chip = { cls: "mut", label: "Not started" };
    return { heading, chip };
  });
}

function moneyFmt(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  const push = (i: Omit<TimelineItem, "dayYmd" | "live">) =>
    items.push({ ...i, dayYmd: melbourneDayOf(i.at), live: melbourneDayOf(i.at) === input.todayYmd });

  for (const u of input.updates) {
    push({
      key: `update:${u.for_date}`,
      at: u.sent_at,
      title: "From your painting team",
      body: u.text,
      chip: null,
      photoIds: [],
      cta: null,
      amountCents: null,
    });
  }

  if (input.underwayAt) {
    push({
      key: "underway",
      at: input.underwayAt,
      title: "We're underway",
      body: "Drop sheets down, furniture covered — and before anything else, every area photographed, so you and we both have a record of how things started.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
  }

  if (input.qaPassedAt) {
    push({
      key: "qa-pass",
      at: input.qaPassedAt,
      title: "Quality check passed",
      body: "Your project coordinator checked the work against our standards before it went any further.",
      chip: { cls: "emerald", label: "Quality check passed" },
      photoIds: [], cta: null, amountCents: null,
    });
  }

  if (input.walkthroughFor) {
    push({
      key: "walkthrough-booked",
      at: dayAnchor(input.walkthroughFor),
      title: "Your walkthrough is booked",
      body: "You'll walk the job with your painter, look at every area, and nothing is finished until you're happy with it.",
      chip: null, photoIds: [], cta: null, amountCents: null,
    });
  }

  if (input.readyAt) {
    push({
      key: "ready",
      at: input.readyAt,
      title: "Ready for your look around",
      body: "The painting is done and checked. Time for you to see it.",
      chip: { cls: "cyan", label: "Ready for your walkthrough" },
      photoIds: [], cta: null, amountCents: null,
    });
  }

  if (input.signedAt) {
    push({
      key: "signed",
      at: input.signedAt,
      title: "Signed off — thank you",
      body: "Your records stay here for good — the photos, your colours, your warranty.",
      chip: { cls: "emerald", label: "Complete" },
      photoIds: [], cta: null, amountCents: null,
    });
  }

  if (input.depositPaidOn) {
    push({
      key: "deposit",
      at: dayAnchor(input.depositPaidOn),
      title: "Deposit received — you're booked",
      body: "Thank you. Your receipt is saved under Money.",
      chip: null, photoIds: [], cta: null,
      amountCents: input.depositCents,
    });
  }

  for (const v of input.variations) {
    const what = VARIATION_CATEGORY[v.category] ?? "Extra work";
    const priced = v.price_cents != null ? ` — ${moneyFmt(v.price_cents)} inc GST` : "";
    if (v.status === "priced" && v.customer_token && !v.customer_responded_at) {
      push({
        key: `variation:${v.id}`,
        at: v.created_at,
        title: "Something needs your say-so",
        body: `${what}${v.comment ? `: ${v.comment}` : ""}${priced}. Nothing extra ever happens without your written OK.`,
        chip: { cls: "amber", label: "Waiting on you" },
        photoIds: [],
        cta: { label: "Review & approve", href: `/v/${v.customer_token}` },
        amountCents: null,
      });
    } else if (v.status === "raised") {
      push({
        key: `variation:${v.id}`,
        at: v.created_at,
        title: "We spotted something",
        body: `${what}${v.comment ? `: ${v.comment}` : ""}. We're putting a price on it now — nothing happens without your OK.`,
        chip: { cls: "amber", label: "Being priced" },
        photoIds: [], cta: null, amountCents: null,
      });
    } else if (v.status === "customer_approved" || v.status === "contractor_accepted") {
      push({
        key: `variation:${v.id}`,
        at: v.customer_responded_at ?? v.created_at,
        title: "You approved an extra",
        body: `${what}${v.comment ? `: ${v.comment}` : ""}${priced}. Approved in writing — it's on your record.`,
        chip: { cls: "emerald", label: "Approved" },
        photoIds: [], cta: null, amountCents: null,
      });
    } else if (v.status === "declined") {
      push({
        key: `variation:${v.id}`,
        at: v.customer_responded_at ?? v.created_at,
        title: "You said no thanks",
        body: `${what}${v.comment ? `: ${v.comment}` : ""}. Recorded and left exactly as you decided.`,
        chip: { cls: "mut", label: "Declined" },
        photoIds: [], cta: null, amountCents: null,
      });
    }
  }

  // Photos attach to their day's leading card — an update first, then a
  // milestone — and only days with no card at all get a plain photo card.
  const byDay = new Map<string, TimelineItem[]>();
  for (const item of items) {
    byDay.set(item.dayYmd, [...(byDay.get(item.dayYmd) ?? []), item]);
  }
  const photoDays = new Map<string, TimelinePhotoRow[]>();
  for (const p of input.photos) {
    const day = melbourneDayOf(p.created_at);
    photoDays.set(day, [...(photoDays.get(day) ?? []), p]);
  }
  for (const [day, photos] of photoDays) {
    const dayItems = byDay.get(day);
    const host =
      dayItems?.find((i) => i.key.startsWith("update:")) ??
      dayItems?.find((i) => !i.key.startsWith("variation:"));
    const ids = photos.map((p) => p.id);
    if (host) {
      host.photoIds = [...host.photoIds, ...ids];
    } else {
      const isBefore = photos.every((p) => p.kind === "before");
      const at = photos.map((p) => p.created_at).sort()[0];
      push({
        key: `photos:${day}`,
        at,
        title: isBefore ? "Before photos — how it started" : "Photos from the site",
        body: isBefore
          ? "A record of every area before the first coat of anything."
          : "Fresh from your painter's phone.",
        chip: null, photoIds: ids, cta: null, amountCents: null,
      });
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}
