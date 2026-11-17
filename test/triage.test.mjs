import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { triageRecord, triageSnapshot, triageCounts, renderTriage, receiptFingerprint } from "../lib/triage.mjs"
import { buildRow, collectRow } from "../lib/cohort-rows.mjs"
import { buildModel, renderCard } from "../lib/card.mjs"
import { evaluateExhibit } from "../lib/verify.mjs"

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/triage-receipts.json", import.meta.url), "utf8"))
const find = (repo, n) => structuredClone(fixtures.find((row) => row.fork === `https://github.com/garnet-labs/${repo}/pull/${n}`))
const pass = (row) => ({ status: "PASS", head: row.headSha, pr_url: row.fork, receipt_fingerprint: receiptFingerprint(row.comment.body), legs: [] })

function alterSummary(row, changes) {
  row.comment.body = row.comment.body.replace(/(<!-- garnet:summary )(.*?)( -->)/, (_, a, json, b) => `${a}${JSON.stringify({ ...JSON.parse(json), ...changes })}${b}`)
  return row
}

test("new hosts are review leads; E2B's assessed new workload action is independently share-gated", () => {
  const row = find("E2B", 93)
  const pending = triageRecord({ ...row, assessment: null })
  assert.deepEqual([pending.classification, pending.app_result, pending.shareable], ["needs-review", "changed", false])
  const unverified = triageRecord(row)
  assert.equal(unverified.shareable, false)
  const assessed = triageRecord({ ...row, verification: pass(row) })
  assert.deepEqual([assessed.classification, assessed.capture, assessed.shareable], ["finding", "best-effort", true])
  assert.equal(triageRecord({ ...row, verification: { ...pass(row), head: "f".repeat(40) } }).shareable, false)
  assert.equal(triageRecord({ ...row, verification: { ...pass(row), pr_url: "https://github.com/another/repo/pull/1" } }).shareable, false)
})

test("Fastly, registry swaps in both directions, and runner churn stay App changed, not findings", () => {
  for (const [repo, n] of [["litellm", 147], ["airbyte", 35], ["airbyte", 27], ["code-interpreter", 24]]) {
    const row = find(repo, n)
    const assessed = triageRecord({ ...row, verification: pass(row) })
    assert.deepEqual([assessed.classification, assessed.app_result, assessed.shareable], ["noise", "changed", false])
    assert.equal(triageRecord({ ...row, assessment: null }).classification, "needs-review")
    assert.equal(assessed.fingerprint, receiptFingerprint(row.comment.body))
  }
})

test("verification identifies the exact receipt it evaluated, not just its head", () => {
  const row = find("E2B", 93)
  const evaluate = (body) => evaluateExhibit({
    pr: { head_sha: row.headSha, base_sha: row.assessment.previous, state: "open", body: "Adds API generation." },
    comments: [{ user: row.comment.user.login, body }],
    checks: [{ name: "garnet/runtime-evidence", status: "completed", conclusion: "success" }],
    permalinkStatus: 200,
  })
  const original = evaluate(row.comment.body)
  const updated = evaluate(row.comment.body + "\n")
  assert.equal(original.status, "PASS", original.reasons.join("; "))
  assert.equal(updated.status, "PASS", updated.reasons.join("; "))
  assert.equal(original.receipt_fingerprint, row.assessment.fingerprint)
  assert.notEqual(updated.receipt_fingerprint, original.receipt_fingerprint)
})

test("a same-head update between collection and verification never shares the old finding or control", async () => {
  for (const [repo, number] of [["E2B", 93], ["nodejs-goof", 5]]) {
    const row = find(repo, number)
    const entry = { fork: row.fork, assessment: row.assessment }
    const exec = (_command, args) => {
      const path = args.at(-1)
      if (path.endsWith(`/pulls/${number}`)) return JSON.stringify({ html_url: row.fork, head: { sha: row.headSha } })
      if (path.includes("/files?")) return "[[]]"
      if (path.includes("/comments?")) return JSON.stringify([[row.comment]])
      if (path.includes("/check-runs?")) return '[{"check_runs":[]}]'
      throw new Error(`unexpected request ${path}`)
    }
    const exact = pass(row)
    const rerecorded = { ...exact, receipt_fingerprint: receiptFingerprint(row.comment.body + "\n") }
    assert.equal((await collectRow(entry, { exec, verifyImpl: async () => exact })).triage.shareable, true)
    assert.equal((await collectRow(entry, { exec, verifyImpl: async () => rerecorded })).triage.shareable, false)
    assert.equal(triageRecord({ ...row, verification: { ...exact, receipt_fingerprint: undefined } }).shareable, false)
  }
})

