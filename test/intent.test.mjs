import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { aggregateIntent, evaluateClaims, parseClaim } from "../lib/intent.mjs"
import { declaredStepName, executionDiffFromProfiles, stepEntries } from "../lib/profile-diff.mjs"
import { renderCard, buildModel } from "../lib/card.mjs"
import { validate } from "../lib/validate.mjs"
import { decideVerdict } from "../lib/evidence.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COMPLETE = { status: "complete" }
const CLAIMS = [
  { id: "storefront-removed", kind: "network", match: { destination: "mock.shop" }, expect: "present-before-absent-after", steps: ["Run E2E test"], source: "pr-body" },
  { id: "sentry-ingest-kept", kind: "network", match: { destination: "o1.ingest.sentry.io" }, expect: "present-both", steps: ["Run E2E test"], source: "pr-body" },
  { id: "no-new-outbound", kind: "network", expect: "no-added", steps: ["Run E2E test"], source: "default" },
]

async function fixture(name) {
  return JSON.parse(await readFile(join(ROOT, "test", "fixtures", name), "utf8"))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test("parseClaim accepts kind:match:expect[:step] text", () => {
  const claim = parseClaim("network:mock.shop:present-before-absent-after:Run E2E test")
  assert.equal(claim.kind, "network")
  assert.deepEqual(claim.match, { destination: "mock.shop" })
  assert.equal(claim.expect, "present-before-absent-after")
  assert.deepEqual(claim.steps, ["Run E2E test"])
})

test("parseClaim rejects a bad kind and a bad expectation", () => {
  assert.throws(() => parseClaim("file:mock.shop:present-both"), /unknown claim kind/)
  assert.throws(() => parseClaim("network:mock.shop:gone"), /unknown claim expectation/)
})

test("the three sentry claims resolve supported", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.outcome, "supported")
  assert.deepEqual(result.claims.map((claim) => claim.outcome), ["supported", "supported", "supported"])
  assert.deepEqual(result.claims[0].before, ["mock.shop"])
  assert.deepEqual(result.claims[0].after, [])
  assert.deepEqual(result.uncovered.added, [])
  assert.deepEqual(result.uncovered.removed, [])
})

test("mock.shop still contacted on the head is contradicted", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = clone(base)
  head.github.sha = "3333333333333333333333333333333333333333"
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.claims[0].outcome, "contradicted")
  assert.equal(result.outcome, "contradicted")
})

test("mock.shop on neither side is unobservable", async () => {
  const base = await fixture("intent-sentry-head.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.claims[0].outcome, "unobservable")
  assert.equal(result.outcome, "undeterminable")
})

test("a scoped step missing on the head makes the claim undeterminable", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  head.egress = head.egress.filter((entry) => entry.step !== "14. Run E2E test")
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.claims[0].outcome, "undeterminable")
  assert.match(result.claims[0].reason, /missing from the head record/)
  assert.deepEqual(result.stepsMissing.head, ["Run E2E test"])
  assert.equal(result.outcome, "undeterminable")
})

test("an extra head-only workload destination needs explanation", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  head.egress.push({
    name: "telemetry.example.net",
    address: "203.0.113.50",
    ports: ["443"],
    pid: 250,
    ancestry: ["Runner.Worker", "node", "vitest"],
    step: "14. Run E2E test",
    result: "connect",
  })
  const claims = CLAIMS.filter((claim) => claim.id !== "no-new-outbound")
  const result = evaluateClaims({ base, head, claims, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.outcome, "needs-explanation")
  assert.deepEqual(result.uncovered.added.map((row) => row.destination), ["telemetry.example.net"])
})

test("partial capture makes every claim undeterminable", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: { status: "partial" } })
  assert.equal(result.outcome, "undeterminable")
  assert.ok(result.claims.every((claim) => claim.outcome === "undeterminable"))
})

