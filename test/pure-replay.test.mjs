import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { assertOneCommit } from "../lib/guards.mjs"
import { livePr, setup } from "../lib/commands.mjs"
import {
  GARNET_ACTION_PIN, executePlan, planPureReplay, planReplay, planSetup, renderPlan, renderSetupPlan, replayAdmissionConflict, replayIdentity,
  replayIdentityFromBody, setupPrBodyText, SETUP_BRANCH, withReplayIdentity, workflowCarryPaths,
} from "../lib/replay-pr.mjs"
import { planPrepared } from "../lib/replay-prepared.mjs"
import { planDetails, planSignature } from "../lib/replay-runner.mjs"
import { branchHeadSha } from "../lib/gh.mjs"
import { kitResponse } from "./fixtures/grounding.mjs"

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
    work: "/tmp/work", forkDefaultSha: SHA_C, recordWorkflows: RECORDERS, ...overrides,
  })
}

test("replay identity ignores branch variants and claims one open logical change", () => {
  const first = withReplayIdentity(purePlan())
  const alternate = withReplayIdentity(purePlan({ branch: "chore/alternate" }))
  assert.equal(first.logicalId, alternate.logicalId)
  assert.equal(first.attemptId, alternate.attemptId)
  assert.deepEqual(replayIdentityFromBody(first.body), replayIdentity(first))
  assert.match(first.body, /<!-- change-id:[0-9a-f]{64} attempt:[0-9a-f]{64} -->/)
  assert.equal(first.steps.find((step) => step.id === "pr-body").writeFileContent.content, first.body)

  const conflicting = {
    number: 9, headRefName: "chore/alternate", title: alternate.title, body: alternate.body,
    url: `https://github.com/${FORK}/pull/9`,
  }
  assert.equal(replayAdmissionConflict({ replays: [] }, first, [conflicting]), conflicting)
  assert.equal(replayAdmissionConflict({ replays: [] }, alternate, [conflicting]), null)
})

test("prepared replay identity distinguishes exact file contents", () => {
  const workflow = ".github/workflows/record.yml"
  const baseSpec = {
    baseline: {
      [workflow]: `on:\n  pull_request:\njobs:\n  record:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: garnet-org/action@${GARNET_ACTION_PIN}\n`,
      "package.json": "{\"dependencies\":{\"example\":\"1.0.0\"}}\n",
    },
    change: { "package.json": "{\"dependencies\":{\"example\":\"2.0.0\"}}\n" },
    transition: { name: "example", from: "1.0.0", to: "2.0.0" },
    workflow,
  }
  const prepared = (spec) => planPrepared({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "main",
    work: "/tmp/work", spec,
  })
  const first = replayIdentity(prepared(baseSpec))
  const resumed = replayIdentity(planPrepared({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "main",
    work: "/tmp/work", spec: baseSpec, resume: true,
  }))
  const second = replayIdentity(prepared({
    ...baseSpec,
    change: { "package.json": "{\"dependencies\":{\"example\":\"2.0.1\"}}\n" },
  }))
  assert.equal(first.logicalId, second.logicalId)
  assert.equal(first.attemptId, resumed.attemptId)
  assert.notEqual(first.attemptId, second.attemptId)
})

test("replay admission recognizes pre-marker pull requests and ledger claims", () => {
  const plan = withReplayIdentity(purePlan())
  const legacy = {
    number: 7, headRefName: "chore/older", title: plan.title,
    body: plan.body.replace(/\n*<!-- change-id:.*?-->\n?/, "\n"),
    url: `https://github.com/${FORK}/pull/7`,
  }
  assert.equal(replayAdmissionConflict({ replays: [] }, plan, [legacy]), legacy)

  const ledgerPr = {
    number: 8, headRefName: "chore/ledger", title: "different", body: "different",
    url: `https://github.com/${FORK}/pull/8`,
  }
  const target = { replays: [{ upstreamPr: plan.upstreamPr, forkPr: 8, branch: ledgerPr.headRefName }] }
  assert.equal(replayAdmissionConflict(target, plan, [ledgerPr]), ledgerPr)
})

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

const CALLER = ".github/workflows/ci.yml"
const CALLEE = ".github/workflows/tests.yml"
const NESTED_CALLEE = ".github/workflows/build.yml"

function callsWorkflow(path) {
  return `on:\n  workflow_call:\njobs:\n  test:\n    uses: ./${path}\n`
}

test("workflowCarryPaths: carries a caller and its local callee", () => {
  assert.deepEqual(workflowCarryPaths([CALLER], {
    [CALLER]: callsWorkflow(CALLEE), [CALLEE]: "on: workflow_call\n",
  }), [CALLER, CALLEE])
})

