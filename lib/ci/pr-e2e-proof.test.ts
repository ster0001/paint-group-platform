import { describe, expect, it } from "vitest";
import { provePrRun } from "../../scripts/ci/pr-e2e-proof.mjs";

/**
 * The main-push skip is EARNED from four API answers, each fail-closed. These
 * are the answers, faked, so the decision is pinned without a network — the
 * old message-prefix rule skipped for a cancelled run for a week before anyone
 * saw it, and this is the shape that must never come back.
 */
const REPO = "ster0001/paint-group-platform";
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD = "cccccccccccccccccccccccccccccccccccccccc";
const JOB = "e2e (test project)";

type Answers = Record<string, unknown>;

function api(answers: Answers) {
  return async (path: string) => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    const v = answers[path];
    if (v instanceof Error) throw v;
    return v;
  };
}

function green(overrides: Answers = {}): Answers {
  return {
    [`/repos/${REPO}/commits/${SHA}`]: { parents: [{ sha: BASE }, { sha: HEAD }] },
    [`/repos/${REPO}/compare/${BASE}...${HEAD}`]: { status: "ahead", ahead_by: 3, behind_by: 0 },
    [`/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=20`]: {
      workflow_runs: [
        // The `closed` run: same head_sha, every job skipped, "success".
        { id: 2, conclusion: "success", html_url: "u2", pull_requests: [{ base: { ref: "main" } }] },
        { id: 1, conclusion: "success", html_url: "u1", pull_requests: [{ base: { ref: "main" } }] },
      ],
    },
    [`/repos/${REPO}/actions/runs/2/jobs?per_page=100`]: { jobs: [{ name: "typecheck · lint · unit", conclusion: "skipped" }, { name: JOB, conclusion: "skipped" }] },
    [`/repos/${REPO}/actions/runs/1/jobs?per_page=100`]: { jobs: [{ name: "typecheck · lint · unit", conclusion: "success" }, { name: JOB, conclusion: "success" }] },
    ...overrides,
  };
}

const prove = (answers: Answers) => provePrRun({ repo: REPO, sha: SHA, jobName: JOB, api: api(answers) });

describe("a push to main skips e2e only when its PR run proved this exact tree", () => {
  it("is proven by a green e2e JOB in a pull_request run into main on the PR head, with main not having moved", async () => {
    const r = await prove(green());
    expect(r.proven).toBe(true);
    expect(r.reason).toContain("run 1");
  });

  it("is not proven by the closed-event run, whose jobs were all skipped", async () => {
    const r = await prove(green({
      [`/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=20`]: {
        workflow_runs: [{ id: 2, conclusion: "success", html_url: "u2", pull_requests: [{ base: { ref: "main" } }] }],
      },
    }));
    expect(r.proven).toBe(false);
    expect(r.reason).toMatch(/none ran "e2e \(test project\)" to success/);
  });

  it("is not proven by a cancelled PR run — the case that hid a red suite for a week", async () => {
    const r = await prove(green({
      [`/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=20`]: {
        workflow_runs: [{ id: 1, conclusion: "cancelled", html_url: "u1", pull_requests: [{ base: { ref: "main" } }] }],
      },
    }));
    expect(r.proven).toBe(false);
    expect(r.reason).toMatch(/no green pull_request run/);
  });

  it("is not proven when the PR was behind main: its run tested a different merge", async () => {
    const r = await prove(green({ [`/repos/${REPO}/compare/${BASE}...${HEAD}`]: { status: "diverged", ahead_by: 3, behind_by: 2 } }));
    expect(r.proven).toBe(false);
    expect(r.reason).toMatch(/2 commit\(s\) behind main/);
  });

  it("is not proven for a squash merge or a direct push (one parent)", async () => {
    const r = await prove(green({ [`/repos/${REPO}/commits/${SHA}`]: { parents: [{ sha: BASE }] } }));
    expect(r.proven).toBe(false);
    expect(r.reason).toMatch(/1 parent\(s\), not 2/);
  });

  it("is not proven by a green run of a PR into another branch (a stacked PR)", async () => {
    const r = await prove(green({
      [`/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=20`]: {
        workflow_runs: [{ id: 1, conclusion: "success", html_url: "u1", pull_requests: [{ base: { ref: "feat/movements-s8-proof" } }] }],
      },
    }));
    expect(r.proven).toBe(false);
  });

  it("fails closed on any API error or malformed answer", async () => {
    for (const bad of [
      { [`/repos/${REPO}/commits/${SHA}`]: new Error("HTTP 403") },
      { [`/repos/${REPO}/compare/${BASE}...${HEAD}`]: "not json" },
      { [`/repos/${REPO}/actions/runs/1/jobs?per_page=100`]: new Error("HTTP 500") },
      { [`/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=20`]: {} },
    ]) {
      const r = await prove(green(bad));
      expect(r.proven, JSON.stringify(Object.keys(bad))).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });
});
