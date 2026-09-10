/**
 * Wait for the Garnet record of one commit on a fork pull request.
 *
 * A replay pushes commit 1 alone, waits here, then pushes commit 2, so the
 * App has a recorded previous commit to compare the change against. Pushing
 * both at once records only the head and the comparison never exists.
 */
import { checkRuns, latestRuntimeReviewComment, prComments, run } from "./gh.mjs"
import { parseReceipt } from "./receipt.mjs"

const GARNET_CHECK_RE = /garnet/i
const TERMINAL_FAILURE = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"])

function boundTo(marker, sha) {
  if (typeof marker !== "string" || typeof sha !== "string") return false
  const left = marker.toLowerCase()
  const right = sha.toLowerCase()
  return left.length <= right.length ? right.startsWith(left) : left.startsWith(right)
}

/**
 * Read the current state of one commit's record from the comments and checks.
 * @param {{comments: unknown[], checks: {name?: string, status?: string, conclusion?: string|null}[], sha: string}} input
 * @returns {{state: "recorded"|"pending"|"failed", detail: string}}
 */
export function recordState({ comments, checks, sha }) {
  const garnetChecks = (Array.isArray(checks) ? checks : []).filter((check) => GARNET_CHECK_RE.test(String(check.name ?? "")))
  const failed = garnetChecks.find((check) => check.status === "completed" && TERMINAL_FAILURE.has(String(check.conclusion)))
  const matching = (Array.isArray(comments) ? comments : []).filter((comment) => {
    const receipt = typeof comment?.body === "string" ? parseReceipt(comment.body) : null
    return receipt !== null && boundTo(receipt.markerCommit, sha)
  })
  const comment = latestRuntimeReviewComment(matching)
  if (comment !== null) {
    const receipt = parseReceipt(comment.body)
    if (receipt.final) return { state: "recorded", detail: `record bound to ${sha.slice(0, 7)}` }
    if (receipt.pending || receipt.summary === null) {
      return { state: "pending", detail: `record for ${sha.slice(0, 7)} is still being written` }
    }
    return { state: "pending", detail: `record for ${sha.slice(0, 7)} has status ${JSON.stringify(receipt.summary.status)}` }
  }
  if (failed !== undefined) return { state: "failed", detail: `check ${failed.name} concluded ${failed.conclusion} on ${sha.slice(0, 7)} before a record was posted` }
  const running = garnetChecks.filter((check) => check.status !== "completed").map((check) => check.name)
  return { state: "pending", detail: running.length > 0 ? `checks running: ${running.join(", ")}` : `no record for ${sha.slice(0, 7)} yet` }
}

/**
 * Poll until the commit is recorded, the Garnet check fails, or time runs out.
 * @param {{fork: string, forkPr: number, sha: string, timeoutMs?: number, pollMs?: number,
 *   exec?: typeof run, sleep?: (ms: number) => Promise<void>, now?: () => number, log?: (line: string) => void}} input
 * @returns {Promise<{state: "recorded"|"pending"|"failed", detail: string, polls: number}>}
 */
export async function waitForRecord({
  fork, forkPr, sha, timeoutMs = 45 * 60 * 1000, pollMs = 30 * 1000,
  exec = run, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), log = () => {},
}) {
  const started = now()
  let polls = 0
  let last = null
  for (;;) {
    polls += 1
    const comments = prComments(fork, forkPr, { exec })
    const checks = checkRuns(fork, sha, { exec })
    const current = recordState({ comments, checks, sha })
    if (current.detail !== last) {
      log(`wait ${sha.slice(0, 7)}: ${current.detail}`)
      last = current.detail
    }
    if (current.state !== "pending") return { ...current, polls }
    if (now() - started >= timeoutMs) return { state: "pending", detail: `${current.detail}; gave up after ${Math.round(timeoutMs / 60000)} min`, polls }
    await sleep(pollMs)
  }
}
