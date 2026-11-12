/**
 * Recorder health: is the fork's Runtime Review path finalizing comments right
 * now? A replay waits for commit 1's record before it pushes commit 2, so a
 * fork whose recent comments are all pending placeholders turns a run into a
 * wait that never ends. `live` reads the last few pull requests on the fork
 * before it writes anything and stops when nothing has finalized lately.
 *
 * From comment contract 11 the App posts nothing while jobs record, so a lost
 * run-completion leaves no placeholder to see: the pull request simply has no
 * comment for its head. That reads as a stall once the head's workflow runs
 * finished longer ago than the App waits before finalizing.
 */
import { checkRuns, listPrs, prComments, run, workflowRuns } from "./gh.mjs"
import { isGarnetComment, parseReceipt } from "./receipt.mjs"

export const RECENT_PRS = 8
/** A pull request younger than this with no finalized record is still in flight, not evidence of a stall. */
export const FRESH_MINUTES = 60
/** How long the App waits for recording jobs before it finalizes anyway (control-plane `RecordingJobFinalizeTimeout`). */
export const FINALIZE_WINDOW_MINUTES = 30
/** Slack past the finalize window before a head with no comment counts as a stall. */
export const FINALIZE_MARGIN_MINUTES = 15

const GARNET_NAME_RE = /garnet/i

/**
 * One Runtime Review comment per pull request, reduced to what health needs.
 * `missing`: a Garnet job ran on the head, its runs finished past the finalize window, and no comment is bound to that head.
 * @typedef {{pr: number, state: "final"|"pending"|"no-profile"|"other"|"missing", updatedAt: string}} RecordObservation
 */

function boundTo(marker, sha) {
  if (typeof marker !== "string" || marker === "" || typeof sha !== "string" || sha === "") return false
  const left = marker.toLowerCase()
  const right = sha.toLowerCase()
  return left.length <= right.length ? right.startsWith(left) : left.startsWith(right)
}

function latestGarnetComment(comments) {
  const matching = (Array.isArray(comments) ? comments : []).filter((comment) => isGarnetComment(comment))
  if (matching.length === 0) return null
  let latest = matching[0]
  const timestamp = (comment) => {
    const value = typeof comment.updated_at === "string" ? comment.updated_at : comment.created_at
    return typeof value === "string" ? Date.parse(value) : NaN
  }
  for (const candidate of matching.slice(1)) {
    const candidateAt = timestamp(candidate)
    const latestAt = timestamp(latest)
    if ((Number.isFinite(candidateAt) && (!Number.isFinite(latestAt) || candidateAt >= latestAt))
      || (!Number.isFinite(candidateAt) && !Number.isFinite(latestAt))) latest = candidate
  }
  return latest
}

/**
 * Reduce a pull request's comments to its latest Runtime Review comment.
 * @param {number} pr
 * @param {unknown[]} comments issue comments
 * @returns {RecordObservation|null} null when the pull request carries no Runtime Review comment
 */
export function observeRecord(pr, comments) {
  const latest = latestGarnetComment(comments)
  if (latest === null) return null
  const receipt = parseReceipt(latest.body)
  const updatedAt = typeof latest.updated_at === "string" ? latest.updated_at : typeof latest.created_at === "string" ? latest.created_at : ""
  const hasFinalSummary = (receipt.finalMarker === true && receipt.summary !== null)
    || (receipt.finalMarker === false && receipt.final === true)
  const state = receipt.pending === true
    ? "pending"
    : hasFinalSummary
      ? "final"
      : receipt.noProfile === true
        ? "no-profile"
        : "other"
  return { pr, state, updatedAt }
}

/** The commit the pull request's latest Runtime Review comment is bound to; null with no comment or no commit marker. */
function latestMarkerCommit(comments) {
  const latest = latestGarnetComment(comments)
  const commit = latest === null ? null : parseReceipt(latest.body).markerCommit
  return typeof commit === "string" && commit !== "" ? commit : null
}

/**
 * Did the head's runs finish, with a Garnet job among them, longer ago than
 * the App's finalize window plus margin? Call it only for a head no comment is
 * bound to. A Garnet job ran when a run of a recording workflow finished
 * without being skipped, or a finished check on the head is named for Garnet.
 * @param {number} pr
 * @param {{runs: {path?: string, status?: string, conclusion?: string|null, updated_at?: string}[],
 *   checks?: {name?: string, status?: string, conclusion?: string|null}[], recordingWorkflows?: string[], now: number}} input
 * @returns {RecordObservation|null} null while the runs are in flight, inside the window, or when no Garnet job ran
 */
export function observeMissingRecord(pr, { runs, checks = [], recordingWorkflows = [], now }) {
  const listed = Array.isArray(runs) ? runs : []
  if (listed.length === 0 || listed.some((row) => row?.status !== "completed")) return null
  const finished = listed.map((row) => (typeof row.updated_at === "string" ? Date.parse(row.updated_at) : NaN))
  if (finished.some((at) => !Number.isFinite(at))) return null
  const lastFinished = Math.max(...finished)
  if (now - lastFinished <= (FINALIZE_WINDOW_MINUTES + FINALIZE_MARGIN_MINUTES) * 60_000) return null
  const ran = (conclusion) => conclusion !== "skipped"
  const recordingRun = listed.some((row) => ran(row.conclusion) && typeof row.path === "string"
    && recordingWorkflows.some((workflow) => row.path === workflow || row.path.endsWith(`/${workflow}`)))
  const garnetCheck = (Array.isArray(checks) ? checks : []).some((check) => check?.status === "completed" && ran(check.conclusion) && GARNET_NAME_RE.test(String(check.name ?? "")))
  if (!recordingRun && !garnetCheck) return null
  return { pr, state: "missing", updatedAt: new Date(lastFinished).toISOString() }
}

