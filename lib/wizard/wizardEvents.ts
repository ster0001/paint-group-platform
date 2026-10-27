import { z } from "zod";

/**
 * Wizard mobile v5, brief §8 — the wizard's own events, client side.
 *
 * The CATALOGUE (the type names and payload shapes) is `lib/crm/events.ts`,
 * the one log; this file is the customer's way of writing to it. A screen
 * calls `sendWizardEvent` and forgets — `/api/wizard/event` validates the
 * body against the schemas below, pins the session (the open wizard draft)
 * on the server, and answers 204 whatever happens, because logging must
 * never break the screen it is measuring. No session id, estimate id or
 * account id is ever trusted from the browser.
 *
 * Pure and client-safe apart from `fetch`; the route imports the same
 * schemas so the two can never disagree on a shape.
 */
export const BREAKPOINTS = ["mobile", "desktop"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
/** The brief's one line: mobile is `< 768px`. */
export const MOBILE_MAX_WIDTH = 767;

const money = z.number().int().min(0).max(100_000_000);
const breakpoint = z.enum(BREAKPOINTS);
const step = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

/** The events a customer's browser may write, and what each must carry. */
export const WIZARD_EVENT_SCHEMAS = {
  wizard_step_viewed: z.object({ step, breakpoint }),
  surface_toggled: z.object({ surface: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), on: z.boolean() }),
  gate_viewed: z.object({ range_low: money, range_high: money, bigger_job: z.boolean(), breakpoint }),
  gate_cta_clicked: z.object({ cta: z.enum(["exact", "visit", "call", "message", "save"]), breakpoint }),
  contact_opened: z.object({ step }),
  scope_viewed: z.object({ from: z.literal("gate") }),
} as const;
export type WizardEventType = keyof typeof WIZARD_EVENT_SCHEMAS;
export const WIZARD_EVENT_TYPES = Object.keys(WIZARD_EVENT_SCHEMAS) as WizardEventType[];
export type WizardEventPayload<T extends WizardEventType> = z.input<(typeof WIZARD_EVENT_SCHEMAS)[T]>;

/** The request body `/api/wizard/event` accepts: one catalogued type and its payload. Spelled out so each arm keeps its payload type. */
export const wizardEventBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wizard_step_viewed"), payload: WIZARD_EVENT_SCHEMAS.wizard_step_viewed }),
  z.object({ type: z.literal("surface_toggled"), payload: WIZARD_EVENT_SCHEMAS.surface_toggled }),
  z.object({ type: z.literal("gate_viewed"), payload: WIZARD_EVENT_SCHEMAS.gate_viewed }),
  z.object({ type: z.literal("gate_cta_clicked"), payload: WIZARD_EVENT_SCHEMAS.gate_cta_clicked }),
  z.object({ type: z.literal("contact_opened"), payload: WIZARD_EVENT_SCHEMAS.contact_opened }),
  z.object({ type: z.literal("scope_viewed"), payload: WIZARD_EVENT_SCHEMAS.scope_viewed }),
]);
export type WizardEventBody = z.infer<typeof wizardEventBodySchema>;

/** Which breakpoint the browser is on right now (desktop when there is no window — a server render never sends). */
export function breakpointNow(width: number | null = typeof window === "undefined" ? null : window.innerWidth): Breakpoint {
  return width != null && width <= MOBILE_MAX_WIDTH ? "mobile" : "desktop";
}

/**
 * Fire and forget. `keepalive` so a tap that navigates away (Get my exact
 * price → the scope page) still lands; a failed send is simply not logged.
 */
export function sendWizardEvent<T extends WizardEventType>(type: T, payload: WizardEventPayload<T>): void {
  if (typeof fetch !== "function") return;
  try {
    void fetch("/api/wizard/event", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload }),
    }).catch(() => undefined);
  } catch { /* logging never breaks the screen */ }
}

/**
 * `scope_viewed {from: 'gate'}` is written by the scope page, which cannot
 * see where the customer came from once the router has moved: the gate
 * leaves a mark in sessionStorage on the way out and the scope page takes it.
 * One-shot, so a reload of the scope page is not a second arrival from the gate.
 */
const FROM_GATE_KEY = "wz-scope-from-gate";
export function markScopeFromGate(): void {
  try { window.sessionStorage.setItem(FROM_GATE_KEY, "1"); } catch { /* private mode: the event is simply not written */ }
}
export function takeScopeFromGate(): boolean {
  try {
    const hit = window.sessionStorage.getItem(FROM_GATE_KEY) === "1";
    if (hit) window.sessionStorage.removeItem(FROM_GATE_KEY);
    return hit;
  } catch { return false; }
}
