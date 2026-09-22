import test from "node:test"
import assert from "node:assert/strict"
import { CAPTURE_STATUS, CLAIM_CLASSES, VERDICTS, assessCapture, assessSupersession, buildClaims, decideVerdict, pairRecord, stableAcrossRepetitions } from "../lib/evidence.mjs"
import { assertNoResidue, assertNoUpstreamLeak, assertOutbound, assertTwoCommits, assertVocabClean, assertForkTarget } from "../lib/guards.mjs"
import { isMergeQueue, observationFor, rankObservations, recommend, renderObserveOutput, scoreGap, prFacts } from "../lib/observe.mjs"
import { INSTALL_COMMANDS, RECORD_WORKFLOW_PATH, allManifests, contextCommitMessage, dependabotConfig, describeRecorders, eligibleRecorders, existingPaths, firstStagesMismatch, hasDependabotConfig, manifestDirectories, prBodyText, detectEcosystem, executePlan, forkHoldsBase, recordingWorkflowFiles, recordWorkflow, matchesPathFilter, planReplay, publicationState, pullRequestPathFilter, reconcileState, recordsAnyPath, renderPlan, requiredLabel, resolvedFirstMessage, selectedPathFilters, upsertReplay, workflowJobs, workflowName, workflowOnlyFirstPaths, workflowOnlyPathFilter, workflowRunWorkflows, writesPullRequests } from "../lib/replay-pr.mjs"
import { describeHealth, observeRecord, recorderHealth, recorderVerdict } from "../lib/recorder-health.mjs"
import { recordState } from "../lib/wait.mjs"
import { allowBuildScripts, buildScriptList, bumpManifest, lockedVersions, planAllowBuild, planTransition, removeBuildScript, resolvedVersion } from "../lib/replay-transition.mjs"
import { buildModel, classify, extractChains, renderCard } from "../lib/card.mjs"
import { assertAggregatesMatchRows, renderCohort, tally } from "../lib/cohort.mjs"
import { nextCommand, nextStage, renderTargetText, stageRows } from "../lib/status.mjs"
import { RECEIPT_TIERS, describeFunnel, describeSignals, evaluateConsumption, mirrorStaleness, recordDestinations, renderConsumeReport, renderHarvestReport, tallyReceipts } from "../lib/consume.mjs"
import { evaluateExhibit, findResidue, verifyExhibit, verifyExitCode } from "../lib/verify.mjs"
import { DEFAULT_REVIEWERS, REVIEWERS, REVIEWER_ADAPTERS, competingListeners, parseReviewers, planStage2, recorderNames, renderStage2Plan } from "../lib/stage2.mjs"
import { isTrustedEvidenceComment, recordStamp, renderEvidenceSection } from "../live/templates/stage2/garnet-evidence-mirror.mjs"
import { alreadyPublished, checkRunPayload, evidenceStateFor, parseRecorderNames, unsettledRecorders, withRecorderCompleteness } from "../live/templates/stage2/garnet-evidence-gate.mjs"
import { API_REVIEWERS, EVIDENCE_CHECK, MENTIONS, alreadyRequestedFor, evidenceCheckState, isFinalizedRecordFor, parseReviewers as parseWorkflowReviewers, renderRequestComment, rereviewMarker } from "../live/templates/stage2/garnet-rereview.mjs"
import { STAGES, ensureTarget } from "../lib/ledger.mjs"
import { keepUat, resolveConsumeTarget, uat } from "../lib/commands.mjs"

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

  // Additions under a partial capture are an observation, not a verdict on the change.
  const partialNew = decideVerdict({ capture: partial, comparisonAvailable: true, workloadAdded: 1, workloadRemoved: 0 })
  assert.equal(partialNew.verdict, VERDICTS.UNDETERMINABLE)
  assert.ok(partialNew.reasons.some((r) => r.includes("capture is partial")))
  assert.ok(partialNew.reasons.some((r) => r.includes("1 outbound connection recorded only after the change")))
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

test("replay --pr: commit 1 and the body name manifests only when every touched path is one", () => {
  const manifests = ["Cargo.toml", "Cargo.lock", "crates/uv/Cargo.toml", "nodejs/package.json", "pnpm-lock.yaml", "pyproject.toml", "uv.lock", "go.mod", "Gemfile.lock"]
  assert.equal(allManifests(manifests), true)
  assert.equal(allManifests([...manifests, "crates/uv/src/lib.rs"]), false)
  assert.equal(allManifests([]), false)
  assert.match(contextCommitMessage(["Cargo.toml", "Cargo.lock"]), /^chore\(deps\): sync dependency manifests before update\n\n- Cargo\.toml\n- Cargo\.lock$/)
  assert.match(contextCommitMessage(["Cargo.toml", "crates/uv/src/lib.rs"]), /^chore: sync touched files before update\n\n- Cargo\.toml\n- crates\/uv\/src\/lib\.rs$/)
  assert.equal(
    prBodyText({ paths: ["Cargo.toml", "crates/uv/src/lib.rs"] }),
    "Two commits: the first prepares the branch, the second is the change itself.\n\n2 files:\n\n- Cargo.toml\n- crates/uv/src/lib.rs\n",
  )
  assert.match(prBodyText({ paths: ["pnpm-lock.yaml"] }), /\n\nOne dependency manifest:\n\n- pnpm-lock\.yaml\n$/)
  assert.match(prBodyText({ paths: manifests }), /\n\n9 dependency manifests:\n\n(- .*\n){6}- and 3 more\n$/)
  const plan = replayPlan({ upstreamTitle: "Retry failed partial downloads", changes: [{ path: "crates/uv/src/lib.rs", status: "modified", previous: null }, { path: "Cargo.lock", status: "modified", previous: null }], firstPaths: [] })
  assert.match(plan.messages.first, /^chore: sync touched files before update/)
  assert.equal(plan.branch, "chore/update-dx")
  assert.equal(replayPlan({ upstreamTitle: "Refresh lockfile", changes: [{ path: "pnpm-lock.yaml", status: "modified", previous: null }] }).branch, "chore/manifests-dx")
  assert.match(plan.body, /^Two commits: the first prepares the branch, the second is the change itself\.\n\n2 files:/)
  for (const text of [plan.body, plan.messages.first]) assertVocabClean(text)
})

test("verify: only PASS exits 0", () => {
  assert.equal(verifyExitCode({ status: "PASS" }), 0)
  assert.equal(verifyExitCode({ status: "FAIL" }), 1)
  assert.equal(verifyExitCode({ status: "anything else" }), 1)
})

test("replay --pr: staging never names a path that is absent from the index and the worktree", () => {
  const plan = replayPlan({ changes: [...changes, { path: "frontend/src/legacy.test.ts", status: "removed", previous: null }] })
  const firstAdd = plan.steps.find((s) => s.id === "first-add")
  const changeAdd = plan.steps.find((s) => s.id === "change-add")
  const changeRemove = plan.steps.find((s) => s.id === "change-remove")
  assert.ok(!firstAdd.args.includes("docs/new.md"), "commit 1 stages nothing the change adds")
  assert.ok(!firstAdd.args.includes("docs/renamed.md"))
  assert.ok(firstAdd.args.includes("frontend/src/legacy.test.ts") && firstAdd.args.includes("docs/old.md"))
  assert.ok(!changeAdd.args.includes("frontend/src/legacy.test.ts"), "commit 2 stages nothing the change removes")
  assert.ok(!changeAdd.args.includes("docs/old.md"))
  assert.ok(changeAdd.args.includes("docs/new.md") && changeAdd.args.includes("docs/renamed.md"))
  assert.ok(changeRemove.args.includes("frontend/src/legacy.test.ts") && changeRemove.args.includes("docs/old.md"))
})

test("replay --pr: the plan measures how far the fork is behind the base and only fast-forwards on request", () => {
  const plan = replayPlan()
  const distance = plan.steps.find((s) => s.id === "base-distance")
  assert.deepEqual(distance.args.slice(-3), ["--count", SHA_A, "^origin/master"])
  assert.equal(plan.steps.some((s) => s.id === "sync-fork"), false)
  const ids = plan.steps.map((s) => s.id)
  assert.ok(ids.indexOf("base-distance") < ids.indexOf("branch"), "the distance is read before the replay branch is cut")

  const synced = replayPlan({ syncFork: true })
  const sync = synced.steps.find((s) => s.id === "sync-fork")
  assert.equal(sync.kind, "write-remote")
  assert.equal(sync.target, FORK)
  assert.deepEqual(sync.args.slice(-3), ["push", "origin", `${SHA_A}:refs/heads/master`])
  const syncedIds = synced.steps.map((s) => s.id)
  assert.ok(syncedIds.indexOf("verify-clean") < syncedIds.indexOf("sync-fork"))
  assert.ok(syncedIds.indexOf("sync-fork") < syncedIds.indexOf("base-distance"))
  assert.ok(syncedIds.indexOf("base-distance") < syncedIds.indexOf("branch"))
})

