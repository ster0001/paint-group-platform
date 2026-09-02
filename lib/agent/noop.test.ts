import { describe, expect, it } from "vitest";
import { NoopTools } from "./noop";
import { TOOL_SPECS, type ToolContext } from "./schemas";
import { DEFAULT_AGENT_SETTINGS } from "./settings";

const ctx: ToolContext = { conversationId: "c1", mode: "guided", view: "customer", estimateId: null, accountId: null };
const settings = { ...DEFAULT_AGENT_SETTINGS, hardStopScripts: { lead_paint: "Lead script.", out_of_area: "Out of area script." } };

/** A valid input for each tool, so the noop path can be driven. */
const SAMPLE_INPUT: Record<string, unknown> = {
  answer_gap: { key: "rooms", value: 3, provenance: "customer_stated" },
  add_area: { name: "Bedroom 1", provenance: "customer_stated" },
  add_surface: { areaId: 1, code: "Walls", provenance: "customer_stated" },
  set_count: { areaId: 1, surfaceId: 1, count: 2, provenance: "customer_stated" },
  set_size: { areaId: 1, lengthM: 4, widthM: 3, provenance: "customer_stated" },
  remove_item: { areaId: 1 },
  add_custom_line: { text: "feature wall in the hall" },
  attach_document: { kind: "photo", ref: "photo-1" },
  propose_diff: { text: "3 bed 1 bath house", sourceKind: "text" },
  apply_diff: { diffId: "d1" },
  lookup_brain: { query: "caulking", audience: "customer" },
  explain_estimate: { question: "why is trim separate?" },
  request_change: { text: "add the laundry" },
  request_handoff: { reason: "customer_asked" },
  request_callback: { window: "am", phoneE164: "+61412345678" },
  emit_crm_event: { type: "website_chat", payload: {} },
  hard_stop: { kind: "lead_paint" },
};

describe("NoopTools honours the contract for every tool", () => {
  it.each(TOOL_SPECS.map((s) => [s.name, s] as const))("%s returns ok data that validates against its output schema", async (name, spec) => {
    const input = spec.input.parse(SAMPLE_INPUT[name] ?? {});
    const result = await new NoopTools(settings).execute(name, input, ctx);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(spec.output.safeParse(result.data).success, JSON.stringify(result.data)).toBe(true);
  });

  it("hard_stop returns the SETTINGS script, and refuses when the row has none", async () => {
    const tools = new NoopTools(settings);
    const r = await tools.execute("hard_stop", { kind: "lead_paint" }, ctx);
    expect(r).toEqual({ status: "ok", data: { script: "Lead script.", nextState: "visit_tier" } });
    const r2 = await tools.execute("hard_stop", { kind: "asbestos" }, ctx);
    expect(r2.status).toBe("refused");
  });

  it("an unknown tool is refused, not thrown", async () => {
    const r = await new NoopTools(settings).execute("set_price", {}, ctx);
    expect(r.status).toBe("refused");
  });
});
