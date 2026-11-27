import { readFile, writeFile } from "node:fs/promises"
import { parseVersionTransition, transitionPhrase } from "../../lib/observe.mjs"
import { recordValueMetrics } from "../../lib/record-value.mjs"
import { scoreRecordValueRow, scorer } from "./score.mjs"

const dir = "out/record-value"
const judgeModel = process.env.RECORD_VALUE_JUDGE ?? "openai/gpt-4.1-mini"
const key = process.env.AI_GATEWAY_API_KEY
if (!key) throw new Error("AI_GATEWAY_API_KEY is required for the independent judge")

const cohort = JSON.parse(await readFile(`${dir}/rows.json`, "utf8"))
const health = await (await fetch(`${scorer}/health`, { signal: AbortSignal.timeout(10_000) })).json()
if (health.status !== "ready" || health.model !== "jevos-v5") throw new Error("Local jevos-v5 is not ready")

const paired = []
const incomplete = []
const queue = [...cohort.included]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length > 0) {
    const row = queue.shift()
    const { url, source, group, headSha, comparedSha, appUrl, capture, scope } = row
    const version = parseVersionTransition(row.title)
    const transition = version === null ? null : `${version.name} ${transitionPhrase(version)} (PR title)`
    const identity = { url, source, group, headSha, comparedSha, appUrl, capture, scope, transition }
    const { pair, failure } = await scoreRecordValueRow(row, identity, { judgeModel, key })
    if (pair !== undefined) paired.push(pair)
    else incomplete.push(failure)
    const count = paired.length + incomplete.length
    if (count % 10 === 0) console.log(`scored ${count}/${cohort.included.length}: ${paired.length} complete pairs`)
  }
}))
const orderRows = rows => rows.sort((a, b) => a.url.localeCompare(b.url, "en"))
orderRows(paired)
orderRows(incomplete)
const sources = [...new Set(cohort.included.map(x => x.source).concat("Nov 20 PostHog shadow mirrors", "Nov 24–29"))].sort()
const metrics = Object.fromEntries([["All sources", recordValueMetrics(paired)],
  ...sources.map(source => [source, recordValueMetrics(paired.filter(row => row.source === source))])])
const format = n => n.toFixed(3)
const cell = value => (value ?? "Not stated").replaceAll("|", "\\|")
const metricLine = ([source, metric]) => metric === null ? `| ${source} | 0 | — | — | — | — | — |`
  : `| ${source} | ${metric.pairs} (${metric.groups} changes) | ${format(metric.meanYes.source)} | ${format(metric.meanYes.record)} | ${metric.flips} | ${format(metric.meanJudgeDelta)} | ${metric.judgeDelta95?.map(format).join(" to ") ?? "—"} |`
const report = [
  "# What the record adds to review", "",
  `Snapshot: ${cohort.cutoff}. Scorer: **jevos-v5** (local, fingerprint \`${health.fingerprint}\`); independent judge: \`${judgeModel}\`.`, "",
  `Inspected ${cohort.candidates} PRs from the org-wide App-author search and replay ledgers: ${cohort.ineligible} lacked a positive eligible workload change, ${cohort.incomplete.length} were incomplete during collection, and ${cohort.included.length} qualified. ${incomplete.length} qualified rows lack a complete model pair.`, "",
  "| Source | Paired PRs | P(yes), source | P(yes), with record | Flips at 0.5 | Judge delta (0–3) | 95% cluster bootstrap interval |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(metrics).map(metricLine), "",
  "Positive judge delta means the record-assisted input was more useful. P(yes) measures whether the diff explains the behavior, not accuracy; a decrease may be appropriate. This is a model-scored, changed-only study, not evidence of improved approval accuracy. Neither arm ran PR code.", "",
  "[PostHog #276](https://github.com/garnet-labs/posthog/pull/276) and [#277](https://github.com/garnet-labs/posthog/pull/277) are variants of one upstream change and use the same cluster when admitted. The Nov 24–29 row is a partial, as-of snapshot, not the planned 30 PRs + 20 reruns.", "",
  "| PR | Source | Record | Compared → head commits | Scope | Version transition | P(yes): source → record | Judge: source → record | Omitted diff characters |",
  "|---|---|---|---|---|---|---:|---:|---:|",
  ...paired.map(row => `| [${new URL(row.url).pathname.slice(1).replace("/pull/", "#")}](${row.url}) | ${row.source} | [${row.capture}](${row.appUrl}) | \`${row.comparedSha}\` → \`${row.headSha}\` | ${cell(row.scope)} | ${cell(row.transition ?? "Not derivable from PR title")} | ${format(row.probabilities.source)} → ${format(row.probabilities.record)} | ${row.judge.source} → ${row.judge.record} | ${row.omitted.diff} |`),
  "", "Collection exclusions and model failures are in the generated `rows.json` and `results.json` with evidence URLs. A missing record or unusable comparison is incomplete, not clean.", "",
]
await writeFile(`${dir}/results.json`, JSON.stringify({
  scorer: health.model, fingerprint: health.fingerprint, judgeModel, metrics, paired, incomplete,
}, null, 2) + "\n")
await writeFile(`${dir}/report.md`, report.join("\n"))
console.log(`wrote ${dir}/results.json and report.md: ${paired.length} complete pairs, ${incomplete.length} incomplete`)
if (incomplete.length > 0) process.exitCode = 1
