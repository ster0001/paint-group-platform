/**
 * The induction content, as data (induction brief §5, Step 4).
 *
 * `docs/induction/induction-v1.md` is the ONLY source of the English words.
 * This module parses that file's loader format — per module the heading, the
 * `### Read and confirm` statements, the `### Tick` line and the `### Worker
 * version` selection — into the rows `induction_modules` / `induction_blocks`
 * hold, and into the string map the translation files mirror (one file per
 * language, the same keys). Nothing here invents or shortens a line: a file
 * that breaks the format throws with the module named, so the seed stops
 * rather than loading half an induction.
 *
 * Shared by server and client code: no fs, no Supabase. The file itself is
 * read by the seed script and the tests, never bundled into a page.
 */

export type InductionModule = {
  /** m01 … m13 */
  key: string;
  no: number;
  title: string;
  minutes: number;
  /** The Read-and-confirm lines, 1-based `line` as printed in the doc. */
  statements: { line: number; text: string }[];
  /** The one-line statement that ends the module. */
  tick: string;
  /** Module 5 only: the standards sign-off sections this module's ticks ARE. */
  standardsSections: string[];
  /** Which statement lines a WORKER reads (ruling ⚑17). Empty = the module is not in the worker induction. */
  workerLines: number[];
  /** Lines only a worker reads, 1-based. */
  workerExtra: { line: number; text: string }[];
};

export type InductionFile = {
  version: number;
  approvedOn: string;
  modules: InductionModule[];
};

export const MODULE_COUNT = 13;

/** The string keys a translation file carries for a module. */
export const STRING_KEYS = {
  title: (m: string) => `${m}.title`,
  statement: (m: string, line: number) => `${m}.s${line}`,
  tick: (m: string) => `${m}.tick`,
  workerExtra: (m: string, line: number) => `${m}.w${line}`,
};

const fail = (where: string, what: string): never => { throw new Error(`induction (${where}): ${what}`); };

