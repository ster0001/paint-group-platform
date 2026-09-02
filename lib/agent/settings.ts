/**
 * `agent_settings` → a typed object with every default the rulings log
 * names (D2, D8, D10, D12, D13, D15). Tenant-ready by construction: the row
 * is what varies, the code never does (§2 rule 10). Model ids are DATA —
 * verify against the Anthropic model list when changing the seed, never
 * recall them from memory (§2 rule 9).
 */

import { z } from "zod";

const hoursPair = z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]);

export const supportHoursSchema = z.object({
  timezone: z.string().default("Australia/Melbourne"),
  days: z.partialRecord(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), hoursPair).default({
    mon: ["08:00", "17:00"], tue: ["08:00", "17:00"], wed: ["08:00", "17:00"], thu: ["08:00", "17:00"], fri: ["08:00", "17:00"],
  }),
  strongCoverageDays: z.array(z.string()).default(["mon", "tue", "thu"]),
  /** D9: who is pinged for a live chat, by weekday (E.164 numbers); `default`
   *  covers unlisted days. `escalateTo` is pinged when the SLA passes. */
  roster: z.record(z.string(), z.array(z.string())).default({}),
  escalateTo: z.array(z.string()).default([]),
});
export type SupportHours = z.infer<typeof supportHoursSchema>;

export const agentSettingsSchema = z.object({
  tenantKey: z.string().default("paint-group"),
  modelDefault: z.string().min(1).default("claude-haiku-4-5"),
  modelHeavy: z.string().min(1).default("claude-sonnet-5"),
  budgetTokensPerConversation: z.number().int().positive().default(60_000),
  dailyCapPerAccount: z.number().int().positive().default(400_000),
  supportHours: supportHoursSchema.prefault({}),
  slaClaimSeconds: z.number().int().positive().default(180),
  tone: z.string().default("warm, plain Australian English; short sentences; never salesy"),
  assistantName: z.string().default("Paint Group assistant"),
  disclosureText: z.string().default("You're chatting with Paint Group's assistant. A person is one tap away."),
  hardStopScripts: z.record(z.string(), z.string()).default({}),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  /** Plan-reader ruling 3 / co-work §3.2: gaps whose swing is at least this
   *  are "will change the price"; the rest are cosmetic. */
  priceImpactGateCents: z.number().int().positive().default(15_000),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = agentSettingsSchema.parse({});

/** The DB row (snake_case) → settings. Any unusable field falls back to its
 *  default rather than failing the turn — a typo in Settings must not take
 *  the assistant down, and the seed row is the reference for the shape. */
export function settingsFromRow(row: unknown): AgentSettings {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const candidate = {
    tenantKey: r.tenant_key,
    modelDefault: r.model_default,
    modelHeavy: r.model_heavy,
    budgetTokensPerConversation: r.budget_tokens_per_conversation,
    dailyCapPerAccount: r.daily_cap_per_account,
    supportHours: r.support_hours,
    slaClaimSeconds: r.sla_claim_seconds,
    tone: r.tone,
    assistantName: r.assistant_name,
    disclosureText: r.disclosure_text,
    hardStopScripts: r.hard_stop_scripts,
    featureFlags: r.feature_flags,
    priceImpactGateCents: (r.feature_flags as Record<string, unknown> | null)?.priceImpactGateCents,
  };
  const parsed = agentSettingsSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // Field-by-field fallback: keep every field that parses on its own.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    const field = agentSettingsSchema.shape[k as keyof typeof agentSettingsSchema.shape];
    const one = field.safeParse(v);
    if (one.success) out[k] = one.data;
  }
  return agentSettingsSchema.parse(out);
}
