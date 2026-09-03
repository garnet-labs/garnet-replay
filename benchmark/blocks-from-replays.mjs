#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"

import { renderExecutionDiffText } from "../lib/execution-diff.mjs"

const seeds = JSON.parse(await readFile("seeds/seeds.json", "utf8"))
const blocks = {}
for (const seed of seeds) {
  const path = seed.replay_json.replace(/^\/?replays\//, "public/replays/")
  const diff = JSON.parse(await readFile(path, "utf8"))
  const key = seed.label === "real" ? seed.id.replace(/^real-/, "") : seed.id
  blocks[key] = {
    block: {
      source: "Garnet Runtime Review (kernel-recorded CI runtime evidence)",
      contract: diff.recorded.contract,
      receipt_id: diff.head.profile_id,
      head_sha: diff.head.sha,
      compared_sha: diff.base.sha,
      comparison: diff.comparison.available ? "available" : "unavailable",
      recorded_at: diff.recorded.at,
      jobs_recorded: diff.execution_diff.totals.jobs_recorded,
      workload: {
        jobs_changed: diff.execution_diff.totals.jobs_changed,
        jobs_unchanged: diff.execution_diff.totals.jobs_unchanged,
        destinations_added: diff.execution_diff.totals.workload.added,
        destinations_removed: diff.execution_diff.totals.workload.removed,
      },
      runner_background: diff.execution_diff.totals.runner_background,
      network_evidence: {
        recorded: diff.execution_diff.kinds_recorded.includes("network"),
        execution_chains: diff.execution_diff.totals.execution_chains,
        destinations: diff.execution_diff.totals.destinations,
        added: diff.execution_diff.network_added,
        removed: diff.execution_diff.network_removed,
      },
      process_evidence: {
        recorded: diff.execution_diff.kinds_recorded.includes("process"),
        note: "processes appear as the execution chains behind each recorded action",
      },
      file_evidence: {
        recorded: diff.execution_diff.kinds_recorded.includes("file"),
        note: diff.execution_diff.kinds_recorded.includes("file") ? "file evidence recorded" : "no file evidence recorded for this run",
      },
      deterministic_detections: [],
      detections_note: "none recorded",
      drill_down: "call the read-only garnet_drilldown tool to read the full recorded evidence for this head",
    },
    rendered: renderExecutionDiffText(diff),
  }
}
await writeFile("benchmark/blocks.json", `${JSON.stringify(blocks, null, 2)}\n`)
console.log(`wrote benchmark/blocks.json for ${seeds.length} seeds`)
