import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { recordValueArms, recordValueChanges, recordValueFileDiff, recordValueHasVerification, recordValueJudge, recordValueMetrics, recordValueReceipt, recordValueShareStatus, recordValueSource } from "../lib/record-value.mjs"

const head = "a".repeat(40)
const previous = "b".repeat(40)
const url = "https://github.com/garnet-labs/posthog/pull/276"
const pr = { number: 276, html_url: url, created_at: "2026-11-20T06:22:45Z", head: { sha: head, ref: "shadow/pr/136655" } }
const folds = [
  "<details><summary><b>CI / Install (recorded)</b> · +1</summary>",
  "<sub>Workload · compared with base</sub>",
  "\n```diff", "  bash › node", "  ├─ python3.12", "+ │  └─ downloads.example[.]net", "− └─ old.example[.]net", "```",
  "<sub>Runner &amp; GitHub's own traffic</sub>",
  "\n```diff", "  systemd", "+ └─ runner.example[.]net", "```", "</details>",
].join("\n")

function comment(overrides = {}) {
  const summary = JSON.stringify({ status: "finalized", commit: head, previous, capture_quality: "best-effort",
    incomplete: 0, outcome: "changed", scope: "pr-base", added: 1, ...overrides })
  return { user: { login: "garnet-runtime-review[bot]" }, updated_at: "2026-11-20T07:00:00Z",
    html_url: `${url}#issuecomment-1`, body: `<!-- garnet:commit ${head} -->\n<!-- garnet:summary ${summary} -->\n${folds}` }
}

test("record-value admits only usable current-head positive workload changes", () => {
  const receipt = recordValueReceipt(pr, [comment()])
  assert.equal(receipt.status, "eligible")
  assert.equal(receipt.comparedSha, previous)
  assert.equal(receipt.capture, "best-effort")
  assert.deepEqual(receipt.changes, [{ job: "CI / Install", step: null, destination: "downloads.example[.]net", chain: "bash › node › python3.12", profile: null }])
  assert.deepEqual(recordValueChanges(folds), receipt.changes)
  assert.equal(recordValueReceipt({ ...pr, head: { sha: previous } }, [comment()]).status, "incomplete")
  assert.equal(recordValueReceipt(pr, [comment({ status: "pending" })]).status, "incomplete")
  assert.equal(recordValueReceipt(pr, [comment({ trimmed: true })]).status, "incomplete")
  assert.equal(recordValueReceipt(pr, [comment({ capture_quality: "partial" })]).status, "incomplete")
  assert.equal(recordValueReceipt(pr, [comment({ outcome: "unchanged", added: 0 })]).status, "not eligible")
  assert.equal(recordValueReceipt(pr, [{ ...comment(), user: { login: "contributor" } }]).status, "incomplete")
})

test("share gating admits only a pass on the collected head and receipt", async () => {
  const row = { url, headSha: head, ...recordValueReceipt(pr, [comment()]) }
  const pass = { status: "PASS", head, receipt_fingerprint: row.fingerprint }
  const verified = await recordValueShareStatus(row, async input => { assert.equal(input, url); return pass })
  assert.equal(recordValueHasVerification({ ...row, ...verified }), true)
  assert.equal(recordValueHasVerification(row), false)
  assert.equal(recordValueHasVerification({ ...row, ...verified, url: `${url}1` }), false)
  assert.equal(recordValueHasVerification({ ...row, ...verified, headSha: previous }), false)
  assert.equal(recordValueHasVerification({ ...row, ...verified, fingerprint: "f".repeat(64) }), false)
  assert.equal(recordValueHasVerification({ ...row, verification: { ...verified.verification, status: "FAIL" } }), false)
  assert.deepEqual(await recordValueShareStatus(row, async () => ({ ...pass, status: "FAIL", legs: [{ name: "no session residue", ok: false }] })), {
    reason: "Replay share gate did not pass", evidence: row.appUrl, failedLegs: ["no session residue"],
  })
  assert.equal((await recordValueShareStatus(row, async () => ({ ...pass, head: previous }))).verification, undefined)
  assert.equal((await recordValueShareStatus(row, async () => ({ ...pass, receipt_fingerprint: "different" }))).verification, undefined)
  assert.equal((await recordValueShareStatus(row, async () => { throw new Error("Unavailable") })).verification, undefined)
})

