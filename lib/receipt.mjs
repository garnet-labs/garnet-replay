const GITHUB_PR_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/i
const MARKER_COMMIT_RE = /<!--\s*garnet:commit\s+([0-9a-f]{40})\s*-->/i
const SUMMARY_RE = /<!--\s*garnet:summary\s+(\{.*?\})\s*-->/is
const PENDING_MARKER_RE = /<!--\s*garnet-control-plane-pending-pr-comment:/i
const FINAL_MARKER_RE = /<!--\s*garnet-control-plane-pr-comment:v1(?::[^>]*)?\s*-->/i
const PROFILE_RE = /[?&]profile=([0-9a-f-]{36})/i
const RUN_RE = /\/(?:actions\/runs|public\/runs)\/(\d+)/i
const STICKY_MARKER = "<!-- garnet-runtime-review -->"
const GARNET_BOT_LOGIN = "garnet-runtime-review[bot]"

/**
 * Parse a GitHub pull request URL.
 * @param {string} url
 * @returns {{owner: string, repo: string, number: number}}
 */
export function parsePrUrl(url) {
  if (typeof url !== "string") {
    throw new Error("expected a GitHub pull request URL")
  }
  const match = GITHUB_PR_RE.exec(url.trim())
  if (match === null) {
    throw new Error(`not a GitHub pull request URL: ${url}`)
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

/**
 * Identify a Runtime Review App comment.
 * @param {Record<string, unknown>} comment
 * @returns {boolean}
 */
export function isGarnetComment(comment) {
  const user = comment !== null && typeof comment.user === "object" && comment.user !== null
    ? /** @type {Record<string, unknown>} */ (comment.user)
    : null
  const login = user !== null && typeof user.login === "string" ? user.login : ""
  const body = typeof comment?.body === "string" ? comment.body : ""
  return login === GARNET_BOT_LOGIN || body.includes(STICKY_MARKER)
}

/**
 * Parse machine markers and links from a Runtime Review comment.
 * `final` is true only for a comment that carries a summary marker, no
 * pending marker, and no summary status other than "finalized"; the App
 * posts a head-bound placeholder first and rewrites it in place.
 * @param {string} commentBody
 * @returns {{markerCommit: string|null, summary: Record<string, unknown>|null, pending: boolean, finalMarker: boolean, noProfile: boolean, final: boolean, profileId: string|null, runId: string|null, permalink: string|null, body: string}}
 */
export function parseReceipt(commentBody) {
  const body = typeof commentBody === "string" ? commentBody : ""
  const markerMatch = MARKER_COMMIT_RE.exec(body)
  const summaryMatch = SUMMARY_RE.exec(body)
  let summary = null
  if (summaryMatch !== null) {
    try {
      const parsed = JSON.parse(summaryMatch[1])
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        summary = parsed
      }
    } catch {
      summary = null
    }
  }
  const profileMatch = PROFILE_RE.exec(body)
  const runMatch = RUN_RE.exec(body)
  const permalinkMatch = /https:\/\/app\.garnet\.ai\/public\/runs\/\d+(?:\?[^\s)"'<]*)?/i.exec(body)
  const pending = PENDING_MARKER_RE.test(body)
  const finalMarker = FINAL_MARKER_RE.test(body)
  const noProfile = finalMarker && summary === null && /\bnot recorded\b/i.test(body)
  const status = summary !== null ? summary.status : undefined
  const final = !pending && summary !== null && (status === undefined || status === "finalized")
  return {
    markerCommit: markerMatch?.[1] ?? null,
    summary,
    pending,
    finalMarker,
    noProfile,
    final,
    profileId: profileMatch?.[1] ?? null,
    runId: runMatch?.[1] ?? null,
    permalink: permalinkMatch?.[0] ?? null,
    body,
  }
}

async function githubGet(path, token, fetchImpl = fetch) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  }
  if (typeof token === "string" && token !== "") {
    headers.authorization = `Bearer ${token}`
  }
  const response = await fetchImpl(`https://api.github.com${path}`, { headers })
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`)
  }
  return response.json()
}

async function fetchPages(path, token, fetchImpl = fetch) {
  const entries = []
  for (let page = 1; ; page += 1) {
    const pageEntries = await githubGet(`${path}?per_page=100&page=${page}`, token, fetchImpl)
    if (!Array.isArray(pageEntries)) {
      throw new Error(`GitHub API returned a non-array page for ${path}`)
    }
    entries.push(...pageEntries)
    if (pageEntries.length < 100) {
      return entries
    }
  }
}

/**
 * Fetch pull request metadata, changed files, and issue comments.
 * @param {{owner: string, repo: string, number: number, token?: string, fetchImpl?: Function}} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchPullRequest({ owner, repo, number, token, fetchImpl = fetch }) {
  const encodedOwner = encodeURIComponent(owner)
  const encodedRepo = encodeURIComponent(repo)
  const prPath = `/repos/${encodedOwner}/${encodedRepo}/pulls/${number}`
  const pr = /** @type {Record<string, any>} */ (await githubGet(prPath, token, fetchImpl))
  const files = /** @type {Array<Record<string, any>>} */ (
    await fetchPages(`${prPath}/files`, token, fetchImpl)
  )
  const comments = /** @type {Array<Record<string, any>>} */ (
    await fetchPages(`/repos/${encodedOwner}/${encodedRepo}/issues/${number}/comments`, token, fetchImpl)
  )
  const garnet = comments.find(isGarnetComment)
  const receipt = garnet === undefined ? parseReceipt("") : parseReceipt(garnet.body)
  const headSha = pr.head.sha
  return {
    pr_number: number,
    url: pr.html_url,
    title: pr.title,
    body: pr.body ?? "",
    head_sha: headSha,
    base_sha: pr.base.sha,
    state: pr.state,
    author_login: pr.user?.login ?? null,
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ?? "",
    })),
    garnet_comment_present: garnet !== undefined,
    garnet_comment_author: garnet?.user?.login ?? null,
    garnet_comment_url: garnet?.html_url ?? null,
    garnet_exact_head: receipt.markerCommit === headSha,
    garnet_marker_commit: receipt.markerCommit,
    garnet_summary: receipt.summary,
    garnet_comment_body: garnet?.body ?? null,
    other_comments: comments
      .filter((comment) => garnet === undefined || comment.id !== garnet.id)
      .map((comment) => ({ user: comment.user?.login, body: comment.body })),
  }
}

const JOB_FOLD_RE = /<details>\s*<summary><b>([^<]+?)(?: \(recorded\))?<\/b>([^<]*)<br>[\s\S]*?↳<\/span>\s*([\s\S]*?)<\/summary>/g
const REMOVED_FOLD_RE = /<summary>(\d+) jobs? ran on <code>([^<]+)<\/code>, not on this commit<\/summary>\s*<blockquote>([\s\S]*?)<\/blockquote>/i
const BASELINE_RE = /compared with the last (\d+) runs on `([^`]+)`/i
const CODE_RE = /<code>([^<]+)<\/code>/g

/**
 * Unescape the few HTML entities the App writes inside job folds.
 * @param {string} text
 * @returns {string}
 */
function unescapeHtml(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
}

/**
 * Per-job rows of the App comment: the job name, the App's own outcome for
 * it, and for a changed job the acting process and the new destinations the
 * fold names. Observed strings are untrusted data; callers render them as code.
 * @param {string} commentBody
 * @returns {{job: string, outcome: "nothing new"|"changed", added: number, process: string|null, hosts: string[]}[]}
 */
export function appJobs(commentBody) {
  const body = typeof commentBody === "string" ? commentBody : ""
  const rows = []
  for (const match of body.matchAll(JOB_FOLD_RE)) {
    const job = unescapeHtml(match[1].trim())
    const plus = /\+(\d+)/.exec(match[2])
    const detail = match[3].trim()
    if (/^nothing new\b/i.test(detail)) {
      rows.push({ job, outcome: "nothing new", added: 0, process: null, hosts: [] })
      continue
    }
    const codes = [...detail.matchAll(CODE_RE)].map((code) => unescapeHtml(code[1]))
    const reaches = /now reaches/i.test(detail)
    rows.push({
      job,
      outcome: "changed",
      added: plus !== null ? Number(plus[1]) : 0,
      process: reaches && codes.length > 0 ? codes[0] : null,
      hosts: reaches ? codes.slice(1) : codes,
    })
  }
  return rows
}

/**
 * The App's own result, read from the summary marker and the job folds,
 * never from prose. Locked wording: changed | nothing new | capture incomplete.
 * A best-effort record keeps its qualifier; it is never complete or clean.
 * A removed job (ran on the base branch, not on this commit) is listed and
 * is not a change by itself.
 * @param {Record<string, unknown>|null} summary
 * @param {string} [commentBody]
 * @returns {{result: "changed"|"nothing new"|"capture incomplete", capture: string, jobs: number|null,
 *   changedJobs: number|null, removedJobs: string[], baseline: string|null, line: string|null, perJob: ReturnType<typeof appJobs>}|null}
 */
export function appResult(summary, commentBody = "") {
  if (summary === null || typeof summary !== "object") return null
  const body = typeof commentBody === "string" ? commentBody : ""
  const capture = typeof summary.capture_quality === "string" ? summary.capture_quality
    : typeof summary.capture === "string" ? summary.capture : "not declared"
  const finalized = summary.status === undefined || summary.status === "finalized"
  const incomplete = Number.isInteger(summary.incomplete) && summary.incomplete > 0
  const declared = capture === "complete" || capture === "best-effort"
  let result = "capture incomplete"
  if (finalized && declared && !incomplete) {
    if (summary.outcome === "changed" || (Number.isInteger(summary.changed) && summary.changed > 0)) result = "changed"
    else if (summary.outcome === "unchanged" || (capture === "complete" && summary.outcome === undefined && summary.changed === 0)) result = "nothing new"
  }
  const removed = REMOVED_FOLD_RE.exec(body)
  const removedJobs = removed !== null ? [...removed[3].matchAll(CODE_RE)].map((code) => unescapeHtml(code[1])) : []
  const baseline = BASELINE_RE.exec(body)
  return {
    result,
    capture,
    jobs: Number.isInteger(summary.jobs) ? summary.jobs : null,
    changedJobs: Number.isInteger(summary.changed) ? summary.changed : null,
    removedJobs,
    baseline: baseline !== null ? `last ${baseline[1]} runs on ${baseline[2]}` : null,
    line: typeof summary.line === "string" ? summary.line : null,
    perJob: appJobs(body),
  }
}

/**
 * One-line rendering of an App result, naming the capture qualifier.
 * @param {ReturnType<typeof appResult>} app
 * @returns {string}
 */
/**
 * The App result only when the record is bound to the current head; null otherwise.
 * @param {{garnet_exact_head?: boolean, garnet_summary?: object|null, garnet_comment_body?: string}} pr
 * @returns {ReturnType<typeof appResult>}
 */
export function headBoundAppResult(pr) {
  if (pr === null || typeof pr !== "object" || pr.garnet_exact_head !== true) return null
  return appResult(pr.garnet_summary ?? null, pr.garnet_comment_body ?? "")
}

export function appResultLine(app) {
  if (app === null) return "no App summary"
  const counts = app.jobs !== null && app.changedJobs !== null ? ` · ${app.changedJobs} of ${app.jobs} recorded jobs changed` : ""
  const removed = app.removedJobs.length > 0 ? ` · ${app.removedJobs.length} removed job${app.removedJobs.length === 1 ? "" : "s"} (not a change by itself)` : ""
  const baseline = app.baseline !== null ? ` · compared with the ${app.baseline}` : ""
  const scoped = app.capture === "complete" ? "" : " · scoped result, not complete capture"
  return `${app.result}${counts}${removed}${baseline} · capture ${app.capture}${scoped}`
}