/**
 * Judge the recorder from the observations, newest pull request first.
 * - `ok`: the newest recorded pull request has a finalized comment.
 * - `stalled`: the newest recorded pull requests are pending placeholders
 *   (two or more, or one with nothing finalized behind it), or one of them
 *   has no comment for its head after its Garnet runs finished (`missing`).
 * - `unknown`: one pending placeholder with a finalized record behind it; the
 *   placeholder may just be fresh.
 * - `none`: no Runtime Review comment on any recent pull request.
 * @param {RecordObservation[]} observations newest pull request first
 * @returns {{verdict: "ok"|"stalled"|"unknown"|"none", pending: RecordObservation[], missing: RecordObservation[], lastFinal: RecordObservation|null}}
 */
export function recorderVerdict(observations) {
  const recorded = observations.filter((row) => row !== null)
  const meaningful = recorded.filter((row) => row.state === "final" || row.state === "pending" || row.state === "missing")
  const lastFinal = recorded.find((row) => row.state === "final") ?? null
  const pending = []
  const missing = []
  for (const row of meaningful) {
    if (row.state === "final") break
    if (row.state === "pending") pending.push(row)
    if (row.state === "missing") missing.push(row)
  }
  if (meaningful.length === 0) return { verdict: "none", pending, missing, lastFinal }
  if (pending.length === 0 && missing.length === 0) return { verdict: "ok", pending, missing, lastFinal }
  if (missing.length > 0 || pending.length >= 2 || lastFinal === null) return { verdict: "stalled", pending, missing, lastFinal }
  return { verdict: "unknown", pending, missing, lastFinal }
}

/**
 * One line for the plan: what the fork's recent pull requests show.
 * @param {{verdict: string, pending: RecordObservation[], missing?: RecordObservation[], lastFinal: RecordObservation|null}} health
 * @param {number} scanned how many pull requests were read
 * @returns {string}
 */
export function describeHealth(health, scanned) {
  const day = (row) => row.updatedAt.slice(0, 10)
  const last = health.lastFinal === null ? "no finalized record" : `last finalized record on pull request ${health.lastFinal.pr} (${day(health.lastFinal)})`
  const pending = health.pending.length === 0 ? "" : `; pending placeholder on ${health.pending.map((row) => `${row.pr} (since ${day(row)})`).join(", ")}`
  const missing = !Array.isArray(health.missing) || health.missing.length === 0 ? "" : `; no comment for the head of ${health.missing.map((row) => `${row.pr} (runs finished ${day(row)})`).join(", ")}`
  return `recorder health: ${health.verdict} · ${last}${pending}${missing} · ${scanned} recent pull requests read`
}

/**
 * Read the fork's recent pull requests and judge the recorder.
 * @param {string} fork owner/name
 * Pull requests younger than FRESH_MINUTES without a finalized record are
 * skipped: a batch of concurrent replays must not read its own in-flight
 * placeholders as a stalled recorder.
 * A pull request whose head no comment is bound to gets its head's workflow
 * runs read; `recordingWorkflows` names the fork's recording workflow files.
 * @param {{exec?: typeof run, limit?: number, prs?: unknown[], now?: number, recordingWorkflows?: string[]}} [options]
 * @returns {{verdict: "ok"|"stalled"|"unknown"|"none", pending: RecordObservation[], missing: RecordObservation[], lastFinal: RecordObservation|null, scanned: number, fresh: number, line: string}}
 */
export function recorderHealth(fork, { exec = run, limit = RECENT_PRS, prs = null, now = Date.now(), recordingWorkflows = [] } = {}) {
  const listed = prs === null ? listPrs(fork, { limit: limit * 4, state: "all", exec }) : prs
  const rows = (Array.isArray(listed) ? listed : [])
    .filter((pr) => Number.isInteger(pr?.number))
    .sort((left, right) => right.number - left.number)
  const observations = []
  let fresh = 0
  for (const pr of rows) {
    if (observations.length >= limit) break
    const comments = prComments(fork, pr.number, { exec })
    let observation = observeRecord(pr.number, comments)
    const headSha = typeof pr.headRefOid === "string" && pr.headRefOid !== "" ? pr.headRefOid : null
    const commit = latestMarkerCommit(comments)
    // A comment with no commit marker cannot be told apart from one for the head; leave it as read.
    const unbound = observation === null || (commit !== null && !boundTo(commit, headSha))
    if (headSha !== null && unbound) {
      const runs = workflowRuns(fork, headSha, { exec })
      const checks = runs.length === 0 ? [] : checkRuns(fork, headSha, { exec })
      observation = observeMissingRecord(pr.number, { runs, checks, recordingWorkflows, now }) ?? observation
    }
    const created = typeof pr.createdAt === "string" ? Date.parse(pr.createdAt) : NaN
    const inFlight = observation === null || observation.state === "pending" || observation.state === "other" || observation.state === "missing"
    if (inFlight && Number.isFinite(created) && now - created < FRESH_MINUTES * 60_000) {
      fresh += 1
      continue
    }
    observations.push(observation)
  }
  const health = recorderVerdict(observations)
  const line = describeHealth(health, observations.length)
  return { ...health, scanned: observations.length, fresh, line: fresh === 0 ? line : `${line} · ${fresh} in-flight pull request${fresh === 1 ? "" : "s"} younger than ${FRESH_MINUTES} min skipped` }
}
