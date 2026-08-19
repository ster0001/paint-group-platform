/**
 * R1.1 — client-side halves of the response contract.
 *
 * Every surface that calls wizard-edit declares which payload it renders via
 * `view: "customer" | "staff"` in the request body. These guards make a
 * wrong-shaped response FAIL LOUDLY IN DEV instead of rendering as a blank
 * range or a frozen tile grid — the silent degradation that hid the
 * staff-preview bug for two sessions.
 *
 * Kept dependency-free so client components can import it without pulling
 * the pricing module into the browser bundle.
 */

export type WizardEditView = "customer" | "staff";

/** Throws in dev when a customer surface receives a non-customer payload. */
export function assertCustomerShape(j: unknown, where: string): void {
  if (process.env.NODE_ENV === "production") return;
  const p = j as { rangeLoCents?: unknown; rangeHiCents?: unknown; outcome?: unknown } | null;
  // A guardrail outcome (handoff/hard stop) is a legal customer response.
  if (p && typeof p.outcome === "string" && p.outcome !== "reveal") return;
  if (!p || typeof p.rangeLoCents !== "number" || typeof p.rangeHiCents !== "number") {
    throw new Error(
      `${where}: expected the CUSTOMER payload (rangeLoCents/rangeHiCents) but got ${JSON.stringify(p)?.slice(0, 200)}. ` +
      "The response contract is broken — check the view field on the request and the route's view branch.",
    );
  }
}

/** Throws in dev when the staff editor receives a non-staff payload. */
export function assertStaffShape(j: unknown, where: string): void {
  if (process.env.NODE_ENV === "production") return;
  const p = j as { totals?: { totalCents?: unknown }; rooms?: unknown } | null;
  if (!p || typeof p.totals?.totalCents !== "number" || !Array.isArray(p.rooms)) {
    throw new Error(
      `${where}: expected the STAFF payload (totals/rooms) but got ${JSON.stringify(p)?.slice(0, 200)}. ` +
      "The response contract is broken — check the view field on the request and the route's view branch.",
    );
  }
}
