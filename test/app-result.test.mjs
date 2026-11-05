import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { appJobs, appResult, appResultLine, headBoundAppResult, parseReceipt } from "../lib/receipt.mjs"
import { buildModel, classify, renderCard } from "../lib/card.mjs"
import { VERDICTS } from "../lib/evidence.mjs"
import { decideMergeSafety, renderDecision } from "../lib/decide.mjs"

const body = (n) => readFileSync(new URL(`./fixtures/app/posthog-${n}.pr-comment.md`, import.meta.url), "utf8")
const HEAD_246 = "304f116cfbea6fc11dbd42d2130121b8808ecd87"
const HEAD_249 = "71ab5eebb5f279f0771fa2795e765ae02846f24a"

test("App result reads nothing new 0 of 6 from the 246 markers and keeps best-effort", () => {
  const app = appResult(parseReceipt(body(246)).summary, body(246))
  assert.equal(app.result, "nothing new")
  assert.equal(app.capture, "best-effort")
  assert.deepEqual([app.jobs, app.changedJobs], [6, 0])
  assert.deepEqual(app.removedJobs, ["Vendored packages / install"])
  assert.equal(app.baseline, "last 10 runs on master")
  assert.match(appResultLine(app), /^nothing new · 0 of 6 recorded jobs changed · 1 removed job \(not a change by itself\).*capture best-effort · scoped result, not complete capture$/)
  assert.ok(app.perJob.every((job) => job.outcome === "nothing new"))
  assert.equal(app.perJob.length, 6)
})

test("App result reads changed 1 of 6 with the two new hosts and the acting process from the 249 job fold", () => {
  const app = appResult(parseReceipt(body(249)).summary, body(249))
  assert.equal(app.result, "changed")
  assert.deepEqual([app.jobs, app.changedJobs], [6, 1])
  const changed = appJobs(body(249)).filter((job) => job.outcome === "changed")
  assert.deepEqual(changed, [{
    job: "Garnet Runtime Visibility / Dependency install", outcome: "changed", added: 2, process: "MainThread",
    hosts: ["2832391.fs1.hubspotusercontent-eu1[.]net", "f.hubspotusercontent40[.]net"],
  }])
})

test("a removed job alone is not a change", () => {
  const summary = { ...parseReceipt(body(246)).summary, vanished: 1, outcome: "unchanged", changed: 0 }
  assert.equal(appResult(summary, body(246)).result, "nothing new")
})

test("unfinalized, undeclared or incomplete records read capture incomplete", () => {
  const base = parseReceipt(body(249)).summary
  assert.equal(appResult({ ...base, status: "pending" }).result, "capture incomplete")
  assert.equal(appResult({ ...base, capture_quality: undefined }).result, "capture incomplete")
  assert.equal(appResult({ ...base, incomplete: 1 }).result, "capture incomplete")
  assert.equal(appResult(null), null)
})

test("card: best-effort changed is new behavior, best-effort nothing new stays scoped, never unchanged", () => {
  assert.equal(classify({ comment: { body: body(249) }, headSha: HEAD_249 }).verdict, VERDICTS.NEW_BEHAVIOR)
  const nothing = classify({ comment: { body: body(246) }, headSha: HEAD_246 })
  assert.equal(nothing.verdict, VERDICTS.UNDETERMINABLE)
  assert.equal(nothing.reason, "best-effort")
  assert.equal(classify({ comment: { body: body(246) }, headSha: HEAD_249 }).reason, "stale")
  const card = renderCard(buildModel({ slug: "posthog", forkPr: 246, headSha: HEAD_246, comment: { body: body(246) } }))
  assert.match(card, /App result: nothing new · 0 of 6 recorded jobs changed/)
  assert.match(card, /capture: best-effort \(scoped result, not complete capture\)/)
  assert.match(card, /App comparison: last 10 runs on master/)
  assert.match(card, /removed job: `Vendored packages \/ install` ran on the base branch, not on this commit; not a change by itself/)
  assert.match(card, /scope: the App's last recorded runs on the base branch → head/)
  assert.doesNotMatch(card, /\bclean\b/i)
})

test("decide renders without tripping the vocabulary guard and names the App result", () => {
  const text = renderDecision({
    decision: "undeterminable", change_class: "code", verdict: "undeterminable",
    reasons: ["capture is partial, so no comparison result on the change is available"],
    new_workload_destinations: [], removed_workload_destinations: [], runner_background: { added: 0, removed: 0 },
    capture: "partial", pair: "base 7ba2b77 → head 71ab5ee · scope pr-base-to-head · real",
    app: appResult(parseReceipt(body(249)).summary, body(249)),
  }, "https://github.com/garnet-labs/posthog/pull/249")
  assert.match(text, /App result: changed · 1 of 6 recorded jobs changed/)
})

test("a stale App comment never reaches the decision, in JSON or text", () => {
  const body = readFileSync(new URL("./fixtures/app/posthog-249.pr-comment.md", import.meta.url), "utf8")
  const summary = parseReceipt(body).summary
  const stale = headBoundAppResult({ garnet_exact_head: false, garnet_summary: summary, garnet_comment_body: body })
  assert.equal(stale, null)
  const result = { ...decideMergeSafety(null, {}), app: stale }
  assert.equal(JSON.parse(JSON.stringify(result)).app, null)
  assert.doesNotMatch(renderDecision(result, "https://github.com/garnet-labs/posthog/pull/249"), /App result/)
  assert.equal(headBoundAppResult({ garnet_exact_head: true, garnet_summary: summary, garnet_comment_body: body }).result, "changed")
})

test("observed names with contract words render in the card without tripping the guard", () => {
  const body = readFileSync(new URL("./fixtures/app/posthog-246.pr-comment.md", import.meta.url), "utf8")
    .replace("Vendored packages / install", "Vendored packages / monitoring").replace(/runs on `master`/, "runs on `monitoring`")
  const app = appResult(parseReceipt(body).summary, body)
  assert.deepEqual(app.removedJobs, ["Vendored packages / monitoring"])
  assert.equal(app.baseline, "last 10 runs on monitoring")
  const card = renderCard(buildModel({ slug: "posthog", forkPr: 246, headSha: HEAD_246, comment: { body } }))
  assert.match(card, /removed job: `Vendored packages \/ monitoring`/)
  assert.match(card, /App comparison: last 10 runs on monitoring/)
})

test("finalized complete capture with zero changes and no outcome reads nothing new", () => {
  assert.equal(appResult({ status: "finalized", capture_quality: "complete", jobs: 3, changed: 0 }).result, "nothing new")
  assert.equal(appResult({ status: "finalized", capture_quality: "best-effort", jobs: 3, changed: 0 }).result, "capture incomplete")
})
