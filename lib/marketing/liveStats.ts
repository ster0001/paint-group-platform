/**
 * The homepage live strip (brief §4.8). STATIC CONSTANTS FOR LAUNCH — these
 * four numbers are typed here, not computed, and "updated 2 min ago" is
 * literal text. ⚑9.4 decides when they go live; when they do they are read
 * SERVER-SIDE and cached for 2 minutes, never computed in the browser.
 * No start-date tile — ruled a future feature.
 */
export const LIVE_STATS = {
  updatedLabel: "updated 2 min ago",
  estimatesThisWeek: { value: 38, label: "Estimates built this week", sub: "↑ 6 on last week" },
  jobsOnSite: { value: 6, label: "Jobs on site right now", sub: "Northcote · Preston · Kew · +3" },
  pricesHonoured: { value: 100, suffix: "%", label: "Prices honoured as signed off", sub: "What we confirm together is what you pay" },
  minutesToPrice: { value: 9, suffix: " min", label: "Average time to a price", sub: "From address to range" },
} as const;