test("replay --pr: --base-branch opens against a fork branch set to the base and carries the fork's recorder into commit 1", () => {
  const recorder = ".github/workflows/garnet-ci.yml"
  const plan = replayPlan({ baseBranch: "sync/abc1234", recordWorkflows: [recorder] })
  const ids = plan.steps.map((s) => s.id)
  const set = plan.steps.find((s) => s.id === "base-branch")
  assert.equal(set.kind, "write-remote")
  assert.equal(set.target, FORK)
  assert.deepEqual(set.args.slice(-3), ["push", "origin", `${SHA_A}:refs/heads/sync/abc1234`])
  assert.deepEqual(plan.steps.find((s) => s.id === "branch").args.slice(-2), [plan.branch, "origin/sync/abc1234"])
  const carried = plan.steps.find((s) => s.id === "first-fork-record")
  assert.deepEqual(carried.args.slice(-3), ["origin/master", "--", recorder])
  assert.ok(ids.indexOf("first-fork-record") < ids.indexOf("first-check"))
  assert.deepEqual(plan.steps.find((s) => s.id === "verify-commits").args.slice(-1), ["origin/sync/abc1234..HEAD"])
  const create = plan.steps.find((s) => s.id === "pr-create")
  assert.equal(create.args[create.args.indexOf("--base") + 1], "sync/abc1234")
  assert.equal(plan.steps.some((s) => s.id === "sync-fork"), false)
  assert.match(renderPlan(plan), /base: sync\/abc1234 \(set to the change's base\)/)

  assert.equal(replayPlan({ baseBranch: "sync/x", record: "inject", ecosystem: "npm" }).steps.some((s) => s.id === "first-fork-record"), false)
  assert.throws(() => replayPlan({ baseBranch: "sync/x" }), /pass --record inject/)
  assert.throws(
    () => replayPlan({ baseBranch: "sync/x", recordWorkflows: [recorder, ".github/workflows/garnet-replay-headless.yml"] }),
    /carries 2 recording workflows; commit 1 carries one, so pass --record-workflow <path> with one of: \.github\/workflows\/garnet-ci\.yml, \.github\/workflows\/garnet-replay-headless\.yml/,
  )
  assert.throws(
    () => replayPlan({ baseBranch: "sync/x", recordWorkflows: [".github/workflows/garnet-harness.yml"] }),
    /session residue 'harness'/,
  )
  assert.throws(() => replayPlan({ baseBranch: "master", recordWorkflows: [recorder] }), /other than master/)
  assert.throws(() => replayPlan({ baseBranch: "sync/x", recordWorkflows: [recorder], syncFork: true }), /alternatives/)
  assert.equal(resolvedFirstMessage([recorder], "chore(deps): sync dependency manifests before update\n\n- x"), `ci: record dependency installs on pull requests\n\n- ${recorder}`)
})

test("replay --pr: when the change's base already records, --base-branch carries nothing and says so", () => {
  const plan = replayPlan({ baseBranch: "base/x", recordWorkflows: [".github/workflows/a.yml", ".github/workflows/b.yml"], baseRecords: [".github/workflows/ci.yml"] })
  assert.equal(plan.steps.some((s) => s.id === "first-fork-record"), false)
  assert.deepEqual(plan.recordWorkflows, [])
  assert.deepEqual(plan.baseRecords, [".github/workflows/ci.yml"])
  assert.match(renderPlan(plan), /record: the change's base already runs its own recording workflow \(\.github\/workflows\/ci\.yml\)/)
  assert.deepEqual(replayPlan({ baseBranch: "base/x", recordWorkflows: [".github/workflows/a.yml"] }).baseRecords, [])
  assert.match(renderPlan(replayPlan({ baseBranch: "base/x", recordWorkflows: [".github/workflows/a.yml"] })), /record: fork's recording workflow carried into commit 1 \(\.github\/workflows\/a\.yml\)/)
})

test("replay --pr: --label puts the fork's label on the pull request after it opens, never on the upstream", () => {
  const plan = replayPlan({ label: "release-testing" })
  const ids = plan.steps.map((s) => s.id)
  const step = plan.steps.find((s) => s.id === "pr-label")
  assert.equal(step.kind, "write-remote")
  assert.equal(step.target, FORK)
  assert.deepEqual(step.args, ["pr", "edit", plan.branch, "--repo", FORK, "--add-label", "release-testing"])
  assert.ok(ids.indexOf("pr-create") < ids.indexOf("pr-label") && ids.indexOf("pr-label") < ids.indexOf("wait-first-record"))
  assert.match(renderPlan(plan), /^label: release-testing$/m)
  assert.equal(replayPlan().steps.some((s) => s.id === "pr-label"), false)
  assert.throws(() => replayPlan({ label: " " }), /--label needs a label name/)
})

test("replay --pr: an injected recorder also covers Dependabot; a fork without dependabot.yml gets one in commit 1", () => {
  const plan = replayPlan({ record: "inject", ecosystem: "npm", dependabotConfigured: false })
  const ids = plan.steps.map((s) => s.id)
  const write = plan.steps.find((s) => s.id === "first-dependabot")
  assert.equal(write.kind, "write-local")
  assert.equal(write.writeFileContent.file, "/tmp/work/.github/dependabot.yml")
  assert.match(write.writeFileContent.content, /^version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: \/\n    schedule:\n      interval: weekly\n/)
  assert.match(write.writeFileContent.content, /package-ecosystem: github-actions/)
  assert.ok(ids.indexOf("first-record-add") < ids.indexOf("first-dependabot") && ids.indexOf("first-dependabot-add") < ids.indexOf("first-commit"), ids.join(" "))
  assert.equal(plan.dependabotAdded, true)
  assert.match(renderPlan(plan), /^record: recording workflow added in commit 1 \(npm\); Dependabot pull requests on the fork run it too$/m)
  assert.deepEqual(plan.dependabotDirectories, ["/", "/nodejs"], "root lockfile and nodejs/package.json")
  assert.match(write.writeFileContent.content, /package-ecosystem: npm\n    directory: \/nodejs\n/)
  assert.match(renderPlan(plan), /^dependabot: \.github\/dependabot\.yml added in commit 1 \(npm, weekly, \/, \/nodejs\)$/m)
  assert.equal(replayPlan({ record: "inject", ecosystem: "npm" }).steps.some((s) => s.id === "first-dependabot"), false)
  assert.equal(replayPlan({ dependabotConfigured: false }).steps.some((s) => s.id === "first-dependabot"), false, "the fork's own recorder: nothing is added")

  // Manifests under a directory: Dependabot watches that directory, not the root.
  const nested = replayPlan({
    record: "inject", ecosystem: "npm", dependabotConfigured: false,
    changes: [{ path: "frontend/package.json", status: "M" }, { path: "frontend/pnpm-lock.yaml", status: "M" }, { path: "frontend/src/a.ts", status: "M" }],
    firstPaths: [],
  })
  assert.deepEqual(nested.dependabotDirectories, ["/frontend"])
  const nestedConfig = nested.steps.find((s) => s.id === "first-dependabot").writeFileContent.content
  assert.match(nestedConfig, /package-ecosystem: npm\n    directory: \/frontend\n/)
  assert.ok(!/package-ecosystem: npm\n    directory: \/\n/.test(nestedConfig))
  assert.match(renderPlan(nested), /^dependabot: .* \(npm, weekly, \/frontend\)$/m)
  assert.deepEqual(manifestDirectories(["package.json", "frontend/package.json", "frontend/pnpm-lock.yaml", "src/a.ts"]), ["/", "/frontend"])
  assert.deepEqual(manifestDirectories(["src/a.ts"]), ["/"])
  assert.deepEqual(manifestDirectories(["tools/x/Cargo.toml"]), ["/tools/x"])
  assert.match(dependabotConfig("npm", ["/", "/frontend"]), /directory: \/\n[\s\S]*directory: \/frontend\n/)
  assert.throws(() => dependabotConfig("npm", ["frontend"]), /absolute/)
  assert.equal(dependabotConfig("pnpm").includes("package-ecosystem: npm"), true)
  assert.equal(dependabotConfig("uv").includes("package-ecosystem: uv"), true)
  assert.equal(dependabotConfig("go").includes("package-ecosystem: gomod"), true)
  assert.equal(dependabotConfig("ruby").includes("package-ecosystem: bundler"), true)
  assert.throws(() => dependabotConfig("bazel"), /no Dependabot ecosystem/)
  assert.match(recordWorkflow("npm"), /Dependabot's included/)
  assert.equal(resolvedFirstMessage([".github/dependabot.yml", ".github/workflows/garnet-record.yml"], "chore(deps): sync"), "ci: record dependency installs on pull requests\n\n- .github/dependabot.yml\n- .github/workflows/garnet-record.yml")
})

test("recording workflows: a pull_request workflow that calls a local reusable workflow running the action counts; the reusable file alone does not", () => {
  const bodies = {
    "ci.yml": "name: CI\non:\n  pull_request:\n  push:\njobs:\n  test:\n    uses: $/.github/workflows/test.yml\n    with:\n      garnet: true\n",
    "test.yml": "name: Test\non:\n  workflow_call:\njobs:\n  test:\n    steps:\n      - uses: garnet-org/action@3d47f4a9004f7356c980a0e8d420ef5984750e3c\n",
    "release.yml": "name: Release\non:\n  push:\n    tags: ['v*']\njobs:\n  release:\n    steps:\n      - uses: garnet-org/action@v2\n",
    "record.yml": "name: Record\non: [push, pull_request]\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n",
    "lint.yml": "name: Lint\non:\n  pull_request:\njobs:\n  lint:\n    uses: ./.github/workflows/lint-impl.yml\n",
    "lint-impl.yml": "on:\n  workflow_call:\njobs:\n  lint:\n    steps:\n      - run: echo ok\n",
  }
  assert.deepEqual(recordingWorkflowFiles(bodies), ["ci.yml", "record.yml"])
})

test("replay --pr: the fork recorder's path filter must be reached by commit 2, or nothing records", () => {
  const recorder = `name: Garnet Runtime Visibility
on:
    pull_request:
        paths:
            - package.json
            - pnpm-lock.yaml
            - .github/workflows/garnet-ci.yml # the recorder itself
    workflow_dispatch:
        inputs:
            checkout_ref:
                required: false
permissions:
    contents: read
`
  assert.deepEqual(pullRequestPathFilter(recorder), ["package.json", "pnpm-lock.yaml", ".github/workflows/garnet-ci.yml"])
  assert.deepEqual(pullRequestPathFilter("on:\n  pull_request:\n    paths: [package.json, 'pnpm-lock.yaml', \"**/Cargo.lock\"] # flow form\njobs: {}\n"), ["package.json", "pnpm-lock.yaml", "**/Cargo.lock"])
  assert.equal(pullRequestPathFilter("on:\n  pull_request:\n    paths: []\njobs: {}\n"), null)
  assert.equal(pullRequestPathFilter("on:\n  pull_request:\n    branches: [main]\njobs: {}\n"), null)
  assert.equal(pullRequestPathFilter("on: [push]\n"), null)

  // Several recorders: commit 2 has to reach at least one; each filter is kept whole so its negations mean what they mean. One unfiltered recorder means no filter.
  const paths = { ".github/workflows/a.yml": ["package.json"], ".github/workflows/b.yml": ["Cargo.lock", "package.json"], ".github/workflows/all.yml": null, ".github/workflows/src.yml": ["**", "!docs/**"] }
  assert.deepEqual(selectedPathFilters(paths, [".github/workflows/a.yml", ".github/workflows/b.yml"]), { ".github/workflows/a.yml": ["package.json"], ".github/workflows/b.yml": ["Cargo.lock", "package.json"] })
  assert.equal(selectedPathFilters(paths, [".github/workflows/a.yml", ".github/workflows/all.yml"]), null)
  assert.equal(selectedPathFilters(paths, [".github/workflows/unknown.yml"]), null)
  assert.equal(recordsAnyPath(selectedPathFilters(paths, [".github/workflows/a.yml", ".github/workflows/b.yml"]), ["Cargo.lock"]), true)
  assert.equal(recordsAnyPath(selectedPathFilters(paths, [".github/workflows/a.yml"]), ["Cargo.lock"]), false)
  assert.equal(recordsAnyPath(selectedPathFilters(paths, [".github/workflows/src.yml", ".github/workflows/a.yml"]), ["docs/x.md"]), false, "a negation in one filter is not cancelled by another workflow's list")
  assert.equal(recordsAnyPath(selectedPathFilters(paths, [".github/workflows/src.yml"]), ["src/x.rs"]), true)
  assert.match(describeRecorders({ ".github/workflows/a.yml": ["package.json"] }), /^fork's own recording workflow: \.github\/workflows\/a\.yml \(paths: package\.json\)$/)
  assert.equal(describeRecorders(null), "fork's own recording workflow (every pull request)")
  assert.equal(matchesPathFilter("pnpm-lock.yaml", ["package.json", "pnpm-lock.yaml"]), true)
  assert.equal(matchesPathFilter("frontend/package.json", ["package.json"]), false)
  assert.equal(matchesPathFilter("frontend/package.json", ["**/package.json"]), true)
  assert.equal(matchesPathFilter("src/a/b.rs", ["src/**"]), true)
  assert.equal(matchesPathFilter("src/a/b.rs", ["src/*"]), false)
  assert.equal(matchesPathFilter("docs/x.md", ["**", "!docs/**"]), false)

  // The lockfile is in commit 1 here, so commit 2 touches only frontend sources: the recorder would never run on it.
  const filters = { ".github/workflows/garnet-ci.yml": ["package.json", "pnpm-lock.yaml"] }
  assert.throws(
    () => replayPlan({ recordFilters: filters }),
    /recording workflows run only when package\.json, pnpm-lock\.yaml change; commit 2 touches none of them, so it would record nothing/,
  )
  assert.doesNotThrow(() => replayPlan({ recordFilters: filters, firstPaths: [] }))
  assert.doesNotThrow(() => replayPlan({ recordFilters: null }))
  assert.doesNotThrow(() => replayPlan({ recordFilters: { ".github/workflows/x.yml": ["Cargo.lock"] }, record: "inject", ecosystem: "npm" }), "an injected recorder has no fork path filter")
  assert.match(renderPlan(replayPlan({ recordFilters: filters, firstPaths: [] })), /^record: fork's own recording workflow: \.github\/workflows\/garnet-ci\.yml \(paths: package\.json, pnpm-lock\.yaml\)$/m)
})

test("recording workflows: a workflow whose every job needs a pull request label counts only when the run applies that label", () => {
  const gate = `name: Release gate
on:
  pull_request:
    types: [opened, synchronize, labeled]
jobs:
  gate:
    if: contains(github.event.pull_request.labels.*.name, 'garnet-release-testing')
    runs-on: ubuntu-latest
    steps:
      - uses: garnet-org/action@9696f3cae14437203c56dac7d78d9449b9ba3764
  report:
    needs: gate
    if: \${{ contains(github.event.pull_request.labels.*.name, "garnet-release-testing") }}
    runs-on: ubuntu-latest
    steps:
      - run: echo done
`
  assert.equal(requiredLabel(gate), "garnet-release-testing")
  // The pnpm fork's release gate: one job checks the label (alongside the schedule trigger), the rest need it.
  const chained = `on:\n  schedule:\n    - cron: '*/30 * * * *'\n  pull_request:\n    types: [opened, labeled]\njobs:\n  detect:\n    if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'garnet-release-testing')\n    runs-on: ubuntu-24.04\n    outputs:\n      tag: \${{ steps.pick.outputs.tag }}\n  reproduce:\n    needs: detect\n    if: needs.detect.outputs.run_gate == 'true'\n    uses: $/.github/workflows/garnet-jibril-release-gate-job.yml\n  report:\n    needs:\n      - detect\n      - reproduce\n    runs-on: ubuntu-24.04\n  summary:\n    needs: [detect, reproduce]\n    steps: []\n`
  assert.equal(requiredLabel(chained), "garnet-release-testing")
  assert.deepEqual(workflowJobs(chained).report.needs, ["detect", "reproduce"])
  assert.deepEqual(workflowJobs(chained).summary.needs, ["detect", "reproduce"])
  assert.equal(requiredLabel(chained.replace("needs: [detect, reproduce]\n", "")), null, "a job that needs nothing and checks nothing runs unlabelled")
  assert.equal(requiredLabel("on: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: garnet-org/action@v2\n"), null)
  assert.equal(requiredLabel("on: [pull_request]\njobs:\n  gated:\n    if: contains(github.event.pull_request.labels.*.name, 'x')\n    steps: []\n  open:\n    steps: []\n"), null, "one unlabelled job means the workflow runs")
  assert.equal(requiredLabel("on: [pull_request]\njobs:\n  test:\n    if: github.event_name == 'pull_request'\n    steps: []\n"), null, "a condition that is not a label gate")
  assert.equal(requiredLabel("on: [pull_request]\n"), null)

  const recording = {
    present: true,
    workflows: [".github/workflows/ci.yml", ".github/workflows/garnet-jibril-release-gate.yml"],
    labels: { ".github/workflows/ci.yml": null, ".github/workflows/garnet-jibril-release-gate.yml": "garnet-release-testing" },
    paths: {},
    name: "CI",
  }
  assert.deepEqual(eligibleRecorders(recording, null), { eligible: [".github/workflows/ci.yml"], gated: { ".github/workflows/garnet-jibril-release-gate.yml": "garnet-release-testing" } })
  assert.deepEqual(eligibleRecorders(recording, "garnet-release-testing").eligible, recording.workflows)
  assert.deepEqual(eligibleRecorders(recording, "other").eligible, [".github/workflows/ci.yml"])
  assert.deepEqual(eligibleRecorders({ ...recording, workflows: recording.workflows.slice(1) }, null).eligible, [])
})

test("replay --pr: a context plan may stage only the paths it adds and its --first paths", () => {
  const plan = { firstStages: "context", firstPaths: ["pnpm-lock.yaml"], contextPaths: [RECORD_WORKFLOW_PATH, ".github/dependabot.yml"] }
  assert.deepEqual(firstStagesMismatch(plan, ["pnpm-lock.yaml", RECORD_WORKFLOW_PATH, ".github/dependabot.yml"]), [])
  assert.deepEqual(firstStagesMismatch(plan, [RECORD_WORKFLOW_PATH, ".github/workflows/ci.yml"]), [".github/workflows/ci.yml"], "another workflow under .github/ is a mismatch")
  assert.deepEqual(firstStagesMismatch(plan, ["package.json"]), ["package.json"])
  assert.deepEqual(firstStagesMismatch({ firstStages: "touched", firstPaths: [] }, ["anything"]), [])
  assert.deepEqual(replayPlan({ record: "inject", ecosystem: "npm", dependabotConfigured: false, forkHoldsBase: true }).contextPaths, [RECORD_WORKFLOW_PATH, ".github/dependabot.yml"])
})

test("dependabot config lookup: only a 404 means absent; any other API failure stops the run", () => {
  const absent = () => { throw new Error("gh: Not Found (HTTP 404)") }
  assert.equal(hasDependabotConfig(FORK, "main", { exec: absent }), false)
  const forbidden = () => { throw new Error("gh: Resource not accessible by integration (HTTP 403)") }
  assert.throws(() => hasDependabotConfig(FORK, "main", { exec: forbidden }), /could not read \.github\/dependabot\.yml on garnet-labs\/posthog@main: gh: Resource not accessible/)
  const present = () => JSON.stringify({ type: "file", path: ".github/dependabot.yml" })
  assert.equal(hasDependabotConfig(FORK, "main", { exec: present }), true)
})

test("existing adapter lookup: 404 means absent, a file means present, a directory or other failure never counts as an adapter", () => {
  const seen = []
  const exec = (_cmd, args) => {
    const path = String(args[1]).replace(/^repos\/[^/]+\/[^/]+\/contents\//, "").replace(/\?ref=.*$/, "")
    seen.push(path)
    if (path === ".coderabbit.yaml") return JSON.stringify({ type: "file", path })
    if (path === ".greptile") return JSON.stringify([{ type: "file", path: ".greptile/config.json" }])
    throw new Error("gh: Not Found (HTTP 404)")
  }
  assert.deepEqual(existingPaths(FORK, "main", [".coderabbit.yaml", ".greptile/config.json", ".greptile"], { exec }), [".coderabbit.yaml"])
  assert.deepEqual(seen, [".coderabbit.yaml", ".greptile/config.json", ".greptile"])
  const forbidden = () => { throw new Error("gh: Resource not accessible by integration (HTTP 403)") }
  assert.throws(() => existingPaths(FORK, "main", [".coderabbit.yaml"], { exec: forbidden }), /could not read \.coderabbit\.yaml on garnet-labs\/posthog@main/)
  assert.deepEqual(existingPaths(FORK, "main", [], { exec: forbidden }), [])
})

test("recorder health: the fork's newest pull requests say whether Runtime Review is finalizing comments", () => {
  const bot = { login: "garnet-runtime-review[bot]" }
  const final = (sha) => ({ user: bot, updated_at: "2026-09-08T10:00:00Z", body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${sha} -->\n<!-- garnet:summary {"status":"finalized","changed":0} -->\nRuntime Review` })
  const pending = (sha) => ({ user: bot, updated_at: "2026-09-10T21:18:00Z", body: `<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pending-pr-comment: ${sha} -->\n<!-- garnet:commit ${sha} -->\n⏳ recording` })
  const human = { user: { login: "someone" }, updated_at: "2026-09-10T21:00:00Z", body: "lgtm" }

  assert.deepEqual(observeRecord(52, [human, pending(SHA_A)]), { pr: 52, state: "pending", updatedAt: "2026-09-10T21:18:00Z" })
  assert.deepEqual(observeRecord(43, [final(SHA_A), human]), { pr: 43, state: "final", updatedAt: "2026-09-08T10:00:00Z" })
  assert.equal(observeRecord(7, [human]), null)

  const row = (pr, state) => ({ pr, state, updatedAt: state === "final" ? "2026-09-08T10:00:00Z" : "2026-09-10T21:18:00Z" })
  assert.equal(recorderVerdict([row(52, "pending"), row(51, "pending"), row(50, "final")]).verdict, "stalled")
  assert.equal(recorderVerdict([row(52, "pending"), row(50, "final")]).verdict, "unknown", "one fresh placeholder over a finalized record may just be fresh")
  assert.equal(recorderVerdict([row(52, "pending")]).verdict, "stalled", "nothing has ever finalized")
  assert.equal(recorderVerdict([row(52, "final"), row(51, "pending")]).verdict, "ok")
  assert.equal(recorderVerdict([null, null]).verdict, "none")
  assert.equal(recorderVerdict([]).verdict, "none")
  assert.match(describeHealth(recorderVerdict([row(52, "pending"), row(51, "pending"), row(50, "final")]), 8), /^recorder health: stalled · last finalized record on pull request 50 \(2026-09-08\); pending placeholder on 52 \(since 2026-09-10\), 51 \(since 2026-09-10\) · 8 recent pull requests read$/)

  // Through gh: the newest pull requests are read, newest first, one comment list each.
  const calls = []
  const exec = (cmd, args) => {
    calls.push(args.join(" "))
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify([{ number: 50 }, { number: 52 }, { number: 51 }])
    if (args[1] === `repos/${FORK}/issues/52/comments`) return JSON.stringify([pending(SHA_A)])
    if (args[1] === `repos/${FORK}/issues/51/comments`) return JSON.stringify([pending(SHA_B)])
    if (args[1] === `repos/${FORK}/issues/50/comments`) return JSON.stringify([final(SHA_A)])
    throw new Error(`unexpected ${args.join(" ")}`)
  }
  const health = recorderHealth(FORK, { exec, limit: 3 })
  assert.equal(health.verdict, "stalled")
  assert.equal(health.scanned, 3)
  assert.deepEqual(health.pending.map((r) => r.pr), [52, 51])
  assert.equal(health.lastFinal.pr, 50)
  assert.ok(calls.some((c) => c.startsWith("pr list") && c.includes(FORK)), calls.join("\n"))
})

test("replay --pr: commit 1's message describes what it stages, not what the plan assumed", () => {
  const planned = "chore(deps): sync dependency manifests before update\n\n- Cargo.lock"
  assert.equal(resolvedFirstMessage(["Cargo.lock", RECORD_WORKFLOW_PATH], planned), planned)
  const only = resolvedFirstMessage([RECORD_WORKFLOW_PATH], planned)
  assert.match(only, /^ci: record dependency installs on pull requests\n\n- \.github\/workflows\/garnet-record\.yml$/)
  assert.equal(replayPlan({ record: "inject", ecosystem: "cargo" }).steps.find((s) => s.id === "first-commit").messageFrom, "firstDiff")

  // The dry run says so too: the plan names the workflow-only message commit 1 gets when nothing else is staged.
  const injected = replayPlan({ record: "inject", ecosystem: "cargo", dependabotConfigured: false })
  assert.deepEqual(workflowOnlyFirstPaths(injected), [RECORD_WORKFLOW_PATH, ".github/dependabot.yml"])
  const rendered = renderPlan(injected)
  assert.ok(rendered.includes(`commit 1\n  ${injected.messages.first.split("\n")[0]}`))
  assert.match(rendered, /or, if the fork already holds the touched paths as the change found them and commit 1 stages only these:\n  ci: record dependency installs on pull requests\n\n  - \.github\/workflows\/garnet-record\.yml\n  - \.github\/dependabot\.yml/)
  assert.deepEqual(workflowOnlyFirstPaths(replayPlan()), [])
  assert.ok(!renderPlan(replayPlan()).includes("stages only these"))
  assert.equal(injected.firstStages, "unknown")
  assert.match(rendered, /commit 1 stages: decided at the checkout/)

  // Compared ahead of time, the dry run names one message and one reason.
  const held = replayPlan({ record: "inject", ecosystem: "cargo", dependabotConfigured: false, firstPaths: [], forkHoldsBase: true })
  assert.equal(held.firstStages, "context")
  assert.match(held.messages.first, /^ci: record dependency installs on pull requests\n\n- \.github\/workflows\/garnet-record\.yml\n- \.github\/dependabot\.yml$/)
  const heldRendered = renderPlan(held)
  assert.match(heldRendered, /commit 1 stages: only what the plan adds \(the touched paths on master match the change's base\)/)
  assert.ok(!heldRendered.includes("or, if the fork"))
  const differs = replayPlan({ record: "inject", ecosystem: "cargo", dependabotConfigured: false, firstPaths: [], forkHoldsBase: false })
  assert.equal(differs.firstStages, "touched")
  assert.match(differs.messages.first, /^chore: sync touched files before update/)
  assert.ok(!renderPlan(differs).includes("or, if the fork"))
  assert.match(renderPlan(differs), /commit 1 stages: the touched paths as the change found them \(master on the fork differs on at least one\)/)
  // --sync-fork and --base-branch start from the change's base, so the answer is known without a probe.
  assert.equal(replayPlan({ syncFork: true }).firstStages, "context")
  assert.equal(replayPlan({ baseBranch: "sync/x", recordWorkflows: [".github/workflows/garnet-ci.yml"], firstPaths: [] }).firstStages, "context")
  // Nothing to stage in commit 1 is refused at plan time, not at the checkout.
  assert.throws(() => replayPlan({ firstPaths: [], forkHoldsBase: true }), /already holds the touched paths .* pass --first <path>/)
  assert.throws(() => replayPlan({ syncFork: true, firstPaths: [] }), /pass --first <path>/)
  assert.doesNotThrow(() => replayPlan({ firstPaths: [], forkHoldsBase: false }))
})

test("replay --pr: forkHoldsBase compares blobs at the change's base and the fork's branch, 404 is absence, other errors are unknown", () => {
  const blobs = {
    "PostHog/posthog@aaaaaaa": { "package.json": "p1", "pnpm-lock.yaml": "l1" },
    "garnet-labs/posthog@master": { "package.json": "p1", "pnpm-lock.yaml": "l1" },
  }
  const exec = (cmd, args) => {
    const [, endpoint] = args
    const match = /^repos\/([^/]+\/[^/]+)\/contents\/(.+)\?ref=(.+)$/.exec(endpoint)
    const at = blobs[`${match[1]}@${match[3].slice(0, 7)}`] ?? {}
    if (!(match[2] in at)) throw new Error("gh: Not Found (HTTP 404)")
    return JSON.stringify({ sha: at[match[2]], type: "file" })
  }
  const input = { upstream: UPSTREAM, baseSha: SHA_A, fork: FORK, ref: "master", changes }
  assert.equal(forkHoldsBase(input, { exec }), true)
  blobs["garnet-labs/posthog@master"]["pnpm-lock.yaml"] = "l2"
  assert.equal(forkHoldsBase(input, { exec }), false)
  delete blobs["garnet-labs/posthog@master"]["pnpm-lock.yaml"]
  assert.equal(forkHoldsBase(input, { exec }), false, "absent on the fork, present at the base")
  delete blobs["PostHog/posthog@aaaaaaa"]["pnpm-lock.yaml"]
  assert.equal(forkHoldsBase(input, { exec }), true, "absent in both")
  assert.equal(forkHoldsBase(input, { exec: () => { throw new Error("HTTP 502") } }), null)
  assert.equal(forkHoldsBase({ ...input, changes: Array.from({ length: 41 }, (_, i) => ({ path: `f${i}`, status: "modified", previous: null })) }, { exec }), null)
  assert.equal(forkHoldsBase({ ...input, changes: [] }, { exec }), null)
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
  const exec = (cmd, args, options = {}) => {
    calls.push([cmd, ...args].join(" "))
    for (const [pattern, out] of responses) if (pattern.test(calls.at(-1))) return typeof out === "function" ? out(options) : out
    return ""
  }
  return { exec, calls }
}

const recordedFirst = JSON.stringify([{ user: { login: "garnet-ai[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_C} -->\n<!-- garnet:summary {"status":"finalized"} -->\n> recorded` }])
const replayResponses = [
  [/remote get-url origin/, `https://github.com/${FORK}.git\n`],
  [/diff --cached --name-only/, "pnpm-lock.yaml\n"],
  [/rev-list --count \S+ \^origin/, "0\n"],
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

})

const TREE_FIRST = "1".repeat(40)
const TREE_HEAD = "2".repeat(40)
const REMOTE_FIRST = "d".repeat(40)
const REBUILT = "e".repeat(40)
const existingPr70 = [/gh pr list/, JSON.stringify([{ number: 70, state: "OPEN", isDraft: true, url: `https://github.com/${FORK}/pull/70` }])]
function resumeResponses(remoteHead, remoteTree, extra = []) {
  return [
    existingPr70,
    ...extra,
    [/rev-parse --verify -q refs\/remotes\/origin\/deps\/puppeteer-25\.9\.0\^\{commit\}/, remoteHead === null ? "" : `${remoteHead}\n`],
    [new RegExp(`rev-parse ${remoteHead}\\^\\{tree\\}`), `${remoteTree}\n`],
    [/rev-parse HEAD~1\^\{tree\}/, `${TREE_FIRST}\n`],
    [/rev-parse HEAD\^\{tree\}/, `${TREE_HEAD}\n`],
    [new RegExp(`rev-parse ${remoteHead}~1`), `${SHA_C}\n`],
    [/rev-parse HEAD~2$/, `${SHA_C}\n`],
    [new RegExp(`rev-list --count origin/master\\.\\.${remoteHead}`), remoteTree === TREE_HEAD ? "2\n" : "1\n"],
    [/commit-tree/, `${REBUILT}\n`],
    [/gh api repos\/\S+\/issues\/70\/comments/, () => JSON.stringify([{ user: { login: "garnet-ai[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${remoteHead} -->\n<!-- garnet:summary {"status":"finalized"} -->` }])],
    ...replayResponses,
  ]
}

test("replay --pr: a rerun with commit 1 already on the fork waits for its record, then pushes commit 2 rebuilt on it", async () => {
  assert.equal(publicationState({ remoteTree: null, firstTree: TREE_FIRST, headTree: TREE_HEAD }), "none")
  assert.equal(publicationState({ remoteTree: TREE_FIRST, firstTree: TREE_FIRST, headTree: TREE_HEAD }), "first")
  assert.equal(publicationState({ remoteTree: TREE_HEAD, firstTree: TREE_FIRST, headTree: TREE_HEAD }), "both")
  assert.equal(publicationState({ remoteTree: "9".repeat(40), firstTree: TREE_FIRST, headTree: TREE_HEAD }), "mismatch")

  const plan = replayPlan()
  const { io } = memoryIo()
  const resume = fakeExec(resumeResponses(REMOTE_FIRST, TREE_FIRST))
  const captured = await executePlan(plan, { exec: resume.exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.forkPr, 70)
  assert.equal(captured.reconciled, true)
  assert.equal(captured.firstSha, REMOTE_FIRST, "the wait binds to the commit 1 that is on the fork, not the rebuilt local one")
  assert.equal(captured.forkHeadSha, REBUILT)
  assert.equal(captured.firstRecord.state, "recorded")
  assert.ok(!resume.calls.some((c) => c.includes("gh pr create")))
  assert.ok(!resume.calls.some((c) => c.includes("push --set-upstream")))
  assert.ok(resume.calls.includes(`git -C /tmp/work commit-tree ${TREE_HEAD} -p ${REMOTE_FIRST} -m ${plan.messages.change}`))
  assert.ok(resume.calls.includes(`git -C /tmp/work update-ref refs/heads/deps/puppeteer-25.9.0 ${REBUILT}`))
  const waited = resume.calls.findIndex((c) => /issues\/70\/comments/.test(c))
  const change = resume.calls.indexOf("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0")
  assert.ok(waited >= 0 && waited < change, resume.calls.join("\n"))

  // Commit 1 on the fork but its record still pending: no push, clear rerun instruction.
  const pendingComment = JSON.stringify([{ user: { login: "garnet-ai[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pending-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:commit ${REMOTE_FIRST} -->` }])
  const pending = fakeExec(resumeResponses(REMOTE_FIRST, TREE_FIRST, [[/issues\/70\/comments/, pendingComment]]))
  await assert.rejects(executePlan(plan, { exec: pending.exec, io, log: () => {}, wait: { ...noWait, timeoutMs: 0 } }), /rerun the same command once it is recorded/)
  assert.ok(!pending.calls.some((c) => c.includes("push origin HEAD:")))

  // --no-wait on a rerun still pushes commit 2 without a comparison.
  const skipped = fakeExec(resumeResponses(REMOTE_FIRST, TREE_FIRST))
  const noWaitRun = await executePlan(plan, { exec: skipped.exec, io, log: () => {}, wait: { enabled: false } })
  assert.equal(noWaitRun.firstRecord.state, "not-waited")
  assert.ok(skipped.calls.includes("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0"))
})

test("replay --pr: a rerun with both commits on the fork pushes nothing; a foreign head is refused", async () => {
  const plan = replayPlan()
  const { io } = memoryIo()
  const REMOTE_HEAD = "f".repeat(40)
  const done = fakeExec(resumeResponses(REMOTE_HEAD, TREE_HEAD))
  const captured = await executePlan(plan, { exec: done.exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.forkPr, 70)
  assert.equal(captured.forkHeadSha, REMOTE_HEAD)
  assert.equal(captured.firstSha, SHA_C)
  assert.equal(captured.firstRecord, undefined)
  assert.ok(!done.calls.some((c) => /git -C \/tmp\/work push/.test(c)))
  assert.ok(!done.calls.some((c) => c.includes("gh pr create")))
  assert.ok(!done.calls.some((c) => c.includes("commit-tree")))

  const foreign = fakeExec(resumeResponses("9".repeat(40), "8".repeat(40)))
  await assert.rejects(executePlan(plan, { exec: foreign.exec, io, log: () => {}, wait: noWait }), /matches neither commit 1 nor commit 2/)
  assert.ok(!foreign.calls.some((c) => /git -C \/tmp\/work push/.test(c)))

  const gone = fakeExec(resumeResponses(null, ""))
  await assert.rejects(executePlan(plan, { exec: gone.exec, io, log: () => {}, wait: noWait }), /is gone/)

  // Commit 1's tree on the fork head, but with an extra commit under it: the two-commit shape is gone, nothing is pushed onto it.
  const padded = fakeExec([[new RegExp(`rev-list --count origin/master\\.\\.${REMOTE_FIRST}`), "2\n"], ...resumeResponses(REMOTE_FIRST, TREE_FIRST)])
  await assert.rejects(executePlan(plan, { exec: padded.exec, io, log: () => {}, wait: noWait }), /carries 2 commit\(s\) past master where commit 1 alone would be 1.*--branch/)
  assert.ok(!padded.calls.some((c) => /git -C \/tmp\/work push|commit-tree|update-ref/.test(c)))
  const overfull = fakeExec([[new RegExp(`rev-list --count origin/master\\.\\.${REMOTE_HEAD}`), "3\n"], ...resumeResponses(REMOTE_HEAD, TREE_HEAD)])
  await assert.rejects(executePlan(plan, { exec: overfull.exec, io, log: () => {}, wait: noWait }), /carries 3 commit\(s\) past master where commit 1 and 2 alone would be 2/)

  // Commit 1 on the fork sits on an older base than the branch would start from today: commit 2 on top of it would carry the drift, so nothing is pushed.
  const OLD_BASE = "7".repeat(40)
  const drifted = fakeExec([[new RegExp(`rev-parse ${REMOTE_FIRST}~1`), `${OLD_BASE}\n`], ...resumeResponses(REMOTE_FIRST, TREE_FIRST)])
  await assert.rejects(executePlan(plan, { exec: drifted.exec, io, log: () => {}, wait: noWait }), /starts from 7777777 but master on the fork is now at ccccccc.*--branch <name>/)
  assert.ok(!drifted.calls.some((c) => /git -C \/tmp\/work push|commit-tree|update-ref|cherry-pick/.test(c)))
  // With both commits already on the fork, base drift changes nothing: there is nothing left to push.
  const settled = fakeExec([[new RegExp(`rev-parse ${REMOTE_HEAD}~1`), `${SHA_C}\n`], [/rev-parse HEAD~2$/, `${OLD_BASE}\n`], ...resumeResponses(REMOTE_HEAD, TREE_HEAD)])
  assert.equal((await executePlan(plan, { exec: settled.exec, io, log: () => {}, wait: noWait })).forkHeadSha, REMOTE_HEAD)

  // A closed pull request on the branch is not reused: the replay starts fresh.
  const logs = []
  const closedList = [/gh pr list/, JSON.stringify([{ number: 70, state: "CLOSED", isDraft: true, url: `https://github.com/${FORK}/pull/70` }])]
  const fresh = fakeExec([closedList, ...replayResponses])
  const started = await executePlan(plan, { exec: fresh.exec, io, log: (line) => logs.push(line), wait: noWait })
  assert.notEqual(started.reconciled, true)
  assert.ok(fresh.calls.includes("git -C /tmp/work push --set-upstream origin HEAD~1:refs/heads/deps/puppeteer-25.9.0"), fresh.calls.join("\n"))
  assert.ok(fresh.calls.some((c) => c.includes("gh pr create")))
  assert.ok(logs.some((line) => /pull request 70 \(closed\) on deps\/puppeteer-25\.9\.0 is not reused/.test(line)), logs.join("\n"))

  // ...unless the closed pull request's branch is still on the fork: a plain push would fail, so stop with the way out.
  const occupied = fakeExec([closedList, [/rev-parse --verify -q refs\/remotes\/origin\/deps\/puppeteer-25\.9\.0\^\{commit\}/, `${REMOTE_FIRST}\n`], ...replayResponses])
  await assert.rejects(executePlan(plan, { exec: occupied.exec, io, log: () => {}, wait: noWait }), /still at ddddddd from closed fork pull request 70.*--branch <name>/)
  assert.ok(!occupied.calls.some((c) => /git -C \/tmp\/work push|gh pr create/.test(c)))
})

test("replay --pr: when the default branch moved, the fork branch is matched by patch and commit 2 is cherry-picked onto the fork's commit 1", async () => {
  const plan = replayPlan()
  const { io } = memoryIo()
  const LOCAL_HEAD = "a".repeat(40)
  const PICKED = "b".repeat(40)
  // Trees differ (master moved); the diffs are the same, so patch ids agree.
  const patchFor = (diff) => `${diff.trim().replace(/\W/g, "").padEnd(40, "0").slice(0, 40)} ${"c".repeat(40)}\n`
  const patched = (remoteHead, remoteTree, remoteDiff) => [
    [new RegExp(`git -C /tmp/work diff ${remoteHead}~1 ${remoteHead}$`), remoteDiff],
    [/git -C \/tmp\/work diff HEAD~2 HEAD~1$/, "first-diff\n"],
    [/git -C \/tmp\/work diff HEAD~1 HEAD$/, "change-diff\n"],
    [/patch-id --stable/, (options) => patchFor(String(options.input ?? ""))],
    [/rev-parse HEAD$/, `${LOCAL_HEAD}\n`],
    [/checkout -q -B deps\/puppeteer-25\.9\.0/, ""],
    [new RegExp(`cherry-pick ${LOCAL_HEAD}`), ""],
    ...resumeResponses(remoteHead, remoteTree),
  ]

  const moved = fakeExec(patched(REMOTE_FIRST, "7".repeat(40), "first-diff\n"))
  // After the cherry-pick, HEAD is the rebuilt commit.
  let picked = false
  const exec = (cmd, args, options) => {
    const line = [cmd, ...args].join(" ")
    if (/cherry-pick/.test(line)) picked = true
    if (picked && /rev-parse HEAD$/.test(line)) { moved.calls.push(line); return `${PICKED}\n` }
    return moved.exec(cmd, args, options)
  }
  const captured = await executePlan(plan, { exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.firstSha, REMOTE_FIRST)
  assert.equal(captured.forkHeadSha, PICKED)
  assert.ok(moved.calls.includes(`git -C /tmp/work checkout -q -B deps/puppeteer-25.9.0 ${REMOTE_FIRST}`))
  assert.ok(moved.calls.includes(`git -C /tmp/work cherry-pick ${LOCAL_HEAD}`))
  assert.ok(!moved.calls.some((c) => c.includes("commit-tree")))
  const waited = moved.calls.findIndex((c) => /issues\/70\/comments/.test(c))
  const change = moved.calls.indexOf("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-25.9.0")
  assert.ok(waited >= 0 && waited < change, moved.calls.join("\n"))

  // A different diff on the fork head is still a foreign head.
  const foreign = fakeExec(patched("9".repeat(40), "8".repeat(40), "something-else\n"))
  await assert.rejects(executePlan(plan, { exec: foreign.exec, io, log: () => {}, wait: noWait }), /by tree or by patch/)
  assert.ok(!foreign.calls.some((c) => /git -C \/tmp\/work push|cherry-pick|checkout -q -B/.test(c)))
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

  // The App's placeholder (posthog fork PR 198, 2026-09-10): head-bound, no summary, not a record.
  const placeholder = `<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pending-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:commit ${SHA_C} -->\n**Execution Profiles recording for jobs triggered by \`${SHA_C.slice(0, 7)}\`**\n\n⏳ Execution Profiles for this commit are still being recorded — this comment updates in place as jobs finish.`
  const placeholderState = recordState({ comments: [{ user: { login: "garnet-runtime-review[bot]" }, body: placeholder }], checks: [], sha: SHA_C })
  assert.equal(placeholderState.state, "pending")
  assert.match(placeholderState.detail, /still being written/)
  assert.equal(recordState({ comments: [{ body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${SHA_C} -->` }], checks: [], sha: SHA_C }).state, "pending")
  const finalized = `<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:commit ${SHA_C} -->\n<!-- garnet:summary {"contract":"6.10.0","commit":"${SHA_C}","jobs":1,"changed":0} -->`
  assert.equal(recordState({ comments: [{ body: finalized }], checks: [], sha: SHA_C }).state, "recorded")
})

test("replay --pr: guards stop execution on wrong origin, empty commit, or wrong commit count", async () => {
  const plan = replayPlan()
  const { io } = memoryIo()
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${UPSTREAM}.git`]]).exec, io, log: () => {} }), /fork/i)
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, ""]]).exec, io, log: () => {} }), /would be empty/)
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, "x"], [/rev-list --count \S+ \^origin/, "0"], [/rev-list --count/, "3"]]).exec, io, log: () => {} }), /two/)
  await assert.rejects(executePlan(plan, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, "x"], [/rev-list --count \S+ \^origin/, "3"]]).exec, io, log: () => {} }), /3 commit\(s\) behind the change's base.*--allow-behind/)
  const lenient = replayPlan({ allowBehind: true })
  const warnings = []
  await assert.rejects(executePlan(lenient, { exec: fakeExec([[/remote get-url origin/, `https://github.com/${FORK}.git`], [/diff --cached/, "x"], [/rev-list --count \S+ \^origin/, "3"], [/rev-list --count/, "3"]]).exec, io, log: (line) => warnings.push(line) }), /two/)
  assert.ok(warnings.some((line) => /^warning: .*3 commit\(s\) behind/.test(line)))
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
  assert.throws(() => allowBuildScripts(allowedJson, "puppeteer", { file: "package.json" }), /already listed under onlyBuiltDependencies/)
  assert.throws(() => allowBuildScripts(`{"pnpm":{}}`, "puppeteer", { file: "package.json" }), /no onlyBuiltDependencies/)

  const yaml = `packages:\n  - 'a/*'\nonlyBuiltDependencies:\n  - esbuild\n  - sharp\nminimumReleaseAge: 10080\n`
  const allowedYaml = allowBuildScripts(yaml, "@scope/pkg", { file: "pnpm-workspace.yaml" })
  assert.ok(allowedYaml.includes(`  - sharp\n  - '@scope/pkg'\nminimumReleaseAge`), allowedYaml)
  assert.throws(() => allowBuildScripts(allowedYaml, "@scope/pkg", { file: "pnpm-workspace.yaml" }), /already listed under onlyBuiltDependencies/)
})

test("build-script lists: ignored list is created beside the allowlist, moved entries leave no empty key, JSON stays valid", () => {
  const json = `{\n  "pnpm": {\n    "onlyBuiltDependencies": [\n      "esbuild",\n      "sharp"\n    ]\n  }\n}\n`
  const skipped = allowBuildScripts(json, "puppeteer", { file: "package.json", key: "ignoredBuiltDependencies" })
  assert.deepEqual(JSON.parse(skipped).pnpm, { ignoredBuiltDependencies: ["puppeteer"], onlyBuiltDependencies: ["esbuild", "sharp"] })
  assert.ok(skipped.includes(`    "ignoredBuiltDependencies": [\n      "puppeteer"\n    ],\n    "onlyBuiltDependencies": [`), skipped)
  assert.deepEqual(buildScriptList(skipped, { file: "package.json", key: "ignoredBuiltDependencies" }), ["puppeteer"])
  assert.throws(() => allowBuildScripts(skipped, "puppeteer", { file: "package.json", key: "ignoredBuiltDependencies" }), /already listed under ignoredBuiltDependencies/)
  const second = allowBuildScripts(skipped, "lmdb", { file: "package.json", key: "ignoredBuiltDependencies" })
  assert.deepEqual(JSON.parse(second).pnpm.ignoredBuiltDependencies, ["puppeteer", "lmdb"])
  const oneLeft = removeBuildScript(second, "puppeteer", { file: "package.json", key: "ignoredBuiltDependencies" })
  assert.deepEqual(JSON.parse(oneLeft).pnpm.ignoredBuiltDependencies, ["lmdb"])
  const moved = allowBuildScripts(removeBuildScript(skipped, "puppeteer", { file: "package.json", key: "ignoredBuiltDependencies" }), "puppeteer", { file: "package.json" })
  assert.equal(moved, `{\n  "pnpm": {\n    "onlyBuiltDependencies": [\n      "esbuild",\n      "sharp",\n      "puppeteer"\n    ]\n  }\n}\n`)
  assert.throws(() => removeBuildScript(json, "puppeteer", { file: "package.json", key: "ignoredBuiltDependencies" }), /not listed under ignoredBuiltDependencies/)

  const yaml = `packages:\n  - 'a/*'\nonlyBuiltDependencies:\n  - esbuild\nminimumReleaseAge: 10080\n`
  const skippedYaml = allowBuildScripts(yaml, "@scope/pkg", { file: "pnpm-workspace.yaml", key: "ignoredBuiltDependencies" })
  assert.equal(skippedYaml, `packages:\n  - 'a/*'\nignoredBuiltDependencies:\n  - '@scope/pkg'\n\nonlyBuiltDependencies:\n  - esbuild\nminimumReleaseAge: 10080\n`)
  assert.deepEqual(buildScriptList(skippedYaml, { file: "pnpm-workspace.yaml", key: "ignoredBuiltDependencies" }), ["@scope/pkg"])
  const movedYaml = allowBuildScripts(removeBuildScript(skippedYaml, "@scope/pkg", { file: "pnpm-workspace.yaml", key: "ignoredBuiltDependencies" }), "@scope/pkg", { file: "pnpm-workspace.yaml" })
  assert.equal(movedYaml, `packages:\n  - 'a/*'\nonlyBuiltDependencies:\n  - esbuild\n  - '@scope/pkg'\nminimumReleaseAge: 10080\n`)
  assert.deepEqual(buildScriptList(yaml, { file: "pnpm-workspace.yaml", key: "ignoredBuiltDependencies" }), [])

  const lock = `packages:\n\n  puppeteer@19.0.0:\n    resolution: {integrity: sha512-x}\n\n  puppeteer@24.40.0(typescript@5.9.3):\n    resolution: {integrity: sha512-y}\n\n  '@scope/pkg@1.2.3':\n    resolution: {integrity: sha512-z}\n\n  puppeteer-core@24.40.0:\n    resolution: {integrity: sha512-w}\n`
  assert.deepEqual(lockedVersions(lock, "puppeteer"), ["19.0.0", "24.40.0"])
  assert.deepEqual(lockedVersions(lock, "@scope/pkg"), ["1.2.3"])
  assert.deepEqual(lockedVersions(lock, "missing"), [])
})

function allowBuildPlan(overrides = {}) {
  return planAllowBuild({
    slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "master", dependency: "puppeteer", versions: ["19.0.0", "24.40.0"],
    allowlistFile: "package.json", work: "/tmp/work", workExists: true, ...overrides,
  })
}

test("allow-build plan: skip recorded then allowed, one file, lockfile guarded untouched, two commits, routine wording", () => {
  const plan = allowBuildPlan()
  assert.equal(plan.mode, "transition")
  assert.equal(plan.shape, "allow-build")
  assert.equal(plan.scope, "immediate-parent-to-head")
  assert.deepEqual(plan.paths, ["package.json"])
  assert.deepEqual(plan.firstPaths, ["package.json"])
  assert.equal(plan.branch, "deps/puppeteer-build-script")
  assert.deepEqual(plan.transition, { name: "puppeteer", from: "19.0.0 and 24.40.0, build script skipped", to: "19.0.0 and 24.40.0, build script allowed", versions: ["19.0.0", "24.40.0"] })
  const ids = plan.steps.map((s) => s.id)
  const order = ["verify-origin", "branch", "verify-locked-19.0.0", "verify-locked-24.40.0", "record-skip", "first-commit", "allow-scripts", "change-commit", "verify-lockfile-untouched", "verify-commits", "find-pr", "push-first", "pr-create", "wait-first-record", "push-change"]
  assert.deepEqual(order.map((id) => ids.indexOf(id)), [...order.map((id) => ids.indexOf(id))].sort((a, b) => a - b))
  assert.ok(!ids.includes("resolve-lockfile"))
  assert.equal(plan.title, "chore(deps): allow puppeteer build script")
  assert.match(plan.messages.first, /^chore\(deps\): record puppeteer build script as skipped\n/)
  assert.match(plan.messages.first, /ignoredBuiltDependencies/)
  assert.match(plan.messages.change, /ignoredBuiltDependencies to onlyBuiltDependencies/)
  assert.match(plan.body, /19\.0\.0 and 24\.40\.0 ship an install script/)
  for (const text of [plan.branch, plan.title, plan.body, plan.messages.first, plan.messages.change]) assert.doesNotMatch(text, /PostHog\/posthog|github\.com|#\d|garnet|demo|test/i)
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  assert.match(renderPlan(plan), /transition plan · posthog · puppeteer 19\.0\.0 and 24\.40\.0, build script skipped → 19\.0\.0 and 24\.40\.0, build script allowed/)
  assert.match(allowBuildPlan({ versions: ["24.40.0"] }).body, /24\.40\.0 ships an install script/)
  assert.throws(() => allowBuildPlan({ versions: [] }), /lockfile versions/)
  assert.throws(() => allowBuildPlan({ allowlistFile: ".npmrc" }), /allowlist must live/)
  assert.throws(() => allowBuildPlan({ fork: UPSTREAM }), /fork must not be the upstream/)
})

test("allow-build execution: commit 1 adds the skip, commit 2 moves it to the allowlist, a changed lockfile fails closed", async () => {
  const plan = allowBuildPlan()
  const settings = `{\n  "pnpm": {\n    "onlyBuiltDependencies": [\n      "esbuild"\n    ]\n  }\n}\n`
  const { io, store } = memoryIo({
    "/tmp/work/pnpm-lock.yaml": "  puppeteer@19.0.0:\n  puppeteer@24.40.0:\n",
    "/tmp/work/package.json": settings,
  })
  const seen = []
  const { exec, calls } = fakeExec([
    [/^git -C \/tmp\/work commit -q -m /, () => { seen.push(store["/tmp/work/package.json"]); return "" }],
    [/^git -C \/tmp\/work diff --name-only origin\/master\.\.HEAD -- pnpm-lock\.yaml$/, () => ""],
    ...replayResponses,
  ])
  const captured = await executePlan(plan, { exec, io, log: () => {}, wait: noWait })
  assert.equal(captured.forkPr, 77)
  assert.deepEqual(captured.lockfileDiff, [])
  assert.equal(seen.length, 2)
  assert.deepEqual(JSON.parse(seen[0]).pnpm, { ignoredBuiltDependencies: ["puppeteer"], onlyBuiltDependencies: ["esbuild"] })
  assert.deepEqual(JSON.parse(seen[1]).pnpm, { onlyBuiltDependencies: ["esbuild", "puppeteer"] })
  assert.ok(calls.indexOf("git -C /tmp/work push --set-upstream origin HEAD~1:refs/heads/deps/puppeteer-build-script") < calls.indexOf("git -C /tmp/work push origin HEAD:refs/heads/deps/puppeteer-build-script"))
  assert.ok(!calls.some((c) => c.includes("pnpm install")))

  const drifted = fakeExec([[/^git -C \/tmp\/work diff --name-only origin\/master\.\.HEAD -- pnpm-lock\.yaml$/, () => "pnpm-lock.yaml"], ...replayResponses])
  await assert.rejects(executePlan(plan, { exec: drifted.exec, io: memoryIo({ "/tmp/work/pnpm-lock.yaml": "  puppeteer@19.0.0:\n  puppeteer@24.40.0:\n", "/tmp/work/package.json": settings }).io, log: () => {} }), /lockfile changed/)
  await assert.rejects(executePlan(plan, { exec: fakeExec(replayResponses).exec, io: memoryIo({ "/tmp/work/pnpm-lock.yaml": "  puppeteer@19.0.0:\n", "/tmp/work/package.json": settings }).io, log: () => {} }), /verify-locked-24\.40\.0 failed/)
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

test("consume: weaker receipts are kept per tier without becoming consumption", () => {
  const pr = { headRefOid: SHA_B, author: { login: "dependabot[bot]" }, body: "x" }
  const record = { user: { login: "garnet-runtime-review[bot]" }, body: RECORD_BODY }
  assert.deepEqual(recordDestinations(RECORD_BODY), ["storage.googleapis.com"])
  const result = evaluateConsumption({
    pr, comments: [
      record,
      { id: 1, html_url: "https://github.com/x/c1", user: { login: "devin-ai-integration[bot]" }, body: `Runtime evidence (Garnet, head ${SHA_B.slice(0, 7)}): one new connection.` },
      { id: 2, user: { login: "qodo[bot]" }, body: `Runtime evidence (Garnet, head ${SHA_C.slice(0, 7)}): stale sentence.` },
      { id: 3, user: { login: "greptile[bot]" }, body: "The Garnet record shows the installer reached storage[.]googleapis[.]com; is that expected?" },
      { id: 4, user: { login: "coderabbitai[bot]" }, body: "Runtime Review noted; nothing bound here." },
      { id: 5, user: { login: "coderabbitai[bot]" }, body: "Please add tests for the config loader." },
      { id: 6, user: { login: "github-actions[bot]" }, body: "Garnet workflow finished." },
    ],
    reviews: [{ user: { login: "human" }, state: "COMMENTED", commit_id: SHA_B, body: `Looked at the profile https://app.garnet.ai/public/runs/123?profile=00000000-0000-4000-8000-000000000000 before approving.` }],
    reviewComments: [],
  })
  assert.equal(result.consumed, true)
  assert.deepEqual(result.consumers, ["human (review commented)", "devin-ai-integration[bot] (comment)"])
  assert.deepEqual(result.signals, { utterance: 1, citation: 1, observation: 1, mention: 2 })
  assert.equal(result.receipts.length, 5)
  const byLogin = Object.fromEntries(result.receipts.map((row) => [row.login, row]))
  assert.equal(byLogin["devin-ai-integration[bot]"].tier, RECEIPT_TIERS.UTTERANCE)
  assert.equal(byLogin["devin-ai-integration[bot]"].headBound, true)
  assert.equal(byLogin["qodo[bot]"].tier, RECEIPT_TIERS.MENTION)
  assert.equal(byLogin["qodo[bot]"].headBound, false)
  assert.deepEqual(byLogin["greptile[bot]"].matched, ["storage.googleapis.com"])
  assert.equal(byLogin.human.tier, RECEIPT_TIERS.CITATION)
  assert.equal(byLogin.human.onHead, true)
  assert.equal(byLogin["coderabbitai[bot]"].tier, RECEIPT_TIERS.MENTION)
  assert.equal("github-actions[bot]" in byLogin, false)

  const stamped = evaluateConsumption({ pr, comments: [record, { user: { login: "qodo-code-review[bot]" }, body: `Review updated until commit <a href="https://github.com/${FORK}/commit/${SHA_B}">${SHA_B.slice(0, 7)}</a>\n\n><code>[.github/workflows/garnet-record.yml[81]](https://github.com/${FORK}/pull/45/files#diff-6dfd${SHA_B}R81)</code>` }] })
  assert.equal(stamped.consumed, false)
  assert.deepEqual(stamped.signals, { utterance: 0, citation: 0, observation: 0, mention: 0 })

  const weakOnly = evaluateConsumption({ pr, comments: [record, { user: { login: "greptile[bot]" }, body: "The Garnet record shows storage.googleapis.com was reached." }] })
  assert.equal(weakOnly.consumed, false)
  assert.deepEqual(weakOnly.signals, { utterance: 0, citation: 0, observation: 1, mention: 0 })
  const report = renderConsumeReport(weakOnly, { prUrl: `https://github.com/${FORK}/pull/77` })
  assert.match(report, /\*\*not consumed\*\*/)
  assert.match(report, /#### Receipts · 1 receipt\(s\): 1 observation/)
  assert.match(report, /\| observation \| greptile\[bot\] \| comment \|/)
  assert.equal(describeSignals(tallyReceipts([])), "no receipts")

  const target = ensureTarget("consume-status", { upstream: "acme/widgets", fork: "garnet-labs/widgets" })
  target.consumption = [{ forkPr: 3, headSha: SHA_B, consumed: false, consumers: [], mirror: false, recordBound: true, signals: weakOnly.signals, receipts: weakOnly.receipts, checkedAt: "2026-09-22T00:00:00Z" }]
  const row = stageRows(target).find((r) => r.n === 4)
  assert.equal(row.state, "in-flight")
  assert.match(row.detail, /no head-bound consumption yet · 1 receipt\(s\): 1 observation · 1 receipt\(s\) across 1 checked/)
  const harvest = renderHarvestReport([{ number: 3, result: weakOnly }, { number: 4, result: null }], { fork: "garnet-labs/widgets" })
  assert.match(harvest, /1 pull request\(s\) with a record checked · 0 consumed \(head-bound\) · 1 with at least one receipt · 1 skipped/)
  assert.match(harvest, /\| 4 \| — \| no \|/)
})

test("consume: the funnel records delivery, visibility, re-request, attention, grounding and observation separately; UAT fields start empty", () => {
  const sha7 = SHA_B.slice(0, 7)
  const pr = { headRefOid: SHA_B, author: { login: "dependabot[bot]" }, body: `x\n<!-- garnet:evidence:begin -->\nhead \`${sha7}\`\n<!-- garnet:evidence:end -->` }
  const record = { user: { login: "garnet-runtime-review[bot]" }, body: RECORD_BODY, created_at: "2026-09-20T12:00:00Z" }
  const rereview = { user: { login: "github-actions[bot]" }, created_at: "2026-09-20T12:10:00Z", body: `<!-- garnet:rereview ${SHA_B} -->\nRuntime evidence for head ${sha7} is final.` }

  const nothing = evaluateConsumption({ pr: { headRefOid: SHA_B, body: "x" }, comments: [] })
  assert.deepEqual(nothing.funnel, { delivered: false, visible: false, rereviewRequested: false, attention: false, grounded: false, observation: false, consumedHow: [], coldRead: null, decisionImpact: "unknown", attribution: "unknown", valueHypothesis: "unknown" })

  const grounded = evaluateConsumption({
    pr, comments: [
      record, rereview,
      { id: 1, user: { login: "coderabbitai[bot]" }, created_at: "2026-09-20T11:00:00Z", body: "No Garnet runtime record yet; reviewing the diff only." },
      { id: 2, user: { login: "devin-ai-integration[bot]" }, created_at: "2026-09-20T12:20:00Z", body: `Runtime evidence (Garnet, head ${sha7}): the installer reached storage.googleapis.com, as the record shows.` },
    ],
    reviews: [{ user: { login: "greptile[bot]" }, state: "COMMENTED", commit_id: SHA_B, submitted_at: "2026-09-20T12:05:00Z", body: `**Runtime grounding** (head \`${sha7}\`): one new outbound connection.` }],
  })
  assert.equal(grounded.consumed, true)
  const funnel = grounded.funnel
  assert.equal(funnel.delivered, true)
  assert.equal(funnel.visible, true)
  assert.equal(funnel.rereviewRequested, true)
  assert.equal(funnel.attention, true)
  assert.equal(funnel.grounded, true)
  assert.equal(funnel.observation, true, "a strong receipt that repeats a record destination is an observation too")
  assert.deepEqual(funnel.consumedHow.map((row) => [row.who, row.tier, row.path]), [
    ["greptile[bot]", RECEIPT_TIERS.UTTERANCE, "after-record"],
    ["devin-ai-integration[bot]", RECEIPT_TIERS.UTTERANCE, "after-rereview"],
  ])
  assert.equal(funnel.coldRead, null)
  assert.equal(funnel.valueHypothesis, "unknown")
  const line = describeFunnel(funnel)
  assert.match(line, /delivered yes · visible yes · rereviewRequested yes · attention yes · grounded yes · observation yes/)
  assert.match(line, /consumed-how: greptile\[bot\] \(utterance, review, after-record\); devin-ai-integration\[bot\] \(utterance, comment, after-rereview\)/)
  assert.match(line, /cold-read not yet rated · decision-impact unknown · attribution unknown · value-hypothesis unknown/)
  assert.match(renderConsumeReport(grounded, { prUrl: `https://github.com/${FORK}/pull/77` }), /^funnel: delivered yes/m)

  const preRecordOnly = evaluateConsumption({ pr: { headRefOid: SHA_B, body: "x" }, comments: [record, { id: 1, user: { login: "coderabbitai[bot]" }, created_at: "2026-09-20T11:00:00Z", body: `Runtime evidence (Garnet, head ${sha7}): looks fine.` }] })
  assert.equal(preRecordOnly.consumed, false)
  assert.equal(preRecordOnly.funnel.delivered, true)
  assert.equal(preRecordOnly.funnel.attention, false, "a receipt written before the record is not attention to it")
  assert.equal(preRecordOnly.funnel.grounded, false)

  const staleReview = evaluateConsumption({
    pr, comments: [record],
    reviews: [{ user: { login: "greptile[bot]" }, state: "COMMENTED", commit_id: SHA_A, submitted_at: "2026-09-20T12:05:00Z", body: `Runtime evidence (Garnet, head ${sha7}): one new outbound connection.` }],
  })
  assert.equal(staleReview.consumed, false, "a review on an older commit does not consume")
  assert.equal(staleReview.funnel.grounded, false, "grounded follows the consumer rule: the review commit must be on the head")
  assert.deepEqual(staleReview.funnel.consumedHow, [])
  assert.equal(staleReview.funnel.attention, true, "the reviewer did write after the record")

  const diffOnly = evaluateConsumption({
    pr, comments: [record, { id: 3, user: { login: "greptile[bot]" }, created_at: "2026-09-20T12:30:00Z", body: "Lockfile drift: the `pnpm-lock.yaml` change is unrelated to the manifest bump." }],
  })
  assert.equal(diffOnly.receipts.length, 0)
  assert.equal(diffOnly.funnel.attention, true, "a reviewer response with no runtime receipt is attention without grounding")
  assert.equal(diffOnly.funnel.grounded, false)
  assert.equal(diffOnly.funnel.observation, false)

  const priorDestination = evaluateConsumption({
    pr, comments: [record, { id: 4, user: { login: "coderabbitai[bot]" }, created_at: "2026-09-20T11:00:00Z", body: "The installer talks to storage.googleapis.com during postinstall." }],
  })
  assert.equal(priorDestination.funnel.observation, false, "a destination named before the record existed is not an observation of it")
  assert.equal(priorDestination.funnel.attention, false)
})

test("uat: manual fields are written by `replay uat` only, survive a re-check of the same head, and reset on a new head", () => {
  const base = { forkPr: 7, headSha: SHA_B, consumed: true, funnel: { delivered: true, visible: true, rereviewRequested: false, attention: true, grounded: true, observation: false, consumedHow: [], coldRead: null, decisionImpact: "unknown", attribution: "unknown", valueHypothesis: "unknown" } }
  const target = { slug: "uat-test", consumption: [structuredClone(base)] }
  const saved = []
  const logged = []
  const io = { load: () => target, save: (t) => saved.push(t), log: (line) => logged.push(line) }

  assert.throws(() => uat(["uat-test", "--pr", "7"], io), /nothing to record/)
  assert.throws(() => uat(["uat-test", "--pr", "7", "--cold-read", "9"], io), /0\.\.5/)
  assert.throws(() => uat(["uat-test", "--pr", "7", "--decision-impact", "yes"], io), /supported, not-supported, unknown/)
  assert.throws(() => uat(["uat-test", "--pr", "7", "--value-hypothesis", "supported"], io), /needs --note/)
  assert.throws(() => uat(["uat-test", "--pr", "8"], io), /no consumption row/)
  assert.equal(saved.length, 0)

  const row = uat(["uat-test", "--pr", "7", "--cold-read", "4", "--value-hypothesis", "supported", "--note", "named the new destination the diff hides"], io)
  assert.equal(row.funnel.coldRead, 4)
  assert.equal(row.funnel.valueHypothesis, "supported")
  assert.equal(row.funnel.decisionImpact, "unknown")
  assert.equal(row.funnel.uat.note, "named the new destination the diff hides")
  assert.equal(row.funnel.uat.headSha, SHA_B)
  assert.equal(saved.length, 1)
  assert.match(logged[0], /cold-read 4 of 5 · decision-impact unknown · attribution unknown · value-hypothesis supported/)

  const recheck = keepUat(target.consumption, { ...structuredClone(base), consumed: false, funnel: { ...structuredClone(base.funnel), grounded: false } })
  assert.equal(recheck.funnel.grounded, false, "observed stages come from the new check")
  assert.equal(recheck.funnel.coldRead, 4, "manual fields come from the earlier row")
  assert.equal(recheck.funnel.valueHypothesis, "supported")
  assert.equal(recheck.funnel.uat.note, "named the new destination the diff hides")

  const newHead = keepUat(target.consumption, { ...structuredClone(base), headSha: SHA_C })
  assert.equal(newHead.funnel.coldRead, null, "a new head starts unrated")
  assert.equal(newHead.funnel.uat, undefined)
  assert.deepEqual(keepUat(undefined, structuredClone(base)), base)
})

test("consume: negative, pre-record and repository-link utterances never advance the pilot", () => {
  const pr = { headRefOid: SHA_B, author: { login: "dependabot[bot]" }, body: "x" }
  const record = { user: { login: "garnet-runtime-review[bot]" }, body: RECORD_BODY, created_at: "2026-09-20T12:00:00Z" }
  const sha7 = SHA_B.slice(0, 7)

  const negative = evaluateConsumption({
    pr, comments: [
      record,
      { id: 1, user: { login: "devin-ai-integration[bot]" }, created_at: "2026-09-20T13:00:00Z", body: `Runtime evidence (Garnet, head ${sha7}): no runtime evidence for this head; undeterminable.` },
      { id: 2, user: { login: "coderabbitai[bot]" }, created_at: "2026-09-20T13:00:00Z", body: `**Runtime grounding** (head \`${sha7}\`): Garnet evidence is pending for this head.` },
      { id: 3, user: { login: "human" }, created_at: "2026-09-20T13:00:00Z", body: `No Garnet record yet for ${sha7}, waiting.` },
    ],
  })
  assert.equal(negative.consumed, false)
  assert.deepEqual(negative.signals, { utterance: 2, citation: 1, observation: 0, mention: 0 })
  for (const row of negative.receipts) {
    assert.equal(row.headBound, false, row.login)
    assert.ok(row.matched.includes("reports no evidence"), row.login)
  }

  const early = evaluateConsumption({
    pr, comments: [
      record,
      { id: 4, user: { login: "devin-ai-integration[bot]" }, created_at: "2026-09-20T11:00:00Z", body: `Runtime evidence (Garnet, head ${sha7}): one new connection.` },
      { id: 5, user: { login: "devin-ai-integration[bot]" }, created_at: "2026-09-20T12:30:00Z", body: `Runtime evidence (Garnet, head ${sha7}): one new connection.` },
    ],
  })
  assert.equal(early.consumed, true)
  assert.deepEqual(early.consumers, ["devin-ai-integration[bot] (comment)"])
  assert.equal(early.receipts[0].headBound, false)
  assert.ok(early.receipts[0].matched.includes("written before the record"))
  assert.equal(early.receipts[1].headBound, true)

  const links = evaluateConsumption({
    pr, comments: [
      record,
      { id: 6, user: { login: "github-advanced-security[bot]" }, body: "Show more details\n\n[details](https://github.com/garnet-labs/pnpm/security/code-scanning/50)" },
      { id: 7, user: { login: "coderabbitai[bot]" }, body: "The garnet-labs fork uses onlyBuiltDependencies; fine." },
      { id: 8, user: { login: "greptile[bot]" }, body: "Per the Garnet record, storage.googleapis.com is new." },
    ],
  })
  assert.equal(links.consumed, false)
  assert.deepEqual(links.signals, { utterance: 0, citation: 0, observation: 1, mention: 0 })
  assert.equal(links.receipts.length, 1)
  assert.equal(links.receipts[0].login, "greptile[bot]")
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

test("verify: an App comment (v6.10 contract) passes on its summary pair and the recording run's own check", () => {
  const pr = { head_sha: SHA_B, base_sha: SHA_A, state: "open", body: "Retry ranged downloads." }
  const appBody = `<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit ${SHA_B} -->
<!-- garnet:summary {"contract":"6.10.0","commit":"${SHA_B}","previous":"${SHA_C}","jobs":1,"changed":0,"unchanged":1,"chains":17,"destinations":8} -->
**Execution Profiles recorded for 1 job, triggered by [\`${SHA_B.slice(0, 7)}\`](https://github.com/${FORK}/commit/${SHA_B})**

> *1&nbsp;job unchanged · compared with [\`${SHA_C.slice(0, 7)}\`](https://github.com/${FORK}/commit/${SHA_C})*

<a href="https://app.garnet.ai/public/runs/34534049128?profile=01a08d4e-d651-741b-9c0a-3666ff4ee271">View this job's Execution Profile in Garnet →</a>
`
  const comments = [{ user: "garnet-runtime-review[bot]", body: appBody }]
  const recorded = { name: "Dependency install (recorded)", status: "completed", conclusion: "success", details_url: `https://github.com/${FORK}/actions/runs/34534049128/job/1` }
  const unrelatedQueued = { name: "plan / plan", status: "queued", conclusion: null, details_url: `https://github.com/${FORK}/actions/runs/34534049758/job/2` }
  const good = evaluateExhibit({ pr, comments, checks: [unrelatedQueued, recorded], permalinkStatus: 200, expectedLabel: "real" })
  assert.equal(good.status, "PASS", good.reasons.join("; "))
  const legs = Object.fromEntries(good.legs.map((entry) => [entry.name, entry.detail]))
  assert.equal(legs["comment finalized"], "record is final; its contract does not declare capture completeness")
  assert.equal(legs["pair line"], `pair ${SHA_C.slice(0, 7)} (previous) → ${SHA_B.slice(0, 7)} (this commit) from the record summary`)
  assert.equal(legs["check settled"], "Dependency install (recorded) completed")

  const noRun = evaluateExhibit({ pr, comments, checks: [unrelatedQueued], permalinkStatus: 200 })
  assert.match(noRun.reasons.join("\n"), /no check on the head commit belongs to run 34534049128/)
  const stillRecording = evaluateExhibit({ pr, comments, checks: [{ ...recorded, status: "in_progress", conclusion: null }], permalinkStatus: 200 })
  assert.match(stillRecording.reasons.join("\n"), /check settled: Dependency install \(recorded\) in_progress/)
  const movedHead = evaluateExhibit({ pr: { ...pr, head_sha: SHA_A }, comments, checks: [recorded], permalinkStatus: 200 })
  assert.match(movedHead.reasons.join("\n"), /head-bound/)
  const pendingBody = appBody.replace("garnet-control-plane-pr-comment:v1", "garnet-control-plane-pending-pr-comment:v1").replace(/<!-- garnet:summary .*-->\n/, "")
  const pending = evaluateExhibit({ pr, comments: [{ user: "garnet-runtime-review[bot]", body: pendingBody }], checks: [recorded], permalinkStatus: 200 })
  assert.match(pending.reasons.join("\n"), /comment finalized: placeholder text present/)
})

test("verify: paginates comments and check runs before evaluating the recording check", async () => {
  const head = SHA_A
  const base = SHA_B
  const recordRunId = "34571400222"
  const permalink = `https://app.garnet.ai/public/runs/${recordRunId}?profile=00000000-0000-4000-8000-000000000000`
  const body = `<!-- garnet-runtime-review -->
<!-- garnet:commit ${head} -->
<!-- garnet:summary {"status":"finalized","commit":"${head}","previous":"${base}","capture_quality":"complete"} -->
[View this run in Garnet →](${permalink})`
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes("/pulls/77")) {
      return { ok: true, status: 200, json: async () => ({ head: { sha: head }, base: { sha: base }, state: "open", body: "", labels: [] }) }
    }
    if (url.includes("/issues/77/comments")) {
      return {
        ok: true,
        status: 200,
        json: async () => /[?&]page=1(?:&|$)/.test(url)
          ? [{ user: { login: "garnet-runtime-review[bot]" }, body }]
          : [],
      }
    }
    if (url.includes("/check-runs")) {
      return {
        ok: true,
        status: 200,
        json: async () => /[?&]page=1(?:&|$)/.test(url)
          ? { total_count: 101, check_runs: Array.from({ length: 100 }, () => ({ name: "other", status: "completed", conclusion: "success", details_url: "https://github.com/o/r/actions/runs/1/job/1" })) }
          : { total_count: 101, check_runs: [{ name: "Dependency install (recorded)", status: "completed", conclusion: "success", details_url: `https://github.com/o/r/actions/runs/${recordRunId}/job/1` }] },
      }
    }
    if (url === permalink) return { ok: true, status: 200 }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const result = await verifyExhibit("https://github.com/o/r/pull/77", { fetchImpl })
  assert.equal(result.legs.find((entry) => entry.name === "check settled")?.ok, true)
  assert.ok(calls.some((url) => url.includes("/check-runs?per_page=100&page=2")))
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
  assert.doesNotMatch(gate, /--slurp/, "gh api rejects --slurp together with --jq on the runner")
  assert.match(gate, /checks: write/, "the check run is published on the pull request head, not left to the workflow_run job")
  assert.match(gate, /issue_comment:\n\s+types: \[created, edited\]/, "re-reads the record each time the App edits its comment")
  assert.match(gate, /garnet-evidence-gate\.mjs/)
  assert.doesNotMatch(gate, /name: garnet\/evidence/, "the job is not named after the check; the job's own check lands on the default-branch commit")
  assert.equal(typeof plan.files[".github/scripts/garnet-evidence-gate.mjs"], "string")
  assert.match(mirror, /issue_comment:\n\s+types: \[created, edited\]/)
  assert.doesNotMatch(mirror, /--slurp/)
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  assert.match(renderStage2Plan(plan), /garnet\/evidence/)
  assert.throws(() => planStage2({ slug: "x", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", recording: { present: false, workflows: [] } }), /--ecosystem/)
  const injected = planStage2({ slug: "x", upstream: UPSTREAM, fork: FORK, defaultBranch: "main", ecosystem: "cargo", recording: { present: false, workflows: [] } })
  const record = Object.entries(injected.files).find(([f]) => f.endsWith("garnet-record.yml"))[1]
  assert.match(record, /id-token: write/)
  assert.doesNotMatch(record, /api_token/)
  assert.match(record, /cargo fetch --locked/)
})

const STAGE2_INPUT = { slug: "posthog", upstream: UPSTREAM, fork: FORK, defaultBranch: "master", recording: { present: true, workflows: [".github/workflows/garnet.yml"], name: "Garnet Runtime Visibility" }, workExists: true }

test("stage 2: the mirror re-requests the targeted reviewers once per head, after the record, and ships one thin adapter per reviewer", () => {
  const plan = planStage2(STAGE2_INPUT)
  assert.deepEqual(plan.reviewers, [...DEFAULT_REVIEWERS])
  assert.deepEqual(DEFAULT_REVIEWERS, ["devin", "coderabbit", "greptile"])
  const mirror = plan.files[".github/workflows/garnet-evidence-mirror.yml"]
  assert.match(mirror, /GARNET_REVIEWERS: "devin,coderabbit,greptile"/)
  assert.match(mirror, /garnet-evidence-mirror\.mjs[\s\S]*garnet-rereview\.mjs/, "re-review runs after the mirror step")
  assert.doesNotMatch(mirror, /\{\{[A-Z_]+\}\}/, "no unfilled template placeholders")
  assert.equal(typeof plan.files[".github/scripts/garnet-rereview.mjs"], "string")
  assert.deepEqual(plan.adapters, [".agents/skills/garnet-runtime-review/SKILL.md", ".coderabbit.yaml", ".greptile/config.json", ".greptile/rules.md"])
  assert.deepEqual(plan.keptAdapters, [])
  for (const path of plan.adapters) assert.match(plan.files[path], /REVIEW\.md/, `${path} points at REVIEW.md`)
  JSON.parse(plan.files[".greptile/config.json"])
  assert.match(plan.body, /re-review|requests the configured reviewers/)
  assert.match(plan.body, /repository secret named in the mirror workflow/)
  assert.doesNotMatch(plan.body.toLowerCase(), /devin/, "outbound text carries no reviewer vendor names (residue guard)")
  assert.match(renderStage2Plan(plan), /reviewers re-requested after the record binds: devin, coderabbit, greptile/)
  for (const step of plan.steps.filter((s) => s.kind === "write-remote")) assert.equal(step.target, FORK)
  const all = planStage2({ ...STAGE2_INPUT, reviewers: REVIEWERS })
  const every = [...new Set(REVIEWERS.flatMap((r) => Object.values(REVIEWER_ADAPTERS[r])))]
  assert.deepEqual(all.adapters, every)
  assert.ok(every.includes(".cursor/BUGBOT.md") && every.includes(".github/copilot-instructions.md") && every.includes(".pr_agent.toml"))
  assert.deepEqual(Object.keys(REVIEWER_ADAPTERS.codex), [], "codex reads AGENTS.md; no file of its own")
})

test("stage 2: reviewer selection is explicit and adapters already in the fork are kept unless asked to replace", () => {
  assert.deepEqual(parseReviewers("Greptile, devin,greptile"), ["greptile", "devin"])
  assert.deepEqual(parseReviewers(["copilot"]), ["copilot"])
  assert.throws(() => parseReviewers("sonar"), /unknown reviewer 'sonar'/)
  assert.throws(() => planStage2({ ...STAGE2_INPUT, reviewers: "" }), /at least one reviewer/)
  const kept = planStage2({ ...STAGE2_INPUT, reviewers: "coderabbit,greptile", existing: [".coderabbit.yaml"] })
  assert.deepEqual(kept.adapters, [".greptile/config.json", ".greptile/rules.md"])
  assert.deepEqual(kept.keptAdapters, [".coderabbit.yaml"])
  assert.equal(kept.files[".coderabbit.yaml"], undefined)
  assert.match(kept.body, /kept as they are: `\.coderabbit\.yaml`/)
  assert.match(renderStage2Plan(kept), /kept as they are \(already in the fork\): \.coderabbit\.yaml/)
  const replaced = planStage2({ ...STAGE2_INPUT, reviewers: "coderabbit", existing: [".coderabbit.yaml"], replaceAdapters: true })
  assert.deepEqual(replaced.adapters, [".coderabbit.yaml"])
  assert.deepEqual(replaced.keptAdapters, [])
  assert.match(kept.files[".github/workflows/garnet-evidence-mirror.yml"], /GARNET_REVIEWERS: "coderabbit,greptile"/)
})

test("stage 2: every recorder that can run on a dependency change is listened to; workflow-only recorders, existing mirrors and competing listeners stop the plan", () => {
  const recording = {
    present: true,
    workflows: [".github/workflows/vendored.yml", ".github/workflows/garnet-sentiment.yml", ".github/workflows/garnet-self.yml"],
    name: "Vendored packages",
    names: { ".github/workflows/vendored.yml": "Vendored packages", ".github/workflows/garnet-sentiment.yml": "Garnet sentiment dependency visibility", ".github/workflows/garnet-self.yml": "Garnet Browser Use CI" },
    paths: { ".github/workflows/vendored.yml": ["vendor/cache-util/**"], ".github/workflows/garnet-sentiment.yml": null, ".github/workflows/garnet-self.yml": [".github/workflows/garnet-self.yml"] },
    listeners: {},
  }
  const { names, skipped } = recorderNames(recording)
  assert.deepEqual(names, ["Vendored packages", "Garnet sentiment dependency visibility"])
  assert.deepEqual(Object.keys(skipped), [".github/workflows/garnet-self.yml"])
  const plan = planStage2({ ...STAGE2_INPUT, recording })
  assert.deepEqual(plan.recordNames, names)
  assert.match(plan.files[".github/workflows/garnet-evidence-mirror.yml"], /workflows: \["Vendored packages","Garnet sentiment dependency visibility"\]/)
  assert.match(plan.files[".github/workflows/garnet-evidence-gate.yml"], /workflows: \["Vendored packages","Garnet sentiment dependency visibility"\]/)
  assert.match(renderStage2Plan(plan), /not listened to: \.github\/workflows\/garnet-self\.yml · pull_request\.paths covers only \.github\/workflows\/garnet-self\.yml/)
  assert.match(plan.body, /Both workflows listen to every recording workflow/)

  const one = planStage2({ ...STAGE2_INPUT, recording, recordWorkflow: ".github/workflows/garnet-self.yml" })
  assert.deepEqual(one.recordNames, ["Garnet Browser Use CI"], "--record-workflow overrides the path-filter reading")
  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording, recordWorkflow: ".github/workflows/nope.yml" }), /not a recording workflow on the fork/)

  const selfOnly = { ...recording, workflows: [".github/workflows/garnet-self.yml"] }
  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording: selfOnly }), /would never fire[\s\S]*--record-workflow[\s\S]*--add-record/)
  const added = planStage2({ ...STAGE2_INPUT, recording: selfOnly, addRecord: true, ecosystem: "uv" })
  assert.deepEqual(added.recordNames, ["Garnet Runtime Visibility"])
  assert.equal(typeof added.files[RECORD_WORKFLOW_PATH], "string")
  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording, addRecord: true }), /--add-record needs --ecosystem/)

  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording, existing: [".github/scripts/garnet-evidence-mirror.mjs", "REVIEW.md"] }), /files at the mirror paths: \.github\/scripts\/garnet-evidence-mirror\.mjs;[\s\S]*unrelated workflow[\s\S]*--replace-mirror/)
  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording, existing: [".github/workflows/garnet-evidence-gate.yml"] }), /--replace-mirror/, "a foreign workflow at the gate path stops the plan too")
  const replaced = planStage2({ ...STAGE2_INPUT, recording, existing: [".github/scripts/garnet-evidence-mirror.mjs", "REVIEW.md"], replaceMirror: true })
  assert.deepEqual(replaced.replacedMirror, [".github/scripts/garnet-evidence-mirror.mjs"])
  assert.equal(replaced.files["REVIEW.md"], undefined, "an existing REVIEW.md is kept like an adapter")
  assert.ok(replaced.keptAdapters.includes("REVIEW.md"))
  assert.equal(typeof planStage2({ ...STAGE2_INPUT, recording, existing: ["REVIEW.md"], replaceAdapters: true }).files["REVIEW.md"], "string")

  const competing = { ...recording, listeners: { ".github/workflows/garnet-evidence-mirror-forks.yml": ["Vendored packages", "TS CI"], ".github/workflows/garnet-evidence-mirror.yml": ["Vendored packages"], ".github/workflows/deploy.yml": ["Release"] } }
  assert.deepEqual(competingListeners(competing.listeners, names), { ".github/workflows/garnet-evidence-mirror-forks.yml": ["Vendored packages"] }, "our own mirror path and unrelated listeners are not conflicts")
  assert.throws(() => planStage2({ ...STAGE2_INPUT, recording: competing }), /workflow_run workflows with pull-requests: write listening to the recorder[\s\S]*garnet-evidence-mirror-forks\.yml → "Vendored packages"/)
  const writes = { ".github/workflows/garnet-evidence-mirror-forks.yml": false, ".github/workflows/deploy.yml": true }
  assert.deepEqual(competingListeners(competing.listeners, names, writes), {}, "a listener without pull-requests: write cannot edit the block or request reviews")
  assert.deepEqual(competingListeners(competing.listeners, names, { ".github/workflows/garnet-evidence-mirror-forks.yml": true }), { ".github/workflows/garnet-evidence-mirror-forks.yml": ["Vendored packages"] })
  assert.deepEqual(planStage2({ ...STAGE2_INPUT, recording: { ...competing, listenerWrites: writes } }).recordNames, names, "read-only listeners do not stop the plan")
})

