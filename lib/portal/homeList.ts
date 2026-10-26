import type { PortalEstimate, PortalWorkOrder } from "./home";
import type { PortalProperty } from "./data";

/**
 * Portal UX brief (25 Oct 2026) · Home, parts C2 and C3 — pure over the rows
 * the page already reads. Nothing here touches the database.
 *
 *  C2  Address chips: identical addresses collapse to one chip with a count,
 *      the four most recently active lead, the rest sit behind "More (n)".
 *  C3  The estimate list groups into Needs you / With us / Done, newest
 *      activity first, every card carrying a one-line next step and a
 *      relative date ("Updated 2 days ago").
 */

export type HomeCard = {
  key: string;
  title: string;
  /** Where the whole card goes; null for a record with nothing to open. */
  href: string | null;
  chip: { cls: "cyan" | "amber" | "emerald" | "mut"; label: string };
  /** The one-line "what next". */
  next: string;
  /** "Updated 2 days ago" — null only for an undated record. */
  when: string | null;
  /** Paint Home jobs on a shared account carry their brand (⚑ P8). */
  paintHome: boolean;
  /** An Airtable record from before the platform (the history tag). */
  history: boolean;
  testId?: string;
};

export type HomeGroups = { needsYou: HomeCard[]; withUs: HomeCard[]; done: HomeCard[] };

export type OpenWizard = { pageLabel: string; where: string; lastSeen: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const melbourneYmd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
});

function dayNumber(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;
}

/** "today" · "yesterday" · "3 days ago" · "2 weeks ago" · "on 16 Sep" (with the
 * year when it differs) — bucketed by Melbourne calendar day, never UTC. */
export function relativeDay(iso: string | null | undefined, todayYmd: string): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const ymd = melbourneYmd.format(t);
  const days = dayNumber(todayYmd) - dayNumber(ymd);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 28) { const w = Math.floor(days / 7); return `${w} ${w === 1 ? "week" : "weeks"} ago`; }
  const [y, m, d] = ymd.split("-").map(Number);
  return `on ${d} ${MONTHS[m - 1]}${y === Number(todayYmd.slice(0, 4)) ? "" : ` ${y}`}`;
}

/** The instant the list sorts and dates by. */
export function activityOf(e: Pick<PortalEstimate, "updated_at" | "sent_at" | "created_at">): string {
  return e.updated_at || e.sent_at || e.created_at;
}

function monthYear(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", month: "short", year: "numeric" }).format(d);
}