test("workflowCarryPaths: carries nested callees transitively", () => {
  assert.deepEqual(workflowCarryPaths([CALLER], {
    [CALLER]: callsWorkflow(CALLEE), [CALLEE]: callsWorkflow(NESTED_CALLEE), [NESTED_CALLEE]: "on: workflow_call\n",
  }), [CALLER, CALLEE, NESTED_CALLEE])
})

test("workflowCarryPaths: deduplicates callers and diamond dependencies", () => {
  assert.deepEqual(workflowCarryPaths([CALLER, CALLER, NESTED_CALLEE], {
    [CALLER]: callsWorkflow(CALLEE), [CALLEE]: "on: workflow_call\n", [NESTED_CALLEE]: callsWorkflow(CALLEE),
  }), [CALLER, CALLEE, NESTED_CALLEE])
})

test("workflowCarryPaths: rejects cycles and self references", () => {
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: callsWorkflow(CALLEE), [CALLEE]: callsWorkflow(CALLER),
  }), /cyclic reusable workflows/)
  assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: callsWorkflow(CALLER) }), /cyclic reusable workflows/)
})

test("workflowCarryPaths: rejects remote and pinned local job-level reusable calls", () => {
  for (const uses of ["owner/repo/.github/workflows/tests.yml@main", "./.github/workflows/tests.yml@main", "./actions/build"]) {
    assert.throws(() => workflowCarryPaths([CALLER], {
      [CALLER]: `jobs:\n  test:\n    uses: ${uses}\n`,
    }), /reusable uses must be local and unpinned/)
  }
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: callsWorkflow(CALLEE), [CALLEE]: "jobs:\n  nested:\n    uses: owner/repo/.github/workflows/tests.yml@main\n",
  }), /reusable uses must be local and unpinned/)
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: "jobs:\n  remote: { uses: owner/repo/.github/workflows/tests.yml@main }\n",
  }), /expand inline or unsupported job mappings/)
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: "jobs: { remote: { uses: owner/repo/.github/workflows/tests.yml@main } }\n",
  }), /expand inline or unsupported job mappings/)
})

test("workflowCarryPaths: allows step-level action uses and ignores comments and run text", () => {
  const body = `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Record\n        uses: garnet-org/action@abc\n      - run: |\n          uses: owner/repo/.github/workflows/tests.yml@main\n    # uses: ./.github/workflows/commented.yml\n`
  assert.deepEqual(workflowCarryPaths([CALLER], { [CALLER]: body }), [CALLER])
  assert.deepEqual(workflowCarryPaths([], {}), [])
})

for (const key of ['"uses":', "'uses':", "<<:", "? uses"]) {
  test(`workflowCarryPaths: rejects unsupported job property ${key}`, () => {
    const property = key === "<<:" ? "<<: *anchor" : key === "? uses" ? "? uses\n    : owner/r/.github/workflows/x.yml@main" : `${key} owner/r/.github/workflows/x.yml@main`
    assert.throws(() => workflowCarryPaths([CALLER], {
      [CALLER]: `jobs:\n  test:\n    ${property}\n`,
    }), /unsupported workflow mapping key/)
  })
}

test("workflowCarryPaths: rejects unsupported keys at workflow and jobs map levels", () => {
  for (const body of [
    '"jobs":\n  test:\n    uses: owner/r/.github/workflows/x.yml@main\n',
    "'jobs':\n  test:\n    uses: owner/r/.github/workflows/x.yml@main\n",
    "<<: *anchor\njobs:\n  test:\n    steps: []\n",
    "? jobs\n: *anchor\n",
    'jobs:\n  "test":\n    uses: owner/r/.github/workflows/x.yml@main\n',
    "jobs:\n  <<: *anchor\n",
    "jobs:\n  ? test\n  : *anchor\n",
    "jobs:\n  test:\n    : *anchor\n",
    "jobs:\n  test:\n    uses : owner/r/.github/workflows/x.yml@main\n",
  ]) {
    assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: body }), /unsupported (?:workflow mapping key|job mappings)/)
  }
})

test("workflowCarryPaths: accepts quoted references with trailing comments", () => {
  for (const quote of ['"', "'"]) {
    assert.deepEqual(workflowCarryPaths([CALLER], {
      [CALLER]: `jobs:\n  test:\n    uses: ${quote}./${CALLEE}${quote} # reusable\n`, [CALLEE]: "on: workflow_call\n",
    }), [CALLER, CALLEE])
  }
})

test("workflowCarryPaths: refuses unreadable default-branch callers and callees", () => {
  assert.throws(() => workflowCarryPaths([CALLER], {}), /cannot carry workflow .*ci.yml: missing from the fork's default branch/)
  assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: callsWorkflow(CALLEE) }), /cannot carry workflow .*tests.yml: missing from the fork's default branch/)
})

