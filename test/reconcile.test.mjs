import test from "node:test"
import assert from "node:assert/strict"
import { collectReconciliation, observeTarget, reconcileTarget } from "../lib/reconcile.mjs"
import { reconcile } from "../lib/commands.mjs"
import { reconciliationSummary, renderTargetText } from "../lib/status.mjs"
import { STAGE2_FILES } from "../lib/stage2.mjs"
import { githubReadFetch } from "../lib/gh.mjs"
import { receiptFingerprint } from "../lib/receipt.mjs"

const head = "a".repeat(40)
const previous = "b".repeat(40)
const target = { slug: "example", fork: "garnet-labs/example", replays: [], cohorts: [] }
const checkedAt = "2026-11-20T00:00:00.000Z"
const comment = { user: { login: "garnet-runtime-review[bot]" }, issue_url: "https://api.github.com/repos/garnet-labs/example/issues/1",
  body: `<!-- garnet:commit ${head} --><!-- garnet:summary {"status":"finalized","commit":"${head}","previous":"${previous}","scope":"pr-base","capture_quality":"best-effort"} -->` }

function snapshot(prs = []) {
  return { defaultBranch: "main", defaultSha: previous, paths: Object.values(STAGE2_FILES), inspectedPrs: prs.length, prs }
}

function pr(status = "PASS", sha = head) {
  return { number: 1, url: "https://github.com/garnet-labs/example/pull/1", branch: "dependency-update", head, state: "open", comments: [comment],
    verification: { status, head: sha, reasons: status === "FAIL" ? ["session residue"] : [], receipt_fingerprint: receiptFingerprint(comment.body) } }
}

function inventoryExec(command, args) {
  assert.equal(command, "gh")
  assert.equal(args[0], "api")
  assert.equal(args.some((arg) => ["POST", "PUT", "PATCH", "DELETE"].includes(arg)), false)
  const path = args.at(-1)
  if (path === "repos/garnet-labs/example") return JSON.stringify({ default_branch: "main" })
  if (path.includes("/branches/")) return JSON.stringify({ commit: { sha: previous } })
  if (path.includes("/contents/")) {
    assert.match(path, new RegExp(`ref=${previous}$`))
    return JSON.stringify({ type: "file" })
  }
  if (path.includes("/issues/comments")) return JSON.stringify([[comment]])
  if (path.includes("/pulls?")) return JSON.stringify([[{ number: 1, html_url: pr().url, head: { sha: head, ref: "dependency-update" }, state: "open", merged_at: null }],
    [{ number: 2, body: "ordinary PR", state: "open", merged_at: null }, { number: 3, state: "closed", merged_at: null }]])
  throw new Error(`unexpected read ${path}`)
}

test("inventory paginates PRs/comments and reads stage 2 files at the exact default SHA", () => {
  const result = observeTarget(target, { exec: inventoryExec })
  assert.equal(result.inspectedPrs, 3)
  assert.deepEqual(result.prs.map((row) => row.number), [1])
  assert.deepEqual(result.paths, Object.values(STAGE2_FILES))
})

test("reconciliation preserves operator rows, records exact pairs and keeps failing recordings unshareable", () => {
  const input = { ...target, notes: ["retain"], replays: [{ upstreamPr: 42, forkPr: 1, branch: "old", title: "kept" }], cohorts: [{ report: "existing" }] }
  const original = structuredClone(input)
  const result = reconcileTarget(input, snapshot([pr("FAIL")]), checkedAt)
  assert.deepEqual(input, original)
  assert.equal(result.replays.length, 1)
  assert.equal(result.replays[0].upstreamPr, 42)
  assert.equal(result.replays[0].title, "kept")
  assert.equal(result.replays[0].state, "recorded")
  assert.equal(result.replays[0].verification.status, "FAIL")
  assert.deepEqual(result.cohorts, input.cohorts)
  assert.deepEqual(result.notes, input.notes)
  assert.equal(result.stage2.state, "in-flight")
  assert.equal(result.reconciliation.prs[0].previous, previous)
  assert.equal(result.reconciliation.prs[0].scope, "pr-base")
  assert.equal(reconciliationSummary(result.reconciliation), `0 shareable, 1 failing, 0 undeterminable / 1 observed PRs · ${checkedAt}`)
  assert.match(renderTargetText(result), /live check: 0 shareable, 1 failing/)
})

test("PASS requires verifier success for this observed head; errors and moved heads are undeterminable", () => {
  assert.equal(reconcileTarget(target, snapshot([pr()]), checkedAt).replays[0].verification.status, "PASS")
  const moved = reconcileTarget(target, snapshot([pr("PASS", previous)]), checkedAt)
  assert.equal(moved.replays[0].verification.status, "undeterminable")
  const errored = { ...pr(), verification: undefined, error: "API unavailable" }
  const result = reconcileTarget(target, snapshot([errored]), checkedAt)
  assert.deepEqual(result.replays[0].verification.reasons, ["API unavailable"])
  assert.equal(result.replays[0].upstreamPr, null)
})

