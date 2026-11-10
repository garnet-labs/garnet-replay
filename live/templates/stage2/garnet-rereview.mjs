import { pathToFileURL } from "node:url";

/**
 * Requests reviews again once a finalized Garnet Runtime Review record is bound
 * to the pull request head. Reviewers run on PR open, before the recorder has
 * finished; this step makes them run once more with the evidence present.
 * A best-effort record fails `garnet/evidence` but is still the record:
 * reviewers are requested once the check settled either way, and the mirror
 * carries the capture qualifier. A pending or absent check requests nothing.
 *
 * Contract: one request per head (a marker comment is the lock), only after the
 * `garnet/evidence` check on that head concluded success and a finalized record
 * from a trusted author is bound to the exact head, only for the reviewers
 * listed in GARNET_REVIEWERS. API requests go out before the lock comment so a
 * failed request leaves no lock and the next run retries. Nothing here judges
 * the pull request. Cursor Bugbot ignores `bugbot run` posted by a bot, so it
 * is requested through Cursor's Bugbot API with a repository secret.
 * Required environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA,
 * GARNET_REVIEWERS (comma-separated).
 * Optional environment: GITHUB_API_URL, DEVIN_API_TOKEN, DEVIN_API_URL,
 * CURSOR_API_KEY, CURSOR_API_URL.
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
/** Label `garnet-review-hold.yml` sets on a pull request it returned to draft. */
export const HOLD_LABEL = "garnet-review-hold"
/** The App edits its comment again seconds after finalizing; wait this long after the last edit. */
export const SETTLE_MS = 30_000
const CHECK_WAIT_MS = 30_000
const CHECK_ATTEMPTS = 16

/** Mention-triggered reviewers: the exact comment line each one documents. */
export const MENTIONS = Object.freeze({
  coderabbit: "@coderabbitai review",
  greptile: "@greptileai review",
  codex: "@codex review",
  qodo: "/review",
})

/** Reviewers requested through an API instead of a comment. */
export const API_REVIEWERS = Object.freeze(["copilot", "devin", "bugbot"])

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
 * @param {string} list comma-separated reviewer names
 * @returns {string[]} known reviewers, in order, without duplicates
 */
export function parseReviewers(list) {
  const seen = new Set()
  for (const raw of String(list ?? "").split(",")) {
    const name = raw.trim().toLowerCase()
    if (name === "") continue
    if (!(name in MENTIONS) && !API_REVIEWERS.includes(name)) throw new Error(`unknown reviewer '${name}'`)
    seen.add(name)
  }
  return [...seen]
}

/**
 * @param {string} head 40-hex head sha
 * @returns {string}
 */
export function rereviewMarker(head) {
  return `<!-- garnet:rereview ${head} -->`
}

/**
 * A finalized, trusted Runtime Review record bound to `head`?
 * @param {{user?: {login?: string}, body?: string}} comment
 * @param {string} head
 * @returns {boolean}
 */
export function isFinalizedRecordFor(comment, head) {
  if (!TRUSTED_AUTHORS.has(comment?.user?.login)) return false
  if (typeof comment?.body !== "string") return false
  const body = comment.body
  if (!body.includes(RUNTIME_REVIEW_MARKER) || body.includes(PENDING_MARKER)) return false
  const commit = COMMIT_RE.exec(body)
  if (commit === null || commit[1] !== head) return false
  const summary = SUMMARY_RE.exec(body)
  if (summary === null) return false
  try {
    const parsed = JSON.parse(summary[1])
    return parsed !== null && typeof parsed === "object" && (parsed.status === undefined || parsed.status === "finalized")
  } catch {
    return false
  }
}

/**
 * State of the `garnet/evidence` check for one head from its check runs.
 * @param {{name?: string, status?: string, conclusion?: string|null}[]} checkRuns
 * @returns {"success"|"pending"|"failed"|"absent"}
 */
export function evidenceCheckState(checkRuns) {
  const runs = (Array.isArray(checkRuns) ? checkRuns : []).filter((run) => run?.name === EVIDENCE_CHECK)
  if (runs.length === 0) return "absent"
  if (runs.some((run) => run.status === "completed" && run.conclusion === "success")) return "success"
  if (runs.some((run) => run.status !== "completed")) return "pending"
  return "failed"
}