for (const indent of [1, 2]) {
  test(`workflowCarryPaths: rejects workflows uniformly indented ${indent} spaces`, () => {
    const body = "on:\n  pull_request:\njobs:\n  t:\n    uses: owner/r/.github/workflows/x.yml@main\n"
    assert.throws(() => workflowCarryPaths([CALLER], {
      [CALLER]: body.split("\n").map((line) => " ".repeat(indent) + line).join("\n"),
    }), /must start at column 0/)
  })
}

test("workflowCarryPaths: rejects indented content after leading comments", () => {
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: "# workflow\n\n  on: pull_request\n  jobs:\n    t:\n      uses: owner/r/.github/workflows/x.yml@main\n",
  }), /must start at column 0/)
  assert.throws(() => workflowCarryPaths([CALLER], {
    [CALLER]: "on:\n  pull_request:\n  jobs:\n    t:\n      uses: owner/r/.github/workflows/x.yml@main\n",
  }), /jobs must start at column 0/)
})

test("workflowCarryPaths: rejects duplicate uses regardless of value order", () => {
  for (const uses of [
    ["owner/r/.github/workflows/x.yml@main", `./${CALLEE}`],
    [`./${CALLEE}`, "owner/r/.github/workflows/x.yml@main"],
  ]) {
    assert.throws(() => workflowCarryPaths([CALLER], {
      [CALLER]: `jobs:\n  t:\n    uses: ${uses[0]}\n    uses: ${uses[1]}\n`, [CALLEE]: "on: workflow_call\n",
    }), /duplicate workflow mapping key uses/)
  }
})

test("workflowCarryPaths: rejects duplicate workflow keys, job ids, and job properties", () => {
  for (const body of [
    "on: pull_request\non: workflow_call\n",
    "jobs:\n  t:\n    steps: []\njobs:\n  t:\n    steps: []\n",
    "jobs:\n  t:\n    steps: []\n  t:\n    steps: []\n",
    "jobs:\n  t:\n    permissions: {}\n    permissions: write-all\n",
  ]) assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: body }), /duplicate workflow mapping key/)
})

test("workflowCarryPaths: rejects inconsistent job and job-property indentation", () => {
  for (const body of [
    "jobs:\n  t:\n    steps: []\n   other:\n     uses: owner/r/.github/workflows/x.yml@main\n",
    "jobs:\n  t:\n    steps: []\n    other:\n      uses: owner/r/.github/workflows/x.yml@main\n",
    "jobs:\n  t:\n    name: Test\n      uses: owner/r/.github/workflows/x.yml@main\n",
    "jobs:\n  t:\n    name: Test\n   uses: owner/r/.github/workflows/x.yml@main\n",
    "jobs:\n  t:\n    steps: []\n  other:\n      uses: owner/r/.github/workflows/x.yml@main\n",
  ]) assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: body }), /indentation|unsupported (?:job property|nested workflow content)/)
})

test("workflowCarryPaths: accepts canonical CRLF workflows with leading comments", () => {
  assert.deepEqual(workflowCarryPaths([CALLER], {
    [CALLER]: `# caller\r\n\r\n${callsWorkflow(CALLEE).replace(/\n/g, "\r\n")}`, [CALLEE]: "on: workflow_call\r\n",
  }), [CALLER, CALLEE])
})

for (const [name, character] of [
  ["NEL", "\u0085"], ["line separator", "\u2028"], ["paragraph separator", "\u2029"],
  ["bare CR", "\r"], ["BOM", "\uFEFF"], ["NBSP", "\u00A0"], ["NUL", "\0"], ["DEL", "\x7F"],
]) {
  test(`workflowCarryPaths: rejects ${name} before interpreting workflow structure`, () => {
    const body = `jobs:\n  t:\n    name: x${character}    uses: owner/r/.github/workflows/x.yml@main\n`
    assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: body }), /unsupported workflow character/)
    assert.throws(() => workflowCarryPaths([CALLER], {
      [CALLER]: callsWorkflow(CALLEE), [CALLEE]: body,
    }), /unsupported workflow character/)
  })
}

test("workflowCarryPaths: rejects alias, anchored, and folded reusable uses", () => {
  for (const value of ["*remote", "&remote owner/r/.github/workflows/x.yml@main", ">-\n      owner/r/.github/workflows/x.yml@main"]) {
    assert.throws(() => workflowCarryPaths([CALLER], { [CALLER]: `jobs:\n  t:\n    uses: ${value}\n` }), /reusable uses must be local and unpinned/)
  }
})

