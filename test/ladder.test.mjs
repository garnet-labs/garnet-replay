import test from "node:test"
import assert from "node:assert/strict"
import { CAPTURE_STATUS, CLAIM_CLASSES, VERDICTS, assessCapture, assessSupersession, buildClaims, decideVerdict, pairRecord, stableAcrossRepetitions } from "../lib/evidence.mjs"
import { assertNoUpstreamLeak, assertOutbound, assertTwoCommits, assertVocabClean, assertForkTarget } from "../lib/guards.mjs"
import { isMergeQueue, observationFor, rankObservations, recommend, renderObserveOutput, scoreGap, prFacts } from "../lib/observe.mjs"
import { INSTALL_COMMANDS, detectEcosystem, executePlan, planReplay, reconcileState, renderPlan, upsertReplay } from "../lib/replay-pr.mjs"
import { recordState } from "../lib/wait.mjs"
import { allowBuildScripts, bumpManifest, planTransition, resolvedVersion } from "../lib/replay-transition.mjs"
import { buildModel, classify, extractChains, renderCard } from "../lib/card.mjs"
import { assertAggregatesMatchRows, renderCohort, tally } from "../lib/cohort.mjs"
import { nextCommand, nextStage, renderTargetText, stageRows } from "../lib/status.mjs"
import { evaluateConsumption, renderConsumeReport } from "../lib/consume.mjs"
import { evaluateExhibit } from "../lib/verify.mjs"
import { planStage2, renderStage2Plan } from "../lib/stage2.mjs"
import { STAGES, ensureTarget } from "../lib/ledger.mjs"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const SHA_C = "c".repeat(40)
const UPSTREAM = "PostHog/posthog"
const FORK = "garnet-labs/posthog"

function cell(side, rep, overrides = {}) {
  return { side, rep, expected_sha: side === "baseline" ? SHA_A : SHA_B, executed_sha: side === "baseline" ? SHA_A : SHA_B, profile_present: true, runner: "ubuntu-24.04", image: "img-1", ...overrides }
}

// ---------------------------------------------------------------- evidence

test("capture: complete, partial, none, not-declared are distinct and reasoned", () => {
  const complete = assessCapture({ expectedCells: 2, cells: [cell("baseline", 1), cell("update", 1)] })
  assert.equal(complete.status, CAPTURE_STATUS.COMPLETE)
  assert.equal(complete.final_record, true)
  assert.deepEqual(complete.reasons, [])

  const missing = assessCapture({ expectedCells: 3, cells: [cell("baseline", 1), cell("update", 1)] })
  assert.equal(missing.status, CAPTURE_STATUS.PARTIAL)
  assert.ok(missing.reasons.includes("cell records: 2/3"))

  const wrongHead = assessCapture({ cells: [cell("baseline", 1), cell("update", 1, { executed_sha: SHA_C })] })
  assert.equal(wrongHead.status, CAPTURE_STATUS.PARTIAL)
  assert.match(wrongHead.reasons.join("\n"), /update rep 1: executed ccccccc, expected bbbbbbb/)

  const identity = assessCapture({ cells: [cell("baseline", 1), cell("update", 1, { runner: "other" })] })
  assert.ok(identity.reasons.includes("cells ran on differing runner identities"))

  const none = assessCapture({ cells: [cell("baseline", 1, { profile_present: false })] })
  assert.equal(none.status, CAPTURE_STATUS.NONE)

  assert.equal(assessCapture({}).status, CAPTURE_STATUS.NOT_DECLARED)
  assert.equal(assessCapture({ declared: { status: "finalized", captureQuality: "complete" } }).status, CAPTURE_STATUS.COMPLETE)
  assert.equal(assessCapture({ declared: { status: "pending", captureQuality: "complete" } }).status, CAPTURE_STATUS.PARTIAL)
})

test("verdict: partial, variance, and missing counts never read as unchanged", () => {
  const complete = assessCapture({ cells: [cell("baseline", 1), cell("update", 1)] })
  const partial = assessCapture({ expectedCells: 4, cells: [cell("baseline", 1), cell("update", 1)] })
  const none = assessCapture({ cells: [cell("update", 1, { profile_present: false })] })

  assert.equal(decideVerdict({ capture: complete, comparisonAvailable: true, workloadAdded: 0, workloadRemoved: 0 }).verdict, VERDICTS.UNCHANGED)
  assert.equal(decideVerdict({ capture: complete, comparisonAvailable: true, workloadAdded: 2, workloadRemoved: 0 }).verdict, VERDICTS.NEW_BEHAVIOR)
  assert.equal(decideVerdict({ capture: complete, comparisonAvailable: false, workloadAdded: 0, workloadRemoved: 0 }).verdict, VERDICTS.RECORDED)
  assert.equal(decideVerdict({ capture: partial, comparisonAvailable: true, workloadAdded: 0, workloadRemoved: 0 }).verdict, VERDICTS.UNDETERMINABLE)
  assert.equal(decideVerdict({ capture: complete, comparisonAvailable: true, workloadAdded: 0, workloadRemoved: 0, variance: 1 }).verdict, VERDICTS.UNDETERMINABLE)
  assert.equal(decideVerdict({ capture: complete, comparisonAvailable: true, workloadAdded: null, workloadRemoved: null }).verdict, VERDICTS.UNDETERMINABLE)
  assert.equal(decideVerdict({ capture: none, comparisonAvailable: true, workloadAdded: 0, workloadRemoved: 0 }).verdict, VERDICTS.UNDETERMINABLE)

  const partialNew = decideVerdict({ capture: partial, comparisonAvailable: true, workloadAdded: 1, workloadRemoved: 0 })
  assert.equal(partialNew.verdict, VERDICTS.NEW_BEHAVIOR)
  assert.ok(partialNew.reasons.some((r) => r.includes("capture is partial")))
})

