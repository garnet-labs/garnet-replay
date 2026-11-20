import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { addPushBranch, baselinePushExpected, baseRecordState, canUpgradeBase } from "../lib/base-baseline.mjs"
import { waitForBaseRecord } from "../lib/wait.mjs"
import { executePlan, planPureReplay, planReplay, renderPlan } from "../lib/replay-pr.mjs"
import { executeReplayJob } from "../lib/replay-runner-worker.mjs"
import { createReplayRunner } from "../lib/replay-runner.mjs"

const workflow = ".github/workflows/record.yml"
const branch = "deps/node-24-base"
const sha = "a".repeat(40)
const body = "name: Record\non:\n  push:\n    branches: ['master'] # keep\n  pull_request:\njobs:\n  install:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n"
const input = { slug: "example", upstream: "upstream/example", fork: "garnet-labs/example", defaultBranch: "master",
  forkDefaultSha: "c".repeat(40), upstreamPr: 1, baseSha: sha, headSha: "b".repeat(40), baseBranch: branch,
  changes: [{ path: "app.js", status: "modified", previous: null }], recordWorkflows: [workflow], workflowBodies: { [workflow]: body } }
const run = { id: 10, event: "push", head_branch: branch, head_sha: sha, path: workflow, status: "completed", conclusion: "success",
  jobs: [{ name: "Install", status: "completed", conclusion: "success", steps: [{ name: "Run garnet-org/action@pin", status: "completed", conclusion: "success" }] }] }

test("push rewriting preserves events, appends flow/block branches after exclusions, and is idempotent", () => {
  for (const original of [body, body.replace("['master'] # keep", "\n      - master\n      - '!deps/**'"), body.replace("['master']", "['master', '!deps/**']"), body.replaceAll("\n", "\r\n")]) {
    const updated = addPushBranch(original, branch)
    assert.match(updated, /node-24-base/)
    assert.match(updated, /pull_request:/)
    assert.match(updated, /master/)
    assert.equal(addPushBranch(updated, branch), updated)
    assert.equal(updated.includes("\r\n"), original.includes("\r\n"))
  }
  for (const trigger of ["push", "[push, pull_request]", "\n  push:", "\n  push: {}", "\n  push: null"]) {
    const unfiltered = `on: ${trigger}\njobs: {}\n`
    assert.equal(addPushBranch(unfiltered, branch), unfiltered)
  }
  const unfiltered = "on:\n  push:\n    paths: ['package.json']\n"
  assert.equal(addPushBranch(unfiltered, branch), unfiltered)
  for (const trigger of ["pull_request", "[pull_request, workflow_dispatch]", "\n  pull_request:"]) {
    assert.match(addPushBranch(`on: ${trigger}\njobs: {}\n`, branch), /push:\n    branches: \["deps\/node-24-base"\]/)
  }
  assert.match(addPushBranch(body.replace("on:", "'on':"), branch), /node-24-base/)
  const filtered = body.replace("  pull_request:", `    paths:\n      - package.json\n      - ${workflow}\n  pull_request:`)
  assert.match(addPushBranch(filtered, branch), /node-24-base/)
  assert.equal(baselinePushExpected(addPushBranch(filtered, branch), branch, [workflow]), true)
  assert.equal(baselinePushExpected(addPushBranch(filtered.replace(`      - ${workflow}`, `        - ${workflow}`), branch), branch, [workflow]), false)
  assert.equal(baselinePushExpected(addPushBranch(filtered.replace("  pull_request:", "      - '!**'\n  pull_request:"), branch), branch, [workflow]), false)
})

test("push rewriting refuses ambiguous mappings, filters, aliases and invalid branch names", () => {
  for (const original of ["jobs: {}", body.replace("on:", "on: *events"), body.replace("  push:", "  push: {branches: [master]}"),
    body.replace("['master']", "*branches"), body.replace("['master']", "[*branches]"), body.replace("['master']", "[${{ inputs.branch }}]"),
    body.replace("  pull_request:", "  push:\n  pull_request:"), body.replace("on:", "<<: *events\non:")]) {
    assert.throws(() => addPushBranch(original, branch), /cannot prepare baseline/)
  }
  for (const invalid of ["", "bad'branch", "-option", "../main", "a//b", "main.lock"]) assert.throws(() => addPushBranch(body, invalid), /plain branch/)
})

