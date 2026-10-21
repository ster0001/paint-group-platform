/**
 * The subcontractor agreement, as data (contractor-agreement brief §4, §6, Step 1).
 *
 * `docs/agreements/subcontractor-agreement-v<N>.md` is the ONLY source of the
 * words a contractor signs. This module parses that file's loader format —
 * the `Version:` / `Approved:` header, `##` sections, `###` / `####` clause
 * headings, `1.` / `(a)` / `(i)` / `(A)` list items, `|` tables — into a block
 * model that the portal page and the PDF both render from (one renderer, so
 * what is read is what is locked), and lifts the `## Schedules` table out as
 * data for `agreement_versions.schedules`.
 *
 * Merge tokens are `{{contractor.abn}}`-style. The set is closed
 * (`MERGE_FIELDS`): a token outside it, or a field the file never uses, fails
 * the parse. Resolution is the renderer's job; `unresolvedFields` is how it
 * refuses to print a blank where an ABN should be.
 *
 * Shared by server and client code: no fs, no crypto, no Supabase. The file is
 * read by the seed script, the tests and the server renderer, never bundled.
 */

export const MERGE_FIELDS = [
  "contractor.company_name",
  "contractor.abn",
  "contractor.address",
  "contractor.signed_name",
  "contractor.signed_on",
  "contractor.signature",
  "company.signatory_name",
  "company.signed_on",
  "company.signature",
  "agreement.signed_on",
  "agreement.commencement_on",
  "agreement.expires_on",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

/** The two fields whose value is an image, not text. */
export const SIGNATURE_FIELDS: readonly MergeField[] = ["contractor.signature", "company.signature"];

export const isMergeField = (s: string): s is MergeField => (MERGE_FIELDS as readonly string[]).includes(s);

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "para"; text: string }
  /** level 0 = `1.` numbered, 1 = `(a)`, 2 = `(i)`, 3 = `(A)`; `marker` as printed. */
  | { kind: "item"; level: 0 | 1 | 2 | 3; marker: string; text: string }
  | { kind: "table"; rows: string[][] };

export type Schedule = { key: string; label: string; value: string };

export type AgreementFile = {
  version: number;
  approvedOn: string;
  sourceFile: string;
  title: string;
  blocks: Block[];
  schedules: Schedule[];
  /** Every merge field the document uses, in first-use order. */
  fields: MergeField[];
};

export const SCHEDULE_KEYS = "ABCDEFGHIJKLMNO".split("");

const fail = (where: string, what: string): never => { throw new Error(`agreement (${where}): ${what}`); };

const TOKEN = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

/** The runs of a text: literal text and merge tokens, in order. */
export type Run = { kind: "text"; text: string } | { kind: "token"; field: MergeField };

export function splitTokens(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ kind: "text", text: text.slice(last, at) });
    const field = m[1];
    if (!isMergeField(field)) throw new Error(`agreement (token): unknown merge field {{${field}}}`);
    runs.push({ kind: "token", field });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last) });
  return runs;
}

/** The merge fields a text uses. */
export function fieldsIn(text: string): MergeField[] {
  return splitTokens(text).flatMap((r) => (r.kind === "token" ? [r.field] : []));
}

/** The document content: everything from the first `## ` section on. The header and the provenance note above it are not wording. */
export function documentBody(md: string): string {
  const at = md.indexOf("\n## ");
  if (at === -1) fail("body", "no `## ` section");
  return md.slice(at + 1);
}

