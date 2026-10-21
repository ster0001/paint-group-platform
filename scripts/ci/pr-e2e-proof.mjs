/**
 * MAY A PUSH TO MAIN SKIP e2e? Only when its PR run already proved THIS tree
 * (21 Oct 2026).
 *
 * Until now main skipped e2e for every commit whose message began "Merge pull
 * request #", on the theory that the PR's own run had tested the same tree.
 * It had not, twice over: every PR here is merged within minutes of opening,
 * which fires the `closed` event that CANCELS the PR's run — so the "proof"
 * was a run that never finished — and a PR behind main tests a different
 * merge from the one that lands. No full e2e run completed in CI between
 * 13 and 20 Oct 2026, and a suite-wide red sat unseen for a week.
 *
 * So the skip is now EARNED, from the API, with the built-in token, in a
 * ten-second job that holds no lock. Four reads, each one fail-closed —
 * anything short of a complete answer means "run the suite":
 *
 *   1. the pushed commit has exactly two parents (a merge-button merge; a
 *      squash or a direct push has one, and nothing has tested those);
 *   2. main's tip before the merge (parent 1) is an ancestor of the PR head
 *      (parent 2) — `compare` says behind_by 0 — so the merge commit's tree
 *      IS the PR head's tree, and so was the test-merge tree the PR run built;
 *   3. a CI run for event pull_request, head_sha = parent 2, pull request
 *      based on main, concluded success;
 *   4. and in THAT run the e2e job itself concluded success. The run's own
 *      conclusion is not enough: the `closed` run has the same head_sha, every
 *      job skipped, and reports success.
 *
 * Dates are deliberately not used anywhere: committer dates can be older than
 * the push that carried them.
 */

/** @param {{ repo: string, sha: string, jobName: string, api: (path: string) => Promise<unknown> }} p
 *  @returns {Promise<{ proven: boolean, reason: string }>} */
export async function provePrRun({ repo, sha, jobName, api }) {
  const no = (reason) => ({ proven: false, reason });
  try {
    const commit = asRecord(await api(`/repos/${repo}/commits/${sha}`));
    const parents = Array.isArray(commit.parents) ? commit.parents.map((p) => asRecord(p).sha).filter((s) => typeof s === "string") : [];
    if (parents.length !== 2) return no(`${sha.slice(0, 8)} has ${parents.length} parent(s), not 2 — not a merge-button merge, nothing has tested this tree`);
    const [base, head] = parents;

    const cmp = asRecord(await api(`/repos/${repo}/compare/${base}...${head}`));
    if (cmp.behind_by !== 0) return no(`the PR head ${head.slice(0, 8)} was ${String(cmp.behind_by)} commit(s) behind main — its run tested a different merge`);

    const list = asRecord(await api(`/repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=20`));
    const runs = Array.isArray(list.workflow_runs) ? list.workflow_runs.map(asRecord) : [];
    const candidates = runs.filter((r) =>
      r.conclusion === "success" &&
      Array.isArray(r.pull_requests) &&
      r.pull_requests.some((pr) => asRecord(asRecord(pr).base).ref === "main"));
    if (candidates.length === 0) return no(`no green pull_request run into main for ${head.slice(0, 8)} (${runs.length} run(s) seen)`);

    for (const run of candidates) {
      const jobsBody = asRecord(await api(`/repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100`));
      const jobs = Array.isArray(jobsBody.jobs) ? jobsBody.jobs.map(asRecord) : [];
      const e2e = jobs.find((j) => j.name === jobName);
      if (e2e && e2e.conclusion === "success") {
        return { proven: true, reason: `run ${String(run.id)} (${String(run.html_url)}) ran "${jobName}" to success on ${head.slice(0, 8)}, which is this merge's tree` };
      }
    }
    return no(`green run(s) for ${head.slice(0, 8)} exist but none ran "${jobName}" to success`);
  } catch (e) {
    return no(`could not ask GitHub: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function asRecord(v) {
  return typeof v === "object" && v !== null ? v : {};
}

/** The entry point the workflow calls. Writes proven=/reason= to GITHUB_OUTPUT
 *  and never exits non-zero: a check that cannot decide decides "run it". */
async function main() {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const sha = process.env.GITHUB_SHA ?? "";
  const token = process.env.GITHUB_TOKEN ?? "";
  const jobName = process.env.E2E_JOB_NAME || "e2e (test project)";
  const api = async (path) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "paint-group-platform-ci",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  };
  const result = repo && sha
    ? await provePrRun({ repo, sha, jobName, api })
    : { proven: false, reason: "GITHUB_REPOSITORY or GITHUB_SHA not set" };
  console.log(`${result.proven ? "PROVEN — e2e may skip" : "NOT PROVEN — e2e runs"}: ${result.reason}`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `proven=${result.proven}\nreason=${result.reason.replace(/\r?\n/g, " ")}\n`);
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