test("baseline push selection excludes callees, nonmatching paths and branch exclusions", () => {
  for (const callee of ["on: workflow_call\n", "on: [workflow_call]\n", "on:\n  workflow_call:\n"]) {
    assert.equal(addPushBranch(callee, branch), callee)
    assert.equal(baselinePushExpected(callee, branch, [workflow]), false)
  }
  const push = (filters) => `on:\n  push:\n${filters}\n`
  for (const [filters, expected] of [
    ["    paths: ['.github/workflows/**']", true], ["    paths: ['src/**']", false],
    ["    paths: ['**', '!.github/**']", false], ["    paths-ignore: ['src/**']", true],
    ["    paths-ignore: ['.github/**']", false], ["    branches-ignore: ['deps/**']", false],
    ["    branches-ignore: ['release/**']", true], ["    branches: ['master']", false],
    ["    branches: ['deps/**']", true], ["    paths: *unknown", false],
    ["    paths: ['+(src)/**']", false], ["    tags: ['v*']", false],
    ["    branches-ignore: ['!master']", false], ["    paths: ['.github/workflows/recor?.yml']", false],
  ]) assert.equal(baselinePushExpected(push(filters), branch, [workflow]), expected, filters)
  assert.equal(baselinePushExpected(push("    paths: ['**']"), branch, []), false)
})

test("pure planning waits only on expected entries in mixed carried sets and refuses an empty set", () => {
  const excluded = {
    ".github/workflows/callee.yml": "on: workflow_call\n",
    ".github/workflows/filtered.yml": "on:\n  push:\n    branches: [master]\n    paths: ['src/**']\n",
    ".github/workflows/ignored.yml": "on:\n  push:\n    paths-ignore: ['.github/**']\n",
    ".github/workflows/branch-ignored.yml": "on:\n  push:\n    branches-ignore: ['deps/**']\n",
  }
  const workflowBodies = { ...excluded, [workflow]: body }
  const plan = planPureReplay({ ...input, recordWorkflows: Object.keys(workflowBodies), workflowBodies })
  assert.deepEqual(plan.steps.find((step) => step.id === "wait-base-record").workflows, [workflow])
  assert.ok(!renderPlan(plan).split("\n").find((line) => line.includes("wait for successful push recordings")).includes("callee.yml"))
  assert.throws(() => planPureReplay({ ...input, recordWorkflows: Object.keys(excluded), workflowBodies: excluded }), /no carried entry workflow is expected to run/)
})

test("base upgrades require ancestry and both carry-only diffs", () => {
  const facts = { containsBase: true, remotePaths: [workflow], newPaths: [workflow, "REVIEW.md"], allowedPaths: [workflow, "REVIEW.md"] }
  assert.equal(canUpgradeBase(facts), true)
  assert.equal(canUpgradeBase({ ...facts, containsBase: false }), false)
  assert.equal(canUpgradeBase({ ...facts, remotePaths: ["app.js"] }), false)
  assert.equal(canUpgradeBase({ ...facts, newPaths: ["app.js"] }), false)
  assert.equal(canUpgradeBase({ ...facts, newPaths: [] }), false)
})

