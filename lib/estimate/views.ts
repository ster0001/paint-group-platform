/**
 * Estimates tab & funnel, session 3 (brief §4, R11): the six views above the
 * estimates list, in the brief's order. All estimates is first and the
 * default; the order and the default are not settings.
 *
 * A view is the `?view=` param. All estimates carries none, so every link the
 * list already had (`/estimates?status=…`) still lands on it unchanged (R2/R14).
 * Campaigns › Automations is a link out, not a view of this page (§4.7).
 */
export const ESTIMATE_VIEWS = ["all", "pipeline", "online", "queue", "funnel", "automations"] as const;
export type EstimateView = (typeof ESTIMATE_VIEWS)[number];

export const ESTIMATE_VIEW_LABEL: Record<EstimateView, string> = {
  all: "All estimates",
  pipeline: "Pipeline",
  online: "Online now",
  queue: "Work queue",
  funnel: "Funnel",
  automations: "Campaigns › Automations",
};

/** Until the Automations sub-tab exists (next brief) the chip opens Campaigns. */
export const AUTOMATIONS_HREF = "/crm/campaigns";

/** `?view=` → the view shown. Anything unknown, and the link-out, read as All estimates. */
export function parseEstimateView(raw: string | undefined): Exclude<EstimateView, "automations"> {
  if (raw === "pipeline" || raw === "online" || raw === "queue" || raw === "funnel") return raw;
  return "all";
}

export function estimateViewHref(view: EstimateView): string {
  if (view === "automations") return AUTOMATIONS_HREF;
  return view === "all" ? "/estimates" : `/estimates?view=${view}`;
}
