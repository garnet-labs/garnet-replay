const ACCEPTABLE_CONCLUSIONS = new Set(["success", "neutral", "skipped"])

/**
 * @typedef {object} AutoMergePullRequest
 * @property {number} number
 * @property {"OPEN"|"CLOSED"|"MERGED"} state
 * @property {boolean} isDraft
 * @property {string} baseRefName
 * @property {string} headRefName
 * @property {string} headRefOid
 * @property {boolean} isCrossRepository
 * @property {"MERGEABLE"|"CONFLICTING"|"UNKNOWN"} mergeable
 * @property {{name:string}[]} labels
 */

/**
 * @typedef {object} AutoMergeCheckRun
 * @property {string} name
 * @property {string} status
 * @property {string|null} conclusion
 */

/**
 * @typedef {object} AutoMergeCommitStatus
 * @property {string} context
 * @property {string} state
 * @property {string} [created_at]
 * @property {string} [updated_at]
 */

/**
 * @typedef {object} AutoMergeReview
 * @property {{login:string}|null} author
 * @property {string} state
 * @property {string|null} submittedAt
 */

/**
 * @param {{
 *   pr: AutoMergePullRequest,
 *   checkRuns: AutoMergeCheckRun[],
 *   statuses: AutoMergeCommitStatus[],
 *   unresolvedThreads: number,
 *   reviews?: AutoMergeReview[],
 *   selfCheckName?: string
 * }} input
 * @returns {{action:"merge"|"wait"|"skip", reason:string}}
 */
export function mergeDecision({ pr, checkRuns, statuses, unresolvedThreads, reviews = [], selfCheckName = "auto-merge" }) {
  if (pr.state !== "OPEN") return { action: "skip", reason: `pull request is ${String(pr.state).toLowerCase()}` }
  if (pr.isDraft === true) return { action: "skip", reason: "pull request is still a draft" }
  if (pr.baseRefName !== "main") return { action: "skip", reason: `base branch is ${pr.baseRefName}, not main` }
  if (typeof pr.headRefName !== "string" || !pr.headRefName.startsWith("devin/")) {
    return { action: "skip", reason: "head branch is not a devin/ branch" }
  }
  if (pr.isCrossRepository === true) return { action: "skip", reason: "pull request comes from another repository" }
  if (Array.isArray(pr.labels) && pr.labels.some((label) => typeof label?.name === "string" && label.name.toLowerCase() === "hold")) {
    return { action: "skip", reason: "pull request has the hold label" }
  }
  if (pr.mergeable === "CONFLICTING") return { action: "skip", reason: "pull request has merge conflicts" }

  const runs = Array.isArray(checkRuns) ? checkRuns.filter((run) => run?.name !== selfCheckName) : []
  const failedRun = runs.find((run) => run?.status === "completed" && !ACCEPTABLE_CONCLUSIONS.has(run?.conclusion))
  if (failedRun !== undefined) {
    const name = typeof failedRun.name === "string" && failedRun.name !== "" ? failedRun.name : "unnamed check"
    return { action: "skip", reason: `check ${name} concluded ${String(failedRun.conclusion)}` }
  }
  const incompleteRun = runs.find((run) => run?.status !== "completed")
  if (incompleteRun !== undefined) {
    const name = typeof incompleteRun.name === "string" && incompleteRun.name !== "" ? incompleteRun.name : "unnamed check"
    return { action: "wait", reason: `waiting for check ${name} to complete` }
  }
  const testSucceeded = runs.some((run) => run?.name === "test" && run?.status === "completed" && run?.conclusion === "success")
  if (!testSucceeded) return { action: "wait", reason: "waiting for the test check to succeed" }

  const latestStatuses = new Map()
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (typeof status?.context !== "string" || status.context === "") continue
    const current = latestStatuses.get(status.context)
    const timestamp = statusTimestamp(status)
    const currentTimestamp = current === undefined ? null : statusTimestamp(current)
    if (current === undefined || (timestamp !== null && (currentTimestamp === null || timestamp > currentTimestamp))) {
      latestStatuses.set(status.context, status)
    }
  }
  const statusList = [...latestStatuses.values()]
  const failedStatus = statusList.find((status) => ["failure", "error"].includes(String(status.state).toLowerCase()))
  if (failedStatus !== undefined) {
    return { action: "skip", reason: `commit status ${failedStatus.context} is ${String(failedStatus.state).toLowerCase()}` }
  }
  const pendingStatus = statusList.find((status) => String(status.state).toLowerCase() === "pending")
  if (pendingStatus !== undefined) {
    return { action: "wait", reason: `waiting for commit status ${pendingStatus.context}` }
  }
  if (unresolvedThreads > 0) return { action: "skip", reason: `${unresolvedThreads} review thread${unresolvedThreads === 1 ? "" : "s"} unresolved` }
  const latestChangedRequest = latestActionableReviews(reviews).find((review) => review.state === "CHANGES_REQUESTED")
  if (latestChangedRequest !== undefined) {
    return { action: "skip", reason: `review from ${latestChangedRequest.login} requests changes` }
  }
  return { action: "merge", reason: "checks and statuses are settled, test succeeded, and no review threads or change requests are unresolved" }
}

function statusTimestamp(status) {
  const value = typeof status.updated_at === "string" ? status.updated_at : status.created_at
  if (typeof value !== "string") return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function latestActionableReviews(reviews) {
  const latestByAuthor = new Map()
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = review?.author?.login
    if (typeof login !== "string" || login === "") continue
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") continue
    if (typeof review.submittedAt !== "string") continue
    const timestamp = Date.parse(review.submittedAt)
    if (!Number.isFinite(timestamp)) continue
    const key = login.toLowerCase()
    const current = latestByAuthor.get(key)
    if (current === undefined || timestamp > current.timestamp) {
      latestByAuthor.set(key, { login, state: review.state, timestamp })
    }
  }
  return [...latestByAuthor.values()]
}
