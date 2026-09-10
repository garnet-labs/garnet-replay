/**
 * `replay consume <pr-url>`: did a reviewer or agent consume the record?
 * Reads the fork pull request body, reviews, review comments and issue
 * comments, and reports head-bound consumption evidence. Fail closed: a
 * citation counts only when it names the current head commit or quotes the
 * head-bound record; anything else is reported as not consumed.
 */
import { writeFileSync } from "node:fs"
import { run, viewPr, prComments, prReviews, prReviewComments, checkRuns, isRuntimeReviewComment, latestRuntimeReviewComment } from "./gh.mjs"
import { parseReceipt } from "./receipt.mjs"
import { CLAIM_CLASSES } from "./evidence.mjs"
import { assertVocabClean, repoFromUrl } from "./guards.mjs"
import { outPath } from "./ledger.mjs"

export const MIRROR_BEGIN = "<!-- garnet:evidence:begin -->"
export const MIRROR_END = "<!-- garnet:evidence:end -->"
const GROUNDING_RE = /\*\*Runtime grounding\*\*\s*\(head\s+`?([0-9a-f]{7,40})`?\)/i
const SHA7_RE = /\b([0-9a-f]{7,40})\b/g

function bound(commit, headSha) {
  if (typeof commit !== "string" || typeof headSha !== "string") return false
  const left = commit.toLowerCase()
  const right = headSha.toLowerCase()
  return left.length <= right.length ? right.startsWith(left) : left.startsWith(right)
}

function citesHead(text, headSha) {
  if (typeof text !== "string" || typeof headSha !== "string") return false
  for (const match of text.matchAll(SHA7_RE)) if (bound(match[1], headSha)) return true
  return false
}

/**
 * @param {object} input
 * @param {{headRefOid?: string, body?: string, author?: {login?: string}}} input.pr
 * @param {Array<{body?: string, user?: {login?: string}}>} input.comments  issue comments
 * @param {Array<{body?: string, user?: {login?: string}, state?: string, commit_id?: string}>} input.reviews
 * @param {Array<{body?: string, user?: {login?: string}, commit_id?: string}>} input.reviewComments
 * @param {Array<{name?: string, status?: string, conclusion?: string|null}>} input.checks
 */
export function evaluateConsumption({ pr, comments = [], reviews = [], reviewComments = [], checks = [] }) {
  const headSha = typeof pr?.headRefOid === "string" ? pr.headRefOid : null
  const findings = []
  const add = (kind, ok, detail, claimClass) => findings.push({ kind, ok, detail, claimClass })

  const record = latestRuntimeReviewComment(comments)
  const receipt = record === null ? null : parseReceipt(record.body)
  const recordBound = receipt !== null && bound(receipt.markerCommit, headSha)
  add("record", recordBound,
    record === null ? "no Runtime Review comment on the pull request"
      : recordBound ? `record bound to head ${headSha.slice(0, 7)}` : `record bound to ${String(receipt.markerCommit ?? "unknown").slice(0, 7)}, head is ${String(headSha ?? "unknown").slice(0, 7)}`,
    CLAIM_CLASSES.COMPARISON)

  const body = typeof pr?.body === "string" ? pr.body : ""
  const mirrorPresent = body.includes(MIRROR_BEGIN) && body.includes(MIRROR_END)
  const mirrorBlock = mirrorPresent ? body.slice(body.indexOf(MIRROR_BEGIN), body.indexOf(MIRROR_END)) : ""
  const mirrorBound = mirrorPresent && citesHead(mirrorBlock, headSha)
  add("mirror", mirrorBound,
    !mirrorPresent ? "no evidence mirror in the pull request body"
      : mirrorBound ? "evidence mirror in the body names the head commit" : "evidence mirror in the body does not name the head commit",
    CLAIM_CLASSES.CONSUMPTION)

  const consumers = []
  const humanOrAgent = (login) => typeof login === "string" && !/^garnet/i.test(login) && login !== pr?.author?.login
  for (const review of reviews) {
    const login = review.user?.login
    if (!humanOrAgent(login)) continue
    const text = typeof review.body === "string" ? review.body : ""
    const grounding = GROUNDING_RE.exec(text)
    const cited = (grounding !== null && bound(grounding[1], headSha)) || (citesHead(text, headSha) && /garnet|runtime|record|execution chain|outbound/i.test(text))
    const onHead = bound(review.commit_id, headSha)
    if (cited && onHead) consumers.push(`${login} (review ${String(review.state ?? "").toLowerCase() || "comment"})`)
  }
  for (const comment of [...reviewComments, ...comments]) {
    if (isRuntimeReviewComment(comment)) continue
    const login = comment.user?.login
    if (!humanOrAgent(login)) continue
    const text = typeof comment.body === "string" ? comment.body : ""
    const grounding = GROUNDING_RE.exec(text)
    const cited = (grounding !== null && bound(grounding[1], headSha)) || (citesHead(text, headSha) && /garnet|runtime|record|execution chain|outbound/i.test(text))
    if (cited && (comment.commit_id === undefined || bound(comment.commit_id, headSha))) consumers.push(`${login} (comment)`)
  }
  const unique = [...new Set(consumers)]
  add("consumers", unique.length > 0,
    unique.length > 0 ? `head-bound citation by ${unique.join(", ")}` : "no reviewer or agent cited the head-bound record",
    CLAIM_CLASSES.CONSUMPTION)

  const garnetChecks = checks.filter((check) => /garnet/i.test(String(check.name ?? "")))
  const settled = garnetChecks.filter((check) => check.status === "completed")
  add("check", garnetChecks.length > 0 && settled.length === garnetChecks.length,
    garnetChecks.length === 0 ? "no Garnet check on the head commit"
      : settled.length === garnetChecks.length
        ? garnetChecks.map((check) => `${check.name}: ${check.conclusion ?? "completed"}`).join(" · ")
        : `${garnetChecks.length - settled.length} of ${garnetChecks.length} Garnet check(s) still running`,
    CLAIM_CLASSES.CHECK)

  const consumed = recordBound && unique.length > 0
  return { headSha, consumed, consumers: unique, mirror: mirrorBound, recordBound, findings }
}

