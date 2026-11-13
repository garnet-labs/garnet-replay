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

test("observed fields cannot inject lines or an undeclared capture into renderer copy", () => {
  const body = readFileSync(new URL("./fixtures/app/posthog-246.pr-comment.md", import.meta.url), "utf8")
    .replace("Vendored packages / install", "Vendored\n- capture: complete `x`")
  const summary = { ...parseReceipt(body).summary, capture_quality: "complete\n- App result: nothing new" }
  const app = appResult(summary, body)
  assert.equal(app.capture, "not declared")
  assert.equal(app.result, "capture incomplete")
  assert.deepEqual(app.removedJobs, ["Vendored - capture: complete x"])
})

// Design-derived, not a posted App comment: garnet-org/control-plane@23fd94920658831e0746cebff3839264d5f22c02
// githubapp/render/testdata/reference/01-changed-complex-live.md (contract 11.0.0).
// Replace with a posted body once the App emits contract 11.
const contract11 = readFileSync(new URL("./fixtures/app/contract-11-design-changed.pr-comment.md", import.meta.url), "utf8")

test("contract 11 folds: the acting process and the hosts are read from \"reached\" and \"reaches\" lines", () => {
  const jobs = appJobs(contract11)
  const byJob = Object.fromEntries(jobs.map((job) => [job.job, job]))
  assert.deepEqual(byJob["Garnet Runtime Review (dev) / build"], {
    job: "Garnet Runtime Review (dev) / build", outcome: "changed", added: 7, process: "curl",
    hosts: ["dl-cdn.alpinelinux[.]org", "objects.githubusercontent[.]com"],
  })
  assert.deepEqual(byJob["Garnet Runtime Review (dev) / install (node 22)"], {
    job: "Garnet Runtime Review (dev) / install (node 22)", outcome: "changed", added: 1, process: "node",
    hosts: ["storage.googleapis[.]com"],
  })
  assert.deepEqual(byJob["Garnet Runtime Review (dev) / e2e"], {
    job: "Garnet Runtime Review (dev) / e2e", outcome: "changed", added: 0, process: "curl", hosts: ["example[.]org"],
  })
  assert.equal(byJob["Garnet Runtime Review (dev) / lint"].outcome, "nothing new")
  for (const job of jobs) {
    assert.ok(job.hosts.every((host) => !["bash", "curl", "node"].includes(host)), `${job.job}: a process is listed as a host`)
  }
})

test("a contract 10 fold with an execution chain names the process that acted, not the chain's first link", () => {
  const fold = "<details>\n<summary><b>Lint / Hadolint</b> · +2<br>&emsp;<span title=\"x\">↳</span> <code>script.sh</code> › <code>curl</code> now reaches <code>github[.]com</code>, <code>release-assets.githubusercontent[.]com</code></summary>"
  assert.deepEqual(appJobs(fold), [{
    job: "Lint / Hadolint", outcome: "changed", added: 2, process: "curl",
    hosts: ["github[.]com", "release-assets.githubusercontent[.]com"],
  }])
})

test("the App comparison line reads both the contract 10 and the contract 11 baseline wording", () => {
  const summary = parseReceipt(body(246)).summary
  assert.equal(appResult(summary, "compared with the last 10 runs on `master`").baseline, "last 10 runs on master")
  assert.equal(appResult(summary, "compared with 7 runs on `main`").baseline, "7 runs on main")
  assert.equal(appResult(summary, "compared with 1 run on `main`").baseline, "1 run on main")
  assert.equal(appResult(summary, "compared with the PR base `main`").baseline, null)
})