for (const [fork, ref, caller, callee, support] of [
  ["litellm", "2d48a1f", "test-unit-core-utils.yml", "_test-unit-base.yml", []],
  ["code-interpreter", "b7514ab", "pull_request.yml", "charts_tests.yml", ["build_test_template.yml", "js_tests.yml", "python_tests.yml", "performance_tests.yml", "cleanup_build_template.yml"]],
]) {
  test(`workflowCarryPaths: real garnet-labs/${fork}@${ref} caller and callee parse`, async () => {
    const prefix = ".github/workflows/"
    const bodies = Object.fromEntries(support.map((file) => [prefix + file, "on: workflow_call\n"]))
    for (const file of [caller, callee]) {
      bodies[prefix + file] = await readFile(`test/fixtures/workflows/garnet-labs_${fork}-${ref}-${file}`, "utf8")
    }
    const carried = workflowCarryPaths([prefix + caller], bodies)
    assert.deepEqual(new Set(carried), new Set([caller, callee, ...support].map((file) => prefix + file)))
    assert.deepEqual(workflowCarryPaths([prefix + callee], bodies), [prefix + callee])
  })
}

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
  assert.equal(ensure.carryFrom, SHA_C)
  assert.equal(plan.baseRef, "review/base")
  assert.match(ensure.message, /carry the fork's recording workflow/)
  const rendered = renderPlan(plan)
  assert.match(rendered, /set review\/base on the fork/)
})

test("planPureReplay: records the exact default SHA in CLI and hosted plans and pins checkout", () => {
  const plan = purePlan()
  assert.equal(plan.forkDefaultSha, SHA_C)
  assert.equal(planDetails(plan).forkDefaultSha, SHA_C)
  assert.ok(renderPlan(plan).includes(`fork default snapshot: main@${SHA_C}`))
  assert.ok(renderPlan(plan).includes(`refuse a moved default branch`))
  assert.equal(plan.steps.find((step) => step.id === "branch").args.at(-1), SHA_C)
  assert.notEqual(planSignature(plan), planSignature(purePlan({ forkDefaultSha: SHA_A })))
  for (const options of [{ baseBranch: "review/base" }, { syncFork: true }]) {
    const variant = purePlan(options)
    const guard = variant.steps.findIndex((step) => step.kind === "verify-fork-default")
    assert.ok(guard >= 0)
    assert.ok(guard < variant.steps.findIndex((step) => step.kind === "ensure-base" || step.id === "sync-fork"))
  }
  for (const forkDefaultSha of [undefined, null, "", "main", "a".repeat(39)]) {
    assert.throws(() => purePlan({ forkDefaultSha }), /fork default-branch SHA unresolved/)
  }
})

