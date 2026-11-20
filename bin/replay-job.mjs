#!/usr/bin/env node
/** GitHub Actions entry for hosted replay jobs: one canonical prepare or start, reported as out/hosted-job/job.json. */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSlug } from "../lib/guards.mjs"
import { executeReplayJob } from "../lib/replay-runner-worker.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const directory = join(ROOT, "out", "hosted-job")
const path = join(directory, "job.json")
const { REPLAY_ACTION: action, REPLAY_SLUG: slug, REPLAY_NUMBER: number, REPLAY_PLAN_FILE: planFile, REPLAY_BASE_BRANCH: baseBranch = "", REPLAY_BRANCH: headBranch = "", REPLAY_RECORD_JOB: recordJob = "" } = process.env

const job = { action, slug, number: Number(number), state: action === "prepare" ? "preparing" : "recording", lines: [] }
const write = () => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${path}.next`, `${JSON.stringify(job, null, 2)}\n`)
  renameSync(`${path}.next`, path)
}

try {
  const rawTwoCommit = process.env.REPLAY_TWO_COMMIT ?? "false"
  if (!["true", "false"].includes(rawTwoCommit)) throw new Error("two_commit must be true or false.")
  const two_commit = rawTwoCommit === "true"
  if (action !== "prepare" && action !== "start") throw new Error("The replay action must be prepare or start.")
  assertSlug(slug)
  if (!/^[1-9]\d*$/.test(number ?? "")) throw new Error("The pull request number is invalid.")
  let signature
  let preparedTwoCommit
  let base = baseBranch
  let branch = headBranch
  if (action === "start") {
    const prepared = JSON.parse(readFileSync(planFile, "utf8"))
    preparedTwoCommit = prepared.two_commit ?? false
    if (two_commit !== preparedTwoCommit) throw new Error("two_commit differs from the prepared plan. Prepare it again.")
    if (prepared.state !== "prepared" || prepared.slug !== slug || prepared.number !== job.number || !/^[0-9a-f]{64}$/.test(prepared.signature ?? "")) {
      throw new Error("The prepared plan does not match this replay. Prepare it again.")
    }
    signature = prepared.signature
    job.plan = prepared.plan
    const planned = typeof prepared.baseBranch === "string" ? prepared.baseBranch : ""
    if (baseBranch !== "" && baseBranch !== planned) throw new Error("The base branch differs from the prepared plan's. Prepare it again.")
    base = planned
    const plannedBranch = typeof prepared.branch === "string" ? prepared.branch : ""
    if (headBranch !== "" && headBranch !== plannedBranch) throw new Error("The branch differs from the prepared plan's. Prepare it again.")
    branch = plannedBranch
    const plannedRecordJob = typeof prepared.recordJob === "string" ? prepared.recordJob : ""
    if (recordJob !== plannedRecordJob) throw new Error("The record job differs from the prepared plan's. Prepare it again.")
  }
  write()
  const result = await executeReplayJob({ action, slug, number: job.number, signature, root: join(ROOT, "public"), baseBranch: base, branch, two_commit, preparedTwoCommit, recordJob }, {
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
  const reason = typeof error.reason === "string" ? error.reason : "REPLAY_FAILED"
  Object.assign(job, { state: reason === "RECORD_PENDING" ? "pending" : "blocked", reason, message: error.message })
  write()
  const refusal = `[${reason}] ${error.message}`
  console.error(refusal)
  if (typeof process.env.GITHUB_STEP_SUMMARY === "string" && process.env.GITHUB_STEP_SUMMARY !== "") {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Replay blocked: ${reason}\n\n${error.message}\n`) } catch (summaryError) {
      console.error(`Could not write job summary: ${summaryError.message}`)
    }
  }
  process.exitCode = 1
}
