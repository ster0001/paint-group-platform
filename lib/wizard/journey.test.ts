import { describe, it, expect } from "vitest";
import { bucketFor, bucketPill, journeyFromRow, journeyLine, journeySteps, pageLabel, WIZARD_OUTCOMES } from "./journey";

const now = new Date("2026-09-06T03:00:00Z");
const mins = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("bucketFor — brief §4, every combination of completed × outcome × idle", () => {
  const cases: Array<[boolean, (typeof WIZARD_OUTCOMES)[number], number, string]> = [];
  for (const completed of [false, true]) {
    for (const outcome of WIZARD_OUTCOMES) {
      for (const idle of [0, 44, 46, 600]) {
        let want: string;
        if (outcome === "call_requested") want = "ready_call";
        else if (outcome === "visit_requested") want = "ready_visit";
        else if (outcome === "question_asked" || outcome === "help_requested") want = "needs_help";
        else if (idle > 45) want = completed ? "priced_no_request" : "dropped";
        else want = "online_now";
        cases.push([completed, outcome, idle, want]);
      }
    }
  }
  it.each(cases)("completed=%s outcome=%s idle=%smin → %s", (completed, outcome, idle, want) => {
    expect(bucketFor({ completed, outcome, lastActiveAt: mins(idle), now })).toBe(want);
  });
  it("never seen = idle forever", () => {
    expect(bucketFor({ completed: false, outcome: "none", lastActiveAt: null, now })).toBe("dropped");
  });
});

describe("wording", () => {
  it("pages are named per job type; the dropped pill carries the page", () => {
    expect(pageLabel("interior", 2)).toBe("The place");   // the quick look, v2 phase 2
    expect(pageLabel("both", 3)).toBe("The job");
    expect(pageLabel("exterior", 2)).toBe("House");
    expect(bucketPill("dropped", "interior", 3)).toEqual({ label: "Dropped · The job", tone: "clay" });
    expect(bucketPill("ready_visit", null, 6).label).toBe("Ready · visit");
    expect(bucketPill("online_now", null, 1).label).toBe("Online now"); // never "In progress"
  });
  it("the mono line reads 'x of y · time · last active'", () => {
    expect(journeyLine({ furthestPage: 3, pagesTotal: 6, activeSeconds: 540, lastActiveAt: mins(120) }, now)).toBe("3 of 6 · 9 min · last active 2h ago");
    expect(journeyLine({ furthestPage: 1, pagesTotal: 6, activeSeconds: 30, lastActiveAt: mins(0) }, now)).toBe("1 of 6 · <1 min · last active just now");
  });
  it("a pre-migration row still reads, and the steps sum to the seconds", () => {
    const j = journeyFromRow({ id: "d1", job_type: "interior", step_times: { "1": 30, "2": 90, junk: "x" }, furthest_page: 2, active_seconds: 120 });
    expect(j.bucket).toBe("online_now");
    expect(j.outcome).toBe("none");
    const steps = journeySteps(j);
    expect(steps.length).toBe(6);
    expect(steps.reduce((s, x) => s + x.seconds, 0)).toBe(j.activeSeconds);
    expect(steps[1]).toMatchObject({ label: "The place", seconds: 90, reached: true });
    expect(steps[2].reached).toBe(false);
  });
});

// ---- C7b: the extended pill vocabulary — every state, derived ----------------

import { daysUntil, estimateAction, estimatePill, estimateValue, type EstimatePillInput, type EstimateRequestView } from "./journey";
import { rangeFromTotal } from "./policy";

