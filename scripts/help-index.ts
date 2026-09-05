/**
 * Help content index — `npm run help:index` (add `-- --check` in CI).
 *
 * Walks docs/help/<feature>/<role>.md, validates every file's front-matter
 * against docs/help/README.md, and writes docs/help/_index.json — the list
 * Phase B (assistant retrieval) and Phase C (/help route) read. It never
 * reads the markdown bodies into the index; the body stays in the file, the
 * index only says where it is and who it is for.
 *
 * Fails (exit 1) with one readable line per problem on: unknown/missing/
 * malformed front-matter keys, a role outside the allowed set or not matching
 * the filename, a feature not matching its folder, a referenced screenshot or
 * walkthrough that does not exist, a stray .md file, and — with --check — a
 * committed _index.json that no longer matches what the files say.
 *
 * Runs on plain `node` (Node 24 strips types natively): no enums, no parameter
 * properties, `import type` only for types. Keep it that way.
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROLES = ["staff", "pc", "contractor", "customer"] as const;
type Role = (typeof ROLES)[number];

const REQUIRED_KEYS = ["feature", "role", "title", "summary"] as const;
const OPTIONAL_KEYS = ["walkthrough", "verified_at_commit"] as const;
const KNOWN_KEYS: ReadonlySet<string> = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

export type HelpIndexEntry = {
  feature: string;
  role: Role;
  title: string;
  summary: string;
  path: string;
  walkthrough: string | null;
  media: string[];
  verified_at_commit: string | null;
};

export type HelpIndex = {
  roles: readonly Role[];
  files: HelpIndexEntry[];
};

type Problem = { file: string; message: string };

const repoRoot = resolve(import.meta.dirname, "..");
const helpRoot = join(repoRoot, "docs", "help");
const indexPath = join(helpRoot, "_index.json");

function rel(p: string): string {
  return relative(repoRoot, p);
}

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

/** Parse the leading `--- … ---` block. Values are single-line; a trailing `# comment` is stripped. */
function parseFrontMatter(text: string): { data: Map<string, string>; problems: string[] } {
  const problems: string[] = [];
  const data = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    problems.push("file must start with a `---` front-matter block (copy docs/help/_template.md)");
    return { data, problems };
  }
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "---") {
      closed = true;
      break;
    }
    if (raw.trim() === "") continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (!m) {
      problems.push(`front-matter line ${i + 1} is not \`key: value\`: ${raw.trim()}`);
      continue;
    }
    const key = m[1] ?? "";
    let value = (m[2] ?? "").replace(/\s+#.*$/, "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!KNOWN_KEYS.has(key)) {
      problems.push(`unknown front-matter key "${key}" (allowed: ${[...KNOWN_KEYS].join(", ")})`);
      continue;
    }
    if (data.has(key)) problems.push(`front-matter key "${key}" appears twice`);
    data.set(key, value);
  }
  if (!closed) problems.push("front-matter block is never closed with `---`");
  return { data, problems };
}

/** Every `media/...` reference in the body — screenshots and any inline GIF. */
function mediaReferences(body: string): string[] {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\((media\/[^)\s]+)\)/g;
  for (const m of body.matchAll(re)) {
    const p = m[1];
    if (p) out.add(p);
  }
  return [...out].sort();
}

