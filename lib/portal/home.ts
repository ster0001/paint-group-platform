/**
 * 3a-2 · The state-aware Home: one headline, one primary action, derived
 * from the job state machine (experience map §4-A3). Pure over its inputs so
 * the precedence order is unit-tested; the server component supplies data.
 *
 * Copy rules: plain words, English tone, phrased as the customer would say
 * it. Never a dead end — every state has a next step.
 */

export type PortalEstimate = {
  id: string;
  title: string | null;
  status: string; // draft | sent | accepted | declined | ...
  source: string | null;
  total_cents: number | null;
  share_token: string | null;
  sent_at: string | null;
  created_at: string;
};

export type PortalWorkOrder = {
  estimate_id: string;
  stage: string; // offered | pre_start | in_progress | qa | completion_prep | walkthrough | closed
  start_date: string | null; // yyyy-mm-dd
  end_date: string | null;
};

export type HomeState = {
  key:
    | "walkthrough"
    | "underway"
    | "booked"
    | "finished"
    | "estimate_ready"
    | "estimate_saved"
    | "welcome";
  headline: string;
  sub: string;
  chip: string | null;
  cta: { label: string; href: string };
  /** The estimate this state is about, when there is one. */
  estimateId: string | null;
};

const ACTIVE_STAGES = new Set(["in_progress", "qa", "completion_prep"]);
const BOOKED_STAGES = new Set(["offered", "pre_start"]);

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

/** "Day 3 of 6" from booking dates — dates are yyyy-mm-dd strings in
 * Melbourne terms (the caller formats today with an Intl formatter pinned to
 * Australia/Melbourne; never toISOString — the CLAUDE.md date rule). */
export function dayOfJob(start: string | null, end: string | null, todayYmd: string): string | null {
  if (!start || !end || start > todayYmd || end < start) return null;
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const day = Math.floor((d(todayYmd) - d(start)) / 86_400_000) + 1;
  const total = Math.floor((d(end) - d(start)) / 86_400_000) + 1;
  if (day > total) return null;
  return `Day ${day} of ${total}`;
}

function about(title: string | null): string {
  return title && title.trim() && !/^untitled/i.test(title) ? ` at ${title.trim()}` : "";
}

export function homeState(
  estimates: PortalEstimate[],
  workOrders: PortalWorkOrder[],
  todayYmd: string,
  phone: string,
): HomeState {
  const byEstimate = new Map(estimates.map((e) => [e.id, e]));
  const wo = (stages: Set<string> | string[]) => {
    const wanted = Array.isArray(stages) ? new Set(stages) : stages;
    return workOrders.find((w) => wanted.has(w.stage) && byEstimate.has(w.estimate_id)) ?? null;
  };
  // With no phone configured a tel: link would be a dead end — the Messages
  // tab explains how to reach us instead.
  const call = phone.trim()
    ? { label: "Ring us — we'll talk it through", href: `tel:${phone.replace(/\s+/g, "")}` }
    : { label: "Get in touch", href: "/account/messages" };

  const atWalkthrough = wo(["walkthrough"]);
  if (atWalkthrough) {
    const e = byEstimate.get(atWalkthrough.estimate_id)!;
    return {
      key: "walkthrough",
      headline: `Your painting${about(e.title)} is finished`,
      sub: "Time for a look around. Walk through with your painter, check every area, and sign off when you're happy — nothing is done until you say so.",
      chip: "Ready for your walkthrough",
      cta: { label: "See my project", href: "/account/project" },
      estimateId: e.id,
    };
  }

  const active = wo(ACTIVE_STAGES);
  if (active) {
    const e = byEstimate.get(active.estimate_id)!;
    return {
      key: "underway",
      headline: `Your painting is underway${about(e.title)}`,
      sub: "Follow it day by day — photos and progress land here as the work happens.",
      chip: dayOfJob(active.start_date, active.end_date, todayYmd),
      cta: { label: "See my project", href: "/account/project" },
      estimateId: e.id,
    };
  }

  const booked = wo(BOOKED_STAGES);
  const accepted = estimates.find((e) => e.status === "accepted");
  if (booked || accepted) {
    const e = booked ? byEstimate.get(booked.estimate_id)! : accepted!;
    const closed = !booked && workOrders.some((w) => w.estimate_id === e.id && w.stage === "closed");
    if (closed) {
      return {
        key: "finished",
        headline: `All finished${about(e.title)}`,
        sub: "Your records are safe here for good — photos, invoices and every colour on your walls.",
        chip: null,
        cta: { label: "See my project", href: "/account/project" },
        estimateId: e.id,
      };
    }
    return {
      key: "booked",
      headline: "You're booked — here's what happens next",
      sub: "We'll confirm your colours, get everything ready, and your painter will be in touch before the first day.",
      chip: booked?.start_date && booked.start_date >= todayYmd ? `Starting ${booked.start_date}` : null,
      cta: { label: "See what happens next", href: "/account/project" },
      estimateId: e.id,
    };
  }

  const sent = estimates.find((e) => e.status === "sent" && e.share_token);
  if (sent) {
    return {
      key: "estimate_ready",
      headline: `Your estimate is ready${sent.total_cents ? ` — ${money(sent.total_cents)} inc GST` : ""}`,
      sub: "Take your time with it. Any questions at all, we're a phone call away.",
      chip: null,
      cta: { label: "See my estimate", href: `/e/${sent.share_token}` },
      estimateId: sent.id,
    };
  }

  const draft = estimates.find((e) => e.status === "draft");
  if (draft) {
    return {
      key: "estimate_saved",
      headline: "Your estimate is saved",
      sub: "We're checking it over and we'll be in touch. It stays right here whenever you want to talk it through.",
      chip: null,
      cta: call,
      estimateId: draft.id,
    };
  }

  return {
    key: "welcome",
    headline: "Welcome — let's get you a price",
    sub: "Answer a few questions about your home and see your estimate in minutes.",
    chip: null,
    cta: { label: "Get an estimate", href: "/estimate" },
    estimateId: null,
  };
}
