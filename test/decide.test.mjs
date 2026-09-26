import test from "node:test"
import assert from "node:assert/strict"
import { buildExecutionDiff } from "../lib/execution-diff.mjs"
import { DECISIONS, decideExitCode, decideMergeSafety, renderDecision } from "../lib/decide.mjs"
import { assertVocabClean } from "../lib/guards.mjs"
import { planStage2 } from "../lib/stage2.mjs"

const PROFILE_ID = "11111111-2222-3333-4444-555555555555"
const RUN_ID = "987654321"

function receiptBody({ sha, summary, diffLines }) {
  const diffBlock = diffLines === null ? "" : `\n\`\`\`diff\n${diffLines.join("\n")}\n\`\`\`\n`
  return [
    "<!-- garnet-runtime-review -->",
    `<!-- garnet:commit ${sha} -->`,
    `<!-- garnet:summary ${JSON.stringify(summary)} -->`,
    "Runtime evidence for this pull request.",
    `[View this job's Execution Profile](https://app.garnet.ai/public/runs/${RUN_ID}?profile=${PROFILE_ID})`,
    diffBlock,
  ].join("\n")
}

function pr({ number, title, sha, summary, diffLines = null, exactHead = true, author = "dependabot[bot]" }) {
  return {
    pr_number: number,
    url: `https://github.com/garnet-labs/pnpm/pull/${number}`,
    title,
    head_sha: sha,
    author_login: author,
    files: [],
    garnet_exact_head: exactHead,
    garnet_marker_commit: sha,
    garnet_summary: summary,
    garnet_comment_body: receiptBody({ sha, summary, diffLines }),
  }
}

// Real receipt shapes from garnet-labs/pnpm.

const PR42 = pr({
  number: 42,
  title: "Bump tar-fs to 2.1.4 to remediate GHSA-vj76-c3g6-qr5v",
  sha: "d6b0a551b5015b6404528aa9ca670d5bed08d8e3",
  summary: {
    contract: "6.10.0", commit: "d6b0a551b5015b6404528aa9ca670d5bed08d8e3",
    previous: "bedea2aa898a5d25c62b5679b5b55b3d398aeeae",
    jobs: 1, changed: 0, unchanged: 1, added: 0, removed: 0,
    backgroundAdded: 2, backgroundRemoved: 1,
    chains: 30, destinations: 9, recorded: "2026-09-08 17:15:19 UTC", kinds: ["network"],
  },
  diffLines: [
    "workload",
    "runner background",
    "+ │ ├─ ○ hosted-compute-watchdog-9.eastus.cloudapp.azure[.]com",
    "+ │ ├─ ○ 140.82.114.24",
    "- │ ├─ ○ glb-1903845.us-east1.elb.amazonaws[.]com",
  ],
})

const PR14 = pr({
  number: 14,
  title: "chore(deps): bump bcrypt from 3.0.6 to 5.0.0 in the has-native-dep fixture",
  sha: "b3b71bb52769a61332c976cb99fcc1ee031ef8dd",
  summary: {
    contract: "6.9.8", commit: "b3b71bb52769a61332c976cb99fcc1ee031ef8dd",
    previous: "77971f62bebaa111d5b6ca93946fd012c08af2df",
    jobs: 1, changed: 1, unchanged: 0, added: 3, removed: 2,
    chains: 33, destinations: 10, recorded: "2026-08-17 23:10:22 UTC", kinds: ["network"],
  },
  diffLines: [
    "+ │ ├─ ○ github[.]com",
    "+ │ ├─ ○ release-assets.githubusercontent[.]com",
    "- │ ├─ ○ registry.npmjs[.]org",
    "- │ ├─ ○ codeload.github[.]com",
  ],
})

const PR50 = pr({
  number: 50,
  title: "fix(binary-fetcher): unpack zip archives into a random directory",
  sha: "aaaabbbbccccddddeeeeffff0000111122223333",
  author: "octocat",
  summary: {
    contract: "6.10.0", commit: "aaaabbbbccccddddeeeeffff0000111122223333",
    previous: "9999888877776666555544443333222211110000",
    jobs: 1, changed: 1, unchanged: 0, added: 20, removed: 0,
    chains: 40, destinations: 30, recorded: "2026-09-20 10:00:00 UTC", kinds: ["network"],
  },
  diffLines: [
    "+ │ ├─ ○ objects.githubusercontent[.]com",
    "+ │ ├─ ○ api.github[.]com",
  ],
})

const PR69 = pr({
  number: 69,
  title: "chore: first recorded pull request",
  sha: "0123456789abcdef0123456789abcdef01234567",
  summary: {
    contract: "6.10.0", commit: "0123456789abcdef0123456789abcdef01234567",
    previous: null,
    jobs: 1, changed: null, unchanged: null, added: null, removed: null,
    chains: 12, destinations: 5, recorded: "2026-10-01 08:00:00 UTC", kinds: ["network"],
  },
})

function context(fixture, files = null) {
  return {
    prMeta: { title: fixture.title, user: { login: fixture.author_login } },
    files: files ?? fixture.files,
  }
}

