import assert from "node:assert/strict"
import test from "node:test"
import { assertOneCommit } from "../lib/guards.mjs"
import { livePr, setup } from "../lib/commands.mjs"
import {
  executePlan, planPureReplay, planSetup, renderPlan, renderSetupPlan, setupPrBodyText, SETUP_BRANCH,
} from "../lib/replay-pr.mjs"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const SHA_C = "c".repeat(40)
const UPSTREAM = "PostHog/posthog"
const FORK = "garnet-labs/posthog"
const CHANGES = [
  { path: "src/a.ts", status: "modified", previous: null },
  { path: "src/b.ts", status: "added", previous: null },
]
const RECORDERS = [".github/workflows/garnet-record.yml"]
const NO_UPSTREAM = /PostHog\/posthog|#\d|github\.com/

function purePlan(overrides = {}) {
  return planPureReplay({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", upstreamPr: 501,
    upstreamTitle: "feat: add thing", baseSha: SHA_A, headSha: SHA_B, changes: CHANGES,
    work: "/tmp/work", recordWorkflows: RECORDERS, ...overrides,
  })
}

function setupFiles() {
  return { ".github/workflows/garnet-record.yml": "on:\n  pull_request:\n" }
}

function setupPlan(overrides = {}) {
  const files = setupFiles()
  return planSetup({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", work: "/tmp/work",
    mode: "inject", files,
    message: "ci: record pull request runs with Garnet\n\n- .github/workflows/garnet-record.yml",
    body: setupPrBodyText({ mode: "inject", files: Object.keys(files), ecosystem: "npm" }),
    ...overrides,
  })
}

// ---------------------------------------------------------------- guards

test("guards: assertOneCommit accepts exactly one commit", () => {
  assert.equal(assertOneCommit("1\n"), 1)
  assert.throws(() => assertOneCommit("2"), /single-commit/)
  assert.throws(() => assertOneCommit("0"), /single-commit/)
})

// ---------------------------------------------------------------- planSetup

test("planSetup: one onboarding commit, fork-only writes, ready pull request", () => {
  const plan = setupPlan()
  assert.equal(plan.mode, "setup")
  assert.equal(plan.branch, SETUP_BRANCH)
  const ids = plan.steps.map((step) => step.id)
  for (const id of ["setup-branch", "setup-commit", "setup-push", "setup-pr"]) assert.ok(ids.includes(id), id)
  assert.equal(plan.steps.filter((step) => step.id.endsWith("-commit")).length, 1)
  for (const step of plan.steps.filter((step) => step.kind === "write-remote")) assert.equal(step.target, FORK)
  const branch = plan.steps.find((step) => step.id === "setup-branch")
  assert.deepEqual(branch.args.slice(-2), ["onboarding/garnet-recording", "origin/main"])
  const pr = plan.steps.find((step) => step.id === "setup-pr")
  assert.ok(!pr.args.includes("--draft"), "onboarding pull requests are ready to merge")
  assert.ok(pr.args.includes("main"), "the pull request opens against the default branch")
  for (const text of [plan.branch, plan.message, plan.title, plan.body]) assert.doesNotMatch(text, NO_UPSTREAM)
  const rendered = renderSetupPlan(plan)
  assert.match(rendered, /setup plan/)
  assert.match(rendered, /\.github\/workflows\/garnet-record\.yml/)
  assert.match(rendered, /dry run: nothing was executed/)
})

test("planSetup: refuses upstream as fork, non-.github files, empty input", () => {
  assert.throws(() => setupPlan({ fork: UPSTREAM }), /fork must not be the upstream/)
  assert.throws(() => setupPlan({ files: { "README.md": "x" } }), /only under \.github/)
  assert.throws(() => setupPlan({ files: {} }), /at least one file/)
  assert.throws(() => setupPlan({ message: "  " }), /commit message/)
})

test("setupPrBodyText: routine CI wording, no upstream reference", () => {
  const body = setupPrBodyText({ mode: "inject", files: [".github/workflows/garnet-record.yml", ".github/dependabot.yml"], ecosystem: "npm" })
  assert.match(body, /One-time onboarding/)
  assert.match(body, /\.github\/workflows\/garnet-record\.yml/)
  assert.match(body, /\.github\/dependabot\.yml/)
  assert.doesNotMatch(body, NO_UPSTREAM)
  const instrumented = setupPrBodyText({ mode: "instrument", files: [".github/workflows/ci.yml"], job: "test", changes: ["test: permissions contents: read, id-token: write"] })
  assert.match(instrumented, /test.*runs under the Garnet sensor/)
  assert.doesNotMatch(instrumented, NO_UPSTREAM)
})

// ---------------------------------------------------------------- planPureReplay