test("baseline state rejects unrelated success and requires every selected workflow at the exact push tip", () => {
  const state = (runs, workflows = [workflow]) => baseRecordState({ runs, workflows, branch, sha })
  assert.equal(state([run]).state, "recorded")
  assert.equal(state([]).state, "pending")
  for (const fields of [{ event: "pull_request" }, { head_branch: "master" }, { head_sha: "b".repeat(40) }, { path: ".github/workflows/build.yml" }, { status: "queued" }, { status: "in_progress" }]) assert.equal(state([{ ...run, ...fields }]).state, "pending")
  for (const conclusion of ["failure", "cancelled", "timed_out", "neutral", null]) assert.equal(state([{ ...run, conclusion }]).state, "failed")
  assert.equal(state([{ ...run, conclusion: "skipped" }]).state, "pending")
  assert.equal(state([run], [workflow, ".github/workflows/other.yml"]).state, "pending")
  assert.equal(state([run, { ...run, id: 11, status: "in_progress", conclusion: null }]).state, "pending")
  assert.throws(() => state([], []), /recording workflow/)
  assert.equal(state([{ ...run, jobs: [] }]).state, "failed")
  assert.equal(state([{ ...run, jobs: undefined }]).state, "pending")
  assert.equal(state([{ ...run, jobs: [{ ...run.jobs[0], conclusion: "skipped" }] }]).state, "pending")
  assert.equal(state([{ ...run, jobs: [{ ...run.jobs[0], steps: [{ ...run.jobs[0].steps[0], conclusion: "skipped" }] }] }]).state, "failed")
  assert.equal(state([{ ...run, jobs: [{ ...run.jobs[0], steps: [{ name: "Unrelated successful step", status: "completed", conclusion: "success" }] }] }]).state, "failed")
})

test("baseline exclusions require a successful recorder and never conceal active or failed runs", () => {
  const other = ".github/workflows/other.yml"
  const state = (runs, nowMs = 300000) => baseRecordState({ runs, workflows: [workflow, other], branch, sha, nowMs, firstRunAt: 0 })
  assert.equal(state([run], 299999).state, "pending")
  assert.equal(state([run]).state, "recorded")
  assert.match(state([run]).detail, /other.yml: absent after 5 min/)
  for (const skipped of [{ ...run, path: other, conclusion: "skipped" }, { ...run, path: other, jobs: [{ ...run.jobs[0], conclusion: "skipped" }] }]) {
    assert.equal(state([run, skipped], 0).state, "recorded")
    assert.equal(state([skipped]).state, "pending")
  }
  assert.equal(state([run, { ...run, path: other, status: "in_progress" }]).state, "pending")
  assert.equal(state([run, { ...run, path: other, conclusion: "failure" }]).state, "failed")
  assert.equal(state([run, { ...run, id: 11, status: "queued" }]).state, "pending")
})

test("baseline waiting applies absence grace from the first selected run, including historical tips", async () => {
  for (const historical of [true, false]) {
    let time = 600000
    let sleeps = 0
    const details = []
    const result = await waitForBaseRecord({ fork: input.fork, branch, sha, workflows: [workflow, "missing.yml"], timeoutMs: 400000, pollMs: 30000,
      now: () => time, sleep: async (ms) => { time += ms; sleeps += 1 }, log: (line) => details.push(line),
      exec: (_command, args) => JSON.stringify(args.at(-1).includes("/jobs?") ? [{ jobs: run.jobs }] : [{ workflow_runs: [{ ...run, ...(historical ? { created_at: new Date(0).toISOString() } : {}) }] }]) })
    assert.equal(result.state, "recorded")
    assert.equal(sleeps, historical ? 0 : 10)
    assert.match(details.at(-1), /missing.yml: absent after 5 min/)
  }
})