/** Parse the markdown export. Pure and total: malformed input throws. */
export function parseInduction(md: string): InductionFile {
  const version = Number(/^Version:\s*(\d+)\s*$/m.exec(md)?.[1]);
  if (!Number.isInteger(version) || version < 1) fail("header", "Version: N is missing");
  const approvedOn = /^Approved:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(md)?.[1] ?? fail("header", "Approved: YYYY-MM-DD is missing");

  const heading = /^## Module (\d+) · (.+?) \((\d+) min\)\s*$/gm;
  const starts: { no: number; title: string; minutes: number; at: number; end: number }[] = [];
  for (let m = heading.exec(md); m; m = heading.exec(md)) {
    starts.push({ no: Number(m[1]), title: m[2].trim(), minutes: Number(m[3]), at: m.index, end: m.index + m[0].length });
  }
  if (starts.length !== MODULE_COUNT) fail("modules", `expected ${MODULE_COUNT} module headings, found ${starts.length}`);

  const modules: InductionModule[] = starts.map((s, i) => {
    if (s.no !== i + 1) fail(`module ${s.no}`, `modules must run 1..13 in order (found ${s.no} at position ${i + 1})`);
    // The module body runs to the next `## ` heading of any kind.
    const next = md.indexOf("\n## ", s.end);
    const body = md.slice(s.end, next === -1 ? md.length : next);
    const key = `m${String(s.no).padStart(2, "0")}`;
    const where = `module ${s.no}`;

    const confirm = section(body, "Read and confirm") ?? fail(where, "no `### Read and confirm` block");
    const standardsSections = (/^Standards:\s*(.+)$/m.exec(confirm)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const statements = numbered(confirm, where);
    if (statements.length === 0) fail(where, "Read and confirm has no numbered lines");

    const tickBlock = section(body, "Tick") ?? fail(where, "no `### Tick` block");
    const tick = tickBlock.split("\n").map((l) => l.trim()).find(Boolean) ?? fail(where, "Tick block is empty");

    const worker = section(body, "Worker version") ?? fail(where, "no `### Worker version` block");
    const linesSpec = (/^Lines:\s*(.+)$/m.exec(worker)?.[1] ?? fail(where, "Worker version has no `Lines:` line")).trim();
    const workerLines = linesSpec === "none" ? [] : linesSpec === "all" ? statements.map((x) => x.line)
      : linesSpec.split(",").map((x) => Number(x.trim())).map((n) => {
        if (!Number.isInteger(n) || !statements.some((x) => x.line === n)) fail(where, `Worker Lines names line ${n}, which the Read and confirm block does not have`);
        return n;
      });
    const extraAt = worker.indexOf("Extra:");
    const workerExtra = extraAt === -1 ? [] : numbered(worker.slice(extraAt + "Extra:".length), `${where} worker extra`);

    return { key, no: s.no, title: s.title, minutes: s.minutes, statements, tick, standardsSections, workerLines, workerExtra };
  });

  return { version, approvedOn, modules };
}

/** The text under `### <name>` up to the next `###` or `##` heading, or null. */
function section(body: string, name: string): string | null {
  const re = new RegExp(`^### ${name}\\s*$`, "m");
  const m = re.exec(body);
  if (!m) return null;
  const from = m.index + m[0].length;
  const rest = body.slice(from);
  const stop = /^##+ /m.exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

/** `1. text` lines, in order, contiguous from 1. Free prose around them is ignored. */
function numbered(block: string, where: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const raw of block.split("\n")) {
    const m = /^(\d+)\.\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const line = Number(m[1]);
    if (line !== out.length + 1) fail(where, `numbered lines must run 1, 2, 3… (found ${line} after ${out.length})`);
    out.push({ line, text: m[2] });
  }
  return out;
}

/**
 * The English string map: every piece of a module a painter reads in their
 * language, keyed the way the translation files are. The seed writes one
 * `induction_blocks` row per key per language from this.
 */
export function inductionStrings(file: InductionFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of file.modules) {
    out[STRING_KEYS.title(m.key)] = m.title;
    for (const s of m.statements) out[STRING_KEYS.statement(m.key, s.line)] = s.text;
    out[STRING_KEYS.tick(m.key)] = m.tick;
    for (const w of m.workerExtra) out[STRING_KEYS.workerExtra(m.key, w.line)] = w.text;
  }
  return out;
}

/** One `induction_blocks` row, before the version and language are known. */
export type BlockRow = {
  module_key: string;
  line_key: string;         // title | s1… | tick | w1…
  kind: "title" | "statement" | "tick" | "worker_extra";
  sort: number;
  /** Who reads it: contractor, worker, or both (⚑17). */
  audiences: ("contractor" | "worker")[];
};

/** The block rows for a module set, language-free (the text comes from the string map per language). */
export function blockRows(file: InductionFile): BlockRow[] {
  const rows: BlockRow[] = [];
  for (const m of file.modules) {
    let sort = 0;
    const workerIn = m.workerLines.length > 0 || m.workerExtra.length > 0;
    rows.push({ module_key: m.key, line_key: "title", kind: "title", sort: sort++, audiences: workerIn ? ["contractor", "worker"] : ["contractor"] });
    for (const s of m.statements) {
      const forWorker = m.workerLines.includes(s.line);
      rows.push({ module_key: m.key, line_key: `s${s.line}`, kind: "statement", sort: sort++, audiences: forWorker ? ["contractor", "worker"] : ["contractor"] });
    }
    for (const w of m.workerExtra) rows.push({ module_key: m.key, line_key: `w${w.line}`, kind: "worker_extra", sort: sort++, audiences: ["worker"] });
    rows.push({ module_key: m.key, line_key: "tick", kind: "tick", sort: sort++, audiences: workerIn ? ["contractor", "worker"] : ["contractor"] });
  }
  return rows;
}

/** The key a block row's text lives under in a string map. */
export function blockStringKey(row: Pick<BlockRow, "module_key" | "line_key">): string {
  return `${row.module_key}.${row.line_key}`;
}
