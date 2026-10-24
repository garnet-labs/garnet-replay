import assert from "node:assert/strict"
import test from "node:test"

import { acrossProfiles, isShard, readJobLog, renderUpstreamReport, summarizeUpstreamProfile } from "../lib/upstream.mjs"

const HEAD = "dafaf8c57aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const worker = ["systemd", "Runner.Listener", "Runner.Worker", "bash", "pn", "node"]

function profile(runId, extra = []) {
  return {
    run: { run_id: runId, profile_id: "01a0fbb7-d94f-7f2e-b642-8cca9a3029bc", repository: "pnpm/pnpm", workflow: "TS CI", job: "test", commit_sha: "ccc1b93a4dd30c4de875d451297bdfc29e3047f2", ref: "refs/pull/16522/merge" },
    assertions: [{ id: "no_bad_egress_domain", result: "ATTENTION" }],
    associations: [
      { remote_names: ["registry.npmjs.org"], remote_ports: ["443 (https)"], ancestry: worker, github_step: "13. Run tests" },
      { remote_names: ["blob.bn3prdstrz12a.store.core.windows.net"], ancestry: worker, github_step: "13. Run tests" },
      { remote_names: ["static.crates.io"], ancestry: ["systemd", "Runner.Listener", "Runner.Worker", "node", "pnpm"], github_step: "99. Runner Processes" },
      { remote_names: [], remote_address: "140.82.112.21", ancestry: worker, github_step: "13. Run tests" },
      { remote_names: ["8.8.8.8"], ancestry: ["systemd", "chronyd"], github_step: "" },
      ...extra,
    ],
  }
}

test("readJobLog finds the action SHA, profile links and the fork auth skip", () => {
  const log = [
    "Download action repository 'garnet-org/action@245ad6be82de3200c205109c8ca7ac816dc692ea' (SHA:245ad6be)",
    "Profile: https://app.garnet.ai/public/runs/37037721753?profile=01A0FBB7-D94F-7F2E-B642-8CCA9A3029BC",
    "again https://app.garnet.ai/public/runs/37037721753?profile=01a0fbb7-d94f-7f2e-b642-8cca9a3029bc",
  ].join("\n")
  const read = readJobLog(log)
  assert.equal(read.actionSha, "245ad6be82de3200c205109c8ca7ac816dc692ea")
  assert.equal(read.links.length, 1)
  assert.equal(read.authSkipped, false)
  assert.equal(readJobLog("Garnet skipped this Runtime Review because no authentication mechanism was available: x").authSkipped, true)
})

test("summarizeUpstreamProfile keeps workload egress with lineage and sets shards, addresses and runner rows aside", () => {
  const summary = summarizeUpstreamProfile(profile("1"), { headSha: HEAD })
  assert.equal(summary.binding, "merge-ref")
  assert.equal(summary.capture, "undeclared")
  assert.deepEqual(summary.workload.map((row) => row.destination), ["registry.npmjs.org"])
  assert.deepEqual(summary.workload[0].lineages, ["bash → pn → node"])
  assert.deepEqual(summary.workload[0].steps, ["Run tests"])
  assert.ok(summary.background.includes("static.crates.io"))
  assert.ok(summary.background.includes("140.82.112.21"))
  assert.ok(isShard("blob.bn3prdstrz12a.store.core.windows.net"))
  assert.equal(isShard("npm.jsr.io"), false)
  const exact = summarizeUpstreamProfile({ ...profile("1"), run: { ...profile("1").run, commit_sha: HEAD } }, { headSha: HEAD })
  assert.equal(exact.binding, "exact-head")
})

test("acrossProfiles separates destinations in every profile from leads seen in some", () => {
  const jsr = { remote_names: ["npm.jsr.io"], ancestry: worker, github_step: "13. Run tests" }
  const across = acrossProfiles([summarizeUpstreamProfile(profile("1")), summarizeUpstreamProfile(profile("2", [jsr]))])
  assert.deepEqual(across.always.map((row) => row.destination), ["registry.npmjs.org"])
  assert.deepEqual(across.sometimes.map((row) => [row.destination, row.runs]), [["npm.jsr.io", ["2"]]])
})

test("renderUpstreamReport names the binding, the auth skip and refuses to read absence", () => {
  const summary = summarizeUpstreamProfile(profile("1"))
  const report = {
    repository: "pnpm/pnpm", pr: 16522, title: "fix: warn", headSha: HEAD, crossRepository: false, observedAt: "2026-10-02T18:00:00.000Z",
    jobs: [
      { runId: "1", attempt: 1, name: "test", jobUrl: "https://github.com/pnpm/pnpm/actions/runs/1/job/2", actionSha: "245ad6be82de3200c205109c8ca7ac816dc692ea", authSkipped: false, profiles: [{ profileId: "01a0fbb7-d94f-7f2e-b642-8cca9a3029bc", url: "https://app.garnet.ai/public/runs/1?profile=01a0fbb7-d94f-7f2e-b642-8cca9a3029bc" }], summary },
      { runId: "3", attempt: 2, name: "test", jobUrl: "https://github.com/pnpm/pnpm/actions/runs/3/job/4", actionSha: null, authSkipped: true, profiles: [], summary: null },
    ],
    across: acrossProfiles([summary]),
  }
  const text = renderUpstreamReport(report)
  assert.match(text, /merge ref `refs\/pull\/16522\/merge`/)
  assert.match(text, /skipped: no authentication/)
  assert.match(text, /absence of a destination is not evidence of absence/)
  assert.match(text, /`no_bad_egress_domain=ATTENTION` ×1/)
  assert.match(renderUpstreamReport({ ...report, jobs: [report.jobs[1]], across: acrossProfiles([]) }), /undeterminable/)
  assert.match(renderUpstreamReport({ ...report, jobs: [], across: acrossProfiles([]) }), /No job ran a Garnet step/)
})
