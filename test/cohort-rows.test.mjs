import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildRow, hoursOpen, renderResearchNote, renderRowsTable, reviewerResult, standingApprover } from "../lib/cohort-rows.mjs"

const read = (name) => readFileSync(new URL(`./fixtures/app/${name}`, import.meta.url), "utf8")
const HEAD = { 246: "304f116cfbea6fc11dbd42d2130121b8808ecd87", 249: "71ab5eebb5f279f0771fa2795e765ae02846f24a" }
const FILES = { 246: ["pnpm-lock.yaml", "pnpm-workspace.yaml", "products/desktop/packages/ui/package.json", "products/desktop/pnpm-lock.yaml", "products/desktop/tools/announcements-admin/package.json"], 249: ["pnpm-workspace.yaml"] }

function row(n, extra = {}) {
  return buildRow({
    entry: { fork: `https://github.com/garnet-labs/posthog/pull/${n}`, upstream: "https://github.com/PostHog/posthog/pull/1", classification: { "f.hubspotusercontent40[.]net": "real" }, ...extra },
    pr: { html_url: `https://github.com/garnet-labs/posthog/pull/${n}`, head: { sha: HEAD[n] }, user: { type: "Bot" } },
    files: FILES[n].map((filename) => ({ filename })),
    comments: [
      { user: { login: "garnet-runtime-review[bot]" }, body: read(`posthog-${n}.pr-comment.md`), html_url: `https://github.com/garnet-labs/posthog/pull/${n}#issuecomment-1` },
      { user: { login: "github-actions[bot]" }, body: read(`posthog-${n}.stamphog.md`), html_url: `https://github.com/garnet-labs/posthog/pull/${n}#issuecomment-2` },
    ],
    proof: { conclusion: "success", html_url: "https://github.com/garnet-labs/posthog/actions/runs/1/job/2" },
    upstream: { state: "closed", merged: true, verdict: "APPROVED", approver: "someone", hours_open_to_merge: 20.5, reverted: false },
    verification: { status: "FAIL", legs: [{ name: "head-bound", ok: true }, { name: "capture completeness", ok: false }, { name: "public profile identity", ok: false }] },
  })
}

test("reviewer comment reads verdict, reviewed head, attested and unattested files as stated", () => {
  const approved = reviewerResult({ body: read("posthog-246.stamphog.md") })
  assert.equal(approved.verdict, "APPROVED")
  assert.deepEqual(approved.attested, FILES[246])
  const refused = reviewerResult({ body: read("posthog-249.stamphog.md") })
  assert.equal(refused.verdict, "REFUSED")
  assert.deepEqual([refused.attested, refused.notAttested], [[], ["pnpm-workspace.yaml"]])
  assert.equal(reviewerResult(undefined).verdict, null)
})

test("246 row: nothing new 0 of 6, best-effort scoped, five files attested, APPROVED, verify FAIL kept", () => {
  const r = row(246)
  assert.deepEqual([r.app_result, r.capture_quality, r.jobs_recorded, r.scope], ["nothing new", "best-effort", 6, "pr-base"])
  assert.deepEqual([r.head_sha, r.compared_sha], [HEAD[246], "7ba2b77e1e9fe875cc696fb4f0c8180a367a9553"])
  assert.deepEqual(r.new_hosts, [])
  assert.deepEqual(r.removed_jobs, ["Vendored packages / install"])
  assert.equal(r.attestation.attested, true)
  assert.equal(r.attestation.files.length, 5)
  assert.deepEqual([r.reviewer.verdict, r.reviewer.current], ["APPROVED", true])
  assert.deepEqual(r.verify, { status: "FAIL", failed: ["capture completeness", "public profile identity"] })
})

