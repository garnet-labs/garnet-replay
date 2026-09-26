import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { aggregateIntent, evaluateClaims, parseClaim } from "../lib/intent.mjs"
import { executionDiffFromProfiles, stepEntries } from "../lib/profile-diff.mjs"
import { renderCard, buildModel } from "../lib/card.mjs"
import { validate } from "../lib/validate.mjs"

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

test("the card renders the Intended behaviour section only with an intent block", async () => {
  const base = await fixture("intent-sentry-base.json")
  const head = await fixture("intent-sentry-head.json")
  const intent = evaluateClaims({ base, head, claims: CLAIMS, steps: ["Run E2E test"], capture: COMPLETE })
  const model = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: null, comment: null, intent })
  const card = renderCard(model)
  assert.match(card, /Intended behaviour/)
  assert.match(card, /`storefront-removed`: Expected behaviour change is present in the record/)
  const plain = buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: null, comment: null })
  assert.doesNotMatch(renderCard(plain), /Intended behaviour/)
})