test("same-head reruns, a new compared commit, or altered scope invalidate an assessment", () => {
  const original = find("airbyte", 35)
  for (const changes of [{ previous: "f".repeat(40) }, { scope: "previous-push" }, { recorded: "later run at same head" }]) {
    assert.equal(triageRecord(alterSummary(structuredClone(original), changes)).classification, "needs-review")
  }
  const replacedLink = structuredClone(original)
  replacedLink.comment.body = replacedLink.comment.body.replace("44032498685", "44032498686")
  assert.equal(triageRecord(replacedLink).classification, "needs-review")
  for (const key of ["fingerprint", "head", "previous", "scope"]) {
    const row = structuredClone(original)
    row.assessment[key] = "different"
    assert.equal(triageRecord(row).classification, "needs-review")
  }
})

test("partial, pending, missing, unbound, trimmed, and unreadable job evidence is undeterminable", () => {
  const original = find("E2B", 93)
  for (const changes of [{ status: "pending" }, { capture_quality: "partial" }, { capture_quality: "not declared" }, { incomplete: 1 }, { jobs: 2 }, { changed: -1 }, { changed: 2 }, { previous: "bad" }, { trimmed: true }, { unattributed: 1 }]) {
    assert.equal(triageRecord(alterSummary(structuredClone(original), changes)).classification, "undeterminable", JSON.stringify(changes))
  }
  assert.equal(triageRecord({ ...original, headSha: "f".repeat(40) }).classification, "undeterminable")
  assert.equal(triageRecord({ comment: null, headSha: original.headSha }).classification, "undeterminable")
  assert.equal(triageRecord().classification, "undeterminable")
  const forged = structuredClone(original)
  forged.comment.user.login = "a-user"
  assert.equal(triageRecord(forged).classification, "undeterminable")
  for (const name of ["head-bound", "capture completeness", "comment finalized", "public profile identity", "sensor coverage"]) {
    assert.equal(triageRecord({ ...original, verification: { status: "FAIL", head: original.headSha, legs: [{ name, ok: false }] } }).classification, "undeterminable")
  }
})

test("no global hostname allowlist: an assessment without sufficient evidence is not accepted", () => {
  const row = find("litellm", 147)
  for (const assessment of [{ ...row.assessment, evidence: [] }, { ...row.assessment, evidence: ["https://example.com", "file:///x"] }, { ...row.assessment, reason: "" }, { ...row.assessment, classification: "clean" }]) {
    assert.equal(triageRecord({ ...row, assessment }).classification, "needs-review")
  }
})

test("quiet fixes retain best-effort and removed destinations; first records and coverage changes are not controls", () => {
  for (const row of [find("nodejs-goof", 5), find("litellm", 149)]) {
    assert.deepEqual([triageRecord(row).classification, triageRecord(row).capture, triageRecord(row).shareable], ["quiet-control", "best-effort", false])
    assert.equal(triageRecord({ ...row, verification: pass(row) }).shareable, true)
  }
  const first = alterSummary(find("E2B", 93), { previous: null, outcome: "first", changed: 0 })
  assert.equal(triageRecord(first).classification, "recorded")
  assert.equal(triageRecord(find("E2B", 95)).classification, "recorded")
})

test("archived records are not promoted using the old real/unchanged labels", () => {
  for (const label of ["real", undefined]) {
    const snapshot = triageSnapshot({ label, verdict: { value: "unchanged" }, capture: { status: "complete" } })
    assert.deepEqual([snapshot.classification, snapshot.shareable], ["undeterminable", false])
  }
  assert.equal(triageSnapshot({ label: "constructed" }).classification, "constructed")
  assert.equal(triageSnapshot(null).classification, "undeterminable")
})

