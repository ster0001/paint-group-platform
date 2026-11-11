import { pageLabel, type WizardJourney } from "@/lib/wizard/journey";

/**
 * Estimates tab session 4 (brief §4.3): Online now & dropped — the open wizard
 * sessions in five sections, in this order. Pure; built on the existing
 * journey rows and the sweep's buckets (ruling E‑J), so a session reads the
 * same here as on the Wizard tab. "Online now" is the only label for a live
 * session (never "In progress").
 *
 * A session sits in the FIRST section it qualifies for: someone live who also
 * came back is Online now, not listed twice.
 */
export const ONLINE_SECTIONS = ["online", "needs_help", "came_back", "priced", "dropped"] as const;
export type OnlineSection = (typeof ONLINE_SECTIONS)[number];
export const ONLINE_SECTION_LABEL: Record<OnlineSection, string> = {
  online: "Online now",
  needs_help: "Needs help",
  came_back: "Came back after dropping out",
  priced: "Priced, no request",
  dropped: "Dropped today",
};
/** Brief §4.3: live = a heartbeat in the last five minutes. */
export const LIVE_MINUTES = 5;

export type OnlineRow = {
  id: string;
  /** Name, or the suburb alone for an anonymous session (Dropped shows no more than that). */
  who: string;
  jobType: string | null;
  step: string;
  /** Minutes since the last heartbeat. */
  idleMinutes: number;
  brand: string | null;
  cameBack: number;
  href: string;
};
export type OnlineView = { section: OnlineSection; label: string; rows: OnlineRow[] }[];

const MELBOURNE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (iso: string | null) => (iso ? MELBOURNE_DAY.format(new Date(iso)) : null);
const hasDetails = (j: WizardJourney) => Boolean(j.name?.trim() || j.email || j.phone);

export function sectionOf(j: WizardJourney, now: Date): OnlineSection | null {
  if (j.convertedAt) return null;
  const seen = j.lastActiveAt ? Date.parse(j.lastActiveAt) : Number.NaN;
  const idle = Number.isNaN(seen) ? Infinity : (now.getTime() - seen) / 60_000;
  const today = dayOf(now.toISOString());
  if (idle <= LIVE_MINUTES) return "online";
  if (j.bucket === "needs_help") return "needs_help";
  if (j.visits > 1 && dayOf(j.lastActiveAt) === today) return "came_back";
  if (j.bucket === "priced_no_request") return "priced";
  if (j.bucket === "dropped" && !hasDetails(j) && dayOf(j.droppedAt ?? j.lastActiveAt) === today) return "dropped";
  return null;
}

export function buildOnlineNow(journeys: readonly WizardJourney[], now: Date): OnlineView {
  const by = new Map<OnlineSection, OnlineRow[]>();
  for (const j of journeys) {
    const s = sectionOf(j, now);
    if (!s) continue;
    const seen = j.lastActiveAt ? Date.parse(j.lastActiveAt) : now.getTime();
    by.set(s, [...(by.get(s) ?? []), {
      id: j.id,
      who: s === "dropped" ? (j.suburb || "Somewhere") : (j.name?.trim() || j.email || j.suburb || "Unknown"),
      jobType: j.jobType,
      step: pageLabel(j.jobType, j.currentPage),
      idleMinutes: Math.max(0, Math.floor((now.getTime() - seen) / 60_000)),
      brand: j.brand,
      cameBack: Math.max(0, j.visits - 1),
      href: `/estimates?status=wizard&open=${j.id}`,
    }]);
  }
  return ONLINE_SECTIONS.map((section) => ({
    section, label: ONLINE_SECTION_LABEL[section],
    rows: (by.get(section) ?? []).sort((a, b) => a.idleMinutes - b.idleMinutes),
  }));
}
