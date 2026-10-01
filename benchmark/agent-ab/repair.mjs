#!/usr/bin/env node
// Re-record submitted repairs. For each episode that rejected a recorded
// violation with a usable repair, write a prepared pair (commit 1 = the pull
// request head as reviewed, commit 2 = the repair) and publish it on the fork
// with the canonical harness. --collect then reads each finalized record and
// writes benchmark/agent-ab/repairs.json.
//   node benchmark/agent-ab/repair.mjs --model anthropic/claude-opus-5.5 [--publish] [--collect]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { ARMS, repairChange, repairVerified, truthFor } from "../../lib/agent-ab.mjs"
import { normalizeDestination } from "../../lib/ci-contacts.mjs"

const { values: args } = parseArgs({ options: {
  model: { type: "string" },
  publish: { type: "boolean", default: false },
  collect: { type: "boolean", default: false },
} })
if (typeof args.model !== "string") throw new Error("--model is required")
const fork = "garnet-labs/express"
const slug = args.model.replace("/", "__")
const short = args.model.split("/").at(-1).replace(/[^a-z0-9]+/gi, "-")
const tasks = new Map(JSON.parse(readFileSync("benchmark/agent-ab/tasks.json", "utf8")).map((t) => [t.id, t]))
const outDir = "benchmark/agent-ab/prepared-repairs"
mkdirSync(outDir, { recursive: true })
const resultsPath = "benchmark/agent-ab/repairs.json"
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")).filter((r) => r.model !== args.model) : []

function lockFor(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "repair-"))
  writeFileSync(join(dir, "package.json"), manifest)
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, stdio: "ignore" })
  const lock = readFileSync(join(dir, "package-lock.json"), "utf8")
  rmSync(dir, { recursive: true, force: true })
  return lock
}

for (const arm of ARMS) {
  const dir = join("benchmark/agent-ab/runs", slug, arm)
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir)) {
    const episode = JSON.parse(readFileSync(join(dir, file), "utf8"))
    const task = tasks.get(episode.task)
    if (task === undefined) continue
    const truth = truthFor(task.key, task.body)
    if (truth.decision !== "reject" || episode.submission?.decision !== "reject") continue
    const id = `${task.id}-${short}-${arm}`
    const change = repairChange(task, episode.submission.repair_files)
    if (change === null) {
      results.push({ model: args.model, arm, task: task.id, submitted: false, verified: false, reason: "no usable repair (nothing repairable changed, or the dependency was dropped)" })
      continue
    }
    if (change["app/package.json"] !== undefined) change["app/package-lock.json"] = lockFor(change["app/package.json"])
    const specPath = join(outDir, `${id}.json`)
    writeFileSync(specPath, `${JSON.stringify({ transition: { name: task.package.name, from: task.package.version, to: `${task.package.version} (repaired)` }, workflow: ".github/workflows/app-install.yml", baseline: task.tree, change }, null, 2)}\n`)
    const logPath = join(homedir(), "abrun", "repair-logs", `${id}.log`)
    if (args.publish && !existsSync(logPath)) {
      mkdirSync(join(homedir(), "abrun", "repair-logs"), { recursive: true })
      const work = join(homedir(), "forks", `express-${id}`)
      if (!existsSync(work)) execFileSync("git", ["clone", "-q", `https://github.com/${fork}.git`, work])
      const title = task.title
      let out
      try {
        out = String(execFileSync("node", ["bin/replay.mjs", "live", "express", "--prepared", specPath, "--work", work, "--base-branch", "app-deps",
          "--branch", `repair/${id}`, "--first-message", title, "--change-message", "fix(deps): keep the install job on the registry", "--title", title,
          "--body", task.body, "--wait-minutes", "45"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
      } catch (error) {
        out = `${error.stdout ?? ""}${error.stderr ?? ""}`
      }
      writeFileSync(logPath, out)
    }
    if (!args.collect) continue
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    const match = /fork pull request (\d+) on garnet-labs\/express/.exec(log)
    if (match === null) { results.push({ model: args.model, arm, task: task.id, submitted: true, verified: null, reason: "not recorded" }); continue }
    const url = `https://github.com/${fork}/pull/${match[1]}`
    try { execFileSync("node", ["bin/replay.mjs", "known", url], { stdio: "ignore" }) } catch {
      results.push({ model: args.model, arm, task: task.id, submitted: true, pr: url, verified: null, reason: "no finalized record" })
      continue
    }
    const replay = JSON.parse(readFileSync(`public/replays/github/${fork}/${match[1]}.json`, "utf8"))
    const workload = (side) => (replay.execution_diff?.[side] ?? []).filter((e) => e.section === "workload").map((e) => normalizeDestination(e.destination))
    const pr = JSON.parse(String(execFileSync("gh", ["api", `repos/${fork}/pulls/${match[1]}`])))
    const runs = JSON.parse(String(execFileSync("gh", ["api", `repos/${fork}/commits/${pr.head.sha}/check-runs`]))).check_runs
    const checkSucceeded = runs.length > 0 && runs.every((r) => r.status === "completed" && r.conclusion === "success")
    const removed = workload("network_removed")
    const stillContacted = truth.violating.filter((d) => !removed.includes(d))
    const verified = replay.head?.sha === pr.head.sha && repairVerified(truth.violating, { workload: stillContacted, checkSucceeded })
    results.push({ model: args.model, arm, task: task.id, submitted: true, pr: url, verified, check_succeeded: checkSucceeded,
      violating_removed: truth.violating.filter((d) => removed.includes(d)), workload_added: workload("network_added") })
  }
}
if (args.collect) {
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`)
  console.log(`${results.filter((r) => r.verified === true).length}/${results.length} repairs verified`)
}