test("baseline waiting succeeds, skips sleeping for existing success, stops failed, and retains pending on timeout/API errors", async () => {
  const query = `repos/garnet-labs/example/actions/runs?event=push&branch=deps%2Fnode-24-base&head_sha=${sha}&per_page=100`
  const wait = async (responses, extra = {}) => {
    let time = 0
    let calls = 0
    let sleeps = 0
    const result = await waitForBaseRecord({ fork: input.fork, branch, sha, workflows: [workflow], timeoutMs: 60, pollMs: 30, now: () => time,
      sleep: async (ms) => { time += ms; sleeps += 1 }, exec: (command, args) => {
        assert.equal(command, "gh")
        if (args.at(-1).endsWith("/jobs?per_page=100")) {
          if (extra.jobError instanceof Error) throw extra.jobError
          return JSON.stringify([{ jobs: extra.jobs === undefined ? run.jobs : extra.jobs }])
        }
        assert.deepEqual(args, ["api", "--paginate", "--slurp", query])
        const response = responses[Math.min(calls++, responses.length - 1)]
        if (response instanceof Error) throw response
        return JSON.stringify(response)
      }, ...extra })
    return { result, calls, sleeps }
  }
  const ready = [{ workflow_runs: [run] }]
  const none = [{ workflow_runs: [] }]
  assert.equal((await wait([ready])).sleeps, 0)
  const later = await wait([none, [{ workflow_runs: [{ ...run, status: "in_progress" }] }], ready])
  assert.equal(later.result.state, "recorded")
  assert.equal(later.sleeps, 2)
  assert.equal((await wait([[{ workflow_runs: [{ ...run, conclusion: "failure" }] }]])).result.state, "failed")
  assert.equal((await wait([none])).result.state, "pending")
  const error = await wait([new Error("HTTP 403")])
  assert.equal(error.result.state, "pending")
  assert.match(error.result.detail, /HTTP 403/)
  assert.equal(error.calls, 1)
  assert.equal((await wait([{}])).result.state, "pending")
  assert.equal((await wait([ready], { jobs: [] })).result.state, "failed")
  assert.equal((await wait([ready], { jobs: null })).result.state, "pending")
  assert.match((await wait([ready], { jobError: new Error("HTTP 403 jobs") })).result.detail, /HTTP 403 jobs/)
})

test("baseline waiting defaults to 45 minutes and 30 seconds with injected clock/sleep", async () => {
  let time = 0
  const result = await waitForBaseRecord({ fork: input.fork, branch, sha, workflows: [workflow], now: () => time,
    exec: () => '[{"workflow_runs":[]}]', sleep: async (ms) => { assert.equal(ms, 30000); time += 45 * 60000 } })
  assert.equal(result.state, "pending")
  assert.equal(result.polls, 2)
  assert.match(result.detail, /45 min/)
})

test("alternate-base planning pins rewritten workflows and waits before branching or publishing", () => {
  const plan = planPureReplay(input)
  const ids = plan.steps.map((step) => step.id)
  const ensure = plan.steps.find((step) => step.id === "ensure-base")
  assert.equal(ensure.baseWorkflows[workflow], addPushBranch(body, branch))
  assert.match(ensure.message, /Include the base branch in push recording/)
  assert.ok(ids.indexOf("ensure-base") < ids.indexOf("wait-base-record"))
  assert.ok(ids.indexOf("wait-base-record") < ids.indexOf("branch"))
  assert.match(renderPlan(plan), /wait for successful push recordings.*base tip/)
  assert.throws(() => planPureReplay({ ...input, workflowBodies: {} }), /unreadable/)
  assert.throws(() => planPureReplay({ ...input, changes: [{ path: workflow }] }), /change edits.*workflow/)
  const reusable = ".github/workflows/reusable.yml"
  const nested = planPureReplay({ ...input, recordRoots: [workflow], recordWorkflows: [workflow, reusable], workflowBodies: { [workflow]: body, [reusable]: "on: workflow_call\n" } })
  assert.equal(nested.steps.find((step) => step.id === "ensure-base").baseWorkflows[reusable], "on: workflow_call\n")
})

test("executor stops pending or failed baseline waits before creating or publishing the replay, even with no-wait", async () => {
  const plan = planPureReplay(input)
  const steps = [plan.steps.find((step) => step.id === "ensure-base"), plan.steps.find((step) => step.id === "wait-base-record"), { id: "should-not-publish", kind: "write-remote", target: input.fork, cmd: "git", args: ["push"] }]
  for (const [runs, expected] of [[[], /not ready/], [[{ ...run, conclusion: "failure" }], /concluded failure/], [[run], null]]) {
    const calls = []
    const execution = executePlan({ ...plan, steps }, { io: { mkdirp: () => {}, writeFile: () => {} }, log: () => {}, wait: { timeoutMs: 0, enabled: false },
      exec: (command, args) => {
        calls.push([command, args])
        if (command === "gh") return JSON.stringify(args.at(-1).endsWith("/jobs?per_page=100") ? [{ jobs: run.jobs }] : [{ workflow_runs: runs }])
        if (args.includes("rev-parse")) return args.at(-1).endsWith("^{tree}") ? "tree" : sha
        if (args.includes("write-tree")) return "tree"
        return ""
      } })
    if (expected === null) assert.equal((await execution).baseRecord.state, "recorded")
    else await assert.rejects(execution, expected)
    assert.equal(calls.some(([command, args]) => command === "git" && args.includes("push")), expected === null)
  }
})

