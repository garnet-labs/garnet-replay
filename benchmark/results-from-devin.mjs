#!/usr/bin/env node
// Scores benchmark/runs/devin/*.{control,treatment}.json into benchmark/results.md.
// judgment_changed: approve|comment|request_changes differs between arms.
// severity_changed: the highest issue severity differs between arms.
// evidence_grounded: issues whose finding cites the record (evidence_grounded: true).
// source_blind_spot: treatment raised the highest severity and its finding cites the record.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"

const RANK = { consider: 1, should_fix: 2, must_fix: 3 }
const dir = "benchmark/runs/devin"
const runs = new Map()
for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
  const run = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"))
  const arms = runs.get(run.seed) ?? {}
  arms[run.arm] = run
  runs.set(run.seed, arms)
}
const maxSeverity = (run) => Math.max(0, ...run.issues.map((i) => RANK[i.severity] ?? 0))
const sevName = (n) => Object.keys(RANK).find((k) => RANK[k] === n) ?? "none"
const grounded = (run) => run.issues.filter((i) => i.evidence_grounded === true).length

const rows = []
const totals = { seeds: 0, real: 0, constructed: 0, judgment: 0, severity: 0, groundedControl: 0, groundedTreatment: 0, blind: [] }
for (const [seed, { control, treatment }] of runs) {
  totals.seeds += 1
  totals[control.label] += 1
  const judgmentChanged = control.judgment !== treatment.judgment
  const severityChanged = maxSeverity(control) !== maxSeverity(treatment)
  if (judgmentChanged) totals.judgment += 1
  if (severityChanged) totals.severity += 1
  totals.groundedControl += grounded(control)
  totals.groundedTreatment += grounded(treatment)
  const blind = maxSeverity(treatment) > maxSeverity(control) && grounded(treatment) > 0
  if (blind) totals.blind.push(seed)
  rows.push(`| ${seed} | ${control.label} | ${control.judgment} → ${treatment.judgment} | ${sevName(maxSeverity(control))} → ${sevName(maxSeverity(treatment))} | ${judgmentChanged} | ${severityChanged} | ${grounded(control)} → ${grounded(treatment)} | ${blind ? "yes" : ""} |`)
}

const out = `# Benchmark results

Reviewer: **Devin** (this agent), both arms, one pass per seed. Not an external model run and not a human study;
the source-only (control) review for each seed was written before the seed's Execution Diff block was read, then
frozen; the treatment arm re-reviewed the same title/body/diff with the block alongside. Raw arm files:
\`benchmark/runs/devin/<seed>.{control,treatment}.json\`. Scoring: \`benchmark/results-from-devin.mjs\`.

Seeds: ${totals.seeds} (${totals.real} real, ${totals.constructed} constructed). Judgment changed: **${totals.judgment}/${totals.seeds}**.
Highest severity changed: **${totals.severity}/${totals.seeds}**. Evidence-grounded findings: ${totals.groundedControl} (control) → ${totals.groundedTreatment} (treatment).
Source-only blind spots (severity rose on a finding the diff could not supply): **${totals.blind.length}** — ${totals.blind.join(", ")}.

Honesty notes:
- The real PostHog seeds (20) all record 0 workload destinations added; the treatment arm's only effect there is to
  close open questions raised by the diff (e.g. real-164 should_fix → consider, real-140/165/182 comment → approve).
  That is a de-escalation, not a discovery.
- The one real escalation is \`real-reference-31\`: a one-line \`file:\` dependency add in garnet-labs/garnet-runtime-review-reference#31,
  kernel-recorded on its own two commits (8703692 → b639b38) in a single OIDC replay run. Source-only review could only
  ask what the tarball does; the record shows node → dash → node reaching api.ipify.org, ip-api.com and httpbin.org.
  The package is a deliberately authored demo beacon in a garnet-labs demo repo, not a third-party supply-chain incident.
- The 4 constructed seeds compare against a clean constructed install (\`constructed-pair\`), not a PR's own parent.

| seed | label | judgment (control → treatment) | highest severity | judgment_changed | severity_changed | evidence_grounded (c → t) | source blind spot |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`
writeFileSync("benchmark/results.md", out)
console.log(`scored ${totals.seeds} seeds; judgment changed ${totals.judgment}, severity changed ${totals.severity}, blind spots ${totals.blind.length}`)
