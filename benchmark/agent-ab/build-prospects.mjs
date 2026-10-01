#!/usr/bin/env node
// Build benchmark/agent-ab/prospect-tasks.json from real upstream pull requests already
// replayed on prospect forks (benchmark/agent-ab/prospects.json). Same task shape and answer
// key as build.mjs; no repository tree, so agents see the diff, the description and npm tools.
//   node benchmark/agent-ab/build-prospects.mjs
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

import { splitFor } from "../../lib/agent-ab.mjs"
import { buildTask } from "../../lib/ci-contacts.mjs"
import { isGarnetComment, parseReceipt } from "../../lib/receipt.mjs"
import { forkEnv } from "./fork-env.mjs"

const { pulls } = JSON.parse(readFileSync("benchmark/agent-ab/prospects.json", "utf8"))
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function gh(env, ...a) {
  for (let attempt = 0; ; attempt += 1) {
    try { return String(execFileSync("gh", a, { env, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })) } catch (error) {
      if (attempt >= 4) throw error
      await pause(15000 * (attempt + 1))
    }
  }
}

const tasks = []
for (const url of pulls) {
  const [, fork, number] = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url)
  const id = `pr-${fork.split("/")[1].toLowerCase()}-${number}`
  const env = forkEnv(fork)
  try {
    execFileSync("node", ["bin/replay.mjs", "known", url], { env, stdio: "ignore" })
  } catch {
    console.log(`skipped ${id}: no finalized record on ${url}`)
    continue
  }
  const replay = JSON.parse(readFileSync(`public/replays/github/${fork}/${number}.json`, "utf8"))
  const pr = JSON.parse(await gh(env, "api", `repos/${fork}/pulls/${number}`))
  if (replay.head?.sha !== pr.head.sha) { console.log(`skipped ${id}: record not bound to head ${pr.head.sha}`); continue }
  const diff = (await gh(env, "api", `repos/${fork}/pulls/${number}`, "-H", "Accept: application/vnd.github.diff")).trimEnd()
  const comment = JSON.parse(await gh(env, "api", `repos/${fork}/issues/${number}/comments?per_page=100`)).filter((c) => isGarnetComment(c)).at(-1)?.body ?? null
  const parsed = comment === null ? null : parseReceipt(comment)
  const task = buildTask({
    id, label: "real", title: pr.title, body: (pr.body ?? "").replace(/\n*<!--[\s\S]*?-->\s*$/g, "").trim(), diff, replay,
    source_note: `real upstream pull request replayed on ${url}`,
  })
  tasks.push({ ...task, split: splitFor(id), cohort: "prospect", pr: url, head_sha: pr.head.sha, garnet_comment: comment,
    receipt: parsed === null ? null : { permalink: parsed.permalink, runId: parsed.runId, profileId: parsed.profileId } })
  await pause(3000)
}
writeFileSync("benchmark/agent-ab/prospect-tasks.json", `${JSON.stringify(tasks, null, 2)}\n`)
console.log(`wrote ${tasks.length} prospect tasks; workload destinations added on ${tasks.filter((t) => t.key.workload_added.length > 0).length}`)
