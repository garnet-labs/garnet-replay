import { pathToFileURL } from "node:url";

/**
 * Publishes the `garnet/evidence` check run on the pull request head.
 *
 * A workflow_run job's own check run is attached to the default-branch commit
 * GitHub ran it from, never to the pull request head, so a job named
 * `garnet/evidence` can neither be a required check on the pull request nor be
 * seen by the re-review step. This script creates the check run itself, bound
 * to HEAD_SHA, with the same fail-closed reading of the record as REVIEW.md:
 *   success   a finalized record from the Garnet App is bound to the exact head
 *   pending   a record for the head exists but is still being written
 *   failure   no record from the Garnet App is bound to the head
 * Missing, stale or third-party evidence is failure. Nothing here judges the
 * pull request.
 * Required environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA.
 * Optional environment: GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_RUN_ID.
 */
const RUNTIME_REVIEW_MARKER = "<!-- garnet-runtime-review -->"
const PENDING_MARKER = "garnet-control-plane-pending-pr-comment"
const COMMIT_RE = /<!--\s*garnet:commit\s+([0-9a-f]{40})\s*-->/
const SUMMARY_RE = /<!-- garnet:summary (\{.*?\}) -->/
const TRUSTED_AUTHORS = new Set([
  "garnet-runtime-review[bot]",
  "garnet-runtime-review-dev[bot]",
  "garnet-ai[bot]",
])
export const EVIDENCE_CHECK = "garnet/evidence"

const api = process.env.GITHUB_API_URL || "https://api.github.com"
const repo = process.env.GITHUB_REPOSITORY
const prNumber = process.env.PR_NUMBER
const headSha = process.env.HEAD_SHA

async function github(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

async function listComments() {
  const all = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`)
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

/**
 * How the Garnet App's comments read for one head.
 * @param {{user?: {login?: string}, body?: string}[]} comments
 * @param {string} head 40-hex head sha
 * @returns {{state: "success"|"pending"|"failure", summary: string, recorded: string|null, jobs: number|null}}
 */
export function evidenceStateFor(comments, head) {
  const sha7 = head.slice(0, 7)
  const bound = (Array.isArray(comments) ? comments : []).filter((comment) => {
    if (!TRUSTED_AUTHORS.has(comment?.user?.login)) return false
    if (typeof comment?.body !== "string" || !comment.body.includes(RUNTIME_REVIEW_MARKER)) return false
    const commit = COMMIT_RE.exec(comment.body)
    return commit !== null && commit[1] === head
  })
  if (bound.length === 0) {
    return { state: "failure", summary: `No Runtime Review comment from the Garnet App is bound to head ${sha7}. Missing evidence is no record, not a clean run.`, recorded: null, jobs: null }
  }
  for (const comment of bound) {
    if (comment.body.includes(PENDING_MARKER)) continue
    const summary = SUMMARY_RE.exec(comment.body)
    if (summary === null) continue
    let parsed = null
    try {
      parsed = JSON.parse(summary[1])
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== "object") continue
    if (parsed.status !== undefined && parsed.status !== "finalized") continue
    const recorded = typeof parsed.recorded === "string" ? parsed.recorded : null
    const jobs = typeof parsed.jobs === "number" ? parsed.jobs : null
    const facts = [jobs !== null ? `${jobs} job${jobs === 1 ? "" : "s"}` : null, recorded !== null ? `recorded ${recorded}` : null].filter((item) => item !== null).join(" · ")
    return { state: "success", summary: `A finalized Runtime Review record from the Garnet App is bound to head ${sha7}${facts === "" ? "" : ` (${facts})`}. The record is evidence, not a judgment.`, recorded, jobs }
  }
  return { state: "pending", summary: `The Runtime Review record for head ${sha7} is still being written. Pending evidence is no record.`, recorded: null, jobs: null }
}

/**
 * The check-run body to publish for one reading.
 * @param {{state: "success"|"pending"|"failure", summary: string}} reading
 * @param {string} head
 * @param {string|null} detailsUrl
 * @returns {Record<string, unknown>}
 */
export function checkRunPayload(reading, head, detailsUrl) {
  const titles = { success: "Head-bound Runtime Review record", pending: "Record still being written", failure: "No head-bound Runtime Review record" }
  return {
    name: EVIDENCE_CHECK,
    head_sha: head,
    ...(detailsUrl !== null ? { details_url: detailsUrl } : {}),
    ...(reading.state === "pending" ? { status: "in_progress" } : { status: "completed", conclusion: reading.state }),
    output: { title: titles[reading.state], summary: reading.summary },
  }
}

/**
 * Whether the newest existing `garnet/evidence` check run already says this.
 * @param {{name?: string, id?: number, status?: string, conclusion?: string|null, output?: {summary?: string}}[]} checkRuns
 * @param {Record<string, unknown>} payload
 * @returns {boolean}
 */
export function alreadyPublished(checkRuns, payload) {
  const runs = (Array.isArray(checkRuns) ? checkRuns : []).filter((run) => run?.name === EVIDENCE_CHECK)
  if (runs.length === 0) return false
  const latest = runs.reduce((best, run) => (typeof run.id === "number" && (best === null || run.id > best.id) ? run : best), null)
  if (latest === null) return false
  const conclusion = payload.status === "completed" ? payload.conclusion : null
  return latest.status === payload.status && (latest.conclusion ?? null) === conclusion && latest.output?.summary === payload.output.summary
}

async function main() {
  if (!process.env.GITHUB_TOKEN || !repo || !prNumber || !headSha) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA are required")
  }
  const pr = await github(`/repos/${repo}/pulls/${prNumber}`)
  if (pr.state !== "open") {
    console.log(`PR #${prNumber} is ${pr.state}; nothing to gate.`)
    return
  }
  if (pr.head?.sha !== headSha) {
    console.log(`PR head moved (${pr.head?.sha?.slice(0, 7)} != ${headSha.slice(0, 7)}); not publishing a check for a stale head.`)
    return
  }
  const reading = evidenceStateFor(await listComments(), headSha)
  const server = process.env.GITHUB_SERVER_URL || "https://github.com"
  const detailsUrl = process.env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
  const payload = checkRunPayload(reading, headSha, detailsUrl)
  const existing = await github(`/repos/${repo}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(EVIDENCE_CHECK)}&per_page=100`)
  if (alreadyPublished(existing?.check_runs, payload)) {
    console.log(`${EVIDENCE_CHECK} on ${headSha.slice(0, 7)} already reads ${reading.state}; nothing to do.`)
  } else {
    await github(`/repos/${repo}/check-runs`, { method: "POST", body: JSON.stringify(payload) })
    console.log(`published ${EVIDENCE_CHECK} = ${reading.state} on head ${headSha.slice(0, 7)} for PR #${prNumber}`)
  }
  if (reading.state === "failure") {
    console.log(`::error::pull request ${prNumber}: ${reading.summary}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
