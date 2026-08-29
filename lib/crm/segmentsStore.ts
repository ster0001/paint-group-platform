/**
 * Where the lists live now: the crm_segments TABLE, not code (Tom, 30 Aug:
 * "we need to have control over building this, not a predefined list").
 *
 * Every reader — the segments page, the campaign dropdown, the dry run, the
 * sweep, the approve-time guard — loads through here, so there is exactly one
 * answer to "which lists exist". STANDING_SEGMENTS remains only as the seed
 * data and the fallback for a database the migration has not reached yet.
 *
 * Rows are validated on the way OUT of the database, not trusted: a criterion
 * the evaluator would not recognise makes the whole list unusable, loudly,
 * rather than silently matching wider than it was built to.
 */

import { criteriaSchema, STANDING_SEGMENTS, type Segment } from "./segments";

type Client = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      };
    };
  };
};

export type StoredSegment = Segment & { invalid?: string };

export async function loadSegments(db: Client): Promise<StoredSegment[]> {
  const { data, error } = await db.from("crm_segments")
    .select("key, name, description, criteria, standing")
    .order("standing", { ascending: false })
    .limit(200);

  // Before migration 20261211 the table does not exist; the seeds still work.
  if (error || !data) return STANDING_SEGMENTS;

  return data.map((row) => {
    const parsed = criteriaSchema.safeParse(row.criteria);
    return {
      key: String(row.key),
      name: String(row.name),
      description: String(row.description ?? ""),
      criteria: parsed.success ? parsed.data : [],
      standing: row.standing === true,
      ...(parsed.success ? {} : { invalid: "This list's rules didn't read back cleanly — open it and re-save." }),
    };
  });
}

export async function getSegment(db: Client, key: string): Promise<StoredSegment | null> {
  const all = await loadSegments(db);
  return all.find((s) => s.key === key) ?? null;
}