test("only added outbound leaves are counted, not dotted processes", () => {
  const body = folds.replace("  ├─ python3.12", "+ ├─ python3.12").replace("− └─ old.example[.]net", "+ └─ curl.exe")
  assert.deepEqual(recordValueChanges(body).map(row => [row.destination, row.chain]), [
    ["downloads.example[.]net", "bash › node › python3.12"],
  ])
})

test("legacy App job folds have an uncaptained workload diff with marked connection leaves", async () => {
  const body = await readFile(new URL("./fixtures/app/dspy-4.pr-comment.md", import.meta.url), "utf8")
  assert.deepEqual(recordValueChanges(body).map(({ job, destination, chain }) => ({ job, destination, chain })), [{
    job: "Lint, Test, and Build / Run MCP v2 Tests", destination: "dualstack.python.map.fastly[.]net", chain: "Runner.Worker › bash › uv",
  }])
  assert.deepEqual(recordValueChanges(folds.replace(/<sub>Workload[^\n]*\n\n```diff[\s\S]*?```\n/, "")), [])
})

test("the source arm receives the concern but neither the record nor the description mirror", () => {
  const receipt = recordValueReceipt(pr, [comment()])
  const row = { title: "Update download", body: "Reason\n<!-- garnet:evidence:begin -->\nmirror leak\n<!-- garnet:evidence:end -->", diff: "x".repeat(4000),
    headSha: head, ...receipt }
  const inputs = recordValueArms(row)
  assert.match(inputs.question, /outbound connection to downloads\.example/)
  assert.doesNotMatch(inputs.question, /python3|Install/)
  assert.doesNotMatch(inputs.arms.source, /mirror leak|python3|Install/)
  assert.ok(inputs.arms.record.startsWith(inputs.arms.source + "\nGarnet record excerpt:"))
  assert.match(inputs.arms.record, /python3\.12/)
  assert.equal(inputs.omitted.diff, 300)
  const probabilities = { source: 0.2, record: 0.8 }
  const judge = recordValueJudge("fixed", inputs, probabilities)
  assert.deepEqual(judge, recordValueJudge("fixed", inputs, probabilities))
  assert.equal(judge.alternatives.option1.probability_yes, probabilities[judge.order[0]])
  assert.deepEqual(Object.keys(judge.alternatives), ["option1", "option2"])
})

test("mirror variants share a cluster; summaries use paired deltas and flips", () => {
  assert.deepEqual(recordValueSource(pr), recordValueSource({ ...pr, number: 277, head: { ref: "shadow/pr/136655-r2" } }))
  assert.equal(recordValueSource({ ...pr, number: 280, created_at: "2026-11-24T00:00:00Z", head: { ref: "dependabot/demo" } }).source, "Nov 24–29")
  const a = { group: "same", probabilities: { source: 0.4, record: 0.6 }, judge: { source: 1, record: 3 } }
  const b = { group: "other", probabilities: { source: 0.9, record: 0.8 }, judge: { source: 2, record: 2 } }
  const metrics = recordValueMetrics([a, a, b])
  assert.equal(metrics.groups, 2)
  assert.equal(metrics.pairs, 3)
  assert.equal(metrics.flips, 2)
  assert.equal(metrics.meanJudgeDelta, 4 / 3)
  assert.deepEqual(metrics.judgeDelta95, [0, 2])
  assert.equal(recordValueMetrics([a, a]).judgeDelta95, null)
  assert.equal(recordValueMetrics([]), null)
})

test("the file-patch fallback fails closed on omitted files or truncated hunks", () => {
  const file = { filename: "after.txt", previous_filename: "before.txt", status: "renamed", additions: 1, deletions: 1,
    patch: "@@ -1 +1 @@\n-before\n+after" }
  assert.match(recordValueFileDiff([file], 1), /^--- a\/before.txt\n\+\+\+ b\/after.txt/)
  assert.throws(() => recordValueFileDiff([file], 2), /Incomplete/)
  assert.throws(() => recordValueFileDiff([{ ...file, additions: 2 }], 1), /Truncated/)
  assert.throws(() => recordValueFileDiff([{ ...file, patch: undefined }], 1), /Missing/)
})