test("supersession: head or base movement supersedes the record; unbound is superseded", () => {
  assert.equal(assessSupersession({ recordHeadSha: SHA_B, currentHeadSha: SHA_B }).superseded, false)
  const moved = assessSupersession({ recordHeadSha: SHA_B, currentHeadSha: SHA_C })
  assert.equal(moved.superseded, true)
  assert.match(moved.reasons[0], /head moved: record bbbbbbb, current ccccccc/)
  assert.equal(assessSupersession({ recordHeadSha: SHA_B, currentHeadSha: SHA_B, recordBaseSha: SHA_A, currentBaseSha: SHA_C }).superseded, true)
  assert.equal(assessSupersession({ recordHeadSha: null, currentHeadSha: SHA_B }).superseded, true)
})

test("claims: every claim carries a class; undeterminable adds an unsupported-claim sentence", () => {
  const capture = assessCapture({ cells: [cell("baseline", 1), cell("update", 1)] })
  const pair = pairRecord({ baseSha: SHA_A, headSha: SHA_B, scope: "pr-base-to-head", label: "real", transition: "puppeteer 1 → 2" })
  assert.match(pair.line, /aaaaaaa/)
  assert.match(pair.line, /bbbbbbb/)
  const totals = { workload: { added: 1, removed: 0 }, runner_background: { added: 0, removed: 0 }, jobs_recorded: 1 }
  const claims = buildClaims({ verdict: VERDICTS.NEW_BEHAVIOR, reasons: ["x"], capture, pair, totals, check: { name: "garnet/evidence", state: "success" } })
  for (const claim of claims) assert.ok(Object.values(CLAIM_CLASSES).includes(claim.class), claim.class)
  const und = buildClaims({ verdict: VERDICTS.UNDETERMINABLE, reasons: ["capture is partial"], capture, pair, totals })
  assert.ok(und.some((c) => c.class === CLAIM_CLASSES.UNSUPPORTED && c.text.includes("capture is partial")))
})

test("variance: a destination seen in only some repetitions is variance, not stable", () => {
  const { stable, variance } = stableAcrossRepetitions([new Set(["a", "b"]), new Set(["a"]), new Set(["a", "b"])])
  assert.deepEqual([...stable], ["a"])
  assert.deepEqual([...variance], ["b"])
})

// ---------------------------------------------------------------- guards

test("guards: upstream references, residue, banned vocabulary, fork target, two commits", () => {
  assert.throws(() => assertNoUpstreamLeak(`see https://github.com/${UPSTREAM}/pull/12`, UPSTREAM), /upstream/i)
  assert.throws(() => assertNoUpstreamLeak("fixes #12", UPSTREAM))
  assert.throws(() => assertNoUpstreamLeak("PostHog/posthog#12", UPSTREAM))
  assert.doesNotThrow(() => assertNoUpstreamLeak("chore(deps): bump puppeteer from 1 to 2", UPSTREAM))
  assert.throws(() => assertOutbound("replay harness run devin session", UPSTREAM))
  assert.throws(() => assertVocabClean("Execution Diff shows a threat detected"))
  assert.doesNotThrow(() => assertVocabClean("new behavior on the head commit"))
  assert.doesNotThrow(() => assertForkTarget(`https://github.com/${FORK}.git`, FORK))
  assert.throws(() => assertForkTarget(`https://github.com/${UPSTREAM}.git`, FORK))
  assert.doesNotThrow(() => assertTwoCommits("2\n"))
  assert.throws(() => assertTwoCommits("3"))
  assert.throws(() => assertTwoCommits("1"))
})

// ---------------------------------------------------------------- find

const depPr = {
  number: 501, title: "chore(deps): bump puppeteer from 24.40.0 to 25.9.0", state: "MERGED", createdAt: "2026-09-01T00:00:00Z",
  author: { login: "dependabot[bot]" }, files: [{ path: "nodejs/package.json" }, { path: "pnpm-lock.yaml" }],
}
const codePr = { number: 502, title: "feat: add thing", state: "OPEN", createdAt: "2026-09-02T00:00:00Z", author: { login: "someone" }, files: [{ path: "src/a.ts" }] }
const batch = { number: 503, title: "Merge batch", state: "MERGED", createdAt: "2026-09-02T00:00:00Z", author: { login: "app/trunk-io" }, headRefName: "trunk-merge/abc", files: [] }

