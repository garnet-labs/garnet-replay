import assert from "node:assert/strict"
import { test } from "node:test"

import { agentMessages, consumptionFor, corpusTasks, EVIDENCE_BEGIN, repairChange, repairVerified, recordingWorkflow, scoreReview, signTest, splitFor, summarizeArm, taskId, toolSpecs, truthFor, wilson } from "../lib/agent-ab.mjs"
import { normalizeDestination } from "../lib/ci-contacts.mjs"
import { classifyUtterance } from "../lib/consume.mjs"

const key = (over = {}) => ({ comparison: true, capture: "not-declared", workload_added: [], expected_verdict: "cannot-tell", ...over })

test("taskId and split are deterministic", () => {
  assert.equal(taskId("@sentry/cli"), "npm-sentry-cli")
  assert.equal(splitFor("npm-lodash"), splitFor("npm-lodash"))
  const tasks = corpusTasks({ packages: [["lodash", "4.17.21", "none"], ["@sentry/cli", "2.39.1", "download"]] })
  assert.deepEqual(tasks.map((t) => t.id), ["npm-lodash", "npm-sentry-cli"])
  assert.ok(tasks.every((t) => t.split === "dev" || t.split === "heldout"))
  assert.deepEqual(corpusTasks({ packages: [["ai", "7.0.111", "none", "ai-infra"], ["lodash", "4.17.21", "none"]] }).map((t) => t.cohort), ["ai-infra", "baseline"])
})

test("arms differ only in how the record reaches the agent", () => {
  const names = (arm) => toolSpecs(arm, { hasTree: true }).map((t) => t.function.name)
  for (const arm of ["control", "mirror", "guided"]) assert.ok(!names(arm).includes("garnet_record"))
  assert.deepEqual(names("tool").filter((n) => !names("control").includes(n)), ["garnet_record"])
  const task = { title: "t", body: "Adds x.", diff: "d", record: "rendered", garnet_comment: "<!-- garnet:commit abc -->\nverbatim" }
  const user = (arm, o) => agentMessages(task, arm, o)[1].content
  assert.equal(user("control"), user("tool"))
  assert.doesNotMatch(user("control"), /garnet/i)
  assert.ok(user("mirror").includes(`${EVIDENCE_BEGIN}\n<!-- garnet:commit abc -->\nverbatim`))
  assert.equal(user("mirror"), user("guided", { guideline: "G" }))
  assert.equal(agentMessages(task, "mirror", { guideline: "G" })[0].content, agentMessages(task, "control")[0].content)
  assert.match(agentMessages(task, "guided", { guideline: "G" })[0].content, /\n\nG$/)
  assert.throws(() => agentMessages(task, "treatment"))
})

test("consumption receipts reuse the replay consume classifier", () => {
  const head = "a".repeat(40)
  const task = { head_sha: head, receipt: null, key: { workload_added: ["storage.googleapis.com"], background_added: ["140.82.114.24"] } }
  const deps = { classify: classifyUtterance, normalize: normalizeDestination }
  const grounded = consumptionFor(task, { reason: `Runtime evidence (Garnet, head ${head.slice(0, 7)}): node contacted storage.googleapis.com`, new_destinations: ["140.82.114.24"] }, deps)
  assert.equal(grounded.tier, "utterance")
  assert.equal(grounded.head_bound, true)
  assert.deepEqual(grounded.background_misattributed, ["140.82.114.24"])
  assert.equal(consumptionFor(task, { reason: "postinstall downloads Chrome" }, deps).tier, "none")
  assert.equal(consumptionFor(task, null, deps).tier, "none")
})