const NOW = new Date("2026-09-12T02:00:00Z"); // 12:00 Melbourne (AEST)
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const wiz = (over: Partial<ReturnType<typeof journeyFromRow>> = {}) => ({
  ...journeyFromRow({ id: "w1", estimate_id: "e1", bucket: "priced_no_request", job_type: "interior", furthest_page: 4, pages_total: 4, active_seconds: 60, last_seen_at: ago(0) }),
  ...over,
});
const req = (over: Partial<EstimateRequestView> = {}): EstimateRequestView => ({
  kind: "remote", status: "requested", requestedAt: new Date(NOW.getTime() - 41 * 60_000).toISOString(),
  suggestedAction: "fix", fixedPriceCents: null, ...over,
});
const base = (over: Partial<EstimatePillInput> = {}): EstimatePillInput => ({
  status: "draft", acceptedAt: null, viewedAt: null, views: { count: 0, lastAt: null }, validUntil: null,
  hasWorkOrder: false, request: null, wizard: null, loop: null, photos: 0, bandPct: null, brief: false, now: NOW,
  ...over,
});

describe("estimatePill — brief 2.2: every state derived, none stored", () => {
  const table: Array<[string, EstimatePillInput, string, string | null]> = [
    ["accepted with a work order", base({ status: "accepted", acceptedAt: "2026-09-08T01:00:00Z", hasWorkOrder: true }), "Accepted 08/09 · job created", null],
    ["accepted, no work order yet", base({ status: "accepted", acceptedAt: "2026-09-08T01:00:00Z" }), "Accepted 08/09", "no job yet"],
    ["sent · confirm remotely, with the mono line", base({ request: req(), loop: { confirmed: 9, total: 9, unit: "rooms" }, photos: 7, bandPct: 4 }), "Sent · confirm remotely", "9 of 9 · ±4% · 7 photos · 41m ago"],
    ["sent · needs a visit, sides", base({ request: req({ kind: "visit", suggestedAction: "visit" }), loop: { confirmed: 3, total: 4, unit: "sides" }, photos: 9, bandPct: 11 }), "Sent · needs a visit", "3 of 4 sides · ±11% · 9 photos · 41m ago"],
    ["question unanswered counts days", base({ request: req({ status: "question_asked", requestedAt: new Date(NOW.getTime() - 2.4 * 86_400_000).toISOString() }), photos: 1 }), "Question unanswered · 2d", "1 photo · 2d ago"],
    ["viewed, fixed, no reply — the hold", base({ status: "sent", viewedAt: ago(300), views: { count: 4, lastAt: ago(120) }, validUntil: "2026-09-26", request: req({ status: "fixed", fixedPriceCents: 2_460_000 }) }), "Viewed 4× · no reply", "last opened 2h ago · hold ends in 14d"],
    ["viewed, not fixed — it expires rather than holds", base({ status: "sent", viewedAt: ago(30), views: { count: 0, lastAt: null }, validUntil: "2026-09-26" }), "Viewed 1× · no reply", "last opened 30m ago · expires in 14d"],
    ["abandoned mid-loop: the room they stopped on", base({ wizard: wiz({ email: null, phone: null, lastActiveAt: ago(60 * 24) }), loop: { confirmed: 1, total: 6, unit: "rooms" } }), "Abandoned · room 2 of 6", "no contact details · last active 24h ago"],
    ["priced, loop finished, no request — the existing pill stays", base({ wizard: wiz({ lastActiveAt: ago(60 * 24) }), loop: { confirmed: 4, total: 4, unit: "rooms" } }), "Priced · no request", "4 of 4 · 1 min · last active 24h ago"],
    ["brief · book a visit (C14 switches it on)", base({ brief: true, photos: 11 }), "Brief · book a visit", "11 photos"],
    ["in-house draft: nothing to say", base(), "—", null],
  ];
  it.each(table)("%s", (_name, input, label, sub) => {
    const p = estimatePill(input);
    expect(p.label).toBe(label);
    expect(p.sub).toBe(sub);
  });

  it("waiting on us outranks waiting on them: an open request beats 'viewed · no reply'", () => {
    const p = estimatePill(base({ status: "sent", viewedAt: ago(10), views: { count: 2, lastAt: ago(10) }, request: req() }));
    expect(p.state).toBe("sent_remote");
  });
  it("a fix online is a fixed price, not an open request", () => {
    const p = estimatePill(base({ status: "sent", request: req({ kind: "fix_online", status: "fixed", fixedPriceCents: 900_000 }), wizard: wiz() }));
    expect(p.state).toBe("wizard"); // unviewed → the wizard bucket pill it always had
  });
  it("a loop the row did not read never prints '0 of 0'", () => {
    expect(estimatePill(base({ request: req(), loop: null, bandPct: 4 })).sub).toBe("±4% · 41m ago");
  });
  it("daysUntil counts Melbourne's calendar day", () => {
    expect(daysUntil("2026-09-13", NOW)).toBe(1);
    expect(daysUntil("2026-09-12", NOW)).toBe(0);
  });
});

