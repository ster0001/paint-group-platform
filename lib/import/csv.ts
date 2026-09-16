/**
 * A small RFC 4180 reader for the import packs: quoted fields, doubled
 * quotes, commas and newlines inside quotes (the events CSV carries JSON
 * payloads), CRLF or LF, a trailing newline or none. Header row → objects.
 * No dependency, because the loaders run from a bare `npx tsx`.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue; // a blank line
    if (r.length !== header.length) throw new Error(`csv row ${i + 1}: ${r.length} fields, header has ${header.length}`);
    const obj: Record<string, string> = {};
    header.forEach((h, j) => { obj[h] = r[j]; });
    out.push(obj);
  }
  return out;
}

export function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new Error("csv: unterminated quoted field");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
