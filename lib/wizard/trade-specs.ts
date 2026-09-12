import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savedSpecSchema, type SavedSpec } from "./saved-specs";

/**
 * C15 — TRADE SPECS as rows (`trade_specs`), replacing the JSON that lived on
 * `accounts.flags.specs`.
 *
 * A spec is a job done again and again — the end-of-lease repaint, the
 * brand fit-out — saved once per account: scope preset, systems overrides,
 * condition band, colour policy (register | choose | brand), hours and the
 * segment defaults. The row's `spec` json is the saved-spec shape minus the
 * identity (id, name, createdAt live on the row), so `applySpec`,
 * `specFromState` and `specSummary` in lib/wizard/saved-specs.ts keep working
 * unchanged: this module only changes WHERE a spec lives.
 */

export const COLOUR_MODES = ["register", "choose", "brand"] as const;
export type ColourMode = (typeof COLOUR_MODES)[number];

export const tradeSpecBodySchema = savedSpecSchema.omit({ id: true, name: true, createdAt: true }).extend({
  /** register = the property's colour register is the default (walks A and B);
   * brand = the spec carries the colours (walk C); choose = ask every time. */
  colourMode: z.enum(COLOUR_MODES).default("register"),
  /** Walk C: the brand's colours, when colourMode is brand. */
  brandColours: z.object({
    walls: z.string().max(80).optional(), ceilings: z.string().max(80).optional(), trims: z.string().max(80).optional(),
    kitchen: z.string().max(120).optional(),
  }).optional(),
  hours: z.string().max(30).optional(),
  /** Walk C: the commercial segment and its defaults a new site inherits. */
  segment: z.string().max(40).optional(),
  segmentDefaults: z.record(z.string().max(40), z.unknown()).optional(),
});
export type TradeSpecBody = z.infer<typeof tradeSpecBodySchema>;

export type TradeSpecRow = {
  id: string;
  account_id: string;
  name: string;
  spec: unknown;
  used_count: number | null;
  created_at: string | null;
};

/** A row → the saved-spec shape the wizard applies. Null when the body is unusable. */
export function specFromRow(row: TradeSpecRow): (SavedSpec & { accountId: string; usedCount: number; colourMode: ColourMode; body: TradeSpecBody }) | null {
  const body = tradeSpecBodySchema.safeParse(row.spec ?? {});
  if (!body.success) return null;
  const spec = savedSpecSchema.safeParse({ ...body.data, id: row.id, name: row.name, createdAt: row.created_at ?? "" });
  if (!spec.success) return null;
  return { ...spec.data, accountId: row.account_id, usedCount: row.used_count ?? 0, colourMode: body.data.colourMode, body: body.data };
}

export type TradeSpec = NonNullable<ReturnType<typeof specFromRow>>;

/** The account(s)' specs, newest first, as the wizard reads them. */
export async function loadTradeSpecs(db: SupabaseClient, accountIds: string[]): Promise<TradeSpec[]> {
  if (!accountIds.length) return [];
  const { data, error } = await db.from("trade_specs")
    .select("id, account_id, name, spec, used_count, created_at")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as TradeSpecRow[]).map(specFromRow).filter((s): s is TradeSpec => s != null);
}

/** The row body from the saved-spec shape (what `specFromState` builds). */
export function rowBodyFromSpec(spec: SavedSpec, extra: Partial<TradeSpecBody> = {}): TradeSpecBody {
  const { id: _id, name: _name, createdAt: _createdAt, ...rest } = spec;
  void _id; void _name; void _createdAt;
  return tradeSpecBodySchema.parse({ ...rest, ...extra });
}