test("decide: unchanged workload delta over a dependency bump decides merge", () => {
  const diff = buildExecutionDiff(PR42)
  const result = decideMergeSafety(diff, context(PR42, [{ filename: "package.json" }, { filename: "pnpm-lock.yaml" }]))
  assert.equal(result.decision, DECISIONS.MERGE)
  assert.equal(result.change_class, "dependency")
  assert.deepEqual(result.new_workload_destinations, [])
  assert.deepEqual(result.runner_background, { added: 2, removed: 1 })
  assert.equal(result.head_sha, "d6b0a551b5015b6404528aa9ca670d5bed08d8e3")
  assert.equal(result.compared_sha, "bedea2aa898a5d25c62b5679b5b55b3d398aeeae")
  assert.equal(result.reasons[0], "no new workload destination recorded after the change")
  assert.match(renderDecision(result, PR42.url), /runner background: \+2 −1, not part of the decision/)
})

test("decide: new workload destinations hold a dependency bump and name them", () => {
  const diff = buildExecutionDiff(PR14)
  const result = decideMergeSafety(diff, context(PR14))
  assert.equal(result.decision, DECISIONS.HOLD)
  assert.equal(result.change_class, "dependency")
  assert.deepEqual(result.new_workload_destinations, ["github[.]com", "release-assets.githubusercontent[.]com"])
  assert.match(result.reasons[0], /3 new workload destinations \(2 named\)/)
})

test("decide: new workload destinations hold a code change", () => {
  const diff = buildExecutionDiff(PR50)
  const result = decideMergeSafety(diff, context(PR50, [{ filename: "src/binary-fetcher.ts" }, { filename: "test/fetch.test.ts" }]))
  assert.equal(result.decision, DECISIONS.HOLD)
  assert.equal(result.change_class, "code")
  assert.match(result.reasons[0], /20 new workload destinations \(2 named\)/)
})

test("decide: a first snapshot with no comparison is undeterminable, never merge", () => {
  const diff = buildExecutionDiff(PR69)
  const result = decideMergeSafety(diff, context(PR69))
  assert.equal(diff.verdict.value, "recorded")
  assert.equal(result.decision, DECISIONS.UNDETERMINABLE)
})

test("decide: a stale record decides undeterminable with the no-record reason", () => {
  const stale = { ...PR14, head_sha: "ffffffffffffffffffffffffffffffffffffffff" }
  const diff = buildExecutionDiff({ ...stale, garnet_exact_head: false })
  assert.equal(diff, null)
  const result = decideMergeSafety(diff, context(PR14))
  assert.equal(result.decision, DECISIONS.UNDETERMINABLE)
  assert.deepEqual(result.reasons, ["no head-bound finalized Garnet record"])
})

test("renderDecision output passes assertVocabClean for every decision", () => {
  const cases = [
    decideMergeSafety(buildExecutionDiff(PR42), context(PR42)),
    decideMergeSafety(buildExecutionDiff(PR14), context(PR14)),
    decideMergeSafety(buildExecutionDiff(PR50), context(PR50)),
    decideMergeSafety(buildExecutionDiff(PR69), context(PR69)),
    decideMergeSafety(null),
  ]
  for (const result of cases) {
    const rendered = renderDecision(result, "https://github.com/garnet-labs/pnpm/pull/1")
    assert.doesNotThrow(() => assertVocabClean(rendered))
    assert.match(rendered, /^decision: (merge|hold|undeterminable)$/m)
  }
})

test("decideExitCode maps merge to 0, hold to 1, undeterminable to 2", () => {
  assert.equal(decideExitCode(decideMergeSafety(buildExecutionDiff(PR42), context(PR42))), 0)
  assert.equal(decideExitCode(decideMergeSafety(buildExecutionDiff(PR14), context(PR14))), 1)
  assert.equal(decideExitCode(decideMergeSafety(null)), 2)
})

test("stage 2: the merge-safety workflow is planned with the harness commit substituted", () => {
  const harnessSha = "a".repeat(40)
  const plan = planStage2({
    slug: "pnpm", upstream: "pnpm/pnpm", fork: "garnet-labs/pnpm", defaultBranch: "main",
    recording: { present: true, workflows: [".github/workflows/garnet.yml"], name: "Garnet Runtime Visibility" },
    workExists: true, harnessSha,
  })
  const entry = Object.entries(plan.files).find(([file]) => file.endsWith("garnet-merge-safety.yml"))
  assert.ok(entry, "plan writes .github/workflows/garnet-merge-safety.yml")
  assert.match(entry[1], new RegExp(`ref: ${harnessSha}`))
  assert.doesNotMatch(entry[1], /\{\{HARNESS_SHA\}\}/)
  assert.match(entry[1], /garnet\/merge-safety/)
  assert.match(entry[1], /issue_comment/)
  assert.match(entry[1], /persist-credentials: false/)
  assert.doesNotMatch(entry[1], /ref:\s*\$\{\{[^}]*head/)
})
