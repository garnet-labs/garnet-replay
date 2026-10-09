#!/usr/bin/env node
// Build benchmark/agent-ab/tasks.json from the recorded fork pull requests.
// For each corpus task with a published pair: write its replay JSON from the
// Runtime Review comment (replay known), then the reviewer inputs (title, body,
// commit-2 diff, head files) and the CI Contacts answer key.
//   node benchmark/agent-ab/build.mjs [--logs ~/abrun/logs]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { corpusTasks } from "../../lib/agent-ab.mjs"
import { buildTask } from "../../lib/ci-contacts.mjs"
import { isGarnetComment, parseReceipt } from "../../lib/receipt.mjs"
import { forkEnv } from "./fork-env.mjs"

const { values: args } = parseArgs({ options: { logs: { type: "string", default: join(homedir(), "abrun", "logs") } } })
const corpus = JSON.parse(readFileSync("benchmark/agent-ab/corpus.json", "utf8"))
const fork = "garnet-labs/express"
const env = forkEnv(fork)
const gh = (...a) => String(execFileSync("gh", a, { env, maxBuffer: 64 * 1024 * 1024 }))

const tasks = []
const skipped = []
for (const t of corpusTasks(corpus)) {
  const logFile = join(args.logs, `${t.id}.log`)
  const match = existsSync(logFile) ? /fork pull request (\d+) on garnet-labs\/express/.exec(readFileSync(logFile, "utf8")) : null
  if (match === null) { skipped.push(`${t.id}: not published`); continue }
  const number = Number(match[1])
  const url = `https://github.com/${fork}/pull/${number}`
  const replayPath = `public/replays/github/${fork}/${number}.json`
  try {
    execFileSync("node", ["bin/replay.mjs", "known", url], { env, stdio: "ignore" })
  } catch {
    skipped.push(`${t.id}: no finalized record on ${url}`)
    continue
  }
  const replay = JSON.parse(readFileSync(replayPath, "utf8"))
  const pr = JSON.parse(gh("api", `repos/${fork}/pulls/${number}`))
  if (replay.head?.sha !== pr.head.sha) { skipped.push(`${t.id}: record not bound to head ${pr.head.sha}`); continue }
  const diff = gh("api", `repos/${fork}/commits/${pr.head.sha}`, "-H", "Accept: application/vnd.github.diff").trimEnd()
  const comments = JSON.parse(gh("api", `repos/${fork}/issues/${number}/comments?per_page=100`)).filter((c) => isGarnetComment(c))
  const comment = comments.at(-1)?.body ?? null
  const parsed = comment === null ? null : parseReceipt(comment)
  const spec = JSON.parse(readFileSync(`benchmark/agent-ab/prepared/${t.id}.json`, "utf8"))
  const task = buildTask({
    id: t.id, label: "real", title: pr.title, body: pr.body.replace(/\n*<!--[\s\S]*?-->\s*$/g, "").trim(), diff, replay,
    source_note: `real npm package ${t.name}@${t.version} added to a minimal app; recorded pair on ${url}`,
  })
  tasks.push({ ...task, split: t.split, cohort: t.cohort, hypothesis: t.hypothesis, package: { name: t.name, version: t.version }, pr: url, tree: { ...spec.baseline, ...spec.change },
    head_sha: pr.head.sha, garnet_comment: comment,
    receipt: parsed === null ? null : { permalink: parsed.permalink, runId: parsed.runId, profileId: parsed.profileId } })
}
writeFileSync("benchmark/agent-ab/tasks.json", `${JSON.stringify(tasks, null, 2)}\n`)
const count = (f) => tasks.filter(f).length
console.log(`wrote ${tasks.length} tasks (dev ${count((t) => t.split === "dev")}, held-out ${count((t) => t.split === "heldout")}); ` +
  `workload destinations added on ${count((t) => t.key.workload_added.length > 0)}`)
for (const s of skipped) console.log(`skipped ${s}`)