async function awaitEvidenceCheck(head) {
  let state = "absent"
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
    const page = await github(`/repos/${repo}/commits/${head}/check-runs?check_name=${encodeURIComponent(EVIDENCE_CHECK)}&per_page=100`)
    state = evidenceCheckState(page?.check_runs)
    if (state === "success" || state === "failed") return state
    await new Promise((resolve) => setTimeout(resolve, CHECK_WAIT_MS))
  }
  return state
}

/**
 * @param {{user?: {login?: string}, body?: string}[]} comments
 * @param {string} head
 * @returns {boolean}
 */
export function alreadyRequestedFor(comments, head) {
  const marker = rereviewMarker(head)
  return comments.some((comment) => typeof comment?.body === "string" && comment.body.includes(marker))
}

/**
 * The single comment that re-triggers every mention-driven reviewer and holds
 * the per-head lock for API-driven ones.
 * @param {string[]} reviewers configured reviewers
 * @param {string} head
 * @returns {string}
 */
export function renderRequestComment(reviewers, head) {
  const sha7 = head.slice(0, 7)
  const lines = reviewers.filter((name) => name in MENTIONS).map((name) => MENTIONS[name])
  return [
    rereviewMarker(head),
    ...lines,
    "",
    `Runtime evidence for head \`${sha7}\` is bound to this pull request; requesting review again so it is read with the record present.`,
    `The record is in the description between \`<!-- garnet:evidence:begin -->\` and \`<!-- garnet:evidence:end -->\`. When its \`garnet:commit\` equals \`${sha7}\`, prefix each runtime-grounded statement with \`Runtime evidence (Garnet, head ${sha7}):\` and name the job and destination it shows; otherwise say the runtime evidence is undeterminable. Judgment stays with you; the record is evidence, not a verdict. See REVIEW.md.`,
  ].join("\n")
}

async function requestCopilot(prUrl) {
  await github(`/repos/${repo}/pulls/${prNumber}/requested_reviewers`, {
    method: "POST",
    body: JSON.stringify({ reviewers: ["copilot-pull-request-reviewer[bot]"] }),
  })
  console.log(`requested Copilot code review on ${prUrl}`)
  return true
}

async function requestDevin(prUrl) {
  const token = process.env.DEVIN_API_TOKEN
  if (typeof token !== "string" || token === "") {
    console.log("devin: DEVIN_API_TOKEN is not set; a Devin review was not requested (repository secret required).")
    return false
  }
  // The API reviews the pull request's current head; the caller checked it equals HEAD_SHA just before.
  const base = process.env.DEVIN_API_URL || "https://api.devin.ai"
  const res = await fetch(`${base}/v3/enterprise/pr-reviews`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pr_url: prUrl }),
  })
  if (!res.ok) throw new Error(`devin: POST /v3/enterprise/pr-reviews: ${res.status}`)
  console.log(`requested Devin review on ${prUrl}`)
  return true
}

/**
 * Whether the hold workflow put this pull request in draft (and so may release it).
 * @param {{draft?: boolean, labels?: {name?: string}[]}} pr
 * @returns {boolean}
 */
export function heldForRecord(pr) {
  return pr?.draft === true && Array.isArray(pr?.labels) && pr.labels.some((label) => label?.name === HOLD_LABEL)
}

/**
 * Milliseconds to wait before the head's finalized record has gone SETTLE_MS without an edit.
 * @param {{updated_at?: string, created_at?: string}[]} records finalized records bound to the head
 * @param {number} now epoch ms
 * @returns {number}
 */
export function settleWaitMs(records, now) {
  const last = Math.max(...records.map((c) => Date.parse(c?.updated_at ?? c?.created_at ?? "") || 0), 0)
  return Math.max(0, last + SETTLE_MS - now)
}

async function releaseHold(pr) {
  const res = await github("/graphql", {
    method: "POST",
    body: JSON.stringify({ query: "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }", variables: { id: pr.node_id } }),
  })
  if (Array.isArray(res?.errors) && res.errors.length > 0) throw new Error(`markPullRequestReadyForReview: ${res.errors.map((e) => e.message).join("; ")}`)
  await github(`/repos/${repo}/issues/${prNumber}/labels/${HOLD_LABEL}`, { method: "DELETE" })
  console.log(`marked ${pr.html_url} Ready: the record for head ${headSha.slice(0, 7)} is final, so Devin Review runs with it present`)
  return true
}