test("no base record is undeterminable", async () => {
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({ base: null, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  assert.equal(result.outcome, "undeterminable")
  assert.equal(result.claims[0].reason, "no base record")
})

test("*.suffix destination match", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({
    base, head, capture: COMPLETE, steps: ["Run E2E test"],
    claims: ["network:*.sentry.io:present-both"],
  })
  assert.equal(result.claims[0].outcome, "supported")
})

test("aggregateIntent: contradicted beats needs-explanation; empty claims undeterminable", () => {
  assert.equal(aggregateIntent({ claims: [{ outcome: "contradicted" }], uncovered: { added: [{ step: "x" }], removed: [] } }), "contradicted")
  assert.equal(aggregateIntent({ claims: [], uncovered: { added: [], removed: [] } }), "undeterminable")
})

test("stepEntries strips the ordinal and keeps workload only", async () => {
  const base = await fixture("intent-sentry-base.json")
  const index = stepEntries(base)
  assert.deepEqual([...index.keys()].sort(), ["Install Playwright", "Run E2E test"])
  assert.deepEqual(index.get("Run E2E test").map((entry) => entry.destination).sort(), ["mock.shop", "o1.ingest.sentry.io"])
})

test("executionDiffFromProfiles scopes workload rows and emits the intent block", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const diff = executionDiffFromProfiles({
    baseline: base,
    update: head,
    meta: {
      label: "constructed",
      repository: "garnet-labs/sentry-javascript",
      prNumber: 3,
      baselineSha: base.github.sha,
      headSha: head.github.sha,
      steps: ["Run E2E test"],
      claims: CLAIMS,
      baseRunId: "36000000001",
      headRunId: "36000000002",
    },
  })
  assert.equal(diff.intent.outcome, "supported")
  assert.deepEqual(diff.execution_diff.steps, ["Run E2E test"])
  assert.equal(diff.execution_diff.network_removed.length, 1)
  assert.equal(diff.execution_diff.network_removed[0].destination, "mock.shop")
  assert.equal(diff.execution_diff.network_removed[0].step, "Run E2E test")
  assert.ok(diff.claims.some((claim) => claim.class === "intent-check-result"))
  const schema = JSON.parse(await readFile(join(ROOT, "schema", "execution-diff.schema.json"), "utf8"))
  assert.deepEqual(validate(schema, diff), [])
})

test("scoped steps drop workload rows outside the declared steps", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const unscoped = executionDiffFromProfiles({ baseline: base, update: head, meta: { label: "constructed", prNumber: 3 } })
  assert.equal(unscoped.execution_diff.network_removed.length, 1)
  const scoped = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Install Playwright"] },
  })
  assert.equal(scoped.execution_diff.network_removed.filter((row) => row.section === "workload").length, 0)
  assert.deepEqual(scoped.execution_diff.steps_missing, { base: [], head: [] })
})

const HEAD_SHA = "a".repeat(40)
const PREV_SHA = "b".repeat(40)

function boundComment(sha = HEAD_SHA) {
  return {
    user: { login: "garnet-runtime-review[bot]" },
    body: `<!-- garnet:commit ${sha} --><!-- garnet:summary {"status":"finalized","previous":"${PREV_SHA}"} -->`,
  }
}

test("the card renders the Intended behaviour section only with an intent block", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const intent = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  const model = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: HEAD_SHA, comment: boundComment(), intent })
  const card = renderCard(model)
  assert.match(card, /Intended behaviour/)
  assert.match(card, /`storefront-removed`: Expected behaviour change is present in the record/)
  const plain = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: HEAD_SHA, comment: boundComment() })
  assert.doesNotMatch(renderCard(plain), /Intended behaviour/)
})

test("a stale or head-unbound record never renders an intent section", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const intent = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  const stale = buildModel({
    slug: "sentry-javascript", forkPr: 3, headSha: HEAD_SHA,
    comment: boundComment("c".repeat(40)), intent,
  })
  assert.equal(stale.intent, null)
  assert.doesNotMatch(renderCard(stale), /Intended behaviour/)
  const unbound = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: HEAD_SHA, comment: null, intent })
  assert.equal(unbound.intent, null)
})

