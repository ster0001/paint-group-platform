/**
 * Human handoff — the pure parts (assistant brief §5).
 *
 * States on agent_handoffs: requested → claimed → active → resolved | missed.
 * Inside hours a request is a live-chat card in the console (one primary
 * action: Claim) and a ping to whoever is on duty; unclaimed past the SLA it
 * escalates (D10, default 3 min) and the customer is offered a callback.
 * Outside hours the assistant says so, names the next opening, and offers
 * a callback dated for the next working morning.
 */

import type { SupportHours } from "./settings";
import { supportHoursState } from "./scope-tools";

export type HandoffRow = {
  id: string;
  conversationId: string;
  reason: string;
  status: "requested" | "claimed" | "active" | "resolved" | "missed";
  requestedAt: string;
  claimedBy: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  summary: string | null;
};

/** Handoffs still waiting past the SLA and not yet escalated. */
export function escalationsDue(handoffs: HandoffRow[], now: Date, slaSeconds: number): HandoffRow[] {
  const cutoff = now.getTime() - slaSeconds * 1000;
  return handoffs.filter((h) => h.status === "requested" && !h.escalatedAt && new Date(h.requestedAt).getTime() <= cutoff);
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The next working day (Melbourne calendar) with support hours, as YYYY-MM-DD.
 *  Today counts if its opening hasn't passed yet. */
export function nextWorkingDate(hours: SupportHours, now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: hours.timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  for (let k = 0; k < 8; k++) {
    const d = new Date(now.getTime() + k * 86_400_000);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = get("weekday").toLowerCase().slice(0, 3) as (typeof DAYS)[number];
    const h = hours.days[day as keyof typeof hours.days];
    if (!h) continue;
    if (k === 0) {
      const nowMin = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
      const openMin = Number(h[0].slice(0, 2)) * 60 + Number(h[0].slice(3, 5));
      if (nowMin >= openMin) continue; // today's opening has passed → next day
    }
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: hours.timezone }).format(now);
}

/** Who to ping now (D9): the roster for today's weekday, else the fallback. */
export function onDutyNumbers(hours: SupportHours & { roster?: Record<string, string[]>; escalateTo?: string[] }, now: Date): { onDuty: string[]; escalate: string[] } {
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: hours.timezone, weekday: "short" }).format(now).toLowerCase().slice(0, 3);
  const roster = hours.roster ?? {};
  const onDuty = roster[day] ?? roster.default ?? [];
  return { onDuty: [...new Set(onDuty)], escalate: [...new Set([...(hours.escalateTo ?? []), ...onDuty])] };
}

export const isOpenNow = (hours: SupportHours, now: Date) => supportHoursState(hours, now);

/** The 3-line brief a person reads on claim: who, what, where they got to. */
export function handoffSummary(input: {
  estimateTitle: string | null;
  customerName: string | null;
  lastUserMessages: string[];
  priceLine: string | null;
  reason: string;
}): string {
  const who = [input.customerName, input.estimateTitle].filter(Boolean).join(" · ") || "A customer";
  const asked = input.lastUserMessages.filter(Boolean).slice(-3).map((m) => `“${m.slice(0, 120)}”`).join(" / ") || "no message yet";
  const why = { customer_asked: "asked for a person", hard_stop: "hit a hard stop", repeated_confusion: "got stuck twice", sentiment: "sounded unhappy", staff_joined: "staff joined", budget_exhausted: "the assistant's budget ran out" }[input.reason] ?? input.reason;
  return [`${who} — ${why}.`, `They said: ${asked}.`, input.priceLine ?? "No price on the estimate yet."].join("\n");
}

export const RESUME_TEXT = "They've stepped away — I can keep going from here, or leave it here. What would you like?";
export const CLOSED_TEXT = (nextOpening: string | null) => `We're closed just now${nextOpening ? ` — a person is next available ${nextOpening}` : ""}. I can keep going with you now, or arrange a callback: morning, afternoon, or any time?`;
export const ESCALATED_TEXT = "Sorry — no one has been able to pick this up yet. I can arrange a callback instead (morning, afternoon, or any time), or keep going with you here.";
