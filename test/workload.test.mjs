import test from "node:test"
import assert from "node:assert/strict"
import { unlinkSync } from "node:fs"
import { anyPathMatches, matchGlob, mergeWorkload, normalizeWorkload } from "../lib/paths.mjs"
import { ensureTarget, mergeRecord, normalizeRecord, saveTarget, targetPath } from "../lib/ledger.mjs"
import { observationFor, recommend, scoreGap, prFacts } from "../lib/observe.mjs"
import { find, effectiveRecord } from "../lib/commands.mjs"

// ---------------------------------------------------------------- paths

test("matchGlob: exact, star, starstar, and question mark", () => {
  assert.equal(matchGlob("dev-packages/e2e-tests/app.ts", "dev-packages/e2e-tests/app.ts"), true)
  assert.equal(matchGlob("dev-packages/e2e-tests/app.ts", "dev-packages/e2e-tests/*.ts"), true)
  assert.equal(matchGlob("dev-packages/e2e-tests/nested/app.ts", "dev-packages/e2e-tests/*.ts"), false)
  assert.equal(matchGlob("dev-packages/e2e-tests/nested/app.ts", "dev-packages/e2e-tests/**"), true)
  assert.equal(matchGlob("dev-packages/e2e-tests/a/b/c.ts", "dev-packages/**/c.ts"), true)
  assert.equal(matchGlob("dev-packages/c.ts", "dev-packages/**/c.ts"), true)
  assert.equal(matchGlob("src/a1.ts", "src/a?.ts"), true)
  assert.equal(matchGlob("src/a12.ts", "src/a?.ts"), false)
  assert.equal(matchGlob("packages/core/index.ts", "dev-packages/e2e-tests/**"), false)
  assert.equal(matchGlob("src/app.test.ts", "src/*.test.ts"), true)
  assert.equal(matchGlob("src/app.test.ts", "src/*.ts"), true)
})

test("anyPathMatches: any path against any pattern", () => {
  const paths = ["packages/core/index.ts", "dev-packages/e2e-tests/app.ts"]
  assert.equal(anyPathMatches(paths, ["dev-packages/e2e-tests/**"]), true)
  assert.equal(anyPathMatches(paths, ["docs/**"]), false)
  assert.equal(anyPathMatches([], ["**"]), false)
  assert.equal(anyPathMatches(paths, []), false)
  assert.equal(anyPathMatches(null, ["**"]), false)
})

// ---------------------------------------------------------------- workload / record normalization

test("normalizeWorkload: valid, null, and bad shapes", () => {
  assert.equal(normalizeWorkload(null), null)
  assert.deepEqual(normalizeWorkload({ name: "e2e", paths: ["dev-packages/e2e-tests/**"] }), { name: "e2e", paths: ["dev-packages/e2e-tests/**"] })
  assert.throws(() => normalizeWorkload({ name: "", paths: ["a/**"] }), /non-empty name/)
  assert.throws(() => normalizeWorkload({ name: "e2e", paths: [] }), /at least one path glob/)
  assert.throws(() => normalizeWorkload({ name: "e2e" }), /at least one path glob/)
  assert.throws(() => normalizeWorkload("e2e"), /must be \{name, paths\}/)
})

test("mergeWorkload: fills absent, keeps identical, throws on conflict", () => {
  const declared = { name: "e2e", paths: ["dev-packages/e2e-tests/**"] }
  assert.deepEqual(mergeWorkload(null, declared), declared)
  assert.deepEqual(mergeWorkload(declared, { name: "e2e", paths: ["dev-packages/e2e-tests/**"] }), declared)
  assert.throws(() => mergeWorkload(declared, { name: "bench", paths: ["x/**"] }), /already declares workload/)
  assert.equal(mergeWorkload(declared, null), declared)
})

test("normalizeRecord: modes, job requirement, bad shapes", () => {
  assert.equal(normalizeRecord(null), null)
  assert.deepEqual(normalizeRecord({ mode: "inject", job: null }), { mode: "inject", job: null })
  assert.deepEqual(normalizeRecord({ mode: "instrument", job: "build.yml/job_e2e_tests" }), { mode: "instrument", job: "build.yml/job_e2e_tests" })
  assert.throws(() => normalizeRecord({ mode: "nope", job: null }), /one of fork-workflow\|inject\|instrument/)
  assert.throws(() => normalizeRecord({ mode: "instrument", job: null }), /needs job/)
  assert.throws(() => normalizeRecord({ mode: "inject", job: "build.yml/x" }), /takes no job/)
})

test("mergeRecord: fills absent, keeps identical, throws on conflict", () => {
  const declared = { mode: "instrument", job: "build.yml/job_e2e_tests" }
  assert.deepEqual(mergeRecord(null, declared), declared)
  assert.deepEqual(mergeRecord(undefined, declared), declared)
  assert.deepEqual(mergeRecord(declared, { mode: "instrument", job: "build.yml/job_e2e_tests" }), declared)
  assert.throws(() => mergeRecord(declared, { mode: "inject", job: null }), /already declares record/)
  assert.equal(mergeRecord(declared, null), declared)
})

// ---------------------------------------------------------------- ledger