test("stage 2: the gate reads the App's comments fail-closed and publishes garnet/evidence on the exact head", () => {
  const app = { login: "garnet-runtime-review[bot]" }
  const record = (body, user = app) => ({ user, body })
  const final = `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet:summary {"status":"finalized","jobs":2,"recorded":"2026-09-22 20:51:04 UTC","capture_quality":"complete"} -->\nRuntime Review`
  assert.equal(evidenceStateFor([], HEAD40).state, "failure")
  assert.equal(evidenceStateFor([record(final, { login: "github-actions[bot]" })], HEAD40).state, "failure", "the workflow token is not the Garnet App")
  assert.equal(evidenceStateFor([record(final.replace(HEAD40, "b".repeat(40)))], HEAD40).state, "failure", "a record for another head is not evidence for this one")
  assert.equal(evidenceStateFor([record(`<!-- garnet-runtime-review -->\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet-control-plane-pending-pr-comment -->`)], HEAD40).state, "pending")
  assert.equal(evidenceStateFor([record(final.replace("finalized", "pending"))], HEAD40).state, "pending")
  const ok = evidenceStateFor([record(final)], HEAD40)
  assert.equal(ok.state, "success")
  assert.equal(ok.jobs, 2)
  assert.match(ok.summary, /2 jobs · recorded 2026-09-22 20:51:04 UTC/)
  assert.equal(withRecorderCompleteness(ok, [], HEAD40).state, "success", "complete capture with settled recorders succeeds")
  const queued = withRecorderCompleteness(ok, ["Install"], HEAD40)
  assert.equal(queued.state, "pending", "a queued recorder keeps the gate from succeeding")
  assert.equal(evidenceStateFor([record(final.replace('"complete"', '"partial"'))], HEAD40).state, "failure")
  assert.equal(evidenceStateFor([record(final.replace(',"capture_quality":"complete"', ""))], HEAD40).state, "failure")
  const payload = checkRunPayload(ok, HEAD40, "https://github.com/o/r/actions/runs/1")
  assert.equal(payload.name, EVIDENCE_CHECK)
  assert.equal(payload.head_sha, HEAD40)
  assert.equal(payload.conclusion, "success")
  assert.equal(checkRunPayload(evidenceStateFor([], HEAD40), HEAD40, null).conclusion, "failure")
  const pending = checkRunPayload({ state: "pending", summary: "s" }, HEAD40, null)
  assert.equal(pending.status, "in_progress")
  assert.equal(pending.conclusion, undefined)
  assert.equal(alreadyPublished([], payload), false)
  assert.equal(alreadyPublished([{ id: 1, name: EVIDENCE_CHECK, status: "completed", conclusion: "success", output: { summary: ok.summary } }], payload), true)
  assert.equal(alreadyPublished([{ id: 2, name: EVIDENCE_CHECK, status: "completed", conclusion: "success", output: { summary: ok.summary } }, { id: 3, name: EVIDENCE_CHECK, status: "completed", conclusion: "failure", output: { summary: "x" } }], payload), false, "the newest run is what the pull request shows")
  assert.equal(alreadyPublished([{ id: 1, name: "other", status: "completed", conclusion: "success", output: { summary: ok.summary } }], payload), false)
})

