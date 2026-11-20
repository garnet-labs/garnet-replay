import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { preparedRunId } from "../lib/hosted-runner.mjs"
import { recordState, waitForRecord } from "../lib/wait.mjs"
import { executeReplayJob } from "../lib/replay-runner-worker.mjs"

const sha = "a".repeat(40)
const comment = { body: `<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:commit ${sha} -->\n<!-- garnet:summary {"contract":"11.0.0","commit":"${sha}","status":"finalized","jobs":1} -->` }
const running = { name: "Garnet install proof", status: "in_progress", conclusion: null }
const completed = { ...running, status: "completed", conclusion: "success" }

test("hosted timeout fits baseline, first-record, head-record and settlement waits plus transfer time", () => {
  const workflow = readFileSync(new URL("../.github/workflows/replay.yml", import.meta.url), "utf8")
  const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(workflow)?.[1])
  assert.ok(minutes >= 4 * 45 + 60)
})

test("hosted plan IDs prefer plan, retain numeric request compatibility, and reject invalid inputs", () => {
  assert.equal(preparedRunId("44673507757", "correlation"), "44673507757")
  assert.equal(preparedRunId("44673507757", "123"), "44673507757")
  assert.equal(preparedRunId("", "44673507757"), "44673507757")
  assert.equal(preparedRunId(undefined, "44673507757"), "44673507757")
  for (const [plan, request] of [["", ""], [undefined, undefined], ["", "correlation"], ["bad", "123"], ["0", "123"], ["-1", "123"], ["1; echo unsafe", "123"]]) {
    assert.throws(() => preparedRunId(plan, request), /input 'plan'.*numeric prepare run ID/)
  }
})

test("the workflow downloads the resolved plan for both hosted start input shapes", () => {
  const workflow = readFileSync(new URL("../.github/workflows/replay.yml", import.meta.url), "utf8")
  const step = workflow.split("      - name: Download the prepared plan\n")[1].split("      - name:")[0]
  assert.match(step, /PLAN_RUN: \$\{\{ inputs.plan \}\}/)
  assert.match(step, /REQUEST_ID: \$\{\{ inputs.request \}\}/)
  const script = step.split("        run: |\n")[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n")
  const cwd = new URL("..", import.meta.url)
  const command = `set -e\ngh() { printf '%s\\n' "$*"; }\n${script}`
  for (const [PLAN_RUN, REQUEST_ID] of [["44673507757", "correlation"], ["", "44673507757"]]) {
    const output = execFileSync("bash", ["-c", command], { cwd, env: { ...process.env, PLAN_RUN, REQUEST_ID, GITHUB_REPOSITORY: "garnet-labs/garnet-replay", RUNNER_TEMP: "/unused" }, encoding: "utf8" })
    assert.match(output, /run download 44673507757 --repo garnet-labs\/garnet-replay/)
  }
  assert.throws(() => execFileSync("bash", ["-c", command], {
    cwd, env: { ...process.env, PLAN_RUN: "", REQUEST_ID: "correlation" }, stdio: "pipe",
  }), (error) => /input 'plan'/.test(error.stderr.toString()))
})

test("post-publish state waits for visible settled recording checks, leaving failures for verify", () => {
  const state = (checks, extra = {}) => recordState({ comments: [comment], checks, sha, settleChecks: true, ...extra })
  assert.equal(state([]).state, "pending")
  assert.equal(state([running]).state, "pending")
  assert.equal(state([{ ...running, status: "queued" }]).state, "pending")
  assert.equal(state([completed]).state, "recorded")
  assert.equal(state([{ ...completed, conclusion: "failure" }]).state, "recorded")
  assert.equal(state([running], { settleChecks: false }).state, "recorded")
  const withRun = { body: `${comment.body}\n[run](https://github.com/garnet-labs/example/actions/runs/123/job/456)` }
  const input = { comments: [withRun], sha, settleChecks: true }
  assert.equal(recordState({ ...input, checks: [completed, { ...running, name: "Install", details_url: "https://github.com/garnet-labs/example/actions/runs/123/job/456" }] }).state, "pending")
  assert.equal(recordState({ ...input, checks: [running, { ...completed, name: "Install", details_url: "https://github.com/garnet-labs/example/actions/runs/123/job/456" }] }).state, "recorded")
})

test("post-publish wait polls through a finalized comment with running checks and times out as pending", async () => {
  for (const settles of [true, false]) {
    let clock = 0
    let polls = 0
    const result = await waitForRecord({
      fork: "garnet-labs/example", forkPr: 1, sha, settleChecks: true, timeoutMs: 60000, pollMs: 30000,
      now: () => clock, sleep: async (ms) => { clock += ms },
      exec: (command, args) => {
        assert.equal(command, "gh")
        if (args.some((arg) => arg.includes("/comments"))) { polls += 1; return JSON.stringify([comment]) }
        if (args.some((arg) => arg.includes("/check-runs"))) return JSON.stringify({ check_runs: [settles && polls > 1 ? completed : running] })
        throw new Error(`Unexpected call: ${args.join(" ")}`)
      },
    })
    assert.equal(result.state, settles ? "recorded" : "pending")
    assert.equal(result.polls, settles ? 2 : 3)
    if (!settles) assert.match(result.detail, /checks running: Garnet install proof; gave up after 1 min/)
  }
  await assert.rejects(waitForRecord({ fork: "garnet-labs/example", forkPr: 1, sha, settleChecks: true, exec: () => { throw new Error("API unavailable") } }), /API unavailable/)
})

test("hosted pending checks never call verify or report a replay failure", async () => {
  await assert.rejects(executeReplayJob({ action: "start", slug: "example", number: 1 }, {
    execute: () => JSON.stringify({ resources: { core: { remaining: 5000, reset: 2000000000 } } }),
    live: async () => ({ plan: { fork: "garnet-labs/example" }, row: { forkPr: 1, forkHeadSha: sha } }),
    wait: async ({ settleChecks }) => { assert.equal(settleChecks, true); return { state: "pending", detail: "checks running; gave up after 45 min" } },
    verify: async () => { assert.fail("verify must not run before checks settle") },
  }), (error) => error.reason === "RECORD_PENDING" && /still pending.*gave up after 45 min/.test(error.message))
})