async function requestBugbot(prUrl) {
  const key = process.env.CURSOR_API_KEY
  if (typeof key !== "string" || key === "") {
    console.log("bugbot: CURSOR_API_KEY is not set; a Bugbot review was not requested (repository secret required).")
    return false
  }
  // Cursor reviews the pull request's current head; the caller checked it equals HEAD_SHA just before.
  const base = process.env.CURSOR_API_URL || "https://api.cursor.com"
  const res = await fetch(`${base}/bugbot/review`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prUrl }),
  })
  if (!res.ok) throw new Error(`bugbot: POST /bugbot/review: ${res.status}`)
  console.log(`requested Bugbot review on ${prUrl}`)
  return true
}

/**
 * Whether the `garnet/evidence` state lets reviews be requested: any settled
 * check. A failed check over a finalized record is a qualified record, not none.
 * @param {"success"|"pending"|"failed"|"absent"} state
 * @returns {boolean}
 */
export function evidenceSettled(state) {
  return state === "success" || state === "failed"
}

async function main() {
  if (!process.env.GITHUB_TOKEN || !repo || !prNumber || !headSha) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA are required")
  }
  const reviewers = parseReviewers(process.env.GARNET_REVIEWERS)
  if (reviewers.length === 0) {
    console.log("GARNET_REVIEWERS is empty; nothing to request.")
    return
  }
  const pr = await github(`/repos/${repo}/pulls/${prNumber}`)
  if (pr.head?.sha !== headSha) {
    console.log(`PR head moved (${pr.head?.sha?.slice(0, 7)} != ${headSha.slice(0, 7)}); not requesting reviews for a stale record.`)
    return
  }
  const comments = await listComments()
  if (alreadyRequestedFor(comments, headSha)) {
    console.log(`Reviews were already requested for head ${headSha.slice(0, 7)}; nothing to do.`)
    return
  }
  if (!comments.some((comment) => isFinalizedRecordFor(comment, headSha))) {
    console.log(`No finalized record bound to head ${headSha.slice(0, 7)}; reviews are not requested without evidence.`)
    return
  }
  const check = await awaitEvidenceCheck(headSha)
  if (!evidenceSettled(check)) {
    console.log(`${EVIDENCE_CHECK} is ${check} for head ${headSha.slice(0, 7)}; reviews are requested only after it settles.`)
    return
  }
  const current = await github(`/repos/${repo}/pulls/${prNumber}`)
  if (current.head?.sha !== headSha) {
    console.log(`PR head moved while waiting (${current.head?.sha?.slice(0, 7)} != ${headSha.slice(0, 7)}); not requesting reviews for a stale record.`)
    return
  }
  if (alreadyRequestedFor(await listComments(), headSha)) {
    console.log(`Reviews were requested for head ${headSha.slice(0, 7)} by another run while waiting; nothing to do.`)
    return
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wait = settleWaitMs((await listComments()).filter((comment) => isFinalizedRecordFor(comment, headSha)), Date.now())
    if (wait === 0) break
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  const requested = []
  if (reviewers.includes("devin") && heldForRecord(current)) {
    if (await releaseHold(current)) requested.push("devin")
  } else if (reviewers.includes("devin") && await requestDevin(pr.html_url)) requested.push("devin")
  if (reviewers.includes("copilot") && await requestCopilot(pr.html_url)) requested.push("copilot")
  if (reviewers.includes("bugbot") && await requestBugbot(pr.html_url)) requested.push("bugbot")
  const body = renderRequestComment(reviewers, headSha, requested)
  await github(`/repos/${repo}/issues/${prNumber}/comments`, { method: "POST", body: JSON.stringify({ body }) })
  const mentioned = reviewers.filter((name) => name in MENTIONS)
  console.log(`posted one re-review request for head ${headSha.slice(0, 7)}: mentioned ${mentioned.join(", ") || "none"}; API requested ${requested.join(", ") || "none"}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
