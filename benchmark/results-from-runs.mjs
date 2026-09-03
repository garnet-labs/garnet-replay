#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises"

const files = (await readdir("benchmark/runs", { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.startsWith("pr") && entry.name.endsWith(".json"))
const runs = new Map()
for (const entry of files) {
  const run = JSON.parse(await readFile(`benchmark/runs/${entry.name}`, "utf8"))
  const key = String(run.pr_number)
  const arms = runs.get(key) ?? {}
  arms[run.arm] = run
  runs.set(key, arms)
}
const rows = [
  "# Benchmark results",
  "",
  "| seed | label | arm | judgment_changed | severity_changed | evidence_grounded_findings |",
  "|---|---|---|---|---|---|",
]
for (const [seed, arms] of runs) {
  const control = arms.control
  const treatment = arms.treatment
  const judgmentChanged = control && treatment
    ? String(JSON.stringify(control.issues) !== JSON.stringify(treatment.issues))
    : "not run"
  const severityChanged = control && treatment
    ? String(JSON.stringify(control.verdicts) !== JSON.stringify(treatment.verdicts))
    : "not run"
  for (const arm of ["control", "treatment"]) {
    const run = arms[arm]
    const grounded = run
      ? String(run.issues.filter((issue) => /garnet|runtime evidence|recorded network|execution chain|receipt_id/i.test(JSON.stringify(issue))).length)
      : "not run"
    rows.push(`| ${seed} | real | ${arm} | ${judgmentChanged} | ${severityChanged} | ${grounded} |`)
  }
}
await writeFile("benchmark/results.md", `${rows.join("\n")}\n`)