test("stage 2: the mirror names what it copied and renders the citation placeholder as code", () => {
  const body = `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet:summary {"status":"finalized","jobs":3,"recorded":"2026-09-22 20:49:55 UTC"} -->\nRuntime Review`
  assert.deepEqual(recordStamp(body), { recorded: "2026-09-22 20:49:55 UTC", jobs: 3 })
  assert.deepEqual(recordStamp("no register"), { recorded: null, jobs: null })
  const section = renderEvidenceSection({ body, html_url: "https://github.com/o/r/pull/1#issuecomment-1" }, HEAD40, 65536)
  assert.match(section, /3 jobs, recorded 2026-09-22 20:49:55 UTC/, "the copy says which state of the comment it holds")
  assert.match(section, /`<Execution Profile URL>`/, "an angle-bracket placeholder outside code is dropped by GitHub Markdown")
  assert.doesNotMatch(section, /verbatim/, "the copy is not the comment; the comment keeps changing as jobs finish")
  assert.match(section, /<details><summary>Execution record, copied from the comment \(3 jobs, recorded/)
})

test("consume: a mirror that names the head but copied an earlier register is stale, not visible", () => {
  const live = `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet:summary {"status":"finalized","jobs":4,"recorded":"2026-09-22 20:51:04 UTC"} -->`
  const copied = `<!-- garnet:evidence:begin -->\nhead ${HEAD40}\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet:summary {"status":"finalized","jobs":3,"recorded":"2026-09-22 20:49:55 UTC"} -->\n<!-- garnet:evidence:end -->`
  assert.match(mirrorStaleness(copied, live), /copied the record of 2026-09-22 20:49:55 UTC, the comment now says 2026-09-22 20:51:04 UTC; 3 job\(s\) copied, the comment now has 4/)
  assert.equal(mirrorStaleness(copied.replace("jobs\":3", "jobs\":4").replace("20:49:55", "20:51:04"), live), null)
  assert.equal(mirrorStaleness("head only", live), null, "no register to compare")
  assert.equal(mirrorStaleness(copied, null), null)
  const pr = { headRefOid: HEAD40, author: { login: "dependabot[bot]" }, body: `x\n${copied}` }
  const result = evaluateConsumption({ pr, comments: [{ user: { login: "garnet-runtime-review[bot]" }, body: live, created_at: "2026-09-20T12:00:00Z" }] })
  assert.equal(result.mirror, false)
  assert.equal(result.funnel.visible, false)
  assert.match(result.findings.find((row) => row.kind === "mirror").detail, /stale/)
})

test("recorder inventory: names, workflow_run listeners and workflow-only path filters are read from workflow bodies", () => {
  assert.equal(workflowName('name: "Garnet Runtime Visibility"\non: pull_request\n'), "Garnet Runtime Visibility")
  assert.equal(workflowName("on: pull_request\n"), null)
  assert.deepEqual(workflowRunWorkflows("on:\n  workflow_run:\n    workflows: [\"TS CI\", 'Vendored packages']\n    types: [completed]\n"), ["TS CI", "Vendored packages"])
  assert.deepEqual(workflowRunWorkflows("on:\n  workflow_run:\n    types: [completed]\n    workflows:\n      - Garnet Runtime Visibility\n      - \"DeepSec review\" # comment\njobs: {}\n"), ["Garnet Runtime Visibility", "DeepSec review"])
  assert.deepEqual(workflowRunWorkflows("on:\n  pull_request:\n    paths: [x]\n"), [])
  assert.equal(writesPullRequests("permissions:\n  contents: read\n  pull-requests: write\n"), true)
  assert.equal(writesPullRequests("jobs:\n  a:\n    permissions:\n      pull-requests: 'write' # edits\n"), true)
  assert.equal(writesPullRequests("permissions:\n  pull-requests: read\n"), false)
  assert.equal(writesPullRequests("permissions: {}\n"), false)
  assert.equal(workflowOnlyPathFilter([".github/workflows/garnet-browser-use-ci.yml"]), true)
  assert.equal(workflowOnlyPathFilter([".garnet-demo/runtime-review/**", ".github/workflows/deepsec.yml"]), false)
  assert.equal(workflowOnlyPathFilter(null), false)
  assert.equal(workflowOnlyPathFilter([]), false)
})

const HEAD40 = "a".repeat(40)
const OTHER40 = "b".repeat(40)
function recordComment(body, login = "garnet-runtime-review[bot]") {
  return { user: { login }, body }
}
const FINAL_RECORD = `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${HEAD40} -->\n<!-- garnet:summary {"status":"finalized","chains":2} -->\nRuntime Review`

test("re-review script: requests only for a finalized, trusted, exact-head record and only once per head", () => {
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD), HEAD40), true)
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD), OTHER40), false, "a record for another head is not evidence for this one")
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD, "someone"), HEAD40), false, "untrusted author")
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD, "github-actions[bot]"), HEAD40), false, "the workflow token is not the Garnet App")
  assert.equal(isTrustedEvidenceComment(recordComment(FINAL_RECORD.replace("<!-- garnet:summary", "<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:summary"))), true)
  assert.equal(isTrustedEvidenceComment(recordComment(`<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pending-pr-comment:v1:app.garnet.ai -->\n<!-- garnet:commit ${HEAD40} -->`)), false, "the mirror never mirrors a pending placeholder")
  assert.equal(isTrustedEvidenceComment(recordComment(`<!-- garnet-runtime-review -->\n<!-- garnet-control-plane-pr-comment:v1 -->`, "github-actions[bot]")), false)
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD.replace("finalized", "pending")), HEAD40), false)
  assert.equal(isFinalizedRecordFor(recordComment(`${FINAL_RECORD}\n<!-- garnet-control-plane-pending-pr-comment -->`), HEAD40), false, "placeholder")
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD.replace(/<!-- garnet:summary.*-->\n/, "")), HEAD40), false, "no machine register")
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD.replace("{\"status\"", "{status")), HEAD40), false, "unparseable register")
  assert.equal(isFinalizedRecordFor(recordComment(FINAL_RECORD.replace(`<!-- garnet:commit ${HEAD40} -->`, `<!-- garnet:commit ${HEAD40.slice(0, 7)} -->`)), HEAD40), false, "short sha is not a binding")
  assert.equal(isFinalizedRecordFor({ user: { login: "github-actions[bot]" }, body: null }, HEAD40), false)
  const marker = rereviewMarker(HEAD40)
  assert.equal(alreadyRequestedFor([recordComment(FINAL_RECORD), { user: { login: "github-actions[bot]" }, body: `${marker}\n@coderabbitai review` }], HEAD40), true)
  assert.equal(alreadyRequestedFor([{ user: { login: "github-actions[bot]" }, body: `${rereviewMarker(OTHER40)}\n@coderabbitai review` }], HEAD40), false, "a new head gets one new request")
  assert.equal(alreadyRequestedFor([{ body: 7 }], HEAD40), false)
})

