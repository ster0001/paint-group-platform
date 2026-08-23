/**
 * The PC Dashboard console's logic — §6 of the brief.
 *
 * Everything the console shows is DERIVED here from rows the model already
 * holds. There is no console table, no "status" anybody types, and no number a
 * human keeps up to date. If a card is on the screen, something in the data put
 * it there; when the data changes, the card leaves by itself.
 */

export type Severity = "critical" | "warning" | "info";

export type QueueCard = {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  ref: string;
  workOrderId: string;
  /** Hours since the thing happened — drives ranking and the "27h" badge. */
  ageHours: number;
  /** Set on the SLA card: the offer Reoffer withdraws. */
  offerId?: string;
  action: { label: string; href?: string; tel?: string; kind: string };
};

export type ConsoleInput = {
  now: Date;
  workOrders: {
    id: string;
    woRef: string;
    stage: string;
    title: string;
    contractorName: string | null;
    contractValueCents: number;
    startDate: string | null;
    coloursConfirmed: boolean;
    blockedReason: string | null;
    /** When the customer accepted the estimate. Null on a job never accepted. */
    acceptedAt: string | null;
    /** False while the work order is still a draft — it can't be offered yet. */
    issued: boolean;
    /** The estimate behind it — issuing happens by opening the builder. */
    estimateId: string;
    ticksDone: number;
    ticksTotal: number;
  }[];
  offers: { id?: string; workOrderId: string; state: string; expiresAt: string; contractorName: string }[];
  variations: { id: string; workOrderId: string; status: string; createdAt: string; pricedAt: string | null }[];
  updates: { id: string; workOrderId: string; status: string; createdAt: string }[];
  signoffs: {
    workOrderId: string; evidencePackSentAt: string | null; signedAt: string | null;
    extensionRequestedAt: string | null; extensionApprovedAt: string | null;
  }[];
  quietSites: { workOrderId: string; at: string; days: number }[];
  /**
   * Completion-prep yeses the office has to act on (Tom, 23 Aug): rubbish for
   * collection, equipment for collection (with the painter's list). Gone from
   * here once "Organised" is pressed. Carries its own ref so it survives the
   * job closing — the skip still needs booking after the customer signs.
   */
  collections?: {
    itemId: string; workOrderId: string; kind: "rubbish" | "equipment";
    note: string; answeredAt: string; woRef: string; title: string; contractorName: string | null;
  }[];
  settings: { coloursWarnDays: number; variationCustomerSilentHours: number };
};

const hoursBetween = (from: string | Date, to: Date): number =>
  (to.getTime() - new Date(from).getTime()) / 3_600_000;

/**
 * The calendar date in Melbourne, which is NOT what toISOString() gives you.
 * Before 10am local, the UTC date is still yesterday — so a sparkline keyed on
 * toISOString().slice(0,10) silently plots every morning's work on the previous
 * day, and "days until the start date" comes out one short. This is the bug the
 * suite's TZ=Australia/Melbourne pin exists to catch, and it caught it.
 */
export const melbourneDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

/**
 * The UTC instant at which the Melbourne day began, as an ISO string.
 *
 * Not `${date}T00:00:00+10:00`: Melbourne is +11 from October to April, so a
 * hardcoded offset silently shifts the window by an hour for half the year —
 * which, for a "today's ticks" query run in the evening, quietly drops or
 * double-counts an hour of work. The offset is read from the zone instead.
 */
export function melbourneDayStartUtc(d: Date): string {
  const date = melbourneDate(d);
  // Midnight in Melbourne is midnight-UTC minus the zone's offset at that
  // moment. Measure the offset rather than writing one down: it changes twice a
  // year, and the second pass settles the hour where a DST switch falls between
  // the guess and the answer.
  let guess = Date.parse(`${date}T00:00:00Z`);
  for (let i = 0; i < 2; i++) guess = Date.parse(`${date}T00:00:00Z`) - zoneOffsetMs(new Date(guess));
  return new Date(guess).toISOString();
}

/** How far ahead of UTC Melbourne is at a given instant, in milliseconds. */
function zoneOffsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Melbourne", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const wallClockAsUtc = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
  return wallClockAsUtc - at.getTime();
}

/** Whole days from today (Melbourne) to a yyyy-mm-dd date. */
const daysUntil = (date: string, now: Date): number => {
  const asUtcMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  return Math.round((asUtcMidnight(date) - asUtcMidnight(melbourneDate(now))) / 86_400_000);
};