test("branchHeadSha: validates API data and preserves read failures", () => {
  const exec = (command, args) => {
    assert.equal(command, "gh")
    assert.deepEqual(args, ["api", `repos/${FORK}/commits/release%2Fstable`])
    return JSON.stringify({ sha: SHA_C })
  }
  assert.equal(branchHeadSha(FORK, "release/stable", { exec }), SHA_C)
  for (const result of [null, {}, { sha: "" }, { sha: "main" }]) {
    assert.throws(() => branchHeadSha(FORK, "main", { exec: () => JSON.stringify(result) }), /could not resolve the commit SHA/)
  }
  assert.throws(() => branchHeadSha(FORK, "main", { exec: () => { throw new Error("HTTP 403") } }), /HTTP 403/)
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

test("two-commit replay: recorder checkout and execution are bound to the planned fork SHA", async () => {
  const input = { ...purePlan({ baseBranch: "review/base" }), changes: CHANGES }
  const plan = planReplay(input)
  const guard = plan.steps.find((step) => step.kind === "verify-fork-default")
  const checkout = plan.steps.find((step) => step.id === "first-fork-record")
  assert.equal(plan.forkDefaultSha, SHA_C)
  assert.deepEqual(checkout.args.slice(-3), [SHA_C, "--", RECORDERS[0]])
  assert.ok(plan.steps.indexOf(guard) < plan.steps.findIndex((step) => step.kind === "write-remote"))
  const pinned = { ...plan, steps: [guard, checkout] }
  const matching = fakeExec([[/gh api .*\/commits\/main/, JSON.stringify({ sha: SHA_C })]])
  await executePlan(pinned, { exec: matching.exec, io: memoryIo(), log: () => {} })
  assert.ok(matching.calls.includes(`git -C ${plan.work} checkout ${SHA_C} -- ${RECORDERS[0]}`))
  const moved = fakeExec([[/gh api .*\/commits\/main/, JSON.stringify({ sha: SHA_A })]])
  await assert.rejects(executePlan(pinned, { exec: moved.exec, io: memoryIo(), log: () => {} }), /default branch .* moved: planned .* current .*prepare a new replay plan/)
  assert.equal(moved.calls.length, 1)
  for (const forkDefaultSha of [undefined, null, "", "main"]) {
    assert.throws(() => planReplay({ ...input, forkDefaultSha }), /fork default-branch SHA unresolved/)
  }
})

test("executePlan: a moved default branch refuses before base checkout or publication", async () => {
  for (const options of [{}, { baseBranch: "review/base" }, { syncFork: true }]) {
    const plan = purePlan(options)
    const guard = plan.steps.findIndex((step) => step.kind === "verify-fork-default")
    const { exec, calls } = fakeExec([[/gh api .*\/commits\/main/, JSON.stringify({ sha: SHA_A })]])
    await assert.rejects(executePlan({ ...plan, steps: plan.steps.slice(guard) }, { exec, io: memoryIo(), log: () => {} }),
      new RegExp(`default branch ${FORK}@main moved: planned ${SHA_C}, current ${SHA_A}; prepare a new replay plan`))
    assert.equal(calls.length, 1, "no checkout or push after the snapshot mismatch")
  }
})

test("executePlan: missing default-branch head fails closed before checkout", async () => {
  const plan = purePlan({ baseBranch: "review/base" })
  const guard = plan.steps.findIndex((step) => step.kind === "verify-fork-default")
  const { exec, calls } = fakeExec([[/gh api .*\/commits\/main/, "{}"]])
  await assert.rejects(executePlan({ ...plan, steps: plan.steps.slice(guard) }, { exec, io: memoryIo(), log: () => {} }), /could not resolve the commit SHA/)
  assert.equal(calls.length, 1)
})

test("executePlan: ensure-base skips when the fork branch already carries the recording", async () => {
  const plan = {
    mode: "pure-replay", singleCommit: true, slug: "posthog", upstream: UPSTREAM, fork: FORK, work: "/tmp/work",
    steps: [{
      id: "ensure-base", kind: "ensure-base", target: FORK, baseBranch: "review/base", baseSha: SHA_A,
      carryFrom: SHA_C, carry: RECORDERS, message: "ci: carry the fork's recording workflow onto the replay base",
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
      carryFrom: SHA_C, carry: RECORDERS, message: "ci: carry the fork's recording workflow onto the replay base",
    }],
  }
  const { exec } = fakeExec([
    [/rev-parse --verify/, "tree-other\n"],
    [/write-tree/, "tree-carried\n"],
  ])
  await assert.rejects(executePlan(plan, { exec, io: memoryIo(), log: () => {} }), /unexpected tree; refusing to overwrite/)
})

// ---------------------------------------------------------------- livePr: refusal and pure mode

const RECORDING_BODY = `on:\n  pull_request:\njobs:\n  record:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: garnet-org/action@${GARNET_ACTION_PIN}\n`

function liveExec({ recording, openPrs = [], recentPrs = [], commits = [
  { sha: SHA_C, commit: { message: "feat: earlier upstream push\n\nbody" } },
  { sha: SHA_B, commit: { message: "feat: pull request head" } },
] }) {
  return (command, args) => {
    assert.equal(command, "gh")
    const kit = kitResponse(args)
    if (kit !== null) return kit
    if (args[0] === "repo") return JSON.stringify({ defaultBranchRef: { name: "main" } })
    if (args[1] === `repos/${FORK}/commits/main`) return JSON.stringify({ sha: SHA_C })
    if (args[0] === "pr" && args[1] === "list" && args.includes("number,title,body,url,author,createdAt,state,labels,files,headRefName,baseRefName,isDraft")) {
      return JSON.stringify(recentPrs.map((pr) => ({ state: "OPEN", ...pr })))
    }
    if (args[0] === "api" && args.includes(`repos/${FORK}/pulls?state=open&per_page=100`)) {
      return JSON.stringify([openPrs.map((pr) => ({
        number: pr.number, title: pr.title, body: pr.body, html_url: pr.url,
        head: { ref: pr.headRefName },
      }))])
    }
    if (args[1]?.includes(":.github/workflows")) {
      return JSON.stringify({ tree: recording ? [{ path: "garnet-record.yml", type: "blob" }] : [] })
    }
    if (args[1]?.includes("/contents/.github/workflows/")) return RECORDING_BODY
    if (args[1]?.includes("/contents/.github/dependabot.yml")) throw new Error("gh: Not Found (HTTP 404)")
    if (args[1]?.includes("/contents/src/")) return JSON.stringify({ sha: "same-blob" })
    if (args[1]?.endsWith("/pulls/501/files")) {
      return JSON.stringify(CHANGES.map((change) => ({ filename: change.path, status: change.status })))
    }
    if (args.at(-1)?.endsWith("/pulls/501/commits")) return JSON.stringify([commits])
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

test("livePr: a changed recording workflow uses the upstream base even when the fork already has the head", async () => {
  for (const mode of [[], ["--base-branch", "review/base"], ["--sync-fork"]]) {
    const reads = []
    const originalExec = liveExec({ recording: false })
    const before = "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bun-1.2.12 test\n"
    const after = before.replace("1.2.12", "1.4.4")
    const exec = (command, args) => {
      const path = args[1]
      if (path?.endsWith("/pulls/501/files")) return JSON.stringify([{ filename: ".github/workflows/ci.yml", status: "modified" }])
      if (path?.includes("/contents/.github/workflows/ci.yml")) {
        reads.push(path)
        return path === `repos/${UPSTREAM}/contents/.github/workflows/ci.yml?ref=${SHA_A}` ? before : after
      }
      return originalExec(command, args)
    }
    const result = await livePr(["posthog", "--pr", "501", "--record", "instrument", "--job", "ci.yml/test", "--ecosystem", "npm", "--dry-run", ...mode], { exec, log: () => {}, save: () => assert.fail("dry run must not save") })
    assert.equal(result.executed, false)
    assert.ok(reads.includes(`repos/${UPSTREAM}/contents/.github/workflows/ci.yml?ref=${SHA_A}`))
    assert.ok(reads.includes(`repos/${UPSTREAM}/contents/.github/workflows/ci.yml?ref=${SHA_B}`))
    const baseline = result.plan.steps.find((step) => step.writeFileContent?.content.includes("bun-1.2.12"))
    const changed = result.plan.steps.find((step) => step.id === "change-instrument")
    assert.ok(baseline, "commit 1 must preserve the upstream base workflow, not the fork default")
    assert.match(changed.writeFileContent.content, /bun-1\.4\.4 test/)
  }
})

test("livePr: onboarded fork plans a pure single-commit replay", async () => {
  const result = await livePr(["posthog", "--pr", "501", "--dry-run"], { exec: liveExec({ recording: true }), log: () => {}, save: () => assert.fail("dry run must not save") })
  assert.equal(result.executed, false)
  assert.equal(result.plan.mode, "pure-replay")
  assert.equal(result.plan.singleCommit, true)
  assert.equal(result.plan.record, "fork-workflow")
  assert.match(result.plan.body, /<!-- change-id:[0-9a-f]{64} attempt:[0-9a-f]{64} -->/)
  assert.doesNotMatch(result.plan.body, NO_UPSTREAM)
})

test("livePr: default-branch instrument bodies and inventory use the one planned SHA", async () => {
  const fallback = liveExec({ recording: true })
  const reads = []
  let snapshotReads = 0
  const exec = (command, args) => {
    const path = args[1] ?? ""
    if (path === `repos/${FORK}/commits/main`) snapshotReads += 1
    if (path.startsWith(`repos/${FORK}/`) && (path.includes(":.github/workflows") || path.includes("/contents/.github/workflows/"))) {
      reads.push(path)
      assert.ok(path.includes(`/git/trees/${SHA_C}:`) || path.endsWith(`?ref=${SHA_C}`), path)
    }
    if (path.includes("/contents/.github/workflows/ci.yml")) {
      return "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n"
    }
    return fallback(command, args)
  }
  const result = await livePr(["posthog", "--pr", "501", "--record", "instrument", "--job", "ci.yml/test", "--ecosystem", "npm", "--dry-run"], {
    exec, log: () => {}, save: () => assert.fail("dry run must not save"),
  })
  assert.equal(result.plan.record, "instrument")
  assert.equal(snapshotReads, 1)
  assert.ok(reads.includes(`repos/${FORK}/contents/.github/workflows/ci.yml?ref=${SHA_C}`))
  assert.ok(reads.filter((path) => path.includes(`/git/trees/${SHA_C}:`)).length >= 2, "recorder discovery and inventory both use the snapshot")
})

test("livePr: pure replay carries default-branch callees over upstream copies or absent upstream files", async () => {
  for (const upstreamHasCallee of [true, false]) {
    const fallback = liveExec({ recording: true })
    const bodies = {
      [CALLER]: callsWorkflow(CALLEE).replace("workflow_call", "pull_request"),
      [CALLEE]: `${callsWorkflow(NESTED_CALLEE)}  record:\n    steps:\n      - uses: garnet-org/action@${GARNET_ACTION_PIN}\n`,
      [NESTED_CALLEE]: "on: workflow_call\n",
    }
    const reads = []
    let snapshotReads = 0
    const exec = (command, args) => {
      const path = args[1] ?? ""
      if (path === `repos/${FORK}/commits/main`) snapshotReads += 1
      if (path.includes(":.github/workflows")) {
        if (path.startsWith(`repos/${FORK}/`)) assert.ok(path.includes(`/git/trees/${SHA_C}:`))
        const paths = path.startsWith(`repos/${FORK}/`)
          ? Object.keys(bodies)
          : upstreamHasCallee ? [CALLEE] : []
        return JSON.stringify({ tree: paths.map((file) => ({ path: file.split("/").at(-1), type: "blob" })) })
      }
      if (path.includes("/contents/.github/workflows/")) {
        reads.push(path)
        if (path.startsWith(`repos/${FORK}/`)) {
          assert.ok(path.endsWith(`?ref=${SHA_C}`))
          return bodies[path.split("/contents/")[1].split("?")[0]]
        }
        assert.ok(upstreamHasCallee, "absent upstream callees must not be read")
        return "on: workflow_call\n"
      }
      return fallback(command, args)
    }
    const result = await livePr(["posthog", "--pr", "501", "--base-branch", "review/base", "--dry-run"], {
      exec, log: () => {}, save: () => assert.fail("dry run must not save"),
    })
    assert.equal(result.plan.mode, "pure-replay")
    assert.equal(snapshotReads, 1)
    assert.equal(result.plan.forkDefaultSha, SHA_C)
    const ensure = result.plan.steps.find((step) => step.kind === "ensure-base")
    assert.deepEqual(ensure.carry, [CALLER, CALLEE, NESTED_CALLEE])
    assert.equal(ensure.carryFrom, SHA_C)
    assert.ok(reads.includes(`repos/${FORK}/contents/${CALLEE}?ref=${SHA_C}`))
    const execution = fakeExec([
      [/gh api .*\/commits\/main/, JSON.stringify({ sha: SHA_C })],
      [/rev-parse --verify/, () => { throw new Error("ref absent") }],
      [/write-tree/, "tree-with-callees"],
      [/diff --cached --name-only/, ensure.carry.join("\n")],
    ])
    const guard = result.plan.steps.find((step) => step.kind === "verify-fork-default")
    await executePlan({ ...result.plan, steps: [guard, ensure] }, { exec: execution.exec, io: memoryIo(), log: () => {} })
    assert.ok(execution.calls.includes(`git -C ${result.plan.work} checkout ${SHA_C} -- ${ensure.carry.join(" ")}`))
    assert.ok(execution.calls.some((call) => call.includes("push --set-upstream origin HEAD:refs/heads/review/base")))
  }
})

test("livePr: refuses a recorder overlay when the change's base records itself", async () => {
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--base-branch", "review/base", "--record-workflow", ".github/workflows/ci.yml", "--dry-run"], {
      exec: liveExec({ recording: true }),
      log: () => {},
      save: () => assert.fail("dry run must not save"),
    }),
    /the change's base already runs \.github\/workflows\/garnet-record\.yml on pull requests; --record-workflow would replace it with garnet-labs\/posthog@main's copy\. Drop --record-workflow so the replay runs the base's own workflows/,
  )
})

test("livePr: resolves an earlier upstream commit and plans its comparison scope", async () => {
  const result = await livePr(["posthog", "--pr", "501", "--first-commit", "ccccccc", "--dry-run"], {
    exec: liveExec({ recording: true }),
    log: () => {},
    save: () => assert.fail("dry run must not save"),
  })
  assert.equal(result.plan.firstCommitSha, SHA_C)
  assert.equal(result.plan.forkDefaultSha, SHA_C)
  assert.ok(result.plan.steps.some((step) => step.kind === "verify-fork-default"))
  assert.equal(result.plan.scope, "previous-recorded-head-to-head")
  assert.equal(result.plan.messages.first, "feat: earlier upstream push")
  assert.equal(result.plan.firstStages, "first-commit")
  assert.ok(result.plan.steps.some((step) => step.id === "verify-first-commit" && step.args.includes(`${SHA_C}^{commit}`)))
  assert.match(result.plan.body, /attempt:[0-9a-f]{64}/)
  assert.match(result.plan.steps.find((step) => step.id === "first-commit-paths").note, /ccccccc/)
  const rendered = renderPlan(result.plan)
  assert.match(rendered, /first upstream commit: c{40}/)
  assert.match(rendered, /compares: ccccccc → bbbbbbb/)
  assert.match(rendered, /scope: previous-recorded-head-to-head/)
})

test("livePr: rejects first-commit values outside the pull request and its head", async () => {
  const exec = liveExec({ recording: true })
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--first-commit", "deadbee", "--dry-run"], { exec, log: () => {} }),
    /is not a commit in pull request/,
  )
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--first-commit", SHA_B, "--dry-run"], { exec, log: () => {} }),
    /must not equal the pull request head/,
  )
})

