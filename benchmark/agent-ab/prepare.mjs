#!/usr/bin/env node
// Write one prepared two-state input per corpus package (docs/prepared.md):
// commit 1 = minimal app with the base dependencies, commit 2 = the same app with
// one real npm package added. Lockfiles are resolved with --ignore-scripts.
// Usage: node benchmark/agent-ab/prepare.mjs [--only id,..]
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { corpusTasks, recordingWorkflow, smokeScript } from "../../lib/agent-ab.mjs"

const { values: args } = parseArgs({ options: { only: { type: "string" } } })
const corpus = JSON.parse(readFileSync("benchmark/agent-ab/corpus.json", "utf8"))
const only = args.only === undefined ? null : new Set(args.only.split(","))
const outDir = "benchmark/agent-ab/prepared"
mkdirSync(outDir, { recursive: true })

/** package.json + package-lock.json for a dependency set, resolved without running scripts. */
function appFiles(dependencies) {
  const dir = mkdtempSync(join(tmpdir(), "app-"))
  const manifest = `${JSON.stringify({ name: "app", version: "1.0.0", private: true, type: "module", scripts: { smoke: "node smoke.mjs" }, dependencies }, null, 2)}\n`
  writeFileSync(join(dir, "package.json"), manifest)
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, stdio: "ignore" })
  const lock = readFileSync(join(dir, "package-lock.json"), "utf8")
  rmSync(dir, { recursive: true, force: true })
  return { "app/package.json": manifest, "app/package-lock.json": lock }
}

const base = appFiles(corpus.base_dependencies)
for (const task of corpusTasks(corpus)) {
  if (only !== null && !only.has(task.id)) continue
  const head = appFiles({ ...corpus.base_dependencies, [task.name]: task.version })
  const spec = {
    transition: { name: task.name, from: "absent", to: task.version },
    workflow: ".github/workflows/app-install.yml",
    baseline: { ".github/workflows/app-install.yml": recordingWorkflow(), "app/smoke.mjs": smokeScript(), ...base },
    change: head,
  }
  writeFileSync(join(outDir, `${task.id}.json`), `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`${task.id}: ${task.name}@${task.version}`)
}