/**
 * One card per §6.1 trigger. Each is keyed so it can be matched across renders,
 * and each carries exactly one primary action — a console that offers three
 * things to do is a console nobody acts on.
 */
export function buildQueue(input: ConsoleInput): QueueCard[] {
  const { now, settings } = input;
  const byId = new Map(input.workOrders.map((w) => [w.id, w]));
  const cards: QueueCard[] = [];

  const label = (id: string) => {
    const w = byId.get(id);
    return w ? `${w.woRef} · ${w.title}` : id;
  };

  // 1. An offer nobody is coming to. Either still live and past its SLA, or
  // already flipped to expired/declined — the sweep does that within minutes of
  // the breach, and a job with a lapsed offer is exactly what needs a person.
  //
  // ONLY WHILE THE JOB IS STILL AT THE OFFER STAGE. A lapsed offer on a job
  // somebody has since accepted is history, not work. WO-2T625S4K sat at the
  // top of "Needs you now" for five days telling the office to chase TR
  // Painters and "release it to the next contractor" — while a different
  // contractor had already accepted it and was on site painting. The stage is
  // the reliable signal: acceptance moves a job to pre_start, and a booking
  // that later falls over moves it back, so `offered` means nobody is coming.
  //
  // One card per job, newest offer wins. A job that has been round the houses
  // carries several lapsed offers and needs chasing once, not once per attempt
  // — these cards all share a key, and nothing downstream de-duplicates them.
  const lapsedPerJob = new Map<string, ConsoleInput["offers"][number]>();
  for (const offer of input.offers) {
    const lapsed = offer.state === "expired" || offer.state === "declined";
    if (!lapsed && offer.state !== "offered" && offer.state !== "proposed") continue;
    if (!lapsed && hoursBetween(offer.expiresAt, now) <= 0) continue;
    const w = byId.get(offer.workOrderId);
    if (!w || w.stage !== "offered") continue;
    const seen = lapsedPerJob.get(offer.workOrderId);
    if (!seen || offer.expiresAt > seen.expiresAt) lapsedPerJob.set(offer.workOrderId, offer);
  }

  for (const offer of lapsedPerJob.values()) {
    const overdueBy = hoursBetween(offer.expiresAt, now);
    cards.push({
      key: `offer-sla:${offer.workOrderId}`,
      offerId: offer.id,
      severity: "critical",
      title: offer.state === "declined" ? "Offer declined — nobody on this job" : "Offer unanswered past SLA",
      detail: offer.state === "declined"
        ? `${offer.contractorName} turned it down. It needs offering to someone else.`
        : `${offer.contractorName} has had it ${Math.round(overdueBy + 24)} hours. Chase, or release it to the next contractor.`,
      ref: label(offer.workOrderId),
      workOrderId: offer.workOrderId,
      ageHours: overdueBy,
      action: { label: "Reoffer", kind: "reoffer", href: `/pc/wo/${offer.workOrderId}` },
    });
  }

  // 1b. Accepted, and nobody booked into it. The customer has said yes and is
  // waiting to hear a date, and every day of silence is a day they wonder
  // whether we forgot. Nothing else surfaced this: the offer cards above only
  // fire once an offer has been SENT and lapsed, so a job nobody ever offered
  // was invisible — it sat in the Unscheduled tray and only got worked if
  // somebody happened to scroll the board.
  //
  // Counted from the customer's acceptance, not from anything internal. A job
  // still waiting to be issued is included (Tom, 22 Aug) but asks for a
  // different action: open it once, rather than ring anyone.
  for (const w of input.workOrders) {
    if (w.stage !== "offered" || !w.acceptedAt) continue;
    // Somebody is already mid-conversation about this job — the offer cards
    // above own that case, and two cards for one job is nagging.
    const liveOffer = input.offers.some((o) =>
      o.workOrderId === w.id && (o.state === "offered" || o.state === "proposed"));
    if (liveOffer) continue;

    const waitingHours = hoursBetween(w.acceptedAt, now);
    const days = Math.floor(waitingHours / 24);
    // A day's grace: a job accepted this morning is not yet a failure.
    if (days < 1) continue;

    const since = days === 1 ? "yesterday" : `${days} days ago`;
    cards.push({
      key: `unbooked:${w.id}`,
      severity: days >= 3 ? "critical" : "warning",
      title: w.issued ? "Accepted, still not booked in" : "Accepted — work order not issued yet",
      detail: w.issued
        ? `They accepted ${since} and have not been given a date. Ring them and book it in.`
        : `They accepted ${since}. Open the job once to issue the work order, then it can be offered.`,
      ref: label(w.id),
      workOrderId: w.id,
      ageHours: waitingHours,
      action: w.issued
        ? { label: "Book it in", kind: "ring", href: `/pc/schedule` }
        // Opening the BUILDER is what issues a draft work order, and it is keyed
        // by estimate — the work-order id would 404 there.
        : { label: "Open it once", kind: "ring", href: `/quote?id=${w.estimateId}&view=workorder&from=/pc` },
    });
  }

  // 2. A site that has gone quiet for a few days. A REMINDER, not a blockage:
  // nobody expects a painter to tick daily, and a red card every morning is
  // just noise. Never an automated message to the customer either — a call.
  for (const flag of input.quietSites) {
    const w = byId.get(flag.workOrderId);
    if (!w) continue;
    cards.push({
      key: `quiet-site:${flag.workOrderId}`,
      severity: "warning",
      title: `Nothing ticked in ${flag.days} days`,
      detail: "No update has gone to the customer since then. Worth a quick call to see how it is going.",
      ref: label(flag.workOrderId),
      workOrderId: flag.workOrderId,
      ageHours: hoursBetween(flag.at, now),
      action: { label: "Call crew", kind: "call", href: `/pc/wo/${flag.workOrderId}` },
    });
  }

  for (const v of input.variations) {
    const w = byId.get(v.workOrderId);
    if (!w) continue;

    // 3. Raised, waiting on the office for a price.
    if (v.status === "raised") {
      cards.push({
        key: `variation-price:${v.id}`,
        severity: "warning",
        title: "Variation waiting on a price",
        detail: "The contractor has stopped on that part of the job until this is priced.",
        ref: label(v.workOrderId),
        workOrderId: v.workOrderId,
        ageHours: hoursBetween(v.createdAt, now),
        action: { label: "Price it", kind: "price", href: `/pc/wo/${v.workOrderId}#variation-${v.id}` },
      });
    }

    // 7. Priced, and the customer has gone quiet on it.
    if (v.status === "priced" && v.pricedAt) {
      const silentFor = hoursBetween(v.pricedAt, now);
      if (silentFor >= settings.variationCustomerSilentHours) {
        cards.push({
          key: `variation-silent:${v.id}`,
          severity: "warning",
          title: "Variation priced, customer silent",
          detail: `Sent ${Math.round(silentFor)} hours ago with no answer. The job is waiting on it.`,
          ref: label(v.workOrderId),
          workOrderId: v.workOrderId,
          ageHours: silentFor,
          action: { label: "Nudge customer", kind: "nudge", href: `/pc/wo/${v.workOrderId}` },
        });
      }
    }
  }

  // 4. Colours unconfirmed with the start date closing in.
  for (const w of input.workOrders) {
    if (w.coloursConfirmed || !w.startDate) continue;
    if (w.stage !== "pre_start" && w.stage !== "offered") continue;
    const days = daysUntil(w.startDate, now);
    if (days > settings.coloursWarnDays) continue;
    cards.push({
      key: `colours:${w.id}`,
      severity: "warning",
      title: days < 0 ? "Colours still unconfirmed — job has started" : "Colours unconfirmed",
      detail: days < 0
        ? "The paint order cannot go in until the schedule is signed."
        : `Starts in ${days} day${days === 1 ? "" : "s"}. The paint order cannot go in until the schedule is signed.`,
      ref: label(w.id),
      workOrderId: w.id,
      // Closer to the start date = older, so it ranks up.
      ageHours: (settings.coloursWarnDays - days) * 24,
      action: { label: "Open", kind: "open", href: `/pc/wo/${w.id}` },
    });
  }

  for (const s of input.signoffs) {
    if (s.signedAt || !s.evidencePackSentAt) continue;
    const w = byId.get(s.workOrderId);
    if (!w) continue;

    // 8. An extension the customer asked for and nobody has answered.
    if (s.extensionRequestedAt && !s.extensionApprovedAt) {
      cards.push({
        key: `extension:${s.workOrderId}`,
        severity: "warning",
        title: "Extension requested on sign-off",
        detail: "They have asked for more time. Approve it and the clock waits.",
        ref: label(s.workOrderId),
        workOrderId: s.workOrderId,
        ageHours: hoursBetween(s.extensionRequestedAt, now),
        action: { label: "Approve / decline", kind: "extension", href: `/pc/wo/${s.workOrderId}` },
      });
      continue;   // one card per job: the extension IS the sign-off question
    }

    // 5. The clock has run past the second nudge.
    const elapsed = hoursBetween(s.evidencePackSentAt, now);
    if (elapsed >= 48) {
      cards.push({
        key: `signoff-clock:${s.workOrderId}`,
        severity: "warning",
        title: "Sign-off clock at 48 hours",
        detail: "Second reminder sent, still nothing back. Worth a call.",
        ref: label(s.workOrderId),
        workOrderId: s.workOrderId,
        ageHours: elapsed,
        action: { label: "Ring them", kind: "ring", href: `/pc/wo/${s.workOrderId}` },
      });
    }
  }

  // 5b. Rubbish / equipment for collection — the painter said yes on the
  // finishing-up list; someone in the office books it and presses Organised.
  for (const c of input.collections ?? []) {
    const who = c.contractorName ? `${c.contractorName} says` : "The painter says";
    cards.push({
      key: `collect:${c.itemId}`,
      severity: "warning",
      title: c.kind === "rubbish" ? "Rubbish to collect" : "Equipment to collect",
      detail: c.kind === "rubbish"
        ? `${who} there's rubbish on site for collection — book the pickup.`
        : `${who} this needs collecting: ${c.note.trim() || "(no list given)"}`,
      ref: `${c.woRef} · ${c.title}`,
      workOrderId: c.workOrderId,
      ageHours: hoursBetween(c.answeredAt, now),
      action: { label: "Organised", kind: "collect", href: `/pc/wo/${c.workOrderId}` },
    });
  }

  // 6. Drafted updates, gathered into one card — they are reviewed together.
  const drafted = input.updates.filter((u) => u.status === "drafted");
  if (drafted.length > 0) {
    const oldest = drafted.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    cards.push({
      key: "updates-drafted",
      severity: "info",
      title: drafted.length === 1 ? "One customer update drafted" : `${drafted.length} customer updates drafted`,
      detail: "Written from today's ticks. Nothing reaches a customer until you approve it.",
      ref: [...new Set(drafted.map((u) => byId.get(u.workOrderId)?.woRef ?? ""))].filter(Boolean).join(" · "),
      workOrderId: drafted[0].workOrderId,
      ageHours: hoursBetween(oldest.createdAt, now),
      action: { label: "Review", kind: "review", href: "/pc/updates" },
    });
  }

  return rankQueue(cards);
}

