#!/usr/bin/env node
// Score benchmark/agent-ab/runs against the recorded answer keys; every arm is
// compared with control on the tasks both ran.
//   node benchmark/agent-ab/score.mjs [--split dev|heldout|ci-contacts|all] [--cohort baseline,ai-infra,prospect] [--repairs benchmark/agent-ab/repairs.json] [--admit-undeclared]
// Without --admit-undeclared an accept key needs declared complete capture, as in
// the CI Contacts answer key; with it, observed-clean records count as accepts.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { ARMS, consumptionFor, scoreReview, signTest, summarizeArm, truthFor, wilson } from "../../lib/agent-ab.mjs"
import { normalizeDestination } from "../../lib/ci-contacts.mjs"
import { classifyUtterance } from "../../lib/consume.mjs"

const { values: args } = parseArgs({ options: {
  split: { type: "string", default: "all" },
  cohort: { type: "string" },
  repairs: { type: "string", default: "benchmark/agent-ab/repairs.json" },
  "admit-undeclared": { type: "boolean", default: false },
} })
const truthOf = (task) => {
  const truth = truthFor(task.key, task.body)
  return truth.decision === "accept" && task.key.capture !== "complete" && !args["admit-undeclared"] ? { ...truth, decision: "undeterminable" } : truth
}
const cohorts = args.cohort === undefined ? null : new Set(args.cohort.split(","))
const tasks = ["benchmark/agent-ab/tasks.json", "benchmark/agent-ab/prospect-tasks.json", "benchmark/ci-contacts/tasks.json"].filter(existsSync)
  .flatMap((f) => JSON.parse(readFileSync(f, "utf8")).map((t) => ({ ...t, split: t.split ?? "ci-contacts", cohort: t.cohort ?? "baseline" })))
  .filter((t) => args.split === "all" || t.split === args.split)
  .filter((t) => cohorts === null || cohorts.has(t.cohort))
const byId = new Map(tasks.map((t) => [t.id, t]))
const repairs = existsSync(args.repairs) ? JSON.parse(readFileSync(args.repairs, "utf8")) : []
const root = "benchmark/agent-ab/runs"
const pct = (k, n) => (n === 0 ? "–" : `${k}/${n} (${Math.round((100 * k) / n)}%)`)
const ci = (k, n) => { const w = wilson(k, n); return w === null ? "" : ` [${Math.round(w[0] * 100)}–${Math.round(w[1] * 100)}]` }
const num = (x, d = 1) => (x === null ? "unknown" : x.toFixed(d))
const deps = { classify: classifyUtterance, normalize: normalizeDestination }

for (const model of existsSync(root) ? readdirSync(root).sort() : []) {
  const rows = {}
  for (const arm of ARMS) {
    const dir = join(root, model, arm)
    rows[arm] = new Map((existsSync(dir) ? readdirSync(dir) : []).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
      .filter((e) => byId.has(e.task))
      .map((episode) => {
        const task = byId.get(episode.task)
        const truth = truthOf(task)
        return [task.id, { task, episode, truth, score: scoreReview(truth, episode.submission, normalizeDestination), consumption: consumptionFor(task, episode.submission, deps) }]
      }))
  }
  const arms = ARMS.filter((arm) => rows[arm].size > 0)
  const shared = [...rows.control.keys()].filter((id) => arms.every((arm) => rows[arm].has(id)))
  const s = Object.fromEntries(arms.map((arm) => [arm, summarizeArm(shared.map((id) => rows[arm].get(id)))]))
  console.log(`\n## ${model.replace("__", "/")} · split ${args.split} · ${shared.length} tasks run in every arm (${arms.join(", ")})\n`)
  console.log(`| metric | ${arms.join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|`)
  const line = (name, f) => console.log(`| ${name} | ${arms.map((arm) => f(s[arm], arm)).join(" | ")} |`)
  line("false accepts (accepted a recorded violation)", (x) => pct(x.false_accepts, x.violations) + ci(x.false_accepts, x.violations))
  line("false rejects (rejected an observed-clean change)", (x) => pct(x.false_rejects, x.clean) + ci(x.false_rejects, x.clean))
  line("decision correct", (x) => pct(x.decision_correct, x.decided) + ci(x.decision_correct, x.decided))
  line("diagnosis exact (decision + exact violating hosts)", (x) => pct(x.diagnosis_correct, x.decided) + ci(x.diagnosis_correct, x.decided))
  line("mean turns", (x) => num(x.mean_turns))
  line("mean tool calls", (x) => num(x.mean_tool_calls))
  line("mean input / output tokens", (x) => `${num(x.mean_input_tokens, 0)} / ${num(x.mean_output_tokens, 0)}`)
  line("invalid / no submission", (x) => String(x.invalid))
  const consumed = (arm, f) => shared.filter((id) => f(rows[arm].get(id))).length
  line("record pulled (tool arm)", (_, arm) => (arm === "tool" ? pct(consumed(arm, (r) => r.episode.record_read), shared.length) : "–"))
  line("head-bound grounding (utterance/citation)", (_, arm) => pct(consumed(arm, (r) => r.consumption.head_bound), shared.length))
  line("runner background blamed on the change", (_, arm) => pct(consumed(arm, (r) => r.consumption.background_misattributed.length > 0), shared.length))
  for (const arm of arms.filter((a) => a !== "control")) {
    const pair = (f) => {
      let b = 0
      let c = 0
      for (const id of shared) {
        const ctl = f(rows.control.get(id))
        const trt = f(rows[arm].get(id))
        if (ctl === null || trt === null) continue
        if (ctl && !trt) b += 1
        if (!ctl && trt) c += 1
      }
      return `${b} control-only vs ${c} ${arm}-only, sign test p=${signTest(b, c).toFixed(3)}`
    }
    console.log(`\n${arm} vs control · decision: ${pair((r) => r.score.decision_correct)} · diagnosis: ${pair((r) => r.score.diagnosis_correct)}`)
  }
  for (const arm of arms) {
    const attempted = repairs.filter((r) => r.model === model.replace("__", "/") && r.arm === arm)
    if (attempted.length === 0) continue
    const ok = attempted.filter((r) => r.verified === true).length
    console.log(`repairs verified by re-recording (${arm}): ${pct(ok, attempted.length)} of rejects on recorded violations`)
  }
}
