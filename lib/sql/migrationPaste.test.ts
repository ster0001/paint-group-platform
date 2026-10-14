import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Production migrations are PASTED into the Supabase SQL editor, whose
 * statement splitter is not Postgres. Twice on 14 Oct 2026 a file that ran
 * cleanly through `pg` failed in the editor with "unterminated dollar-quoted
 * string": each time the chunk it sent stopped inside a `$$` body, and each
 * time a `--` comment just before that body carried an apostrophe
 * ("20270218's body", "a contractor's demo") — a quote the splitter counts
 * as a string opening. A `do $$ … foreach … $$` loop fell to the same thing.
 *
 * So, for every migration written after the trap was found: no apostrophe
 * (or double quote) inside a `--` comment, and no DO block. Older files are
 * already live and are not judged.
 */
const DIR = join(__dirname, "..", "..", "supabase", "migrations");
const FROM = "20270263";

function commentPart(line: string): string | null {
  // A line that is a comment, or code followed by a trailing comment. String
  // literals are stripped first so a '--' inside one is not read as a comment.
  const noStrings = line.replace(/'(?:[^']|'')*'/g, "''");
  const at = noStrings.indexOf("--");
  if (at === -1) return null;
  return noStrings.slice(at);
}

describe("migrations paste cleanly into the Supabase SQL editor", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f >= FROM).sort();

  test("no apostrophe or double quote inside a -- comment", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(DIR, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        const c = commentPart(line);
        if (c && /['"]/.test(c)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test("no DO block — write the statements out", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(DIR, f), "utf8");
      if (/^\s*do\s+\$\$/im.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
