/**
 * Help content index — `npm run help:index` (add `-- --check` in CI, `-- --stamp` after regenerating media).
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
import { execFileSync } from "node:child_process";

const ROLES = ["staff", "pc", "contractor", "customer"] as const;
type Role = (typeof ROLES)[number];

const REQUIRED_KEYS = ["feature", "role", "title", "summary"] as const;
const OPTIONAL_KEYS = ["walkthrough", "verified_at_commit", "sources"] as const;
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
  /** Source paths whose changes make this help stale — the CI warning reads these. */
  sources: string[];
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

  const sources = (fm.data.get("sources") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const src of sources) {
    if (src.startsWith("/") || src.includes("..")) push(`sources entry "${src}" must be a repo-relative path`);
    else if (!existsSync(join(repoRoot, src))) push(`sources entry "${src}" does not exist in the repo`);
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
      sources,
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

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * `--stamp [feature…]`: write `verified_at_commit: <HEAD>` into the front-matter
 * of every role file of the named features (all features when none named).
 * Run it right after regenerating a feature's screenshots and walkthrough, so
 * the stamp names the source state the media was captured from.
 */
function stamp(entries: HelpIndexEntry[], features: string[]): number {
  const head = git(["rev-parse", "--short=10", "HEAD"]);
  if (!head) { console.error("help:index --stamp — not a git checkout, nothing stamped."); return 0; }
  let n = 0;
  for (const e of entries) {
    if (features.length && !features.includes(e.feature)) continue;
    const path = join(repoRoot, e.path);
    const text = readFileSync(path, "utf8");
    const updated = /^verified_at_commit:.*$/m.test(text.split(/\n---/, 2)[0] + "\n---")
      ? text.replace(/^verified_at_commit:.*$/m, `verified_at_commit: ${head}`)
      : text.replace(/^---\n([\s\S]*?)\n---/, (_m, fm: string) => `---\n${fm}\nverified_at_commit: ${head}\n---`);
    if (updated !== text) { writeFileSync(path, updated); n++; }
  }
  return n;
}

/**
 * Stale-walkthrough warning: a help file names its `sources`; if any commit
 * after `verified_at_commit` touched them (or the working tree has uncommitted
 * changes there), warn. GitHub renders `::warning::` lines as annotations. It
 * never fails the build — stale help is a chore, not a broken build.
 */
function staleWarnings(entries: HelpIndexEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (!e.verified_at_commit || e.sources.length === 0) continue;
    const known = git(["cat-file", "-t", e.verified_at_commit]);
    if (known !== "commit") {
      out.push(`::warning file=${e.path}::help for ${e.feature}/${e.role} was verified at ${e.verified_at_commit}, which this checkout cannot see (shallow clone?) — cannot tell whether it is stale`);
      continue;
    }
    const commits = git(["log", "--oneline", `${e.verified_at_commit}..HEAD`, "--", ...e.sources]).split("\n").filter(Boolean);
    const dirty = git(["status", "--porcelain", "--", ...e.sources]).split("\n").filter(Boolean);
    if (commits.length || dirty.length) {
      const what = [
        commits.length ? `${commits.length} commit${commits.length === 1 ? "" : "s"} since ${e.verified_at_commit}` : "",
        dirty.length ? `${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" and ");
      out.push(`::warning file=${e.path}::help for ${e.feature}/${e.role} may be stale — ${what} touched ${e.sources.join(", ")}. Re-run the capture spec, re-read the file, then \`npm run help:index -- --stamp ${e.feature}\`.`);
    }
  }
  return out;
}

function main(): void {
  const check = process.argv.includes("--check");
  const stampAt = process.argv.indexOf("--stamp");
  const { index, problems } = buildIndex();

  if (problems.length > 0) {
    for (const p of problems) console.error(`${p.file}: ${p.message}`);
    console.error(`\nhelp:index — ${problems.length} problem${problems.length === 1 ? "" : "s"} in docs/help/. See docs/help/README.md.`);
    process.exit(1);
  }

  if (stampAt >= 0) {
    const features = process.argv.slice(stampAt + 1).filter((a) => !a.startsWith("--"));
    const n = stamp(index.files, features);
    console.log(`help:index — stamped ${n} help file${n === 1 ? "" : "s"} with the current commit.`);
    // Re-read so the index carries the new stamps.
    const again = buildIndex();
    writeFileSync(indexPath, JSON.stringify(again.index, null, 2) + "\n");
    console.log(`help:index — wrote ${rel(indexPath)} (${again.index.files.length} help files).`);
    return;
  }

  for (const w of staleWarnings(index.files)) console.log(w);

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