test("re-review script: the garnet/evidence check must have passed; absent, pending and failed checks request nothing", () => {
  assert.equal(EVIDENCE_CHECK, "garnet/evidence")
  const run = (status, conclusion, name = EVIDENCE_CHECK) => ({ name, status, conclusion })
  assert.equal(evidenceCheckState([]), "absent")
  assert.equal(evidenceCheckState(undefined), "absent")
  assert.equal(evidenceCheckState([run("completed", "success", "ci/other")]), "absent", "another check's success is not evidence")
  assert.equal(evidenceCheckState([run("in_progress", null)]), "pending")
  assert.equal(evidenceCheckState([run("completed", "failure")]), "failed")
  assert.equal(evidenceCheckState([run("completed", "failure"), run("completed", "success")]), "success", "a rerun that passed counts")
  assert.equal(evidenceCheckState([run("completed", "failure"), run("queued", null)]), "pending")
})

test("re-review script: one comment carries every mention and the per-head lock without API reviewer residue", () => {
  assert.deepEqual(parseWorkflowReviewers("devin, coderabbit,greptile,devin"), ["devin", "coderabbit", "greptile"])
  assert.deepEqual(parseWorkflowReviewers(""), [])
  assert.throws(() => parseWorkflowReviewers("sonar"), /unknown reviewer 'sonar'/)
  for (const name of REVIEWERS) assert.ok(name in MENTIONS || API_REVIEWERS.includes(name), `${name} has a request path in the workflow script`)
  const body = renderRequestComment(["devin", "coderabbit", "greptile"], HEAD40)
  assert.ok(body.startsWith(rereviewMarker(HEAD40)))
  assert.match(body, /^@coderabbitai review$/m)
  assert.match(body, /^@greptileai review$/m)
  assert.doesNotMatch(body, /Review requested through the API|devin|copilot/)
  assert.match(body, /head `aaaaaaa`/)
  assert.match(body, /Runtime evidence \(Garnet, head aaaaaaa\):/, "the comment carries the grounding ask inline")
  assert.match(body, /garnet:evidence:begin/)
  assert.doesNotMatch(body, /approve|LGTM|safe|clean/i, "the request never judges the pull request")
  const apiOnly = renderRequestComment(["copilot"], HEAD40)
  assert.ok(apiOnly.startsWith(rereviewMarker(HEAD40)), "API-only reviewers still get the lock comment")
  assert.doesNotMatch(apiOnly, /^@/m)
  for (const reviewers of [[], ["devin"], ["copilot"], ["coderabbit"], ["devin", "copilot"], ["devin", "coderabbit", "greptile", "bugbot", "codex", "qodo"]]) {
    assert.doesNotThrow(() => assertNoResidue(renderRequestComment(reviewers, HEAD40)))
  }
})