test("verification cannot attach to a different receipt on the same head", () => {
  for (const status of ["PASS", "FAIL"]) {
    const changed = { ...pr(status), comments: [{ ...comment, body: `${comment.body}\nUpdated record` }] }
    const result = reconcileTarget(target, snapshot([changed]), checkedAt)
    assert.equal(result.replays[0].verification.status, "undeterminable")
    assert.equal(result.replays[0].verification.receiptFingerprint, null)
  }
  const absent = { ...pr(), comments: [] }
  assert.equal(reconcileTarget(target, snapshot([absent]), checkedAt).replays[0].verification.status, "undeterminable")
})

test("empty inventory proves no installation, not a cohort or a successful replay", () => {
  const result = reconcileTarget(target, { ...snapshot(), paths: [] }, checkedAt)
  assert.deepEqual(result.replays, [])
  assert.deepEqual(result.cohorts, [])
  assert.equal(result.stage2.state, "unstarted")
  assert.equal(result.stage2.missing.length, 5)
  assert.equal(result.reconciliation.prs.length, 0)
  assert.equal(reconcileTarget(target, { ...snapshot(), paths: [STAGE2_FILES.review] }, checkedAt).stage2.state, "unstarted")
})

test("pending and stale receipts never become recorded", () => {
  for (const body of [comment.body.replace(head, previous), "<!-- garnet-control-plane-pending-pr-comment:1 -->"]) {
    const result = reconcileTarget(target, snapshot([{ ...pr("FAIL"), comments: [{ ...comment, body }] }]), checkedAt)
    assert.notEqual(result.replays[0].state, "recorded")
  }
  const pending = `<!-- garnet:commit ${head} --><!-- garnet-control-plane-pending-pr-comment:1 -->`
  assert.equal(reconcileTarget(target, snapshot([{ ...pr("FAIL"), comments: [{ ...comment, body: pending }] }]), checkedAt).replays[0].state, "pending")
  assert.equal(reconcileTarget(target, snapshot([{ ...pr("FAIL"), comments: [{ ...comment, body: pending.replace(head, previous) }] }]), checkedAt).replays[0].state, "undeterminable")
})

test("collector uses injected verify and retains exceptions without claiming failure", async () => {
  let calls = 0
  const result = await collectReconciliation(target, { exec: inventoryExec, verify: async (url, { exec }) => {
    assert.equal(url, pr().url)
    assert.equal(typeof exec, "function")
    calls += 1
    throw new Error("API unavailable")
  } })
  assert.equal(calls, 1)
  assert.equal(result.prs[0].error, "API unavailable")
})

test("command defaults to dry-run, applies through save, and preserves an inventory error", async () => {
  const saved = []
  const deps = { load: () => structuredClone(target), save: (row) => saved.push(row), exec: inventoryExec, verify: async () => pr().verification, now: () => checkedAt, log: () => {} }
  await reconcile(["example"], deps)
  assert.equal(saved.length, 0)
  await reconcile(["example", "--apply"], deps)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].replays[0].verification.status, "PASS")
  await reconcile(["--all", "--apply"], { ...deps, targets: () => [target], exec: () => { throw new Error("403 denied") } })
  assert.equal(saved[1].reconciliation.error, "403 denied")
  assert.deepEqual(saved[1].replays, [])
  assert.match(reconciliationSummary(saved[1].reconciliation), /undeterminable.*403 denied/)
  await assert.rejects(reconcile(["example", "--apply", "--dry-run"], deps), /choose/)
  await assert.rejects(reconcile(["example", "--apply"], { ...deps, save: () => { throw new Error("disk unavailable") } }), /disk unavailable/)
})

test("GitHub read adapter uses gh for API reads, delegates public profiles, and refuses writes", async () => {
  const calls = []
  const read = githubReadFetch({ exec: (command, args) => {
    calls.push([command, args])
    return '{"head":"recorded"}'
  }, fetchImpl: async (url) => new Response(url) })
  assert.deepEqual(await (await read("https://api.github.com/repos/garnet-labs/example/pulls/1?per_page=100")).json(), { head: "recorded" })
  assert.deepEqual(calls, [["gh", ["api", "/repos/garnet-labs/example/pulls/1?per_page=100"]]])
  assert.equal(await (await read("https://app.garnet.ai/public/runs/1")).text(), "https://app.garnet.ai/public/runs/1")
  await assert.rejects(read("https://api.github.com/repos/garnet-labs/example", { method: "POST" }), /GET only/)
  const denied = githubReadFetch({ exec: () => { throw Object.assign(new Error("forbidden"), { stderr: "gh: Forbidden (HTTP 403)" }) } })
  assert.equal((await denied("https://api.github.com/repos/garnet-labs/example")).status, 403)
  const broken = githubReadFetch({ exec: () => { throw new Error("network unavailable") } })
  await assert.rejects(broken("https://api.github.com/repos/garnet-labs/example"), /network unavailable/)
  const empty = githubReadFetch({ exec: () => "[]" })
  assert.deepEqual(await (await empty("https://api.github.com/repos/garnet-labs/example/issues/comments")).json(), [])
})