test("249 row: changed 1 of 6 on the two HubSpot hosts with job and process, no attestation, REFUSED", () => {
  const r = row(249)
  assert.equal(r.app_result, "changed")
  assert.deepEqual(r.new_hosts.map((h) => [h.host, h.job, h.process, h.class]), [
    ["2832391.fs1.hubspotusercontent-eu1[.]net", "Garnet Runtime Visibility / Dependency install", "MainThread", "unclassified"],
    ["f.hubspotusercontent40[.]net", "Garnet Runtime Visibility / Dependency install", "MainThread", "real"],
  ])
  assert.deepEqual([r.attestation.attested, r.attestation.not_attested], [false, ["pnpm-workspace.yaml"]])
  assert.equal(r.reviewer.verdict, "REFUSED")
})

test("a comment bound to another head yields capture incomplete with no compared commit", () => {
  const r = buildRow({
    entry: { fork: "https://github.com/garnet-labs/posthog/pull/246" },
    pr: { html_url: "https://github.com/garnet-labs/posthog/pull/246", head: { sha: "a".repeat(40) }, user: { type: "User" } },
    files: [], comments: [{ user: { login: "garnet-runtime-review[bot]" }, body: read("posthog-246.pr-comment.md") }], proof: null,
  })
  assert.deepEqual([r.app_result, r.compared_sha, r.record, r.author_class], ["capture incomplete", null, "not finalized or not bound to head", "human"])
})

test("table and note name pair, scope and capture on every row, count from rows, and keep the vocabulary", () => {
  const rows = [row(246), row(249)]
  const table = renderRowsTable(rows)
  assert.match(table, /`304f116` → `7ba2b77` \(pr-base\) \| best-effort \(scoped\) \| 6 \| nothing new · 0 of 6 jobs changed · 1 removed \(not a change by itself\)/)
  assert.match(table, /changed · 1 of 6 jobs changed/)
  assert.match(table, /no: pnpm-workspace\.yaml/)
  assert.match(table, /merged after 20\.5 h · approved by someone/)
  assert.doesNotMatch(table, /\b(clean|complete capture|detected|verified|caught)\b/i)
  const note = renderResearchNote(rows, { question: "Q?" })
  for (const h of ["Question", "Hypothesis", "Method", "Sample", "Results", "Findings", "Limitations", "Conclusion"]) assert.match(note, new RegExp(`^## ${h}$`, "m"))
  assert.match(note, /App results: 1 changed, 1 nothing new, 0 capture incomplete\. Strict `replay verify`: 0 of 2 PASS\./)
  assert.match(note, /unclassified: 1\./)
  assert.match(note, /Strict public profile identity fails on 2 of 2 rows/)
  assert.doesNotMatch(note, /replayed as one commit/)
})

test("hours open to merge", () => {
  assert.equal(hoursOpen("2026-11-01T00:00:00Z", "2026-11-01T20:30:00Z"), 20.5)
  assert.equal(hoursOpen("2026-11-01T00:00:00Z", null), null)
})

test("a reviewer comment on an older head attests nothing for the current head", () => {
  const r = buildRow({
    entry: { fork: "https://github.com/garnet-labs/posthog/pull/246" },
    pr: { html_url: "https://github.com/garnet-labs/posthog/pull/246", head: { sha: "b".repeat(40) }, user: { type: "Bot" } },
    files: [], comments: [{ user: { login: "github-actions[bot]" }, body: read("posthog-246.stamphog.md") }], proof: null,
  })
  assert.deepEqual([r.attestation.attested, r.attestation.files, r.reviewer.verdict, r.reviewer.current], [false, [], "APPROVED", false])
})

test("an approval later withdrawn by the same reviewer does not stand", () => {
  const r = (login, state) => ({ user: { login }, state })
  assert.equal(standingApprover([r("a", "APPROVED"), r("a", "CHANGES_REQUESTED")]), null)
  assert.equal(standingApprover([r("a", "APPROVED"), r("b", "COMMENTED"), r("b", "APPROVED")]), "b")
  assert.equal(standingApprover([r("b", "APPROVED"), r("a", "CHANGES_REQUESTED"), r("a", "APPROVED"), r("b", "DISMISSED")]), "a")
})