/** §6.2 — critical oldest-first, then warning oldest-first, then info. */
export function rankQueue(cards: QueueCard[]): QueueCard[] {
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return [...cards].sort((a, b) =>
    order[a.severity] - order[b.severity] || b.ageHours - a.ageHours || a.key.localeCompare(b.key));
}

export type PulseTiles = {
  onTheBooksCents: number;
  openJobs: number;
  critical: number;
  waiting: number;
  signedOffThisWeek: number;
};

/** §6.3 — the four tiles, all from the same rows the queue used. */
export function pulseTiles(
  input: ConsoleInput,
  queue: QueueCard[],
  signedOffThisWeek: number,
): PulseTiles {
  const open = input.workOrders.filter((w) => w.stage !== "closed");
  return {
    onTheBooksCents: open.reduce((sum, w) => sum + w.contractValueCents, 0),
    openJobs: open.length,
    critical: queue.filter((c) => c.severity === "critical").length,
    waiting: queue.filter((c) => c.severity === "warning").length,
    signedOffThisWeek,
  };
}

/** The headline. Counts come from the same query as everything else. */
export function headline(tiles: PulseTiles): { top: string; bottom: string } {
  const jobs = tiles.openJobs;
  const needs = tiles.critical + tiles.waiting;
  const top = jobs === 0 ? "Nothing live right now." : `${jobs === 1 ? "One job" : `${jobs} jobs`} live.`;
  const bottom = needs === 0
    ? "Nothing needs you."
    : `${needs === 1 ? "One needs" : `${needs} need`} you before coffee.`;
  return { top, bottom };
}

/** Tick events per day for the sparkline, oldest first, 14 days. */
export function sparkline(ticksByDay: Record<string, number>, now: Date, days = 14): number[] {
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    out.push(ticksByDay[melbourneDate(d)] ?? 0);
  }
  return out;
}