function validateFile(featureDir: string, feature: string, fileName: string): { entry: HelpIndexEntry | null; problems: Problem[] } {
  const filePath = join(featureDir, fileName);
  const file = rel(filePath);
  const problems: Problem[] = [];
  const push = (message: string) => problems.push({ file, message });

  const text = readFileSync(filePath, "utf8");
  const fm = parseFrontMatter(text);
  for (const p of fm.problems) push(p);

  for (const key of REQUIRED_KEYS) {
    const v = fm.data.get(key);
    if (v === undefined) push(`missing required front-matter key "${key}"`);
    else if (v === "" || v.startsWith("<")) push(`front-matter "${key}" is empty or still the template placeholder`);
  }

  const roleValue = fm.data.get("role") ?? "";
  if (roleValue && !isRole(roleValue)) {
    push(`role "${roleValue}" is not one of ${ROLES.join(", ")}`);
  }
  const expectedRole = fileName.replace(/\.md$/, "");
  if (!isRole(expectedRole)) {
    push(`file name must be one of ${ROLES.map((r) => r + ".md").join(", ")}`);
  } else if (roleValue && roleValue !== expectedRole) {
    push(`role "${roleValue}" does not match the file name "${fileName}"`);
  }

  const featureValue = fm.data.get("feature") ?? "";
  if (featureValue && featureValue !== feature) {
    push(`feature "${featureValue}" does not match the folder "${feature}"`);
  }

  const bodyStart = text.indexOf("\n---", 3);
  const body = bodyStart >= 0 ? text.slice(bodyStart + 4) : "";
  const media = mediaReferences(body);
  for (const m of media) {
    if (!existsSync(join(featureDir, m))) push(`referenced image does not exist: ${m}`);
  }

  const walkthrough = fm.data.get("walkthrough") ?? null;
  if (walkthrough !== null) {
    if (!/^media\/[a-z]+-walkthrough(-\d+)?\.gif$/.test(walkthrough)) {
      push(`walkthrough must be media/<role>-walkthrough.gif (or -2, -3 for a split flow), got "${walkthrough}"`);
    } else if (!walkthrough.startsWith(`media/${expectedRole}-`)) {
      push(`walkthrough "${walkthrough}" is not this role's GIF (expected media/${expectedRole}-walkthrough.gif)`);
    } else if (!existsSync(join(featureDir, walkthrough))) {
      push(`walkthrough file does not exist: ${walkthrough}`);
    }
  }

  const verified = fm.data.get("verified_at_commit") ?? null;
  if (verified !== null && !COMMIT.test(verified)) {
    push(`verified_at_commit "${verified}" is not a git commit hash`);
  }

  if (problems.length > 0 || !isRole(roleValue)) return { entry: null, problems };
  return {
    entry: {
      feature,
      role: roleValue,
      title: fm.data.get("title") ?? "",
      summary: fm.data.get("summary") ?? "",
      path: file,
      walkthrough,
      media,
      verified_at_commit: verified,
    },
    problems,
  };
}

export function buildIndex(): { index: HelpIndex; problems: Problem[] } {
  const problems: Problem[] = [];
  const files: HelpIndexEntry[] = [];

  for (const name of readdirSync(helpRoot).sort()) {
    if (name.startsWith("_") || name === "README.md") continue;
    const full = join(helpRoot, name);
    if (!statSync(full).isDirectory()) {
      problems.push({ file: rel(full), message: "only feature folders belong in docs/help/ (plus README.md and _template.md)" });
      continue;
    }
    if (!SLUG.test(name)) {
      problems.push({ file: rel(full), message: "feature folder must be a lowercase slug (letters, digits, single hyphens)" });
      continue;
    }
    let roleFiles = 0;
    for (const child of readdirSync(full).sort()) {
      const childPath = join(full, child);
      if (statSync(childPath).isDirectory()) {
        if (child !== "media") problems.push({ file: rel(childPath), message: "the only folder inside a feature is media/" });
        continue;
      }
      if (!child.endsWith(".md")) {
        problems.push({ file: rel(childPath), message: "only <role>.md files belong directly inside a feature folder; images go in media/" });
        continue;
      }
      roleFiles++;
      const r = validateFile(full, name, child);
      problems.push(...r.problems);
      if (r.entry) files.push(r.entry);
    }
    if (roleFiles === 0) problems.push({ file: rel(full), message: "feature folder has no <role>.md file" });
  }

  files.sort((a, b) => a.feature.localeCompare(b.feature) || a.role.localeCompare(b.role));
  return { index: { roles: ROLES, files }, problems };
}

function main(): void {
  const check = process.argv.includes("--check");
  const { index, problems } = buildIndex();

  if (problems.length > 0) {
    for (const p of problems) console.error(`${p.file}: ${p.message}`);
    console.error(`\nhelp:index — ${problems.length} problem${problems.length === 1 ? "" : "s"} in docs/help/. See docs/help/README.md.`);
    process.exit(1);
  }

  const json = JSON.stringify(index, null, 2) + "\n";
  if (check) {
    const current = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
    if (current !== json) {
      console.error(`${rel(indexPath)}: is stale — run \`npm run help:index\` and commit the result.`);
      process.exit(1);
    }
    console.log(`help:index — ${index.files.length} help file${index.files.length === 1 ? "" : "s"} indexed, _index.json is current.`);
    return;
  }
  writeFileSync(indexPath, json);
  console.log(`help:index — wrote ${rel(indexPath)} (${index.files.length} help file${index.files.length === 1 ? "" : "s"}).`);
}

main();