test("repairs must keep the dependency and touch only repairable files", () => {
  const manifest = (deps) => JSON.stringify({ dependencies: deps })
  const task = { package: { name: "puppeteer", version: "23.11.1" }, tree: { "app/package.json": manifest({ ms: "2.1.3", puppeteer: "23.11.1" }) } }
  const kept = manifest({ ms: "2.1.3", puppeteer: "23.11.1" }).replace("}}", "},\"puppeteer\":{\"skipDownload\":true}}")
  assert.deepEqual(Object.keys(repairChange(task, { "./app/package.json": kept })), ["app/package.json"])
  assert.equal(repairChange(task, { "app/package.json": manifest({ ms: "2.1.3" }) }), null)
  assert.equal(repairChange(task, { ".github/workflows/app-install.yml": "x" }), null)
  assert.equal(repairChange(task, {}), null)
  assert.equal(repairVerified(["storage.googleapis.com"], { workload: [], checkSucceeded: true }), true)
  assert.equal(repairVerified(["storage.googleapis.com"], { workload: ["storage.googleapis.com"], checkSucceeded: true }), false)
  assert.equal(repairVerified(["storage.googleapis.com"], { workload: [], checkSucceeded: false }), false)
})

test("recording workflow is OIDC-only and pinned", () => {
  const yml = recordingWorkflow()
  assert.match(yml, /id-token: write/)
  assert.doesNotMatch(yml, /api_token|secrets\./)
  assert.match(yml, /garnet-org\/action@[0-9a-f]{40}/)
})

test("truth: undisclosed workload host rejects, disclosed or absent accepts, no comparison is undeterminable", () => {
  assert.deepEqual(truthFor(key({ workload_added: ["storage.googleapis.com"] })).decision, "reject")
  assert.equal(truthFor(key({ workload_added: ["storage.googleapis.com"] }), "Downloads Chrome from storage.googleapis.com").decision, "accept")
  assert.equal(truthFor(key({ workload_added: ["registry.npmjs.org"] })).decision, "accept")
  assert.equal(truthFor(key()).basis, "observed; capture not declared")
  assert.equal(truthFor(key({ comparison: false })).decision, "undeterminable")
})

test("scoreReview counts false accepts and exact diagnosis", () => {
  const truth = truthFor(key({ workload_added: ["storage.googleapis.com"] }))
  const accept = scoreReview(truth, { decision: "accept", new_destinations: [] }, normalizeDestination)
  assert.equal(accept.false_accept, true)
  const exact = scoreReview(truth, { decision: "reject", new_destinations: ["https://storage.googleapis.com/chrome"] }, normalizeDestination)
  assert.equal(exact.diagnosis_correct, true)
  const extra = scoreReview(truth, { decision: "reject", new_destinations: ["storage.googleapis.com", "github.com"] }, normalizeDestination)
  assert.equal(extra.decision_correct, true)
  assert.equal(extra.diagnosis_correct, false)
  const none = scoreReview(truth, null, normalizeDestination)
  assert.equal(none.valid, false)
  assert.equal(none.false_accept, true)
  const clean = scoreReview(truthFor(key()), { decision: "reject", new_destinations: ["x.example"] }, normalizeDestination)
  assert.equal(clean.false_reject, true)
})

test("summaries keep unknown token usage unknown", () => {
  const truth = truthFor(key({ workload_added: ["a.example"] }))
  const row = (usage) => ({ truth, score: scoreReview(truth, { decision: "accept" }, normalizeDestination), episode: { turns: 2, tool_calls: 1, usage } })
  assert.equal(summarizeArm([row({ input_tokens: 10, output_tokens: 5 })]).mean_input_tokens, 10)
  const unknown = summarizeArm([row({ input_tokens: 10, output_tokens: 5 }), row({ input_tokens: null, output_tokens: null })])
  assert.equal(unknown.mean_input_tokens, null)
  assert.equal(unknown.false_accepts, 2)
})

test("wilson and sign test", () => {
  assert.equal(wilson(0, 0), null)
  const [lo, hi] = wilson(5, 10)
  assert.ok(lo < 0.5 && hi > 0.5)
  assert.equal(signTest(0, 0), 1)
  assert.ok(Math.abs(signTest(0, 6) - 0.03125) < 1e-9)
})