test("livePr: rejects combining first-commit with --first", async () => {
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--first", "src/a.ts", "--first-commit", SHA_C, "--dry-run"], {
      exec: liveExec({ recording: true }),
      log: () => {},
    }),
    /--first-commit cannot be combined with --first/,
  )
})

test("livePr: rejects first-commit with allow-build and instrument modes", async () => {
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--allow-build", "puppeteer", "--first-commit", SHA_C, "--dry-run"], {
      exec: () => assert.fail("incompatible mode must stop before GitHub access"),
      log: () => {},
    }),
    /--first-commit is only available with --pr <N>; it cannot be combined with --dependency, --allow-build, or --prepared/,
  )
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--record", "instrument", "--job", ".github/workflows/ci.yml/test", "--first-commit", SHA_C, "--dry-run"], {
      exec: () => assert.fail("incompatible mode must stop before GitHub access"),
      log: () => {},
    }),
    /--first-commit cannot be combined with --record instrument/,
  )
})

test("livePr: refuses an alternate branch for an already-open logical replay", async () => {
  const body = "2 files:\n\n- src/a.ts\n- src/b.ts\n"
  await assert.rejects(
    livePr(["posthog", "--pr", "501", "--branch", "chore/alternate", "--dry-run"], {
      exec: liveExec({
        recording: true,
        openPrs: [{
          number: 9, headRefName: "chore/original", title: "feat: add thing", body,
          url: `https://github.com/${FORK}/pull/9`,
        }],
      }),
      log: () => {},
      save: () => assert.fail("must not save"),
    }),
    /already claims this logical change/,
  )
})