test("find: score equals the printed reason sum; merge-queue batches are set aside", () => {
  const facts = prFacts(depPr)
  const gap = scoreGap(facts)
  assert.equal(gap.total, gap.reasons.reduce((sum, r) => sum + r.points, 0))
  assert.ok(gap.reasons.some((r) => r.id === "dependency-only"))
  assert.ok(gap.reasons.some((r) => r.id === "major"))
  assert.ok(gap.reasons.some((r) => r.id === "bot-author"))
  assert.equal(isMergeQueue(batch), true)
  assert.equal(isMergeQueue(depPr), false)

  const rows = [observationFor(codePr), observationFor(depPr)]
  for (const row of rows) assert.equal(row.evidence_class, "candidate-evidence")
  assert.equal(rankObservations(rows)[0].upstreamPr, 501)
  assert.equal(recommend(rows).upstreamPr, 501)
  const text = renderObserveOutput(rows, { slug: "posthog", upstream: UPSTREAM, scanned: 3, setAside: 1 })
  assert.match(text, /candidate/i)
  assert.match(text, /merge-queue batch\(es\) set aside/)
  assert.doesNotMatch(text, /runtime record shows|new behavior recorded/i)
  assert.match(text, /24\.40\.0 → 25\.9\.0|24\.40\.0.*25\.9\.0/)
})

// ---------------------------------------------------------------- replay --pr

const changes = [
  { path: "nodejs/package.json", status: "modified", previous: null },
  { path: "pnpm-lock.yaml", status: "modified", previous: null },
  { path: "docs/new.md", status: "added", previous: null },
  { path: "docs/renamed.md", status: "renamed", previous: "docs/old.md" },
]

function replayPlan(overrides = {}) {
  return planReplay({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "master", upstreamPr: 501,
    upstreamTitle: depPr.title, baseSha: SHA_A, headSha: SHA_B, changes, firstPaths: ["pnpm-lock.yaml"], work: "/tmp/work", workExists: true, ...overrides,
  })
}

test("replay --pr: two commits, exact head fetch, fork-only writes, no upstream residue", () => {
  const plan = replayPlan()
  assert.equal(plan.scope, "pr-base-to-head")
  assert.deepEqual(plan.transition, { name: "puppeteer", from: "24.40.0", to: "25.9.0" })
  assert.doesNotThrow(() => pairRecord({ baseSha: SHA_A, headSha: SHA_B, scope: plan.scope, label: "real" }))
  const ids = plan.steps.map((s) => s.id)
  assert.ok(ids.includes("fetch-upstream") && ids.includes("verify-head") && ids.includes("verify-commits"))
  const fetch = plan.steps.find((s) => s.id === "fetch-upstream")
  assert.deepEqual(fetch.args.slice(-3), ["upstream", SHA_A, "refs/pull/501/head"])
  const nopush = plan.steps.find((s) => s.id === "remote-upstream-nopush")
  assert.ok(nopush.args.includes("DISABLED-no-push"))
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  for (const text of [plan.branch, plan.title, plan.body, plan.messages.first, plan.messages.change]) {
    assert.doesNotMatch(text, /PostHog\/posthog|#501|github\.com/)
  }
  assert.equal(plan.steps.filter((s) => s.id.endsWith("-commit")).length, 2)
  const rendered = renderPlan(plan)
  assert.match(rendered, /compares: aaaaaaa → bbbbbbb/)
  assert.match(rendered, /fork \(only write target\): garnet-labs\/posthog/)
  assert.throws(() => replayPlan({ fork: UPSTREAM }), /fork must not be the upstream/)
  assert.throws(() => replayPlan({ headSha: "" }), /unresolved/)
  assert.throws(() => replayPlan({ firstPaths: ["nope"] }), /not touched/)
  assert.throws(() => replayPlan({ record: "inject", ecosystem: "bazel" }), /no install command/)
})

test("replay --pr: ecosystem detection covers every install command and degrades honestly", () => {
  assert.equal(detectEcosystem(["pnpm-lock.yaml"]), "pnpm")
  assert.equal(detectEcosystem(["Cargo.lock"]), "cargo")
  assert.equal(detectEcosystem(["Gemfile.lock"]), "ruby")
  assert.equal(detectEcosystem(["uv.lock"]), "uv")
  assert.equal(detectEcosystem(["go.sum"]), "go")
  assert.equal(detectEcosystem(["yarn.lock"]), "yarn")
  assert.equal(detectEcosystem(["package-lock.json"]), "npm")
  assert.equal(detectEcosystem(["WORKSPACE"]), null)
  assert.deepEqual(Object.keys(INSTALL_COMMANDS).sort(), ["cargo", "go", "npm", "pnpm", "ruby", "uv", "yarn"])
})

function fakeExec(responses) {
  const calls = []
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "))
    for (const [pattern, out] of responses) if (pattern.test(calls.at(-1))) return typeof out === "function" ? out() : out
    return ""
  }
  return { exec, calls }
}