export function renderConsumeReport(result, { prUrl }) {
  const lines = []
  lines.push(`<!-- garnet:consume pr=${prUrl} head=${result.headSha ?? "unknown"} consumed=${result.consumed} -->`)
  lines.push(`### Consumption · ${prUrl}`)
  lines.push("")
  lines.push(`head: ${result.headSha !== null ? `\`${result.headSha.slice(0, 7)}\` · \`${result.headSha}\`` : "undeterminable"}`)
  lines.push("")
  lines.push(result.consumed
    ? `**consumed** · ${result.consumers.length} reviewer(s) or agent(s) cited the head-bound record · ${CLAIM_CLASSES.CONSUMPTION}`
    : `**not consumed** · no head-bound citation on the current head · ${CLAIM_CLASSES.CONSUMPTION}`)
  lines.push("")
  lines.push("| check | state | detail | claim class |")
  lines.push("|---|---|---|---|")
  for (const finding of result.findings) lines.push(`| ${finding.kind} | ${finding.ok ? "yes" : "no"} | ${finding.detail} | ${finding.claimClass} |`)
  lines.push("")
  assertVocabClean(lines.filter((line) => !line.startsWith("|")).join("\n"))
  return `${lines.join("\n")}\n`
}

export function consumePr(prUrl, { exec = run, write = null } = {}) {
  const repo = repoFromUrl(prUrl)
  const match = /\/pull\/(\d+)/.exec(prUrl)
  if (match === null) throw new Error(`not a pull request url: ${prUrl}`)
  const number = Number(match[1])
  const pr = viewPr(repo, number, { exec })
  const comments = prComments(repo, number, { exec })
  const reviews = prReviews(repo, number, { exec })
  const reviewComments = prReviewComments(repo, number, { exec })
  const checks = typeof pr.headRefOid === "string" ? checkRuns(repo, pr.headRefOid, { exec }) : []
  const result = evaluateConsumption({ pr: { ...pr, author: pr.author }, comments, reviews, reviewComments, checks })
  const report = renderConsumeReport(result, { prUrl })
  let path = null
  if (typeof write === "string") {
    path = outPath(write, `pr-${number}-consume.md`)
    writeFileSync(path, report)
  }
  return { repo, number, result, report, path }
}