test("two-commit, injected, instrumented and already-recording source bases use the same pre-publication gate", () => {
  for (const options of [{}, { record: "inject", ecosystem: "npm" },
    { record: "instrument", instrument: { path: workflow, content: body, changes: ["Record install"], job: "install" } },
    { baseRecords: [workflow], baseWorkflowBodies: { [workflow]: body }, firstPaths: ["app.js"] }]) {
    const plan = planReplay({ ...input, firstPaths: ["app.js"], ...options })
    const ids = plan.steps.map((step) => step.id)
    assert.ok(ids.indexOf("ensure-base") < ids.indexOf("wait-base-record"))
    assert.ok(ids.indexOf("wait-base-record") < ids.indexOf("branch"))
    const ensure = plan.steps.find((step) => step.id === "ensure-base")
    assert.equal(ensure.copyPaths.length, 0)
    assert.match(Object.values(ensure.baseWorkflows).join("\n"), /deps\/node-24-base/)
    const preserve = plan.steps.find((step) => step.id === "first-base-record")
    assert.deepEqual(preserve.args.slice(2), ["checkout", `origin/${branch}`, "--", ...ensure.carry])
    assert.ok(ids.indexOf("first-base-record") < ids.indexOf("first-check"))
  }
  for (const options of [{}, { record: "inject", ecosystem: "npm" }, { record: "instrument", instrument: { path: workflow, content: body, changes: ["Record install"], job: "install" } }]) {
    assert.throws(() => planReplay({ ...input, ...options }), /commit 1 would be empty/)
  }
})

test("ensure-base upgrades an older carry commit by a non-force fast-forward and preserves source files", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "base-baseline-"))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Author", GIT_AUTHOR_EMAIL: "author@example.test", GIT_COMMITTER_NAME: "Author", GIT_COMMITTER_EMAIL: "author@example.test" } }).trim()
  git("init", "-q")
  writeFileSync(join(work, "app.js"), "source\n")
  git("add", ".")
  git("commit", "-qm", "Initial source")
  const baseSha = git("rev-parse", "HEAD")
  mkdirSync(join(work, ".github/workflows"), { recursive: true })
  writeFileSync(join(work, workflow), body)
  git("add", ".")
  git("commit", "-qm", "Configure recording")
  const defaultSha = git("rev-parse", "HEAD")
  git("update-ref", `refs/remotes/origin/${branch}`, defaultSha)
  const plan = planPureReplay({ ...input, work, workExists: true, baseSha, forkDefaultSha: defaultSha })
  let pushed = false
  git("update-ref", `refs/remotes/origin/${plan.branch}`, defaultSha)
  const guardExec = (command, args) => {
    if (args[2] === "fetch") return ""
    if (args[2] === "push") assert.fail("must refuse before upgrading a used base")
    return git(...args.slice(2))
  }
  await assert.rejects(executePlan({ ...plan, steps: plan.steps.filter((step) => step.id === "ensure-base") }, { log: () => {}, exec: guardExec }), /already uses the current base tip/)
  assert.equal(git("rev-parse", `refs/remotes/origin/${branch}`), defaultSha)
  git("update-ref", "-d", `refs/remotes/origin/${plan.branch}`)
  const captured = await executePlan({ ...plan, steps: plan.steps.filter((step) => step.id === "ensure-base") }, { log: () => {}, exec: (command, args) => {
    assert.equal(command, "git")
    const subcommand = args[2]
    if (subcommand === "fetch") return ""
    if (subcommand === "push") {
      assert.equal(args.some((arg) => arg.startsWith("--force") || arg.startsWith("+")), false)
      assert.equal(git("rev-parse", "HEAD^"), defaultSha)
      pushed = true
      return ""
    }
    return git(...args.slice(2))
  } })
  assert.equal(pushed, true)
  assert.equal(captured.baseBranchSha, git("rev-parse", "HEAD"))
  assert.equal(readFileSync(join(work, "app.js"), "utf8"), "source\n")
  assert.equal(readFileSync(join(work, workflow), "utf8"), addPushBranch(body, branch))
})

