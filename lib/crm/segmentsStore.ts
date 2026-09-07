/**
 * Where the lists live: the crm_segments TABLE, not code (Tom, 30 Aug: "we
 * need to have control over building this, not a predefined list").
 *
 * Every reader — the audiences page, the campaign dropdown, the dry run, the
 * sweep, the send-time guard — loads through here, so there is exactly one
 * answer to "which lists exist". STANDING_SEGMENTS remains only as the seed
 * data and the fallback for a database the migration has not reached yet.
 *
 * P5: a row carries `rules` (the tree). A row saved before P5 carries only
 * `criteria` (the flat AND list); it is translated on the way out, and the
 * next save writes `rules`. A rule the translation could not carry is
 * reported on the row rather than silently dropped.
 */

import { audienceSchema, legacyToAudience, ruleCount, STANDING_SEGMENTS, type Segment } from "./segments";

type Client = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      };
    };
  };
};

export type StoredSegment = Segment & {
  /** Set when the row could not be read cleanly — open it and re-save. */
  invalid?: string;
  /** Legacy rules with no home in the new model (draft progress etc.). */
  dropped?: string[];
  /** True when the row still carries only the pre-P5 shape. */
  legacy?: boolean;
};

export async function loadSegments(db: Client): Promise<StoredSegment[]> {
  const { data, error } = await db.from("crm_segments")
    .select("key, name, description, criteria, rules, standing")
    .order("standing", { ascending: false })
    .limit(200);

  if (error || !data) return STANDING_SEGMENTS;

  return data.map((row) => {
    const base = { key: String(row.key), name: String(row.name), description: String(row.description ?? ""), standing: row.standing === true };
    if (row.rules != null) {
      const parsed = audienceSchema.safeParse(row.rules);
      if (parsed.success) return { ...base, audience: parsed.data };
      return { ...base, audience: { groups: [] }, invalid: "This list's rules didn't read back cleanly — open it and re-save." };
    }
    const { audience, dropped } = legacyToAudience(row.criteria);
    return {
      ...base, audience, legacy: true,
      ...(dropped.length ? { dropped } : {}),
      ...(ruleCount(audience) === 0 ? { invalid: "This list has no rules the new builder understands — open it and rebuild." } : {}),
    };
  });
}

export async function getSegment(db: Client, key: string): Promise<StoredSegment | null> {
  const all = await loadSegments(db);
  return all.find((s) => s.key === key) ?? null;
}
