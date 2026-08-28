"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * A2-02 · The settings tables save through ONE transaction.
 *
 * `EditableTable` used to loop in the browser, one insert/update round trip per
 * dirty row, collecting failures per row. A failure partway left the rate card
 * half saved — some rows repriced, some not, no rollback — and every estimate
 * priced afterwards used the mixture. CLAUDE.md requires multi-step money
 * operations to run in a single Postgres transaction via an RPC.
 *
 * This is also the server boundary those writes never had (A2-01): zod in, RPC
 * out. The table name is validated against the same allowlist the RPC enforces,
 * so neither side trusts the other.
 */

/** The tables EditableTable is mounted over. Mirrors the RPC's allowlist —
 *  deliberately duplicated, because a boundary that trusts the far side to
 *  validate is not a boundary. */
const TABLE = z.enum([
  "rate_items",
  "modifiers",
  "room_type_scope_rules",
  "room_type_defaults",
  "area_names",
  "area_name_presets",
]);

/** A cell: whatever the column holds. The RPC casts to the column's declared
 *  type and raises on an unknown column, so shape is checked at the database
 *  rather than guessed at here. */
const CELL = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const INPUT = z.object({
  table: TABLE,
  rows: z.array(z.record(z.string(), CELL)).min(1).max(500),
});

export type SaveRowsResult =
  | { ok: true; inserted: number; updated: number; newIds: string[] }
  | { ok: false; error: string };

export async function saveSettingsRows(input: unknown): Promise<SaveRowsResult> {
  const parsed = INPUT.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_settings_rows", {
    p_table: parsed.data.table,
    p_rows: parsed.data.rows,
  });

  if (error) {
    // The RPC's exceptions are deliberately readable — not_staff,
    // table_not_allowed, unknown_column, row_not_found — so pass the message
    // through rather than flattening it to "Save failed". A person editing a
    // rate card needs to know WHICH row and why.
    return { ok: false, error: error.message };
  }

  const out = data as { inserted?: number; updated?: number; newIds?: string[] } | null;
  return {
    ok: true,
    inserted: out?.inserted ?? 0,
    updated: out?.updated ?? 0,
    newIds: out?.newIds ?? [],
  };
}