test("livePr: explicit --record inject still bundles on an onboarded fork", async () => {
  const result = await livePr(["posthog", "--pr", "501", "--record", "inject", "--ecosystem", "npm", "--dry-run"], { exec: liveExec({ recording: true }), log: () => {}, save: () => assert.fail("dry run must not save") })
  assert.equal(result.plan.record, "inject")
  assert.ok(result.plan.steps.some((step) => step.id === "first-commit"), "explicit --record inject still bundles a recorder as commit 1")
  assert.ok(result.plan.steps.some((step) => step.id === "change-commit"))
})

// ---------------------------------------------------------------- setup command

function bunSetupExec(manifest) {
  const fallback = liveExec({ recording: false })
  return (command, args) => {
    if (args[1] === `repos/${FORK}/contents/package.json?ref=main`) {
      assert.equal(command, "gh")
      assert.ok(args.includes("Accept: application/vnd.github.raw"))
      return JSON.stringify(manifest)
    }
    if (args[1] === `repos/${FORK}/git/trees/main`) return JSON.stringify({ tree: [{ path: "bun.lock", type: "blob" }] })
    return fallback(command, args)
  }
}

test("setup: Bun validates the root packageManager before planning its recorder", async () => {
  const result = await setup(["posthog", "--dry-run"], {
    exec: bunSetupExec({ packageManager: "bun@1.4.4" }), log: () => {}, save: () => assert.fail("dry run must not save"),
  })
  assert.equal(result.executed, false)
  const workflow = result.plan.steps.find((step) => step.writeFileContent?.file.endsWith("garnet-record.yml")).writeFileContent.content
  assert.match(workflow, /bun-version-file: package.json/)
  assert.match(workflow, /run: bun install --frozen-lockfile/)
})