describe("estimateAction — ⚑39: one action, or nothing", () => {
  const ids = { estimateId: "e1", accountId: "a1", workOrderId: "wo1" };
  it.each([
    ["accepted", null, "Open job", "/pc/wo/wo1"],
    ["question", req({ status: "question_asked" }), "Chase", "/crm/customers/a1"],
    ["sent_visit", req({ kind: "visit" }), "Book", "/quote?id=e1&tab=pack"],
    ["sent_remote", req({ suggestedAction: "fix" }), "Fix price", "/quote?id=e1&tab=pack"],
    ["sent_remote", req({ suggestedAction: "visit" }), "Book", "/quote?id=e1&tab=pack"],
    ["sent_remote", req({ suggestedAction: "ask" }), "Chase", "/crm/customers/a1"],
    ["viewed_no_reply", null, "Nudge", "/crm/customers/a1"],
  ] as const)("%s → %s", (pill, request, label, href) => {
    expect(estimateAction({ pill, request, ...ids })).toEqual({ label, href });
  });
  it("renders nothing when the rules produce nothing", () => {
    expect(estimateAction({ pill: "wizard", request: null, ...ids })).toBeNull();
    expect(estimateAction({ pill: "none", request: null, ...ids })).toBeNull();
    expect(estimateAction({ pill: "abandoned", request: null, ...ids })).toBeNull();
    // A nudge with nobody to nudge is not an action; a chase falls back to the
    // pack tab, where the strip asks the question through the same route.
    expect(estimateAction({ pill: "viewed_no_reply", request: null, ...ids, accountId: null })).toBeNull();
    expect(estimateAction({ pill: "question", request: null, ...ids, accountId: null })).toEqual({ label: "Chase", href: "/quote?id=e1&tab=pack" });
    expect(estimateAction({ pill: "accepted", request: null, ...ids, workOrderId: null })).toBeNull();
  });
});

describe("estimateValue — brief 2.6: a range while it is a range", () => {
  const v = (over: Partial<Parameters<typeof estimateValue>[0]>) =>
    estimateValue({ totalCents: 1_013_000, status: "draft", hasWizard: true, bandPct: 4, request: null, range: rangeFromTotal, ...over });
  it("a wizard estimate with a band is a range, rounded the customer's way", () => {
    expect(v({})).toEqual({ kind: "range", loCents: 972_000, hiCents: 1_054_000 });
  });
  it("fixed takes the fixed price, not the tree total", () => {
    expect(v({ request: req({ status: "fixed", fixedPriceCents: 1_000_000 }) })).toEqual({ kind: "fixed", cents: 1_000_000 });
    expect(v({ status: "accepted" })).toEqual({ kind: "fixed", cents: 1_013_000 });
  });
  it("in-house is one figure; nothing priced is nothing", () => {
    expect(v({ hasWizard: false })).toEqual({ kind: "figure", cents: 1_013_000 });
    expect(v({ bandPct: null })).toEqual({ kind: "figure", cents: 1_013_000 });
    expect(v({ totalCents: null })).toEqual({ kind: "none" });
  });
});