test("a destination moved to a scoped step on the head is added, not shared", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = clone(base)
  head.github.sha = "3333333333333333333333333333333333333333"
  head.github.run_id = "36000000003"
  const moved = head.egress.find((entry) => entry.name === "cdn.playwright.dev")
  moved.step = "14. Run E2E test"
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Run E2E test"] },
  })
  assert.deepEqual(diff.execution_diff.network_added.map((row) => row.destination), ["cdn.playwright.dev"])
  assert.equal(diff.execution_diff.network_added[0].step, "Run E2E test")
  assert.equal(diff.execution_diff.network_removed.filter((row) => row.destination === "cdn.playwright.dev").length, 0)
})

test("a process moved to a scoped step on the head is added, not shared", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = clone(base)
  head.github.sha = "3333333333333333333333333333333333333333"
  head.github.run_id = "36000000003"
  const moved = head.egress.find((entry) => entry.name === "cdn.playwright.dev")
  moved.step = "14. Run E2E test"
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Run E2E test"] },
  })
  const added = diff.execution_diff.processes_added.map((row) => row.ancestry.join(" → "))
  assert.ok(added.includes("Runner.Worker → npx → playwright"))
})

test("a claim scoped to a step outside the declared scope is undeterminable", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({
    base, head, steps: ["Run E2E test"], capture: COMPLETE,
    claims: [{ id: "out-of-scope", kind: "network", match: { destination: "cdn.playwright.dev" }, expect: "present-both", steps: ["Install Playwright"], source: "test" }],
  })
  assert.equal(result.claims[0].outcome, "undeterminable")
  assert.equal(result.claims[0].reason, 'step "Install Playwright" is outside the declared scope')
})

test("a contradicted claim does not cover its head-only destination", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  head.egress.push({
    name: "telemetry.example.net", address: "203.0.113.50", ports: ["443"], pid: 250,
    ancestry: ["Runner.Worker", "node", "vitest"], step: "14. Run E2E test", result: "connect",
  })
  const result = evaluateClaims({
    base, head, steps: ["Run E2E test"], capture: COMPLETE,
    claims: [{ id: "telemetry-kept", kind: "network", match: { destination: "telemetry.example.net" }, expect: "present-both", steps: ["Run E2E test"], source: "test" }],
  })
  assert.equal(result.claims[0].outcome, "contradicted")
  assert.deepEqual(result.uncovered.added.map((row) => row.destination), ["telemetry.example.net"])
})

test("repetition variance makes every claim undeterminable", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE, variance: 1 })
  assert.equal(result.outcome, "undeterminable")
  assert.ok(result.claims.every((claim) => claim.outcome === "undeterminable" && claim.reason === "repetitions disagree"))
})

test("a declared step missing on the base makes the whole comparison undeterminable", async () => {
  const base = await fixture("intent-sentry-base.json")
  base.egress = base.egress.filter((entry) => entry.step !== "14. Run E2E test")
  const head = await fixture("intent-sentry-head.json")
  head.egress.push({
    name: "telemetry.example.net", address: "203.0.113.50", ports: ["443"], pid: 250,
    ancestry: ["Runner.Worker", "node", "vitest"], step: "14. Run E2E test", result: "connect",
  })
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Run E2E test"] },
  })
  assert.equal(diff.verdict.value, "undeterminable")
  assert.ok(diff.verdict.reasons.some((reason) => reason.includes('step "Run E2E test" was not recorded before the change')))
  assert.ok(diff.verdict.reasons.some((reason) => reason.includes("observation, not a comparison result")))
  assert.ok(diff.execution_diff.network_added.some((row) => row.destination === "telemetry.example.net"))
})

