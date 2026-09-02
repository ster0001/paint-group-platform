import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS, settingsFromRow } from "./settings";

describe("agent settings (§2 rules 9–10)", () => {
  it("a missing row yields the rulings-log defaults", () => {
    const s = settingsFromRow(null);
    expect(s).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(s.modelDefault).toBe("claude-haiku-4-5");
    expect(s.modelHeavy).toBe("claude-sonnet-5");
    expect(s.budgetTokensPerConversation).toBe(60_000);
    expect(s.assistantName).toBe("Paint Group assistant");
  });

  it("reads the seeded row shape", () => {
    const s = settingsFromRow({
      tenant_key: "paint-group", model_default: "claude-haiku-4-5", model_heavy: "claude-sonnet-5",
      budget_tokens_per_conversation: 12345, daily_cap_per_account: 99999, sla_claim_seconds: 120,
      support_hours: { timezone: "Australia/Melbourne", days: { mon: ["08:00", "17:00"] }, strongCoverageDays: ["mon"] },
      hard_stop_scripts: { lead_paint: "x" }, feature_flags: { widget: false }, tone: "terse", assistant_name: "Sam",
      disclosure_text: "d",
    });
    expect(s.budgetTokensPerConversation).toBe(12345);
    expect(s.slaClaimSeconds).toBe(120);
    expect(s.hardStopScripts.lead_paint).toBe("x");
    expect(s.featureFlags.widget).toBe(false);
    expect(s.assistantName).toBe("Sam");
  });

  it("a bad field falls back on its own without losing the rest", () => {
    const s = settingsFromRow({ model_default: 42, budget_tokens_per_conversation: -5, assistant_name: "Sam" });
    expect(s.modelDefault).toBe("claude-haiku-4-5");
    expect(s.budgetTokensPerConversation).toBe(60_000);
    expect(s.assistantName).toBe("Sam");
  });
});
