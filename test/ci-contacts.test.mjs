import assert from "node:assert/strict"
import { test } from "node:test"

import { answerKey, buildTask, diffFromFiles, normalizeDestination, parseAnswer, renderPrompt, scoreAnswer, summarize } from "../lib/ci-contacts.mjs"

const chain = ["systemd", "hosted-compute-agent", "Runner.Listener", "Runner.Worker", "bash", "node", "dash", "node"]

function replay({ available = true, capture = "complete", added = [] } = {}) {
  return {
    base: { sha: "b".repeat(40) },
    head: { sha: "a".repeat(40) },
    comparison: { available, scope: available ? "immediate-parent-to-head" : "unavailable" },
    capture: { status: capture, expected_cells: 2, recorded_cells: 2 },
    execution_diff: { totals: { jobs_recorded: 1, destinations: 5 }, network_added: added, network_removed: [] },
  }
}

const beacon = replay({
  added: [
    { destination: "api.ipify.org", section: "workload", ancestry: chain },
    { destination: "httpbin.org", section: "workload", ancestry: chain },
    { destination: "140.82.114.24", section: "runner background", ancestry: ["systemd", "provjobd"] },
  ],
})

test("normalizeDestination strips scheme, path, port, defang and annotation", () => {
  assert.equal(normalizeDestination("https://HTTPBIN.org/get"), "httpbin.org")
  assert.equal(normalizeDestination("api.ipify.org:443"), "api.ipify.org")
  assert.equal(normalizeDestination("glb-2a3c35-public-internal.githubapp[.]com (github infra)"), "glb-2a3c35-public-internal.githubapp.com")
})

test("answerKey: new behavior, verified clean, and unsupported clean", () => {
  const k = answerKey(beacon)
  assert.equal(k.expected_verdict, "new-behavior")
  assert.deepEqual(k.workload_added, ["api.ipify.org", "httpbin.org"])
  assert.deepEqual(k.background_added, ["140.82.114.24"])
  assert.equal(answerKey(replay()).expected_verdict, "no-new-behavior")
  assert.equal(answerKey(replay({ capture: "not-declared" })).expected_verdict, "cannot-tell")
  assert.equal(answerKey(replay({ available: false })).expected_verdict, "cannot-tell")
})

test("buildTask splits visible and hidden destinations and redacts harness context", () => {
  const diff = '+    "postinstall": "curl -s https://httpbin.org/get"\n   "description": "Minimal workload for the npm top-10 X testbed.",'
  const task = buildTask({ id: "t", label: "constructed", title: "t", body: "", diff, replay: beacon, source_note: "" })
  assert.deepEqual(task.key.visible_in_diff, ["httpbin.org"])
  assert.deepEqual(task.key.hidden_from_diff, ["api.ipify.org"])
  assert.equal(task.redactions.length, 1)
  assert.ok(!task.diff.includes("top-10"))
})

test("diff track never shows the record; record track does", () => {
  const task = buildTask({ id: "t", label: "real", title: "t", body: "", diff: "+x", replay: beacon, source_note: "" })
  assert.ok(!renderPrompt(task, "diff").includes("CI execution record"))
  assert.ok(renderPrompt(task, "record").includes("api.ipify.org [workload] via bash → node → dash → node"))
  assert.throws(() => renderPrompt(task, "other"))
})

test("diffFromFiles drops replay scaffolding", () => {
  const d = diffFromFiles([{ filename: ".github/DEPENDENCY_REPLAY.md", status: "added", patch: "+x" }, { filename: "package.json", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }])
  assert.ok(!d.includes("DEPENDENCY_REPLAY"))
  assert.ok(d.includes("+++ b/package.json"))
})

test("parseAnswer tolerates fences and rejects unknown verdicts", () => {
  const a = parseAnswer('Here:\n```json\n{"new_destinations":["https://httpbin.org/get"],"verdict":"new-behavior","reason":"r"}\n```')
  assert.deepEqual(a.new_destinations, ["httpbin.org"])
  assert.equal(a.verdict, "new-behavior")
  assert.equal(parseAnswer('{"verdict":"clean"}').verdict, "invalid")
  assert.equal(parseAnswer("no json").parse_error, "no JSON object")
})

test("scoreAnswer outcomes and summarize counts", () => {
  const task = buildTask({ id: "t", label: "real", title: "t", body: "", diff: "+x", replay: beacon, source_note: "" })
  const unsupported = buildTask({ id: "u", label: "real", title: "u", body: "", diff: "+x", replay: replay({ capture: "not-declared" }), source_note: "" })
  const caught = scoreAnswer(task.key, { new_destinations: ["api.ipify.org", "140.82.114.24"], verdict: "new-behavior" })
  assert.equal(caught.outcome, "caught")
  assert.deepEqual([caught.tp, caught.fp, caught.fn, caught.background_fp, caught.hidden_named], [1, 1, 1, 1, 1])
  assert.equal(scoreAnswer(task.key, { new_destinations: [], verdict: "no-new-behavior" }).outcome, "missed_said_clean")
  const over = scoreAnswer(unsupported.key, { new_destinations: [], verdict: "no-new-behavior" })
  assert.equal(over.outcome, "overclaimed_clean")
  const s = summarize([{ task, score: caught }, { task: unsupported, score: over }])
  assert.equal(s.hidden_flagged, 1)
  assert.equal(s.overclaimed_clean, 1)
  assert.equal(s.destination_recall, 0.5)
})
