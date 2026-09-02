/**
 * S1's `NoopTools`: every tool in the registry answers with a well-formed,
 * schema-valid result and touches nothing. It exists so the gateway loop can
 * be exercised end to end — logging, refusal relay, the number guard, budget
 * exhaustion — before a single binding exists. S3 replaces it tool by tool.
 *
 * The price_scope sample is deliberately NOT zero: the number guard is only
 * testable against a reply that mentions a figure a tool actually returned.
 */

import { ok, refused, toolSpec, type ToolContext, type ToolExecutor, type ToolResult } from "./schemas";
import type { AgentSettings } from "./settings";

export const NOOP_PRICE_SAMPLE = {
  totalCents: 482_000,
  accuracyPct: 62,
  bandPct: 15,
  loCents: 410_000,
  hiCents: 555_000,
  chargeOutCentsPerHr: 9_500,
  revenueCentsPerHr: 11_200,
  reviewFlags: [],
  assumptions: [
    { key: "cupboard_interiors", areaId: null, label: "Assumed: cupboard interiors not included", assumedValue: "excluded", swingCents: 98_000 },
    { key: "door_style", areaId: null, label: "Assumed: flat doors", assumedValue: "flat", swingCents: 35_000 },
  ],
  showNumber: true,
  confirmedAreaIds: [],
  allAreasConfirmed: false,
} as const;

export class NoopTools implements ToolExecutor {
  constructor(private readonly settings: AgentSettings) {}

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    void ctx; // S1: nothing is bound yet; S3 bindings scope by it.
    const spec = toolSpec(name);
    if (!spec) return refused("That is not something I can do.");
    const i = (input ?? {}) as Record<string, unknown>;
    switch (name) {
      case "get_scope": return ok({ estimateId: null, areas: [], confirmedAreaIds: [] });
      case "next_gap": return ok({ gap: null });
      case "list_gaps": return ok({ gaps: [] });
      case "answer_gap": return ok({ applied: true, key: String(i.key ?? "") });
      case "add_area": return ok({ areaId: 1 });
      case "add_surface": return ok({ surfaceId: 1 });
      case "set_count":
      case "set_size": return ok({ applied: true });
      case "remove_item": return ok({ removed: true });
      case "add_custom_line": return ok({ ref: "noop-note", amber: true, visitTier: true });
      case "attach_document": return ok({ pipelineState: "queued", sourceId: null });
      case "price_scope": return ok(NOOP_PRICE_SAMPLE);
      case "check_thresholds": return ok({ outcome: "visit", reasons: ["Some areas are not confirmed yet."], accuracyPct: 62, minAccuracyPct: 90, capCents: 600_000, guardrail: "reveal" });
      case "propose_diff": return ok({ diffId: "noop-diff", added: [], assumed: [], gaps: [], injectedInstructions: [] });
      case "apply_diff": return ok({ applied: true, rows: 0 });
      case "lookup_brain": return ok({ found: false, entries: [] });
      case "explain_estimate": return ok({ answer: "Nothing is priced yet.", citedToolCallIds: [] });
      case "request_change": return ok({ flagId: "noop-flag" });
      case "visit_policy": return ok({ tier: "phone_first", reasons: ["Visit booking is not wired yet."] });
      case "open_visit_booking": return ok({ url: "/account/visits" });
      case "get_support_hours": return ok({ open: false, nextOpening: null, summary: "Support hours are not wired yet." });
      case "request_handoff": return ok({ handoffId: "noop-handoff", status: "requested" });
      case "request_callback": return ok({ callbackId: "noop-callback", forDate: "1970-01-01" });
      case "emit_crm_event": return ok({ eventId: null });
      case "hard_stop": {
        const kind = String(i.kind ?? "");
        const script = this.settings.hardStopScripts[kind];
        if (!script) return refused("That situation needs a person — I have flagged it.");
        const nextState =
          kind === "out_of_area" ? "out_of_area"
          : kind === "lead_paint" || kind === "asbestos" || kind === "heritage" ? "visit_tier"
          : kind === "discount" || kind === "margin" ? "refuse"
          : "handoff";
        return ok({ script, nextState });
      }
      default: return refused("That is not something I can do.");
    }
  }
}