test("consume: a URL without a matching target requires an explicit slug", () => {
  const targets = [{ slug: "widgets", fork: "garnet-labs/widgets" }]
  assert.deepEqual(resolveConsumeTarget("https://github.com/garnet-labs/widgets/pull/7", targets), { target: targets[0], reason: "matched" })
  assert.deepEqual(resolveConsumeTarget("https://github.com/garnet-labs/codex/pull/7", targets), { target: null, reason: "missing" })
  assert.deepEqual(resolveConsumeTarget("https://github.com/garnet-labs/widgets/pull/7", [...targets, { slug: "widgets-copy", fork: "garnet-labs/widgets" }]), { target: null, reason: "ambiguous" })
})

test("stage2 gate: a finalized record stays pending while any listened recorder run on the head is unfinished", () => {
  const recorders = ["Install", "Prettier"]
  const runs = [
    { name: "Install", status: "completed" },
    { name: "Prettier", status: "in_progress" },
    { name: "Lint", status: "queued" },
  ]
  assert.deepEqual(unsettledRecorders(runs, recorders), ["Prettier"], "non-recorder workflows do not count")
  assert.deepEqual(unsettledRecorders(runs, []), [])
  const success = { state: "success", summary: "ok", recorded: "2026-09-20T12:00:00Z", jobs: 2 }
  const held = withRecorderCompleteness(success, ["Prettier"], HEAD40)
  assert.equal(held.state, "pending")
  assert.match(held.summary, /1 recorder run is still running \(Prettier\)/)
  assert.equal(held.jobs, 2, "what the record said is kept")
  assert.equal(checkRunPayload(held, HEAD40, null).status, "in_progress")
  assert.deepEqual(withRecorderCompleteness(success, [], HEAD40), success)
  const failure = { state: "failure", summary: "none", recorded: null, jobs: null }
  assert.deepEqual(withRecorderCompleteness(failure, ["Prettier"], HEAD40), failure, "a missing record is failure regardless of running recorders")
  assert.deepEqual(parseRecorderNames('["Install","Prettier"]'), recorders)
  assert.deepEqual(parseRecorderNames(undefined), [])
  assert.throws(() => parseRecorderNames('{"a":1}'), /JSON array/)
})

test("verify: the fork's re-review lock comment is not session residue, other comments still are", () => {
  const lock = `<!-- garnet:rereview ${SHA_B} -->\n@greptileai review\nNot requested (repository secret absent): devin.`
  assert.equal(findResidue("routine body", [lock]), null)
  assert.equal(findResidue("routine body", [lock, "Reviewed by Devin"]), "Devin")
  assert.equal(findResidue("see app.devin.ai/x", [lock]), "app.devin.ai")
})
