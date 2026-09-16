/**
 * The dispatcher's decision, as a pure function (Session 1) — CLIENT-SAFE.
 *
 * Given an automation, the office's settings, what we know about the
 * recipient and the clock, says what happens to this send: nothing (off, or
 * nobody to send to), queue it for approval, hold it until quiet hours end or
 * the daily cap resets, or send now on these channels. The server dispatcher
 * (dispatch.ts) does the I/O around this; the tests pin the rules with a
 * fixed clock.
 */
import type { Automation } from "./registry";
import type { MessagingSettings } from "@/lib/messaging/config";
import { automationOn } from "@/lib/messaging/config";
import {
  DEFAULT_DAILY_CAP, melbourneDayStart, nextSendingOpen, normaliseChannel, parseQuietHours, planChannels,
  withinSendingHours, type AutomationControl, type SendChannel,
} from "./controls";
import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";

export type Decision =
  | { action: "off" }
  | { action: "nobody"; detail: string }
  | { action: "pending"; channels: SendChannel[]; fallback?: string }
  | { action: "hold"; reason: "quiet" | "cap"; releaseAt: Date; detail: string; channels: SendChannel[]; fallback?: string }
  | { action: "send"; channels: SendChannel[]; fallback?: string };

export type DecideInput = {
  automation: Automation;
  cfg: Partial<MessagingSettings> | null | undefined;
  contact: { email?: string | null; phone?: string | null };
  now: Date;
  /** Automatic, cap-counted sends already made to this customer today (Melbourne). Null = not a customer / unknown → cap not applied. */
  sentToday: number | null;
  /** True when this is a release of a held message — approval and quiet/cap are not asked again. */
  direct?: boolean;
};

/** The office's stored control for an automation, defensively. */
export function controlFor(cfg: Partial<MessagingSettings> | null | undefined, key: string): AutomationControl {
  const raw = cfg?.controls;
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  return c && typeof c === "object" ? (c as AutomationControl) : {};
}

/** The mode in force: the stored one if the automation may be queued, else automatic. */
export function modeFor(a: Automation, cfg: Partial<MessagingSettings> | null | undefined): "auto" | "approve" {
  if (!a.approvable) return "auto";
  const m = controlFor(cfg, a.key).mode;
  return m === "approve" || m === "auto" ? m : a.defaultMode ?? "auto";
}

/** A timing value: stored, else the registry default. */
export function timingFor(a: Automation, cfg: Partial<MessagingSettings> | null | undefined, id: string): number {
  const def = a.timing?.find((t) => t.id === id);
  const v = controlFor(cfg, a.key).timing?.[id];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return def?.default ?? 0;
}

export function dailyCapFor(cfg: Partial<MessagingSettings> | null | undefined): number {
  const n = cfg?.dailyCap;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

export function decide(input: DecideInput): Decision {
  const { automation: a, cfg, contact, now } = input;
  if (!automationOn(cfg, a.key)) return { action: "off" };

  const choice = normaliseChannel(controlFor(cfg, a.key).channel, a.channels, a.defaultChannel ?? (a.channels.includes("email") ? "email" : "sms"));
  const plan = planChannels(choice, a.channels, contact);
  if (plan.channels.length === 0) {
    return { action: "nobody", detail: a.channels.includes("sms") && a.channels.includes("email") ? "No email or mobile on file." : a.channels.includes("sms") ? "No mobile on file." : "No email on file." };
  }
  if (input.direct) return { action: "send", channels: plan.channels, fallback: plan.fallback };

  if (modeFor(a, cfg) === "approve") return { action: "pending", channels: plan.channels, fallback: plan.fallback };

  // D1 — quiet hours apply to automatic customer and painter messages only.
  if (a.audience !== "office" && !a.quietExempt) {
    const q = parseQuietHours(cfg?.quietHours);
    if (!withinSendingHours(now, q)) {
      const releaseAt = nextSendingOpen(now, q);
      return { action: "hold", reason: "quiet", releaseAt, detail: "Outside sending hours — held until they open.", channels: plan.channels, fallback: plan.fallback };
    }
  }
  // D2 — the daily cap, customers only, exempt kinds pass.
  if (a.audience === "customer" && !a.capExempt && input.sentToday != null) {
    const cap = dailyCapFor(cfg);
    if (input.sentToday >= cap) {
      const q = parseQuietHours(cfg?.quietHours);
      const tomorrow = new Date(melbourneDayStart(now).getTime() + 24 * 3_600_000 + 60_000);
      const p = melbourneParts(tomorrow);
      const releaseAt = nextSendingOpen(melbourneInstant(p.y, p.m, p.d, 0), q);
      return { action: "hold", reason: "cap", releaseAt, detail: `Already ${input.sentToday} automatic message${input.sentToday === 1 ? "" : "s"} today (limit ${cap}) — held for tomorrow.`, channels: plan.channels, fallback: plan.fallback };
    }
  }
  return { action: "send", channels: plan.channels, fallback: plan.fallback };
}
