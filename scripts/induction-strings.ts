/**
 * Print the English string map a translation file must mirror — the
 * induction's Read-and-confirm lines, ticks, titles and worker extras from
 * docs/induction/induction-v1.md, plus every sentence of the finish standards
 * under `standards.` (lib/standards/strings.ts).
 *
 *   npx tsx scripts/induction-strings.ts > /tmp/en.json
 *
 * The committed English file docs/induction/translations/en.json is this
 * output; lib/induction/translations.test.ts fails when it drifts, and when
 * any other language's file is missing a key or carries one that no longer
 * exists. To start a new language: copy en.json, translate the values, keep
 * the keys.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inductionStrings, parseInduction } from "../lib/induction/source";
import { standardsFromFile, type StandardsFile } from "../lib/standards/source";
import { standardsStrings, STANDARDS_PREFIX } from "../lib/standards/strings";
import { translationFile } from "../lib/induction/translations";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const induction = parseInduction(readFileSync(resolve(ROOT, "docs/induction/induction-v1.md"), "utf8"));
const standards = standardsFromFile(JSON.parse(readFileSync(resolve(ROOT, "docs/standards/finish-standards-v1.json"), "utf8")) as StandardsFile);

const strings: Record<string, string> = { ...inductionStrings(induction) };
for (const [k, v] of Object.entries(standardsStrings(standards))) strings[`${STANDARDS_PREFIX}${k}`] = v;

process.stdout.write(JSON.stringify(translationFile("en", induction.version, standards.version.no, strings), null, 2) + "\n");