test("a destination under both a scoped and an unscoped step yields one scoped row", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  for (const step of ["14. Run E2E test", "13. Install Playwright"]) {
    head.egress.push({
      name: "api.example", address: "203.0.113.60", ports: ["443"], pid: 260,
      ancestry: ["Runner.Worker", "node"], step, result: "connect",
    })
  }
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Run E2E test"] },
  })
  const added = diff.execution_diff.network_added.filter((row) => row.destination === "api.example")
  assert.equal(added.length, 1)
  assert.equal(added[0].step, "Run E2E test")
  assert.equal(diff.execution_diff.totals.workload.added, 1)
})

test("an ancestry seen in two scoped steps yields one process row", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  head.egress.push({
    name: "api.example", address: "203.0.113.60", ports: ["443"], pid: 261,
    ancestry: ["Runner.Worker", "node", "deploy"], step: "14. Run E2E test", result: "connect",
  })
  head.egress.push({
    name: "cdn.playwright.dev", address: "203.0.113.61", ports: ["443"], pid: 262,
    ancestry: ["Runner.Worker", "node", "deploy"], step: "13. Install Playwright", result: "connect",
  })
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["Run E2E test", "Install Playwright"] },
  })
  const added = diff.execution_diff.processes_added.filter((row) => row.ancestry.join(" → ") === "Runner.Worker → node → deploy")
  assert.equal(added.length, 1)
})

test("decideVerdict reports missing scoped steps as undeterminable", () => {
  const decision = decideVerdict({
    capture: { status: "complete", reasons: [] },
    comparisonAvailable: true,
    workloadAdded: 1,
    workloadRemoved: 0,
    stepsMissing: { base: ["Run E2E test"], head: [] },
  })
  assert.equal(decision.verdict, "undeterminable")
  assert.equal(decision.reasons[0], 'step "Run E2E test" was not recorded before the change, so the scoped comparison is not available')
  assert.match(decision.reasons.at(-1), /in the recorded steps; this is an observation, not a comparison result/)
})

test("ordinal-prefixed declared steps are equivalent to canonical names", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const result = evaluateClaims({
    base, head, capture: COMPLETE,
    claims: ["network:mock.shop:present-before-absent-after:14. Run E2E test"],
    steps: ["14. Run E2E test"],
  })
  assert.equal(result.outcome, "supported")
  assert.deepEqual(result.claims.map((claim) => claim.outcome), ["supported"])
  assert.deepEqual(result.steps, ["Run E2E test"])
  assert.deepEqual(result.stepsMissing, { base: [], head: [] })
  const diff = executionDiffFromProfiles({
    baseline: base, update: head,
    meta: { label: "constructed", prNumber: 3, steps: ["14. Run E2E test"], claims: ["network:mock.shop:present-before-absent-after:14. Run E2E test"] },
  })
  assert.deepEqual(diff.execution_diff.steps_missing, { base: [], head: [] })
  assert.equal(diff.execution_diff.network_removed.length, 1)
  assert.equal(diff.execution_diff.network_removed[0].destination, "mock.shop")
  assert.equal(diff.intent.claims[0].outcome, "supported")
})

test("declaredStepName normalizes declared step names", () => {
  assert.equal(declaredStepName("14. Run E2E test"), "Run E2E test")
  assert.equal(declaredStepName("Run E2E test"), "Run E2E test")
  assert.equal(declaredStepName("  3.  x "), "x")
  assert.equal(declaredStepName(""), null)
  assert.equal(declaredStepName(14), null)
})

test("a missing declared step renders its own card headline", async () => {
  const comment = {
    user: { login: "garnet-runtime-review[bot]" },
    body: `<!-- garnet:commit ${HEAD_SHA} --><!-- garnet:replay {"head":"${HEAD_SHA}","verdict":"undeterminable","reason":"steps-missing","capture":"complete","final":true} -->`,
  }
  const model = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: HEAD_SHA, comment })
  assert.equal(model.reason, "steps-missing")
  const card = renderCard(model)
  assert.ok(card.includes("A declared step was not recorded on both sides, so the scoped comparison is not available."))
  assert.ok(!card.includes("Capture is incomplete"))
})
