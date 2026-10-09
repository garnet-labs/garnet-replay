#!/usr/bin/env node
/** GitHub Actions entry for hosted replay jobs: one canonical prepare or start, reported as out/hosted-job/job.json. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSlug } from "../lib/guards.mjs"
import { executeReplayJob } from "../lib/replay-runner-worker.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const directory = join(ROOT, "out", "hosted-job")
const path = join(directory, "job.json")
const { REPLAY_ACTION: action, REPLAY_SLUG: slug, REPLAY_NUMBER: number, REPLAY_PLAN_FILE: planFile } = process.env

const job = { action, slug, number: Number(number), state: action === "prepare" ? "preparing" : "recording", lines: [] }
const write = () => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${path}.next`, `${JSON.stringify(job, null, 2)}\n`)
  renameSync(`${path}.next`, path)
}

try {
  if (action !== "prepare" && action !== "start") throw new Error("The replay action must be prepare or start.")
  assertSlug(slug)
  if (!/^[1-9]\d*$/.test(number ?? "")) throw new Error("The pull request number is invalid.")
  let signature
  if (action === "start") {
    const prepared = JSON.parse(readFileSync(planFile, "utf8"))
    if (prepared.state !== "prepared" || prepared.slug !== slug || prepared.number !== job.number || !/^[0-9a-f]{64}$/.test(prepared.signature ?? "")) {
      throw new Error("The prepared plan does not match this replay. Prepare it again.")
    }
    signature = prepared.signature
    job.plan = prepared.plan
  }
  write()
  const result = await executeReplayJob({ action, slug, number: job.number, signature, root: join(ROOT, "public") }, {
    save: async () => {},
    progress: (delta) => {
      if (delta.line !== undefined) {
        job.lines.push(delta.line)
        console.log(delta.line)
      }
      const { line: _line, ...fields } = delta
      Object.assign(job, fields)
      write()
    },
  })
  Object.assign(job, result)
  write()
} catch (error) {
  Object.assign(job, { state: "blocked", message: error.message })
  write()
  console.error(error.message)
  process.exitCode = 1
}
