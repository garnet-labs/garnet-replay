/**
 * Wait for the Garnet record of one commit on a fork pull request.
 *
 * A replay pushes commit 1 alone, waits here, then pushes commit 2, so the
 * App has a recorded previous commit to compare the change against. Pushing
 * both at once records only the head and the comparison never exists.
 */
import { checkRuns, ghJson, latestRuntimeReviewComment, prComments, run } from "./gh.mjs"
import { parseReceipt } from "./receipt.mjs"
import { baseRecordState } from "./base-baseline.mjs"

const GARNET_CHECK_RE = /garnet/i
const TERMINAL_FAILURE = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"])

/** Await exact-tip push runs; API errors stop pending rather than publishing without evidence. */
export async function waitForBaseRecord({ fork, branch, sha, workflows, timeoutMs = 45 * 60 * 1000, pollMs = 30 * 1000,
  exec = run, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), log = () => {},
}) {
  const started = now()
  let polls = 0
  for (;;) {
    polls += 1
    let current
    try {
      const pages = ghJson(["api", "--paginate", "--slurp", `repos/${fork}/actions/runs?event=push&branch=${encodeURIComponent(branch)}&head_sha=${sha}&per_page=100`], { exec })
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page.workflow_runs))) throw new Error("invalid Actions runs response")
      current = baseRecordState({ runs: pages.flatMap((page) => page.workflow_runs), workflows, branch, sha })
    } catch (error) {
      return { state: "pending", detail: `baseline runs unreadable: ${error.message}`, polls }
    }
    log(`wait baseline ${branch}@${sha.slice(0, 7)}: ${current.detail}`)
    if (current.state !== "pending") return { ...current, polls }
    if (now() - started >= timeoutMs) return { state: "pending", detail: `${current.detail}; gave up after ${Math.round(timeoutMs / 60000)} min`, polls }
    await sleep(pollMs)
  }
}

function boundTo(marker, sha) {
  if (typeof marker !== "string" || typeof sha !== "string") return false
  const left = marker.toLowerCase()
  const right = sha.toLowerCase()
  return left.length <= right.length ? right.startsWith(left) : left.startsWith(right)
}

/**
 * Read the current state of one commit's record from the comments and checks.
 * @param {{comments: unknown[], checks: {name?: string, status?: string, conclusion?: string|null, details_url?: string}[], sha: string, settleChecks?: boolean}} input
 * @returns {{state: "recorded"|"pending"|"failed", detail: string}}
 */
export function recordState({ comments, checks, sha, settleChecks = false }) {
  const garnetChecks = (Array.isArray(checks) ? checks : []).filter((check) => GARNET_CHECK_RE.test(String(check.name ?? "")))
  const failed = garnetChecks.find((check) => check.status === "completed" && TERMINAL_FAILURE.has(String(check.conclusion)))
  const matching = (Array.isArray(comments) ? comments : []).filter((comment) => {
    const receipt = typeof comment?.body === "string" ? parseReceipt(comment.body) : null
    return receipt !== null && boundTo(receipt.markerCommit, sha)
  })
  const comment = latestRuntimeReviewComment(matching)
  if (comment !== null) {
    const receipt = parseReceipt(comment.body)
    if (receipt.final) {
      if (settleChecks) {
        const runPath = receipt.runId === null ? null : `/actions/runs/${receipt.runId}/`
        const recordingChecks = runPath === null ? [] : checks.filter((check) => typeof check.details_url === "string" && check.details_url.includes(runPath))
        const relevant = recordingChecks.length > 0 ? recordingChecks : garnetChecks
        if (relevant.length === 0) return { state: "pending", detail: `record bound to ${sha.slice(0, 7)}; waiting for recording checks on the head` }
        const running = relevant.filter((check) => check.status !== "completed")
        if (running.length > 0) return { state: "pending", detail: `record bound to ${sha.slice(0, 7)}; checks running: ${running.map((check) => check.name).join(", ")}` }
      }
      return { state: "recorded", detail: `record bound to ${sha.slice(0, 7)}` }
    }
    if (receipt.pending || receipt.summary === null) {
      return { state: "pending", detail: `record for ${sha.slice(0, 7)} is still being written` }
    }
    return { state: "pending", detail: `record for ${sha.slice(0, 7)} has status ${JSON.stringify(receipt.summary.status)}` }
  }
  const running = garnetChecks.filter((check) => check.status !== "completed").map((check) => check.name)
  // The App posts nothing while jobs record, so one failed check says nothing final while others still run.
  if (failed !== undefined && running.length === 0) return { state: "failed", detail: `check ${failed.name} concluded ${failed.conclusion} on ${sha.slice(0, 7)} before a record was posted` }
  return { state: "pending", detail: running.length > 0 ? `checks running: ${running.join(", ")}` : `no record for ${sha.slice(0, 7)} yet` }
}

/**
 * Poll until the commit is recorded, the Garnet check fails, or time runs out.
 * A failed check ends the wait only after `failedGraceMs` with no record: the
 * App posts its first comment once the last job has finished, not before.
 * @param {{fork: string, forkPr: number, sha: string, timeoutMs?: number, pollMs?: number, failedGraceMs?: number, settleChecks?: boolean,
 *   exec?: typeof run, sleep?: (ms: number) => Promise<void>, now?: () => number, log?: (line: string) => void}} input
 * @returns {Promise<{state: "recorded"|"pending"|"failed", detail: string, polls: number}>}
 */
export async function waitForRecord({
  fork, forkPr, sha, timeoutMs = 45 * 60 * 1000, pollMs = 30 * 1000, failedGraceMs = 5 * 60 * 1000,
  exec = run, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), log = () => {}, settleChecks = false,
}) {
  const started = now()
  let polls = 0
  let last = null
  let failedSince = null
  for (;;) {
    polls += 1
    const comments = prComments(fork, forkPr, { exec })
    const checks = checkRuns(fork, sha, { exec })
    const current = recordState({ comments, checks, sha, settleChecks })
    if (current.detail !== last) {
      log(`wait ${sha.slice(0, 7)}: ${current.detail}`)
      last = current.detail
    }
    if (current.state === "recorded") return { ...current, polls }
    if (current.state === "failed") {
      failedSince ??= now()
      if (now() - failedSince >= failedGraceMs) return { ...current, polls }
    } else {
      failedSince = null
    }
    if (now() - started >= timeoutMs) return { state: "pending", detail: `${current.detail}; gave up after ${Math.round(timeoutMs / 60000)} min`, polls }
    await sleep(pollMs)
  }
}