test("setup: Bun rejects a missing packageManager without producing a plan", async () => {
  await assert.rejects(setup(["posthog", "--ecosystem", "bun", "--dry-run"], {
    exec: bunSetupExec({}), log: () => assert.fail("must not emit a plan"), save: () => assert.fail("must not save"),
  }), /Bun recording requires root package.json.*packageManager.*bun@<version>/)
})

test("setup: Bun rejects malformed packageManager values without producing a plan", async () => {
  for (const packageManager of ["", "bun@latest", "bun@1.4", "npm@1.4.4", 144, null]) {
    await assert.rejects(setup(["posthog", "--ecosystem", "bun", "--dry-run"], {
      exec: bunSetupExec({ packageManager }), log: () => assert.fail("must not emit a plan"), save: () => assert.fail("must not save"),
    }), /Bun recording requires root package.json.*packageManager.*bun@<version>/)
  }
})

test("setup: already-onboarded fork inventories the identical kit without writes", async () => {
  const lines = []
  const result = await setup(["posthog", "--dry-run"], { exec: liveExec({ recording: true }), log: (line) => lines.push(line), save: () => assert.fail("must not save") })
  assert.equal(result[0].grounded, true)
  assert.ok(lines.some((line) => /garnet-labs\/posthog \| 0 \| 5 \| 0 \| 0 \| 0/.test(line)))
})

test("setup: plans a single onboarding commit via dry run", async () => {
  const lines = []
  const exec = (command, args) => {
    assert.equal(command, "gh")
    if (args[1] === "repos/garnet-labs/posthog") return '{"default_branch":"main"}'
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
