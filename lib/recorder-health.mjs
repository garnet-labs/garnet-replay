/**
 * Recorder health: is the fork's Runtime Review path finalizing comments right
 * now? A replay waits for commit 1's record before it pushes commit 2, so a
 * fork whose recent comments are all pending placeholders turns a run into a
 * wait that never ends. `live` reads the last few pull requests on the fork
 * before it writes anything and stops when nothing has finalized lately.
 */
import { listPrs, prComments, run } from "./gh.mjs"
import { isGarnetComment, parseReceipt } from "./receipt.mjs"

export const RECENT_PRS = 8

/**
 * One Runtime Review comment per pull request, reduced to what health needs.
 * @typedef {{pr: number, state: "final"|"pending"|"other", updatedAt: string}} RecordObservation
 */

/**
 * Reduce a pull request's comments to its latest Runtime Review comment.
 * @param {number} pr
 * @param {unknown[]} comments issue comments, oldest first
 * @returns {RecordObservation|null} null when the pull request carries no Runtime Review comment
 */
export function observeRecord(pr, comments) {
  const garnet = (Array.isArray(comments) ? comments : []).filter((comment) => isGarnetComment(comment))
  if (garnet.length === 0) return null
  const latest = garnet[garnet.length - 1]
  const receipt = parseReceipt(latest.body)
  const updatedAt = typeof latest.updated_at === "string" ? latest.updated_at : typeof latest.created_at === "string" ? latest.created_at : ""
  const state = receipt.final ? "final" : receipt.pending || receipt.summary === null ? "pending" : "other"
  return { pr, state, updatedAt }
}

/**
 * Judge the recorder from the observations, newest pull request first.
 * - `ok`: the newest recorded pull request has a finalized comment.
 * - `stalled`: the newest recorded pull requests are pending placeholders
 *   (two or more, or one with nothing finalized behind it).
 * - `unknown`: one pending placeholder with a finalized record behind it; the
 *   placeholder may just be fresh.
 * - `none`: no Runtime Review comment on any recent pull request.
 * @param {RecordObservation[]} observations newest pull request first
 * @returns {{verdict: "ok"|"stalled"|"unknown"|"none", pending: RecordObservation[], lastFinal: RecordObservation|null}}
 */
export function recorderVerdict(observations) {
  const recorded = observations.filter((row) => row !== null)
  const lastFinal = recorded.find((row) => row.state === "final") ?? null
  const pending = []
  for (const row of recorded) {
    if (row.state === "final") break
    pending.push(row)
  }
  if (recorded.length === 0) return { verdict: "none", pending, lastFinal }
  if (pending.length === 0) return { verdict: "ok", pending, lastFinal }
  if (pending.length >= 2 || lastFinal === null) return { verdict: "stalled", pending, lastFinal }
  return { verdict: "unknown", pending, lastFinal }
}

/**
 * One line for the plan: what the fork's recent pull requests show.
 * @param {{verdict: string, pending: RecordObservation[], lastFinal: RecordObservation|null}} health
 * @param {number} scanned how many pull requests were read
 * @returns {string}
 */
export function describeHealth(health, scanned) {
  const day = (row) => row.updatedAt.slice(0, 10)
  const last = health.lastFinal === null ? "no finalized record" : `last finalized record on pull request ${health.lastFinal.pr} (${day(health.lastFinal)})`
  const pending = health.pending.length === 0 ? "" : `; pending placeholder on ${health.pending.map((row) => `${row.pr} (since ${day(row)})`).join(", ")}`
  return `recorder health: ${health.verdict} · ${last}${pending} · ${scanned} recent pull requests read`
}

/**
 * Read the fork's recent pull requests and judge the recorder.
 * @param {string} fork owner/name
 * @param {{exec?: typeof run, limit?: number}} [options]
 * @returns {{verdict: "ok"|"stalled"|"unknown"|"none", pending: RecordObservation[], lastFinal: RecordObservation|null, scanned: number, line: string}}
 */
export function recorderHealth(fork, { exec = run, limit = RECENT_PRS } = {}) {
  const prs = listPrs(fork, { limit, state: "all", exec })
  const rows = (Array.isArray(prs) ? prs : [])
    .filter((pr) => Number.isInteger(pr?.number))
    .sort((left, right) => right.number - left.number)
  const observations = rows.map((pr) => observeRecord(pr.number, prComments(fork, pr.number, { exec })))
  const health = recorderVerdict(observations)
  return { ...health, scanned: rows.length, line: describeHealth(health, rows.length) }
}