const recordedFirst = JSON.stringify([{ user: { login: "garnet-ai[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_C} -->\n<!-- garnet:summary {"status":"finalized"} -->\n> recorded` }])
const replayResponses = [
  [/remote get-url origin/, `https://github.com/${FORK}.git\n`],
  [/diff --cached --name-only/, "pnpm-lock.yaml\n"],
  [/rev-list --count/, "2\n"],
  [/rev-parse HEAD~1/, `${SHA_C}\n`],
  [/rev-parse HEAD$/, `${SHA_B}\n`],
  [/gh pr list/, "[]"],
  [/gh pr create/, `https://github.com/${FORK}/pull/77\n`],
  [/gh api repos\/\S+\/issues\/77\/comments/, recordedFirst],
  [/check-runs/, JSON.stringify({ check_runs: [] })],
]
const noWait = { pollMs: 0, sleep: async () => {}, timeoutMs: 1000 }

function memoryIo(files = {}) {
  const store = { ...files }
  return { store, io: { mkdirp: () => {}, readFile: (p) => { if (!(p in store)) throw new Error(`missing ${p}`); return store[p] }, writeFile: (p, c) => { store[p] = c } } }
}

test("replay --pr: commit 1 is pushed alone, recorded, then commit 2 follows; an existing PR is reused", async () => {
  const plan = replayPlan()
  const { exec, calls } = fakeExec(replayResponses)
  const { io } = memoryIo()
  const captured = await executePlan(plan, { exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.forkPr, 77)
  assert.equal(captured.firstSha, SHA_C)
  assert.equal(captured.forkHeadSha, SHA_B)
  assert.equal(captured.commitCount, 2)
  assert.equal(captured.reconciled, false)
  assert.equal(captured.firstRecord.state, "recorded")
  const first = calls.indexOf("git -C /tmp/work push --set-upstream origin HEAD~1:refs/heads/deps/puppeteer-25.9.0")
  const create = calls.findIndex((c) => c.startsWith(`gh pr create --repo ${FORK} --draft`))
  const waited = calls.findIndex((c) => /issues\/77\/comments/.test(c))
  const change = calls.indexOf("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0")
  assert.ok(first >= 0 && first < create && create < waited && waited < change, calls.join("\n"))
  assert.ok(calls.every((c) => !/git -C \S+ push/.test(c) || c.includes(" origin ")))

  const reuse = fakeExec([[/gh pr list/, JSON.stringify([{ number: 70, state: "OPEN", isDraft: true, url: `https://github.com/${FORK}/pull/70` }])], ...replayResponses])
  const again = await executePlan(plan, { exec: reuse.exec, io, log: () => {}, wait: noWait })
  assert.equal(again.forkPr, 70)
  assert.equal(again.reconciled, true)
  assert.ok(!reuse.calls.some((c) => c.includes("gh pr create")))
  assert.ok(!reuse.calls.some((c) => c.includes("git -C /tmp/work push")))
})

test("replay --pr: commit 2 is not pushed while commit 1 is unrecorded or its check failed; --no-wait pushes it", async () => {
  const plan = replayPlan()
  const { io } = memoryIo()
  const pending = fakeExec([[/issues\/77\/comments/, "[]"], [/check-runs/, JSON.stringify({ check_runs: [{ name: "Dependency install (recorded)", status: "in_progress", conclusion: null }] })], ...replayResponses])
  await assert.rejects(executePlan(plan, { exec: pending.exec, io, log: () => {}, wait: { ...noWait, timeoutMs: 0 } }), /gave up|checks running/)
  assert.ok(!pending.calls.some((c) => c.includes("push origin HEAD:")))

  const failed = fakeExec([[/issues\/77\/comments/, "[]"], [/check-runs/, JSON.stringify({ check_runs: [{ name: "Garnet Runtime Visibility", status: "completed", conclusion: "failure" }] })], ...replayResponses])
  await assert.rejects(executePlan(plan, { exec: failed.exec, io, log: () => {}, wait: noWait }), /concluded failure/)
  assert.ok(!failed.calls.some((c) => c.includes("push origin HEAD:")))

  const skipped = fakeExec([[/issues\/77\/comments/, "[]"], ...replayResponses])
  const captured = await executePlan(plan, { exec: skipped.exec, io, log: () => {}, wait: { enabled: false } })
  assert.equal(captured.firstRecord.state, "not-waited")
  assert.ok(skipped.calls.includes("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0"))
  assert.ok(!skipped.calls.some((c) => /issues\/77\/comments/.test(c)))

  assert.deepEqual(
    recordState({ comments: [{ body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_C} -->\n<!-- garnet:summary {"status":"pending"} -->` }], checks: [], sha: SHA_C }).state,
    "pending",
  )
  assert.equal(recordState({ comments: [{ body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_B} -->` }], checks: [], sha: SHA_C }).state, "pending")
})

test("replay --pr: guards stop execution on wrong origin, empty commit, or wrong commit count", async () => {
  const plan = replayPlan()
  const { io } = memoryIo()
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${UPSTREAM}.git`]]).exec, io, log: () => {} }), /fork/i)
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, ""]]).exec, io, log: () => {} }), /would be empty/)
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, "x"], [/rev-list --count/, "3"]]).exec, io, log: () => {} }), /two/)
})

test("replay --pr: reconcileState reads the fork head binding from the newest Runtime Review comment", () => {
  const bound = [{ user: { login: "garnet-runtime-review[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_B} -->\nhello` }]
  assert.equal(reconcileState(bound, SHA_B), "recorded")
  assert.notEqual(reconcileState(bound, SHA_C), "recorded")
  assert.notEqual(reconcileState([], SHA_B), "recorded")
})

test("ledger: constructed rows without an upstream number key on the branch", () => {
  let target = ensureTarget("t-ledger-test", { upstream: UPSTREAM, fork: FORK })
  target = upsertReplay(target, { upstreamPr: null, branch: "deps/x-1", forkPr: 1, state: "pending" })
  target = upsertReplay(target, { upstreamPr: null, branch: "deps/x-1", forkPr: 1, state: "recorded" })
  target = upsertReplay(target, { upstreamPr: 9, branch: "deps/y", forkPr: 2, state: "pending" })
  target = upsertReplay(target, { upstreamPr: 9, branch: "deps/y-renamed", forkPr: 2, state: "recorded" })
  assert.equal(target.replays.length, 2)
  assert.equal(target.replays.find((r) => r.branch === "deps/x-1").state, "recorded")
  assert.equal(target.replays.find((r) => r.upstreamPr === 9).branch, "deps/y-renamed")
})

// ---------------------------------------------------------------- transition

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^18.0.0
        version: 18.3.1

  nodejs:
    dependencies:
      puppeteer:
        specifier: ^24.40.0
        version: 24.40.0(typescript@5.9.2)
      '@scope/pkg':
        specifier: 1.0.0
        version: 1.0.0

packages:
  puppeteer@24.40.0:
    resolution: {integrity: sha512-x}
`

test("transition helpers: lockfile resolution, text-preserving bump, allowlist edits", () => {
  assert.deepEqual(resolvedVersion(LOCK, "nodejs", "puppeteer"), { specifier: "^24.40.0", version: "24.40.0" })
  assert.deepEqual(resolvedVersion(LOCK, "nodejs", "@scope/pkg"), { specifier: "1.0.0", version: "1.0.0" })
  assert.equal(resolvedVersion(LOCK, ".", "puppeteer"), null)
  assert.equal(resolvedVersion(LOCK, "missing", "puppeteer"), null)

  const manifest = `{\n  "name": "x",\n  "dependencies": {\n    "puppeteer": "^24.40.0",\n    "puppeteer-core": "^24.40.0"\n  }\n}\n`
  const bumped = bumpManifest(manifest, "puppeteer", "^25.9.0")
  assert.ok(bumped.includes(`"puppeteer": "^25.9.0"`))
  assert.ok(bumped.includes(`"puppeteer-core": "^24.40.0"`))
  assert.throws(() => bumpManifest(manifest, "missing", "1"), /does not declare/)
  assert.throws(() => bumpManifest(`{"a":{"p":"1"},"b":{"p":"2"}}`, "p", "3"), /refusing to guess/)

  const json = `{\n  "pnpm": {\n    "onlyBuiltDependencies": [\n      "esbuild",\n      "sharp"\n    ]\n  }\n}\n`
  const allowedJson = allowBuildScripts(json, "puppeteer", { file: "package.json" })
  assert.ok(allowedJson.includes(`      "sharp",\n      "puppeteer"\n    ]`), allowedJson)
  assert.throws(() => allowBuildScripts(allowedJson, "puppeteer", { file: "package.json" }), /already allowed/)
  assert.throws(() => allowBuildScripts(`{"pnpm":{}}`, "puppeteer", { file: "package.json" }), /no onlyBuiltDependencies/)

  const yaml = `packages:\n  - 'a/*'\nonlyBuiltDependencies:\n  - esbuild\n  - sharp\nminimumReleaseAge: 10080\n`
  const allowedYaml = allowBuildScripts(yaml, "@scope/pkg", { file: "pnpm-workspace.yaml" })
  assert.ok(allowedYaml.includes(`  - sharp\n  - '@scope/pkg'\nminimumReleaseAge`), allowedYaml)
  assert.throws(() => allowBuildScripts(allowedYaml, "@scope/pkg", { file: "pnpm-workspace.yaml" }), /already allowed/)
})

function transitionPlan(overrides = {}) {
  return planTransition({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "master", dependency: "puppeteer", from: "24.40.0", to: "25.9.0",
    packageDir: "nodejs", allowlistFile: "package.json", work: "/tmp/work", workExists: true, ...overrides,
  })
}

test("transition plan: bump then allow, lockfile resolved without scripts, fork-only, routine wording", () => {
  const plan = transitionPlan()
  assert.equal(plan.mode, "transition")
  assert.equal(plan.upstreamPr, null)
  assert.equal(plan.scope, "immediate-parent-to-head")
  assert.equal(plan.ecosystem, "pnpm")
  assert.deepEqual(plan.firstPaths, ["nodejs/package.json", "pnpm-lock.yaml"])
  assert.deepEqual(plan.paths, ["nodejs/package.json", "pnpm-lock.yaml", "package.json"])
  const ids = plan.steps.map((s) => s.id)
  const order = ["verify-from", "bump-manifest", "resolve-lockfile", "verify-to", "first-commit", "allow-scripts", "change-commit", "verify-commits", "find-pr", "push-first", "pr-create", "wait-first-record", "push-change"]
  assert.deepEqual(order.map((id) => ids.indexOf(id)), [...order.map((id) => ids.indexOf(id))].sort((a, b) => a - b))
  const resolve = plan.steps.find((s) => s.id === "resolve-lockfile")
  assert.deepEqual(resolve.args, ["pnpm", "install", "--lockfile-only"])
  assert.equal(resolve.cwd, "/tmp/work")
  assert.equal(plan.title, "chore(deps): bump puppeteer from 24.40.0 to 25.9.0")
  assert.match(plan.messages.change, /allow puppeteer install scripts/)
  assert.match(plan.body, /allowlist/)
  for (const text of [plan.branch, plan.title, plan.body, plan.messages.first, plan.messages.change]) assert.doesNotMatch(text, /PostHog\/posthog|github\.com|#\d/)
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  assert.match(renderPlan(plan), /transition plan · posthog · puppeteer 24\.40\.0 → 25\.9\.0/)
  assert.match(renderPlan(plan), /compares: commit 1 → commit 2/)
  assert.throws(() => transitionPlan({ to: "24.40.0" }), /two different versions/)
  assert.throws(() => transitionPlan({ allowlistFile: ".npmrc" }), /allowlist must live/)
  assert.throws(() => transitionPlan({ fork: UPSTREAM }), /fork must not be the upstream/)
})

test("transition execution: edits land in files, guards read the lockfile before and after resolving", async () => {
  const plan = transitionPlan()
  const { io, store } = memoryIo({
    "/tmp/work/pnpm-lock.yaml": "puppeteer@24.40.0:\n",
    "/tmp/work/nodejs/package.json": `{\n  "dependencies": {\n    "puppeteer": "^24.40.0"\n  }\n}\n`,
    "/tmp/work/package.json": `{\n  "pnpm": {\n    "onlyBuiltDependencies": [\n      "esbuild"\n    ]\n  }\n}\n`,
  })
  const { exec, calls } = fakeExec([
    [/^corepack pnpm install --lockfile-only/, () => { store["/tmp/work/pnpm-lock.yaml"] = "puppeteer@25.9.0:\n"; return "" }],
    ...replayResponses,
  ])
  const captured = await executePlan(plan, { exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.forkPr, 77)
  assert.equal(captured.firstSha, SHA_C)
  assert.equal(captured.forkHeadSha, SHA_B)
  assert.ok(calls.indexOf("git -C /tmp/work push --set-upstream origin HEAD~1:refs/heads/deps/puppeteer-25.9.0") < calls.indexOf("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0"))
  assert.ok(store["/tmp/work/nodejs/package.json"].includes(`"puppeteer": "^25.9.0"`))
  assert.ok(store["/tmp/work/package.json"].includes(`"esbuild",\n      "puppeteer"`))
  assert.ok(calls.some((c) => c === "git -C /tmp/work add -- nodejs/package.json pnpm-lock.yaml"))
  assert.ok(calls.some((c) => c === "git -C /tmp/work add -- package.json"))

  const stale = memoryIo({ ...store, "/tmp/work/pnpm-lock.yaml": "puppeteer@23.0.0:\n" })
  await assert.rejects(executePlan(plan, { exec: fakeExec(replayResponses).exec, io: stale.io, log: () => {} }), /verify-from failed/)
})

// ---------------------------------------------------------------- card

const RECORD_BODY = `<!-- garnet-runtime-review -->
<!-- garnet:commit ${SHA_B} -->
<!-- garnet:summary {"status":"finalized","capture_quality":"complete","previous":"${SHA_C}","changed":1,"added":1,"removed":0} -->
### Runtime Review

> *1 new outbound connection in "pnpm install" from \`puppeteer\` postinstall.*

\`\`\`diff
@@ ${SHA_C.slice(0, 7)} (previous) vs ${SHA_B.slice(0, 7)} (this commit) @@
 pnpm install
 └─ node install.mjs
+   └─ ○ connect storage.googleapis.com:443
\`\`\`

[View this run in Garnet →](https://app.garnet.ai/public/runs/123?profile=00000000-0000-4000-8000-000000000000)
`

test("card: head-bound record renders the finding, pair, scope, chains and link; incomplete evidence fails closed", () => {
  const comment = { user: { login: "garnet-runtime-review[bot]" }, body: RECORD_BODY }
  const model = buildModel({ slug: "posthog", forkPr: 77, headSha: SHA_B, comment, replay: { scope: "immediate-parent-to-head", transition: { name: "puppeteer", from: "24.40.0", to: "25.9.0" } } })
  assert.equal(model.verdict, VERDICTS.NEW_BEHAVIOR)
  assert.equal(model.chains.length, 1)
  assert.ok(model.chains[0].marked)
  const card = renderCard(model)
  assert.match(card, /new outbound connection/)
  assert.match(card, /- head: `bbbbbbb`/)
  assert.match(card, /- compared with: `ccccccc`/)
  assert.match(card, /`puppeteer` 24\.40\.0 → 25\.9\.0/)
  assert.match(card, /immediate parent → head/)
  assert.match(card, /storage\.googleapis\.com:443/)
  assert.match(card, /app\.garnet\.ai\/public\/runs\/123/)
  assert.match(card, /Would this have helped the review\?/)
  assert.doesNotMatch(card, /Execution Diff/)

  assert.equal(classify({ comment: null, headSha: SHA_B }).reason, "pending")
  assert.equal(classify({ comment, headSha: SHA_C }).reason, "stale")
  assert.equal(classify({ comment: { body: "<!-- garnet-runtime-review -->\nno marker" }, headSha: SHA_B }).reason, "head-unbound")
  const stale = renderCard(buildModel({ slug: "posthog", forkPr: 77, headSha: SHA_C, comment }))
  assert.match(stale, /undeterminable/)
  assert.doesNotMatch(stale, /unchanged/)
  assert.match(stale, /not the current head/)
  assert.equal(extractChains(RECORD_BODY)[0].lines.at(-1).trim(), "+   └─ ○ connect storage.googleapis.com:443")
})

// ---------------------------------------------------------------- cohort

test("cohort: aggregate counts reconcile with rows; undeterminable reasons are listed", () => {
  const rows = [
    { forkPr: 1, verdict: VERDICTS.NEW_BEHAVIOR, headSha: SHA_B, previousSha: SHA_C, reason: null },
    { forkPr: 2, verdict: VERDICTS.UNCHANGED, headSha: SHA_B, previousSha: SHA_C, reason: null },
    { forkPr: 3, verdict: VERDICTS.UNDETERMINABLE, headSha: SHA_B, previousSha: null, reason: "stale" },
    { forkPr: 4, verdict: VERDICTS.UNDETERMINABLE, headSha: null, previousSha: null, reason: "pending" },
  ]
  const { total, counts } = tally(rows)
  assert.equal(total, 4)
  assert.equal(counts[VERDICTS.UNDETERMINABLE], 2)
  const text = renderCohort({ slug: "posthog", index: 1, rows })
  assert.doesNotThrow(() => assertAggregatesMatchRows(text, rows, counts, total, "test"))
  assert.match(text, /stale/)
  assert.match(text, /pending/)
  assert.match(text, /25\.0%|50\.0%/)
  assert.throws(() => tally([{ forkPr: 9, verdict: "maybe" }]), /unknown result/)
})

// ---------------------------------------------------------------- status

test("status: ladder marks stages done only from their own artifact; next command follows", () => {
  const target = ensureTarget("t-status-test", { upstream: UPSTREAM, fork: FORK })
  assert.equal(nextStage(target), 0)
  assert.match(nextCommand(target), /^replay find PostHog\/posthog --slug t-status-test --fork garnet-labs\/posthog/)
  target.observations.push({ upstreamPr: 1, gap: { total: 5, reasons: [] } })
  assert.equal(nextStage(target), 1)
  target.replays.push({ upstreamPr: 1, forkPr: 77, state: "pending" })
  assert.equal(stageRows(target)[1].state, "in-flight")
  target.replays[0].state = "recorded"
  assert.equal(stageRows(target)[1].state, "done")
  assert.equal(nextStage(target), 2)
  assert.match(nextCommand(target), /^replay card t-status-test --pr 77/)
  target.evidence.push({ forkPr: 77, verdict: VERDICTS.UNDETERMINABLE, reason: "stale" })
  assert.equal(stageRows(target)[2].state, "in-flight")
  target.evidence.push({ forkPr: 77, verdict: VERDICTS.NEW_BEHAVIOR, card: "out/x.md" })
  assert.equal(stageRows(target)[2].state, "done")
  const text = renderTargetText(target)
  for (const stage of STAGES) assert.match(text, new RegExp(stage.name))
  assert.equal(STAGES.length, 7)
})

// ---------------------------------------------------------------- consume

test("consume: only a head-bound citation by a non-Garnet reviewer counts as consumption", () => {
  const pr = { headRefOid: SHA_B, author: { login: "dependabot[bot]" }, body: `x\n<!-- garnet:evidence:begin -->\nRuntime evidence (head \`${SHA_B.slice(0, 7)}\`)\n<!-- garnet:evidence:end -->` }
  const record = { user: { login: "garnet-runtime-review[bot]" }, body: RECORD_BODY }
  const none = evaluateConsumption({ pr, comments: [record], reviews: [], checks: [{ name: "garnet/evidence", status: "completed", conclusion: "success" }] })
  assert.equal(none.recordBound, true)
  assert.equal(none.mirror, true)
  assert.equal(none.consumed, false)
  const cited = evaluateConsumption({
    pr, comments: [record],
    reviews: [{ user: { login: "reviewer" }, state: "APPROVED", commit_id: SHA_B, body: `**Runtime grounding** (head \`${SHA_B.slice(0, 7)}\`): one new outbound connection, from the record.` }],
    checks: [{ name: "garnet/evidence", status: "completed", conclusion: "success" }],
  })
  assert.equal(cited.consumed, true)
  assert.deepEqual(cited.consumers, ["reviewer (review approved)"])
  for (const finding of cited.findings) assert.ok(Object.values(CLAIM_CLASSES).includes(finding.claimClass))
  const staleReview = evaluateConsumption({ pr, comments: [record], reviews: [{ user: { login: "reviewer" }, state: "APPROVED", commit_id: SHA_C, body: `Runtime grounding (head \`${SHA_C.slice(0, 7)}\`)` }] })
  assert.equal(staleReview.consumed, false)
  assert.match(renderConsumeReport(cited, { prUrl: `https://github.com/${FORK}/pull/77` }), /reviewer/)
})

// ---------------------------------------------------------------- verify

test("verify: the share gate fails on pending checks, stale heads, residue; passes a clean exhibit", () => {
  const pr = { head_sha: SHA_B, base_sha: SHA_C, state: "open", body: "Bumps `puppeteer` from 24.40.0 to 25.9.0." }
  const comments = [{ user: "garnet-runtime-review[bot]", body: RECORD_BODY }]
  const good = evaluateExhibit({ pr, comments, checks: [{ name: "garnet/runtime-evidence", status: "completed", conclusion: "success" }], permalinkStatus: 200, expectedLabel: "real" })
  assert.equal(good.status, "PASS", good.reasons.join("; "))
  const pending = evaluateExhibit({ pr, comments, checks: [{ name: "garnet/runtime-evidence", status: "in_progress", conclusion: null }], permalinkStatus: 200 })
  assert.equal(pending.status, "FAIL")
  assert.match(pending.reasons.join("\n"), /check settled/)
  const stale = evaluateExhibit({ pr: { ...pr, head_sha: SHA_A }, comments, checks: [], permalinkStatus: 200 })
  assert.match(stale.reasons.join("\n"), /head moved/)
  const residue = evaluateExhibit({ pr: { ...pr, body: "opened by the replay harness in a devin session" }, comments, checks: [], permalinkStatus: 200 })
  assert.match(residue.reasons.join("\n"), /residue/)
  assert.equal(evaluateExhibit({ pr, comments: [], checks: [], permalinkStatus: null }).status, "FAIL")
})

// ---------------------------------------------------------------- stage 2

test("stage 2: mirror + gate ride the default branch, never run fork code, and reuse the fork's recording workflow", () => {
  const plan = planStage2({ slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "master", recording: { present: true, workflows: [".github/workflows/garnet.yml"], name: "Garnet Runtime Visibility" }, workExists: true })
  const files = Object.keys(plan.files)
  assert.ok(files.some((f) => f.includes("garnet-evidence-mirror.yml")))
  assert.ok(files.some((f) => f.includes("garnet-evidence-gate.yml")))
  assert.ok(!files.some((f) => f.endsWith("garnet-record.yml")))
  const mirror = Object.entries(plan.files).find(([f]) => f.endsWith("garnet-evidence-mirror.yml"))[1]
  assert.match(mirror, /workflow_run/)
  assert.match(mirror, /Garnet Runtime Visibility/)
  assert.doesNotMatch(mirror, /actions\/checkout@[^\n]*\n[^\n]*head\.sha|ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha/)
  const gate = Object.entries(plan.files).find(([f]) => f.endsWith("garnet-evidence-gate.yml"))[1]
  assert.match(gate, /head_sha|headRefOid|head\.sha/)
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  assert.match(renderStage2Plan(plan), /garnet\/evidence/)
  assert.throws(() => planStage2({ slug: "x", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", recording: { present: false, workflows: [] } }), /--ecosystem/)
  const injected = planStage2({ slug: "x", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", ecosystem: "cargo", recording: { present: false, workflows: [] } })
  const record = Object.entries(injected.files).find(([f]) => f.endsWith("garnet-record.yml"))[1]
  assert.match(record, /id-token: write/)
  assert.doesNotMatch(record, /api_token/)
  assert.match(record, /cargo fetch --locked/)
})