/** Parse the markdown file. Pure and total: malformed input throws with the place named. */
export function parseAgreement(md: string): AgreementFile {
  const version = Number(/^Version:\s*(\d+)\s*$/m.exec(md)?.[1]);
  if (!Number.isInteger(version) || version < 1) fail("header", "Version: N is missing");
  const approvedOn = /^Approved:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(md)?.[1] ?? fail("header", "Approved: YYYY-MM-DD is missing");
  const sourceFile = /^Source:\s*(\S+)\s*$/m.exec(md)?.[1] ?? fail("header", "Source: <path> is missing");
  const title = /^# (.+?)\s*$/m.exec(md)?.[1] ?? fail("header", "no `# Title` line");

  const blocks: Block[] = [];
  const lines = documentBody(md).split("\n");
  let para: string[] = [];
  let table: string[][] | null = null;
  const flushPara = () => { if (para.length) { blocks.push({ kind: "para", text: para.join(" ") }); para = []; } };
  const flushTable = () => { if (table) { blocks.push({ kind: "table", rows: table }); table = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") { flushPara(); flushTable(); continue; }
    if (line.startsWith("|")) {
      flushPara();
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      (table ??= []).push(cells);
      continue;
    }
    flushTable();
    const h = /^(#{1,4}) (.+)$/.exec(line);
    if (h) { flushPara(); blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3 | 4, text: h[2].trim() }); continue; }
    const item = /^(\d+\.|\([a-z]+\)|\([ivx]+\)|\([A-Z]\)) (.+)$/.exec(line);
    if (item) {
      flushPara();
      const marker = item[1];
      const level: 0 | 1 | 2 | 3 = /^\d/.test(marker) ? 0 : /^\([ivx]+\)$/.test(marker) ? 2 : /^\([A-Z]\)$/.test(marker) ? 3 : 1;
      blocks.push({ kind: "item", level, marker, text: item[2].trim() });
      continue;
    }
    para.push(line.trim());
  }
  flushPara(); flushTable();

  if (blocks.some((b) => b.kind === "heading" && b.level === 1)) fail("body", "the title is the header's `# ` line; the body has none");

  // The schedules: the one table in the `## Schedules` section, A..O in order.
  const schedulesAt = blocks.findIndex((b) => b.kind === "heading" && b.level === 2 && b.text === "Schedules");
  if (schedulesAt === -1) fail("schedules", "no `## Schedules` section");
  const next = blocks.findIndex((b, i) => i > schedulesAt && b.kind === "heading" && b.level === 2);
  const section = blocks.slice(schedulesAt + 1, next === -1 ? blocks.length : next);
  const tables = section.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");
  if (tables.length !== 1) fail("schedules", `expected one table, found ${tables.length}`);
  const [header, ...rows] = tables[0].rows;
  if (header.join("|") !== "Schedule|Item|Value") fail("schedules", "the table header is `| Schedule | Item | Value |`");
  const schedules: Schedule[] = rows.map((r, i) => {
    if (r.length !== 3) fail("schedules", `row ${i + 1} has ${r.length} cells, not 3`);
    const [key, label, value] = r;
    if (key !== SCHEDULE_KEYS[i]) fail("schedules", `row ${i + 1} is Schedule ${key}; expected ${SCHEDULE_KEYS[i]}`);
    if (!label.trim() || !value.trim()) fail("schedules", `Schedule ${key} has a blank item or value`);
    return { key, label, value };
  });
  if (schedules.length !== SCHEDULE_KEYS.length) fail("schedules", `expected ${SCHEDULE_KEYS.length} schedules, found ${schedules.length}`);

  if (!blocks.some((b) => b.kind === "heading" && b.level === 2 && b.text === "Signed as an agreement")) fail("signing", "no `## Signed as an agreement` section");

  const fields: MergeField[] = [];
  for (const b of blocks) {
    const texts = b.kind === "table" ? b.rows.flat() : [b.text];
    for (const t of texts) for (const f of fieldsIn(t)) if (!fields.includes(f)) fields.push(f);
  }
  const unused = MERGE_FIELDS.filter((f) => !fields.includes(f));
  if (unused.length) fail("tokens", `merge fields the document never uses: ${unused.join(", ")}`);

  return { version, approvedOn, sourceFile, title, blocks, schedules, fields };
}

/** The values a render needs, one per field; signature fields carry an image URL or data URL. */
export type MergeValues = Partial<Record<MergeField, string>>;

/** The fields a document uses that the values leave blank. Empty means the render may proceed. */
export function unresolvedFields(file: Pick<AgreementFile, "fields">, values: MergeValues): MergeField[] {
  return file.fields.filter((f) => !(values[f] ?? "").trim());
}

/** The merge fields the CONTRACTOR'S record must supply before they can sign (the rest are set at signing). */
export const PROFILE_FIELDS: readonly MergeField[] = ["contractor.company_name", "contractor.abn", "contractor.address"];

/** An ABN is 11 digits and passes the ATO weighting check. Spaces are tolerated. */
export function isValidAbn(raw: string): boolean {
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = weights.reduce((acc, w, i) => acc + w * (Number(digits[i]) - (i === 0 ? 1 : 0)), 0);
  return sum % 89 === 0;
}

/** An ABN as the document prints it: 11 digits in 2-3-3-3 groups. */
export function formatAbn(raw: string): string {
  const d = raw.replace(/\s+/g, "");
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : raw.trim();
}
