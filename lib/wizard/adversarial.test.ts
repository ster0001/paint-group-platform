import { describe, expect, it } from "vitest";
import { defaultCustomer, defaultWizardState, wizardStateSchema, type WizardState } from "./state";
import { evaluateGuardrails, answersFromState, DEFAULT_POLICY } from "./policy";
import { customerPayload } from "./view";
import type { WizardEditorPayload } from "./view";
import { DEFAULT_BANDS } from "./policy";

/**
 * Step 8's done-when: "an adversarial test script fails safely". This suite
 * attacks the PURE layer — crafted states, bypass attempts, and payload
 * leak checks. scripts/adversarial-wizard.ts attacks the live routes.
 */

const customerState = (over: Partial<WizardState> = {}): WizardState => ({
  ...defaultWizardState(),
  mode: "customer",
  customer: { ...defaultCustomer(), email: "attacker@example.com", suburb: "Northcote", postcode: "3070" },
  noPlan: true,
  basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
  ...over,
});

describe("schema attacks fail safely", () => {
  it("customer mode without the property answers is rejected", () => {
    expect(wizardStateSchema.safeParse({ ...customerState(), customer: null }).success).toBe(false);
  });

  /**
   * ⚑ REVERSED by estimator journey v2 ⚑1 (phase 2). The email gate used to
   * sit here, before the price. It now sits on the reveal screen's "Keep this
   * estimate" door instead — priced without an email, kept only with one.
   *
   * What must NOT relax with it is the property block: the guardrails read
   * those answers, and a hazard question nobody answered must never be
   * allowed to read as "no". That is the assertion worth keeping.
   */
  it("prices customer mode without an email — the gate moved, it did not vanish", () => {
    const s = customerState();
    s.customer!.email = "";
    expect(wizardStateSchema.safeParse(s).success).toBe(true);
  });

  it("still refuses customer mode with no property answers at all", () => {
    const s = customerState();
    s.customer!.email = "";
    expect(wizardStateSchema.safeParse({ ...s, customer: null }).success).toBe(false);
  });

  it("run-id smuggling: non-uuid planRunIds are rejected", () => {
    const s = { ...customerState(), planRunIds: ["../../etc/passwd"] };
    expect(wizardStateSchema.safeParse(s).success).toBe(false);
  });

  it("oversized inputs are rejected, not truncated silently", () => {
    expect(wizardStateSchema.safeParse({
      ...customerState(),
      planRunIds: Array.from({ length: 41 }, (_, i) => `6b8f9e7c-1111-4222-8333-${String(i).padStart(12, "0")}`),
    }).success).toBe(false);
    const s = customerState();
    s.details.damageNote = "x".repeat(3000);
    expect(wizardStateSchema.safeParse(s).success).toBe(false);
  });

  it("a fabricated guardrail-free property kind is rejected", () => {
    const s = customerState();
    (s.customer as unknown as Record<string, unknown>).propertyKind = "definitely_not_commercial";
    expect(wizardStateSchema.safeParse(s).success).toBe(false);
  });
});

describe("guardrail bypass attempts fail safely", () => {
  it("perfect accuracy does not bypass the $15k walkthrough", () => {
    const d = evaluateGuardrails(answersFromState(customerState()), 2_000_000, 100, false);
    expect(d.canAccept).toBe(false);
  });

  it("a spotless answer set with asbestos=yes still hard-stops at any price", () => {
    const s = customerState();
    s.customer!.asbestosSuspected = "yes";
    const d = evaluateGuardrails(answersFromState(s), 250_000, 100, false);
    expect(d.outcome).toBe("hard_stop");
  });

  it("whitespace-padded postcodes cannot slip the service-area check", () => {
    const s = customerState();
    s.customer!.postcode = " 9999 ";
    const d = evaluateGuardrails(answersFromState(s), 900_000, 95, false, DEFAULT_POLICY, ["3070"]);
    expect(d.outcome).toBe("outside_area");
  });

  it("an exterior can never self-accept, whatever the numbers claim", () => {
    const s = customerState({ jobType: "exterior" });
    const d = evaluateGuardrails(answersFromState(s), 800_000, 99, true);
    expect(d.canAccept).toBe(false);
  });
});

describe("the customer payload leaks nothing internal", () => {
  it("no margin, no point price, no internal reasons in the serialized reveal", () => {
    const internal: WizardEditorPayload = {
      rooms: [{
        areaId: 1, name: "Living", roomType: "living", L: 4, W: 4, H: 2.4,
        priceCents: 123_456, status: "extracted", confidencePct: 92, assumedFields: [],
        surfaces: [{ label: "Walls", count: 1, coats: 2 }],
      }],
      totals: { subtotalCents: 999_999, totalCents: 1_000_000, contractorHours: 42, marginCents: 313_370 },
      accuracyPct: 85,
      deferred: [{ room: "Whole job", what: "staircase", count: 1, needs: "no per-room rate for stairs — price it in the builder" }],
      heightUnconfirmed: false,
      exteriorWidthFromPlan: false,
      exteriorWidthMissing: false,
    };
    const decision = evaluateGuardrails(answersFromState(customerState()), 1_000_000, 85, false);
    const out = JSON.stringify(customerPayload(internal, [], decision, DEFAULT_BANDS));

    expect(out).not.toContain("marginCents");
    expect(out).not.toContain("313370");   // the margin value
    expect(out).not.toContain("subtotalCents");
    expect(out).not.toContain("priceCents");
    expect(out).not.toContain("123456");   // the per-room price
    expect(out).not.toContain("1000000");  // the exact point price
    expect(out).not.toContain("contractorHours");
    expect(out).not.toContain("builder");  // internal wording never reaches customers
    // The range brackets the point price rather than revealing it.
    const parsed = JSON.parse(out) as { rangeLoCents: number; rangeHiCents: number };
    expect(parsed.rangeLoCents).toBeLessThan(1_000_000);
    expect(parsed.rangeHiCents).toBeGreaterThan(1_000_000);
  });
});