export function groupEstimates(
  estimates: readonly PortalEstimate[],
  workOrders: readonly PortalWorkOrder[],
  openWizard: OpenWizard | null,
  todayYmd: string,
  /** True when the account mixes Paint Group and Paint Home jobs — only then is the brand tagged. */
  mixedBrands = false,
): HomeGroups {
  const groups: HomeGroups = { needsYou: [], withUs: [], done: [] };
  const closed = new Set(workOrders.filter((w) => w.stage === "closed").map((w) => w.estimate_id));
  const booked = new Set(workOrders.filter((w) => w.stage !== "closed").map((w) => w.estimate_id));

  if (openWizard) {
    groups.needsYou.push({
      key: "wizard",
      title: openWizard.where || "Your estimate",
      href: "/estimate",
      chip: { cls: "amber", label: "Not yet submitted" },
      next: `You were at ${openWizard.pageLabel} — tap to finish it`,
      when: openWizard.lastSeen ? `Started ${relativeDay(openWizard.lastSeen, todayYmd)}` : null,
      paintHome: false,
      history: false,
      testId: "portal-unsubmitted-estimate",
    });
  }

  const sorted = [...estimates].sort((a, b) => activityOf(b).localeCompare(activityOf(a)));
  for (const e of sorted) {
    const title = e.title?.trim() || "Your estimate";
    const paintHome = mixedBrands && e.brand === "painthome";
    const history = e.source === "airtable";
    const shaping = e.status === "draft" && e.source === "customer_intake";
    const openable = !history && e.status !== "draft" && !!e.share_token && !!e.sent_at;
    const docHref = openable ? `/e/${e.share_token}?portal=1` : null;
    const base = { key: e.id, title, paintHome, history };

    if (history) {
      groups.done.push({
        ...base,
        href: null,
        chip: e.status === "accepted" ? { cls: "emerald", label: "Accepted" } : e.status === "declined" ? { cls: "mut", label: "Declined" } : { cls: "mut", label: "On record" },
        next: `From our records${e.sent_at ? ` · ${monthYear(e.sent_at)}` : ""}`,
        when: null,
        testId: "portal-history",
      });
      continue;
    }

    if (shaping) {
      groups.needsYou.push({
        ...base,
        href: `/estimate/scope?id=${e.id}`,
        chip: { cls: "amber", label: "Keep shaping" },
        next: "Confirm your rooms to finalise your price",
        when: `Updated ${relativeDay(activityOf(e), todayYmd)}`,
      });
    } else if (e.status === "draft") {
      groups.withUs.push({
        ...base,
        href: null,
        chip: { cls: "amber", label: "Being checked" },
        next: "We're checking the details — you'll hear from us within one business day",
        when: `Sent ${relativeDay(activityOf(e), todayYmd)}`,
      });
    } else if (e.status === "sent") {
      groups.needsYou.push({
        ...base,
        href: docHref,
        chip: { cls: "cyan", label: "Ready for you" },
        next: docHref ? "Your estimate is ready — tap to open it" : "Your estimate is ready — we'll be in touch",
        when: `Updated ${relativeDay(activityOf(e), todayYmd)}`,
      });
    } else if (e.status === "accepted") {
      const done = closed.has(e.id);
      groups.done.push({
        ...base,
        href: docHref,
        chip: done ? { cls: "emerald", label: "Complete" } : { cls: "emerald", label: "Accepted" },
        next: done
          ? "Signed off — your photos, colours and warranty stay here for good"
          : booked.has(e.id) ? "Booked — follow it under My project" : "Accepted — we'll be in touch about a start date",
        when: `Updated ${relativeDay(activityOf(e), todayYmd)}`,
      });
    } else if (e.status === "declined") {
      groups.done.push({
        ...base,
        href: docHref,
        chip: { cls: "mut", label: "Declined" },
        next: "Declined — ring us if you'd like to look at it again",
        when: `Updated ${relativeDay(activityOf(e), todayYmd)}`,
      });
    } else {
      groups.done.push({
        ...base,
        href: docHref,
        chip: { cls: "mut", label: e.status.replace(/_/g, " ") },
        next: docHref ? "Tap to open it" : "On record",
        when: `Updated ${relativeDay(activityOf(e), todayYmd)}`,
      });
    }
  }
  return groups;
}

export type AddressChip = {
  /** The property id the chip links to (the first of the group). */
  id: string;
  /** Every property id this chip stands for — identical addresses collapse (C2). */
  ids: string[];
  label: string;
  /** Estimates across the group; shown as a badge when more than one. */
  count: number;
};

export type ChipStrip = {
  shown: AddressChip[];
  hidden: AddressChip[];
  /** The ids the page filters by when a chip is selected, else null for Everything. */
  selectedIds: string[] | null;
};

function addressKey(p: Pick<PortalProperty, "address" | "suburb" | "postcode">): string {
  return [p.address, p.suburb, p.postcode].map((s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

/**
 * C2 · Dedupe by address, order by last activity, cap at `limit` plus the
 * selected chip (never hide the one that is on). Nothing is merged or deleted
 * in the data — this is presentation only (locked default C2).
 */
export function addressChips(
  properties: readonly PortalProperty[],
  estimates: readonly PortalEstimate[],
  selectedId: string | null,
  expanded: boolean,
  limit = 4,
): ChipStrip {
  const groups = new Map<string, AddressChip & { last: string }>();
  for (const p of properties) {
    const key = addressKey(p) || p.id;
    const label = p.address?.trim() || p.suburb?.trim() || "My address";
    const g = groups.get(key);
    if (g) g.ids.push(p.id);
    else groups.set(key, { id: p.id, ids: [p.id], label, count: 0, last: "" });
  }
  for (const g of groups.values()) {
    const mine = estimates.filter((e) => e.property_id && g.ids.includes(e.property_id));
    g.count = mine.length;
    g.last = mine.reduce((m, e) => (activityOf(e) > m ? activityOf(e) : m), "");
  }
  const ordered = [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));
  const selected = selectedId ? ordered.find((g) => g.ids.includes(selectedId)) ?? null : null;
  let shown = ordered.slice(0, limit);
  if (selected && !shown.includes(selected)) shown = [...shown.slice(0, Math.max(0, limit - 1)), selected];
  const hidden = ordered.filter((g) => !shown.includes(g));
  const strip = (g: AddressChip & { last: string }): AddressChip => ({ id: g.id, ids: g.ids, label: g.label, count: g.count });
  return {
    shown: (expanded ? ordered : shown).map(strip),
    hidden: expanded ? [] : hidden.map(strip),
    selectedIds: selected ? selected.ids : null,
  };
}