test("planPureReplay: exactly one commit, no wait, no scaffolding", () => {
  const plan = purePlan()
  assert.equal(plan.mode, "pure-replay")
  assert.equal(plan.singleCommit, true)
  assert.deepEqual(plan.steps.filter((step) => step.id.endsWith("-commit")).map((step) => step.id), ["change-commit"])
  assert.ok(!plan.steps.some((step) => step.kind === "wait-record"), "nothing is published after the change")
  assert.ok(!plan.steps.some((step) => step.kind === "ensure-base"))
  assert.ok(!plan.steps.some((step) => typeof step.writeFileContent?.file === "string" && step.writeFileContent.file.startsWith(plan.work)), "no scaffolding is written into the checkout")
  const verify = plan.steps.find((step) => step.id === "verify-commits")
  assert.ok(verify.args.join(" ").includes("origin/main..HEAD"))
  for (const step of plan.steps.filter((step) => step.kind === "write-remote")) assert.equal(step.target, FORK)
  for (const text of [plan.branch, plan.title, plan.body, plan.messages.change]) assert.doesNotMatch(text, NO_UPSTREAM)
  assert.doesNotMatch(plan.body, /Two commits/)
  const rendered = renderPlan(plan)
  assert.match(rendered, /the change \(the only commit\)/)
  assert.match(rendered, /the fork's own recording workflow records the pull request/)
  assert.doesNotMatch(rendered, /commit 1/)
})

test("planPureReplay: --base-branch carries the recorder via ensure-base", () => {
  const plan = purePlan({ baseBranch: "review/base" })
  const ensure = plan.steps.find((step) => step.kind === "ensure-base")
  assert.ok(ensure, "ensure-base step present")
  assert.equal(ensure.target, FORK)
  assert.deepEqual(ensure.carry, RECORDERS)
  assert.equal(ensure.carryFrom, "origin/main")
  assert.equal(plan.baseRef, "review/base")
  assert.match(ensure.message, /carry the fork's recording workflow/)
  const rendered = renderPlan(plan)
  assert.match(rendered, /set review\/base on the fork/)
})

test("planPureReplay: refuses unonboarded forks, clobbered recorders, filtered-out changes", () => {
  assert.throws(() => purePlan({ recordWorkflows: [] }), /onboard the fork first/)
  assert.throws(() => purePlan({
    changes: [...CHANGES, { path: ".github/workflows/garnet-record.yml", status: "modified", previous: null }],
    baseBranch: "review/base",
  }), /edits the fork's recording workflow/)
  assert.throws(() => purePlan({ recordFilters: { ".github/workflows/garnet-record.yml": ["e2e/**"] } }), /would record nothing/)
  assert.throws(() => purePlan({ baseBranch: "main" }), /other than main/)
  assert.throws(() => purePlan({ baseBranch: "review/base", syncFork: true }), /alternatives/)
  assert.throws(() => purePlan({ fork: UPSTREAM }), /fork must not be the upstream/)
  assert.throws(() => purePlan({ changes: [] }), /nothing to replay/)
})

// ---------------------------------------------------------------- executePlan: single-commit reconcile

function fakeExec(responses) {
  const calls = []
  const exec = (command, args, options = {}) => {
    calls.push([command, ...args].join(" "))
    for (const [pattern, out] of responses) {
      if (pattern.test(calls.at(-1))) return typeof out === "function" ? out(calls.at(-1), options) : out
    }
    return ""
  }
  return { exec, calls }
}

const memoryIo = () => ({ mkdirp: () => {}, readFile: () => { throw new Error("no files") }, writeFile: () => {} })

function reconcilePlan() {
  return {
    mode: "pure-replay", singleCommit: true, slug: "posthog", upstream: UPSTREAM, fork: FORK,
    defaultBranch: "main", baseRef: "main", branch: "replay/thing-501", work: "/tmp/work",
    steps: [
      { id: "find-pr", kind: "read", capture: "existingPr", cmd: "gh", args: ["pr", "list", "--repo", FORK, "--head", "replay/thing-501", "--state", "all", "--json", "number,state,isDraft,url"] },
      { id: "reconcile", kind: "reconcile", singleCommit: true, branch: "replay/thing-501", baseRef: "main", work: "/tmp/work" },
    ],
  }
}

test("executePlan: single-commit reconcile proceeds on a fresh branch", async () => {
  const { exec } = fakeExec([
    [/gh pr list/, "[]"],
    [/rev-parse --verify/, ""],
  ])
  const captured = await executePlan(reconcilePlan(), { exec, io: memoryIo(), log: () => {} })
  assert.equal(captured.forkPr ?? null, null)
  assert.equal(captured.reconciled, false)
})

test("executePlan: single-commit reconcile reuses a matching remote commit", async () => {
  const { exec } = fakeExec([
    [/gh pr list/, JSON.stringify([{ number: 9, state: "OPEN", isDraft: false, url: `https://github.com/${FORK}/pull/9` }])],
    [/rev-parse --verify/, `${SHA_C}\n`],
    [/rev-list --count/, "1\n"],
    [/rev-parse .*\{tree\}/, "tree-same\n"],
  ])
  const captured = await executePlan(reconcilePlan(), { exec, io: memoryIo(), log: () => {} })
  assert.equal(captured.forkPr, 9)
  assert.equal(captured.forkHeadSha, SHA_C)
})

test("executePlan: single-commit reconcile refuses a mismatched remote", async () => {
  const { exec } = fakeExec([
    [/gh pr list/, JSON.stringify([{ number: 9, state: "OPEN", isDraft: false, url: `https://github.com/${FORK}/pull/9` }])],
    [/rev-parse --verify/, `${SHA_C}\n`],
    [/rev-list --count/, "1\n"],
    [/rev-parse HEAD\^\{tree\}/, "tree-local\n"],
    [/rev-parse \S+\^\{tree\}/, "tree-remote\n"],
    [/git -C \/tmp\/work diff origin\/main HEAD/, "different-a\n"],
    [/git -C \/tmp\/work diff \S+~1 \S+$/, "different-bb\n"],
    [/patch-id/, (line, options) => `${String(options.input).length} 0000000\n`],
  ])
  await assert.rejects(
    executePlan(reconcilePlan(), { exec, io: memoryIo(), log: () => {} }),
    /matches the change commit by neither tree nor patch/,
  )
})

test("executePlan: single-commit commit-count assert accepts one, rejects two", async () => {
  const countPlan = () => ({
    mode: "pure-replay", singleCommit: true, slug: "posthog", upstream: UPSTREAM, fork: FORK, work: "/tmp/work",
    steps: [{ id: "verify-commits", kind: "read", capture: "commitCount", cmd: "git", args: ["-C", "/tmp/work", "rev-list", "--count", "origin/main..HEAD"] }],
  })
  const { exec } = fakeExec([[/rev-list --count/, "1\n"]])
  const captured = await executePlan(countPlan(), { exec, io: memoryIo(), log: () => {} })
  assert.equal(captured.commitCount, 1)
  const { exec: exec2 } = fakeExec([[/rev-list --count/, "2\n"]])
  await assert.rejects(executePlan(countPlan(), { exec: exec2, io: memoryIo(), log: () => {} }), /single-commit replay required/)
})

test("executePlan: setup refuses when an onboarding pull request is already open", async () => {
  const plan = {
    mode: "setup", slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "main",
    branch: SETUP_BRANCH, work: "/tmp/work",
    steps: [{ id: "setup-pr-exists", kind: "read", capture: "setupPr", cmd: "gh", args: ["pr", "list", "--repo", FORK, "--head", SETUP_BRANCH] }],
  }
  const { exec } = fakeExec([[/pr list/, JSON.stringify([{ number: 2, url: `https://github.com/${FORK}/pull/2` }])]])
  await assert.rejects(
    executePlan(plan, { exec, io: memoryIo(), log: () => {} }),
    /already open on onboarding\/garnet-recording/,
  )
})

// ---------------------------------------------------------------- executePlan: ensure-base

test("executePlan: ensure-base skips when the fork branch already carries the recording", async () => {
  const plan = {
    mode: "pure-replay", singleCommit: true, slug: "posthog", upstream: UPSTREAM, fork: FORK, work: "/tmp/work",
    steps: [{
      id: "ensure-base", kind: "ensure-base", target: FORK, baseBranch: "review/base", baseSha: SHA_A,
      carryFrom: "origin/main", carry: RECORDERS, message: "ci: carry the fork's recording workflow onto the replay base",
    }],
  }
  const { exec, calls } = fakeExec([
    [/rev-parse --verify/, "tree-carried\n"],
    [/write-tree/, "tree-carried\n"],
  ])
  const captured = await executePlan(plan, { exec, io: memoryIo(), log: () => {} })
  assert.equal(captured.baseBranchTree, "tree-carried")
  assert.ok(!calls.some((call) => call.includes("push")), "nothing is pushed when the tree already matches")
})

test("executePlan: ensure-base refuses an unexpected remote tree", async () => {
  const plan = {
    mode: "pure-replay", singleCommit: true, slug: "posthog", upstream: UPSTREAM, fork: FORK, work: "/tmp/work",
    steps: [{
      id: "ensure-base", kind: "ensure-base", target: FORK, baseBranch: "review/base", baseSha: SHA_A,
      carryFrom: "origin/main", carry: RECORDERS, message: "ci: carry the fork's recording workflow onto the replay base",
    }],
  }
  const { exec } = fakeExec([
    [/rev-parse --verify/, "tree-other\n"],
    [/write-tree/, "tree-carried\n"],
  ])
  await assert.rejects(executePlan(plan, { exec, io: memoryIo(), log: () => {} }), /unexpected tree; refusing to overwrite/)
})

// ---------------------------------------------------------------- livePr: refusal and pure mode

const RECORDING_BODY = "on:\n  pull_request:\njobs:\n  record:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: garnet-org/action@245ad6be82de3200c205109c8ca7ac816dc692ea\n"

function liveExec({ recording }) {
  return (command, args) => {
    assert.equal(command, "gh")
    if (args[0] === "repo") return JSON.stringify({ defaultBranchRef: { name: "main" } })
    if (args[1]?.includes(":.github/workflows")) {
      return JSON.stringify({ tree: recording ? [{ path: "garnet-record.yml", type: "blob" }] : [] })
    }
    if (args[1]?.includes("/contents/.github/workflows/")) return RECORDING_BODY
    if (args[1]?.includes("/contents/.github/dependabot.yml")) throw new Error("gh: Not Found (HTTP 404)")
    if (args[1]?.includes("/contents/src/")) return JSON.stringify({ sha: "same-blob" })
    if (args[1]?.endsWith("/pulls/501/files")) {
      return JSON.stringify(CHANGES.map((change) => ({ filename: change.path, status: change.status })))
    }
    if (args[1]?.endsWith("/pulls/501")) {
      return JSON.stringify({ title: "feat: add thing", base: { sha: SHA_A }, head: { sha: SHA_B } })
    }
    if (args[0] === "pr") return "[]"
    throw new Error(`unexpected gh call ${args.join(" ")}`)
  }
}

test("livePr: refuses without onboarding and points at setup", async () => {
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--dry-run"], { exec: liveExec({ recording: false }), log: () => {}, save: () => assert.fail("must not save") }),
    /onboard the fork first: replay setup posthog/,
  )
})

test("livePr: onboarded fork plans a pure single-commit replay", async () => {
  const result = await livePr(["posthog", "--pr", "501", "--dry-run"], { exec: liveExec({ recording: true }), log: () => {}, save: () => assert.fail("dry run must not save") })
  assert.equal(result.executed, false)
  assert.equal(result.plan.mode, "pure-replay")
  assert.equal(result.plan.singleCommit, true)
  assert.equal(result.plan.record, "fork-workflow")
  assert.doesNotMatch(result.plan.body, NO_UPSTREAM)
})

test("livePr: explicit --record inject still bundles on an onboarded fork", async () => {
  const result = await livePr(["posthog", "--pr", "501", "--record", "inject", "--ecosystem", "npm", "--dry-run"], { exec: liveExec({ recording: true }), log: () => {}, save: () => assert.fail("dry run must not save") })
  assert.equal(result.plan.record, "inject")
  assert.ok(result.plan.steps.some((step) => step.id === "first-commit"), "explicit --record inject still bundles a recorder as commit 1")
  assert.ok(result.plan.steps.some((step) => step.id === "change-commit"))
})

// ---------------------------------------------------------------- setup command

test("setup: already-onboarded fork reports nothing to do", async () => {
  const lines = []
  const result = await setup(["posthog", "--dry-run"], { exec: liveExec({ recording: true }), log: (line) => lines.push(line), save: () => assert.fail("must not save") })
  assert.equal(result.executed, false)
  assert.equal(result.plan, null)
  assert.ok(lines.some((line) => /nothing to onboard/.test(line)))
})

test("setup: plans a single onboarding commit via dry run", async () => {
  const lines = []
  const exec = (command, args) => {
    assert.equal(command, "gh")
    if (args[0] === "repo") return JSON.stringify({ defaultBranchRef: { name: "main" } })
    if (args[1]?.includes(":.github/workflows")) return JSON.stringify({ tree: [] })
    if (args[1]?.includes("/git/trees/")) return JSON.stringify({ tree: [{ path: "pnpm-lock.yaml", type: "blob" }] })
    if (args[1]?.includes("/contents/.github/dependabot.yml")) throw new Error("gh: Not Found (HTTP 404)")
    throw new Error(`unexpected gh call ${args.join(" ")}`)
  }
  const result = await setup(["posthog", "--dry-run"], { exec, log: (line) => lines.push(line), save: () => assert.fail("dry run must not save") })
  assert.equal(result.executed, false)
  assert.equal(result.plan.mode, "setup")
  assert.ok(result.plan.files.includes(".github/workflows/garnet-record.yml"))
  assert.ok(result.plan.files.includes(".github/dependabot.yml"), "adds Dependabot when the fork lacks it")
  assert.match(lines.join("\n"), /setup plan/)
})