test("ensureTarget: new target stores record and workload; existing fills and conflicts", () => {
  const slug = "t-workload-target"
  try {
    const created = ensureTarget(slug, {
      upstream: "getsentry/sentry-javascript",
      fork: "garnet-labs/sentry-javascript",
      record: { mode: "instrument", job: "build.yml/job_e2e_tests" },
      workload: { name: "e2e", paths: ["dev-packages/e2e-tests/**"] },
    })
    assert.deepEqual(created.record, { mode: "instrument", job: "build.yml/job_e2e_tests" })
    assert.deepEqual(created.workload, { name: "e2e", paths: ["dev-packages/e2e-tests/**"] })
    saveTarget(created)

    const refilled = ensureTarget(slug, {
      upstream: "getsentry/sentry-javascript",
      fork: "garnet-labs/sentry-javascript",
      record: { mode: "instrument", job: "build.yml/job_e2e_tests" },
      workload: { name: "e2e", paths: ["dev-packages/e2e-tests/**"] },
    })
    assert.deepEqual(refilled.record, created.record)

    assert.throws(
      () => ensureTarget(slug, { upstream: "getsentry/sentry-javascript", fork: "garnet-labs/sentry-javascript", record: { mode: "inject", job: null } }),
      /already declares record/,
    )
    assert.throws(
      () => ensureTarget(slug, { upstream: "getsentry/sentry-javascript", fork: "garnet-labs/sentry-javascript", workload: { name: "bench", paths: ["x/**"] } }),
      /already declares workload/,
    )
  } finally {
    try { unlinkSync(targetPath(slug)) } catch { /* already absent */ }
  }
})

// ---------------------------------------------------------------- observe

function pr(number, paths, title = "change something") {
  return {
    number,
    title,
    author: { login: "someone" },
    state: "OPEN",
    createdAt: "2026-09-24T00:00:00Z",
    isDraft: false,
    files: paths.map((path) => ({ path, additions: 1, deletions: 0 })),
  }
}

const E2E = { name: "e2e", paths: ["dev-packages/e2e-tests/**"] }

test("scoreGap: workload-surface reason only when workload paths are touched", () => {
  const touched = scoreGap(prFacts(pr(1, ["dev-packages/e2e-tests/app.ts"])), undefined, E2E)
  const reason = touched.reasons.find((entry) => entry.id === "workload-surface")
  assert.ok(reason)
  assert.equal(reason.points, 3)
  assert.match(reason.reason, /e2e workload surface/)
  assert.equal(touched.total, touched.reasons.reduce((sum, entry) => sum + entry.points, 0))

  const missed = scoreGap(prFacts(pr(2, ["packages/core/index.ts"])), undefined, E2E)
  assert.equal(missed.reasons.some((entry) => entry.id === "workload-surface"), false)

  const unscoped = scoreGap(prFacts(pr(3, ["dev-packages/e2e-tests/app.ts"])))
  assert.equal(unscoped.reasons.some((entry) => entry.id === "workload-surface"), false)
})

test("observationFor threads the workload; recommend prefers workload rows", () => {
  const rows = [pr(1, ["packages/core/index.ts"]), pr(2, ["dev-packages/e2e-tests/app.ts"])].map((row) => observationFor(row, E2E))
  assert.equal(rows[1].gap.reasons.some((entry) => entry.id === "workload-surface"), true)
  assert.equal(recommend(rows, E2E).upstreamPr, 2)
  assert.equal(recommend(rows, null).upstreamPr, 2)
})

// ---------------------------------------------------------------- live defaults

test("effectiveRecord: flags win, then target declaration, then null", () => {
  const target = { record: { mode: "instrument", job: "build.yml/job_e2e_tests" } }
  assert.deepEqual(effectiveRecord([], target), { mode: "instrument", job: "build.yml/job_e2e_tests" })
  assert.deepEqual(effectiveRecord(["--record", "inject"], target), { mode: "inject", job: "build.yml/job_e2e_tests" })
  assert.deepEqual(effectiveRecord(["--job", "other.yml/other"], target), { mode: "instrument", job: "other.yml/other" })
  assert.deepEqual(effectiveRecord([], null), { mode: null, job: null })
  assert.deepEqual(effectiveRecord([], {}), { mode: null, job: null })
  assert.deepEqual(effectiveRecord([], { record: { mode: "fork-workflow", job: null } }), { mode: "fork-workflow", job: null })
})

// ---------------------------------------------------------------- find

test("find: --paths filters, --record-mode/--record-job and workload persist on the target", () => {
  const rows = [
    pr(11, ["dev-packages/e2e-tests/app.ts"], "fix flaky login test"),
    pr(12, ["packages/core/index.ts"], "refactor core"),
  ]
  const exec = () => JSON.stringify(rows)
  const logs = []
  const saved = []
  const result = find(
    ["getsentry/sentry-javascript", "--slug", "t-find-workload", "--fork", "garnet-labs/sentry-javascript",
      "--paths", "dev-packages/e2e-tests/**",
      "--record-mode", "instrument", "--record-job", "build.yml/job_e2e_tests",
      "--workload-name", "e2e", "--workload-paths", "dev-packages/e2e-tests/**"],
    { exec, log: (line) => logs.push(line), save: (target) => saved.push(target) },
  )
  assert.equal(result.observations.length, 1)
  assert.equal(result.observations[0].upstreamPr, 11)
  assert.deepEqual(result.target.record, { mode: "instrument", job: "build.yml/job_e2e_tests" })
  assert.deepEqual(result.target.workload, { name: "e2e", paths: ["dev-packages/e2e-tests/**"] })
  assert.ok(logs.join("\n").includes("workload surface"))
  assert.equal(saved.length, 1)
})

test("find: bad --record-mode fails fast", () => {
  const exec = () => JSON.stringify([])
  assert.throws(
    () => find(["getsentry/sentry-javascript", "--slug", "t-find-bad", "--fork", "garnet-labs/sentry-javascript", "--record-mode", "nope"],
      { exec, log: () => {}, save: () => {} }),
    /one of fork-workflow\|inject\|instrument/,
  )
})
