import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3a-6 · The no-fork proof (brief: "assert with a shared-module test").
 * The portal never mounts its own wizard — "Get a new estimate" links to
 * /estimate, the ONE route, which mounts the ONE WizardApp. If a copy ever
 * appears under app/account, this fails on every commit.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("the portal and the public site share ONE wizard", () => {
  it("/estimate mounts the one WizardApp", () => {
    const page = readFileSync(resolve(ROOT, "app/estimate/page.tsx"), "utf8");
    expect(page).toContain(`import WizardApp from "../wizard/WizardApp"`);
  });

  it("nothing under app/account mounts a wizard — the portal links to /estimate", () => {
    const files = walk(resolve(ROOT, "app/account"));
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      // AddressField is a deliberately shared FIELD; a WizardApp import or a
      // second wizard implementation is a fork.
      return /WizardApp|defaultWizardState|wizardStateSchema/.test(src);
    });
    expect(offenders).toEqual([]);

    const home = readFileSync(resolve(ROOT, "app/account/(portal)/page.tsx"), "utf8");
    expect(home).toContain("/estimate");
  });

  it("the signed-in prefill rides props into the same component, not a variant", () => {
    const page = readFileSync(resolve(ROOT, "app/estimate/page.tsx"), "utf8");
    expect(page).toMatch(/prefill=\{memberEmail/);
    // 31 Aug: the contact page is the LAST page, and a member whose account
    // already carries name+phone+email (contactDone) never sees it.
    const app = readFileSync(resolve(ROOT, "app/wizard/WizardApp.tsx"), "utf8");
    expect(app).toMatch(/!contactDone \? 6 : 5/);
    expect(app).toMatch(/prefill\?\.email && prefill\?\.name/);
  });
});