test("shrinking coverage is never a shareable quiet control", () => {
  const vanished = alterSummary(find("nodejs-goof", 5), { vanished: 1 })
  assert.equal(triageRecord({ ...vanished, verification: pass(vanished) }).classification, "recorded")
  assert.equal(triageRecord({ ...vanished, verification: pass(vanished) }).shareable, false)
  const removed = find("nodejs-goof", 5)
  removed.comment.body += "\n<details>\n<summary>1 job ran on <code>main</code>, not on this commit</summary>\n<blockquote><code>Old build</code></blockquote>\n</details>"
  assert.equal(triageRecord({ ...removed, verification: pass(removed) }).classification, "recorded")
  assert.equal(triageRecord({ ...removed, verification: pass(removed) }).shareable, false)
})

test("verified PR identity accepts equivalent URLs without accepting another PR", () => {
  const row = find("E2B", 93)
  for (const url of [row.fork + "/", row.fork.toLowerCase(), row.fork + "#issuecomment-1"]) {
    assert.equal(triageRecord({ ...row, verification: { ...pass(row), pr_url: url } }).shareable, true)
  }
  for (const url of [null, "not a URL", row.fork.replace("/93", "/94")]) {
    assert.equal(triageRecord({ ...row, verification: { ...pass(row), pr_url: url } }).shareable, false)
  }
})

test("archive and rendered triage retain known transitions and explicitly name unknown ones", () => {
  const diff = JSON.parse(readFileSync(new URL("../public/replays/github/garnet-labs/continue/5.json", import.meta.url)))
  const triage = triageSnapshot(diff)
  assert.equal(triage.transition, diff.pair.transition)
  const row = { fork_pr: diff.pull_request.url, transition: triage.transition, triage }
  assert.ok(renderTriage([row]).includes(`- Transition: ${diff.pair.transition}`))
  assert.ok(renderTriage([{ ...row, transition: null }]).includes("- Transition: not derivable from the record"))
})

test("inconsistent summary and job rows are not promoted to a finding", () => {
  const row = alterSummary(find("nodejs-goof", 5), { outcome: "changed", changed: 1 })
  assert.equal(triageRecord(row).classification, "undeterminable")
  const repeated = find("nodejs-goof", 4)
  assert.equal(triageRecord({ ...repeated, verification: pass(repeated) }).shareable, true)
})

test("rows and cards keep recorded hosts and full diff while adding the review classification", () => {
  const fixture = find("airbyte", 35)
  const row = buildRow({ entry: { fork: fixture.fork, assessment: fixture.assessment }, pr: { title: "Bump example from 1.0.0 to 2.0.0", head: { sha: fixture.headSha } }, files: [], comments: [fixture.comment], proof: null, verification: pass(fixture) })
  assert.deepEqual([row.app_result, row.triage.classification], ["changed", "noise"])
  assert.equal(row.transition, "example from 1.0.0 to 2.0.0 (PR title)")
  assert.ok(row.new_hosts.some((host) => host.host.includes("s3.dualstack")))
  const model = buildModel({ slug: "airbyte", forkPr: 35, ...fixture })
  const card = renderCard(model)
  assert.match(card, /Review classification: \*\*noise\*\*/)
  assert.ok(card.includes("Assessment evidence:"))
  for (const host of ["docker-images-prod.s3.dualstack", "d3ipk8a4rcghwr.cloudfront", "chronyd", "registry-1.docker"]) assert.ok(card.includes(host))
})

test("classification counts reconcile and every row keeps pair, capture, and an evidence link", () => {
  const rows = fixtures.map((f) => ({ fork_pr: f.fork, head_sha: f.headSha, compared_sha: f.assessment?.previous ?? null, scope: "pr-base", triage: triageRecord(f) }))
  const counts = triageCounts(rows)
  assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), rows.length)
  const table = renderTriage(rows)
  assert.ok(table.includes(`${rows.length} records:`))
  for (const row of rows) {
    assert.ok(table.includes(row.fork_pr))
    assert.ok(table.includes(row.head_sha))
  }
  assert.equal(table.split("\n").filter((line) => line === "<details>").length, rows.length)
})