test("hosted worker preserves baseline pending stops and does not verify or save", async () => {
  await assert.rejects(executeReplayJob({ action: "start", slug: "example", number: 1, baseBranch: branch }, {
    execute: () => JSON.stringify({ resources: { core: { remaining: 1000, reset: Math.floor(Date.now() / 1000) + 3600 } } }), live: async () => { throw Object.assign(new Error("base is not ready"), { reason: "RECORD_PENDING" }) },
    verify: async () => assert.fail("must not verify"), save: async () => assert.fail("must not save"),
  }), (error) => error.reason === "RECORD_PENDING")
})

test("ensure-base refuses source-base and worktree symlinks before writing carried workflows", async (t) => {
  for (const sourceLink of [true, false]) {
    const work = mkdtempSync(join(tmpdir(), "base-links-"))
    t.after(() => rmSync(work, { recursive: true, force: true }))
    const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Author", GIT_AUTHOR_EMAIL: "author@example.test", GIT_COMMITTER_NAME: "Author", GIT_COMMITTER_EMAIL: "author@example.test" } }).trim()
    git("init", "-q")
    mkdirSync(join(work, ".github/workflows"), { recursive: true })
    writeFileSync(join(work, "outside.yml"), "preserve\n")
    if (sourceLink) symlinkSync("../../outside.yml", join(work, workflow))
    else writeFileSync(join(work, workflow), body)
    git("add", ".")
    git("commit", "-qm", "Initial source")
    const baseSha = git("rev-parse", "HEAD")
    rmSync(join(work, workflow))
    if (sourceLink) writeFileSync(join(work, workflow), body)
    else symlinkSync("../../outside.yml", join(work, workflow))
    const plan = planPureReplay({ ...input, work, baseSha })
    await assert.rejects(executePlan({ ...plan, steps: plan.steps.filter((step) => step.id === "ensure-base") }, {
      log: () => {}, exec: (command, args) => {
        if (args[2] === "fetch") return ""
        if (args[2] === "push") assert.fail("must not publish")
        return git(...args.slice(2))
      },
    }), /symlinks/)
    assert.equal(readFileSync(join(work, "outside.yml"), "utf8"), "preserve\n")
  }
})

test("runner persists recording pending stops separately from hard failures", async (t) => {
  for (const [reason, state] of [["RECORD_PENDING", "pending"], ["BASE_FAILED", "blocked"]]) {
    const directory = mkdtempSync(join(tmpdir(), "base-baseline-runner-"))
    const runner = await createReplayRunner({ directory, root: directory, enabled: true, launch: async (action) => {
      if (action === "prepare") return { state: "prepared", signature: "approved" }
      throw Object.assign(new Error("base stopped"), { reason })
    } })
    t.after(() => { runner.close(); rmSync(directory, { recursive: true, force: true }) })
    const job = await runner.prepare({ url: "https://github.com/upstream/example/pull/1", repository: input.upstream, number: 1 }, input)
    for (let tries = 0; tries < 100 && job.state !== "prepared"; tries += 1) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.equal(job.state, "prepared")
    await runner.start(job.id)
    let saved
    for (let tries = 0; tries < 100; tries += 1) {
      saved = JSON.parse(readFileSync(join(directory, "jobs.json"), "utf8"))[0]
      if (saved.state === state) break
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    assert.equal(saved.state, state)
    assert.equal(saved.reason, reason)
  }
})
