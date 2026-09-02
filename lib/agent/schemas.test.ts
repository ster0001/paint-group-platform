import { describe, expect, it } from "vitest";
import { TOOL_NAME_SHAPE, TOOL_SPECS, priceScopeResultSchema, toAnthropicTool, toolSpec, toolsFor } from "./schemas";
import { NOOP_PRICE_SAMPLE } from "./noop";

describe("tool contract (§7)", () => {
  it("every tool has a unique, well-shaped name", () => {
    const names = TOOL_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(TOOL_NAME_SHAPE);
  });

  it("covers the §7 table plus the addendum's needs", () => {
    for (const n of ["get_scope", "next_gap", "list_gaps", "answer_gap", "add_area", "add_surface", "set_count", "set_size", "remove_item",
      "add_custom_line", "attach_document", "price_scope", "check_thresholds", "propose_diff", "apply_diff", "lookup_brain", "explain_estimate",
      "request_change", "visit_policy", "open_visit_booking", "get_support_hours", "request_handoff", "request_callback", "emit_crm_event", "hard_stop"]) {
      expect(toolSpec(n), n).toBeDefined();
    }
  });

  it("a customer in guided mode never sees staff-only or support-only tools", () => {
    const names = toolsFor("guided", "customer").map((s) => s.name);
    expect(names).not.toContain("apply_diff");
    expect(names).not.toContain("lookup_brain");
    expect(names).toContain("next_gap");
    expect(names).toContain("price_scope");
    expect(names).toContain("request_handoff");
  });

  it("staff in co-work see propose_diff and apply_diff", () => {
    const names = toolsFor("cowork", "staff").map((s) => s.name);
    expect(names).toContain("propose_diff");
    expect(names).toContain("apply_diff");
  });

  it("apply_diff is explicit view=staff, never inferred (§2 rule 4)", () => {
    expect(toolsFor("cowork", "customer").map((s) => s.name)).not.toContain("apply_diff");
  });

  it("every spec converts to an Anthropic tool with an object input schema", () => {
    for (const s of TOOL_SPECS) {
      const t = toAnthropicTool(s);
      expect(t.name).toBe(s.name);
      expect(t.input_schema.type).toBe("object");
      expect("$schema" in t.input_schema).toBe(false);
    }
  });

  it("optional/defaulted inputs are not required on the wire", () => {
    const t = toAnthropicTool(toolSpec("add_area")!);
    const req = (t.input_schema as { required?: string[] }).required ?? [];
    expect(req).toContain("name");
    expect(req).not.toContain("lengthM");
  });

  it("answer_gap rejects an empty key and an unknown provenance", () => {
    const s = toolSpec("answer_gap")!;
    expect(s.input.safeParse({ key: "", value: 3, provenance: "customer_stated" }).success).toBe(false);
    expect(s.input.safeParse({ key: "rooms", value: 3, provenance: "guessed" }).success).toBe(false);
    expect(s.input.safeParse({ key: "rooms", value: 3, provenance: "ai_assumed" }).success).toBe(true);
  });

  it("request_callback insists on an E.164 phone", () => {
    const s = toolSpec("request_callback")!;
    expect(s.input.safeParse({ window: "am", phoneE164: "0412 345 678" }).success).toBe(false);
    expect(s.input.safeParse({ window: "am", phoneE164: "+61412345678" }).success).toBe(true);
  });

  it("hard_stop only knows the scripted kinds", () => {
    const s = toolSpec("hard_stop")!;
    expect(s.input.safeParse({ kind: "lead_paint" }).success).toBe(true);
    expect(s.input.safeParse({ kind: "be_rude" }).success).toBe(false);
  });

  it("emit_crm_event only accepts catalogue event types", () => {
    const s = toolSpec("emit_crm_event")!;
    expect(s.input.safeParse({ type: "website_chat", payload: { excerpt: "hi" } }).success).toBe(true);
    expect(s.input.safeParse({ type: "stage_changed" }).success).toBe(false);
  });

  it("price_scope's result carries the range, the assumptions with $ swing, and showNumber", () => {
    expect(priceScopeResultSchema.safeParse(NOOP_PRICE_SAMPLE).success).toBe(true);
    expect(priceScopeResultSchema.safeParse({ ...NOOP_PRICE_SAMPLE, totalCents: -1 }).success).toBe(false);
    expect(priceScopeResultSchema.safeParse({ ...NOOP_PRICE_SAMPLE, assumptions: [{ key: "x", label: "y", assumedValue: "z" }] }).success).toBe(false);
  });
});
