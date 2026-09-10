/**
 * Exhibit verifier: the gate every PR passes before anyone shares it.
 * Absorbed from the pnpm release gate legs (L2 finalized comment, L4
 * permalink, L5 check state) and the fork-lane cold reads (placeholder read
 * as the record, session residue in PR bodies, wrong real/constructed label).
 *
 * `evaluateExhibit` is pure and fully unit-testable; `verifyExhibit`
 * gathers the live inputs from GitHub and the public profile permalink.
 */

import { assessSupersession } from "./evidence.mjs"
import { isGarnetComment, parsePrUrl, parseReceipt } from "./receipt.mjs"

const REPLAY_MARKER_RE = /<!--\s*garnet:replay\s+(\{.*?\})\s*-->/s
const PAIR_LINE_RE = /base [0-9a-f]{7} → head [0-9a-f]{7} · scope [a-z-]+/
const DIFF_HEADER_RE = /@@ ([0-9a-f]{7}) \(previous\) vs ([0-9a-f]{7}) \(this commit\) @@/
const PLACEHOLDER_RE = /(<!--\s*garnet-control-plane-pending-pr-comment:|\b(?:recording in progress|still being recorded|will be updated|updates in place as jobs finish|placeholder|awaiting (?:the )?record|waiting for (?:the )?(?:record|sensor|profile)|not yet recorded|pending record)\b)/i
const RESIDUE_RE = /(app\.devin\.ai|\bdevin\b|\bcognition\b|written by devin|\bharness\b|replay scaffold|DEPENDENCY_REPLAY\.md|<!--\s*garnet-replay-scaffold)/i
const GARNET_CHECK_RE = /garnet/i

function parseReplayMarker(body) {
  const match = REPLAY_MARKER_RE.exec(typeof body === "string" ? body : "")
  if (match === null) return null
  try {
    const parsed = JSON.parse(match[1].replace(/-\\u002d/g, "--"))
    return parsed !== null && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function leg(name, ok, detail) {
  return { name, ok, detail }
}

/**
 * Evaluate one exhibit from already-gathered inputs.
 * @param {{
 *   pr: {head_sha: string, base_sha: string, state: string, body: string, labels?: string[]},
 *   comments: {user?: string|null, body: string, updated_at?: string|null}[],
 *   checks: {name: string, status: string, conclusion: string|null}[],
 *   permalinkStatus: number|null,
 *   expectedLabel?: "real"|"constructed"|null,
 * }} input
 * @returns {{status: "PASS"|"FAIL", legs: {name: string, ok: boolean, detail: string}[], reasons: string[], head: string}}
 */
export function evaluateExhibit({ pr, comments, checks, permalinkStatus, expectedLabel = null }) {
  const legs = []
  const garnetComments = comments.filter((comment) => isGarnetComment({ user: { login: comment.user ?? "" }, body: comment.body }) || REPLAY_MARKER_RE.test(comment.body ?? ""))
  const comment = garnetComments.at(-1) ?? null
  legs.push(leg("comment present", comment !== null, comment === null ? "no Runtime Review or replay comment on the PR" : `${garnetComments.length} Garnet comment${garnetComments.length === 1 ? "" : "s"}`))
  const body = comment?.body ?? ""
  const receipt = parseReceipt(body)
  const marker = parseReplayMarker(body)

  const recordHead = marker?.commit ?? receipt.markerCommit ?? null
  const supersession = assessSupersession({
    recordHeadSha: recordHead,
    currentHeadSha: pr.head_sha,
    recordBaseSha: marker?.scope === "pr-base-to-head" ? marker.base ?? null : null,
    currentBaseSha: pr.base_sha,
  })
  legs.push(leg("head-bound", comment !== null && !supersession.superseded, comment === null ? "no record" : supersession.superseded ? supersession.reasons.join("; ") : `record bound to ${pr.head_sha.slice(0, 7)}`))

  const declaredStatus = marker?.capture ?? receipt.summary?.status ?? null
  const finalizedDeclared = marker !== null
    ? marker.capture === "complete" && marker.final === true
    : receipt.summary === null ? false : receipt.summary.status === "finalized" && (receipt.summary.capture_quality === undefined || receipt.summary.capture_quality === "complete")
  const placeholder = PLACEHOLDER_RE.exec(body)
  legs.push(leg(
    "comment finalized",
    comment !== null && finalizedDeclared && placeholder === null,
    comment === null ? "no record"
      : placeholder !== null ? `placeholder text present: "${placeholder[0]}"`
        : finalizedDeclared ? "record declares a complete, final capture"
          : `record declares capture ${JSON.stringify(declaredStatus)}, not complete and final`,
  ))

  const verdict = marker?.verdict ?? null
  legs.push(leg(
    "verdict determinable",
    marker === null ? receipt.summary !== null : verdict !== null && verdict !== "undeterminable",
    marker === null
      ? (receipt.summary !== null ? "App summary present" : "no machine summary on the record")
      : verdict === null ? "no verdict on the record" : `verdict ${verdict}`,
  ))

  const diffHeader = DIFF_HEADER_RE.exec(body)
  const pairPresent = PAIR_LINE_RE.test(body) || diffHeader !== null || (marker !== null && typeof marker.pair === "string" && marker.pair !== "")
  const headerMatches = diffHeader === null || pr.head_sha.startsWith(diffHeader[2])
  const pairMatches = marker === null
    ? receipt.markerCommit === pr.head_sha && headerMatches
    : marker.commit === pr.head_sha && (marker.scope !== "pr-base-to-head" || marker.base === pr.base_sha)
  legs.push(leg(
    "pair line",
    pairPresent && pairMatches,
    !pairPresent ? "no pair line on the comment"
      : !pairMatches ? "pair does not name the current PR commits"
        : diffHeader !== null && marker === null ? `pair ${diffHeader[1]} (previous) → ${diffHeader[2]} (this commit) names the current head` : "pair names the current base/head",
  ))

  legs.push(leg("public permalink", permalinkStatus === 200, receipt.permalink === null ? "no public profile link on the comment" : `GET ${receipt.permalink} → ${permalinkStatus ?? "unreachable"}`))

  const garnetChecks = checks.filter((check) => GARNET_CHECK_RE.test(check.name))
  const pendingChecks = garnetChecks.filter((check) => check.status !== "completed")
  const unsuccessful = garnetChecks.filter((check) => check.status === "completed" && check.conclusion !== "success" && check.conclusion !== "neutral")
  legs.push(leg(
    "check settled",
    garnetChecks.length > 0 && pendingChecks.length === 0 && unsuccessful.length === 0,
    garnetChecks.length === 0 ? "no Garnet check on the head commit"
      : pendingChecks.length > 0 ? `${pendingChecks.map((check) => `${check.name} ${check.status}`).join(", ")}`
        : unsuccessful.length > 0 ? unsuccessful.map((check) => `${check.name} concluded ${check.conclusion}`).join(", ")
          : `${garnetChecks.map((check) => check.name).join(", ")} completed`,
  ))

  const residueSources = [pr.body ?? "", ...comments.filter((entry) => entry !== comment).map((entry) => entry.body ?? "")]
  const residue = residueSources.map((source) => RESIDUE_RE.exec(source)).find((match) => match !== null) ?? null
  legs.push(leg("no session residue", residue === null, residue === null ? "PR body and other comments carry no harness or session traces" : `residue: "${residue[0]}"`))

  const carriedLabel = marker?.label ?? (/\bconstructed\b/i.test(body) ? "constructed" : receipt.summary !== null ? "real" : null)
  const labelOk = carriedLabel !== null && (expectedLabel === null || carriedLabel === expectedLabel)
  legs.push(leg("label", labelOk, carriedLabel === null ? "the record carries no real/constructed label" : expectedLabel !== null && carriedLabel !== expectedLabel ? `record says ${carriedLabel}, expected ${expectedLabel}` : `label ${carriedLabel}`))

  legs.push(leg("pull request open", pr.state === "open", `state ${pr.state}`))

  const reasons = legs.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`)
  return { status: reasons.length === 0 ? "PASS" : "FAIL", legs, reasons, head: pr.head_sha }
}

async function githubGet(path, token, fetchImpl) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
  if (typeof token === "string" && token !== "") headers.authorization = `Bearer ${token}`
  const response = await fetchImpl(`https://api.github.com${path}`, { headers })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.json()
}

/**
 * Gather inputs for a PR from GitHub and the public permalink, then evaluate.
 * @param {string} prUrl
 * @param {{token?: string, expectedLabel?: "real"|"constructed"|null, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<ReturnType<typeof evaluateExhibit> & {pr_url: string}>}
 */
export async function verifyExhibit(prUrl, { token, expectedLabel = null, fetchImpl = fetch } = {}) {
  const { owner, repo, number } = parsePrUrl(prUrl)
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const pr = await githubGet(`${base}/pulls/${number}`, token, fetchImpl)
  const rawComments = await githubGet(`${base}/issues/${number}/comments?per_page=100`, token, fetchImpl)
  const checkRuns = await githubGet(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`, token, fetchImpl)
  const comments = (Array.isArray(rawComments) ? rawComments : []).map((comment) => ({
    user: comment.user?.login ?? null,
    body: typeof comment.body === "string" ? comment.body : "",
    updated_at: comment.updated_at ?? null,
  }))
  const garnetComment = comments.filter((comment) => isGarnetComment({ user: { login: comment.user ?? "" }, body: comment.body }) || REPLAY_MARKER_RE.test(comment.body)).at(-1)
  const permalink = garnetComment === undefined ? null : parseReceipt(garnetComment.body).permalink
  let permalinkStatus = null
  if (permalink !== null) {
    try {
      const response = await fetchImpl(permalink, { method: "GET", redirect: "follow" })
      permalinkStatus = response.status
    } catch {
      permalinkStatus = null
    }
  }
  const checks = (checkRuns.check_runs ?? []).map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion ?? null }))
  const result = evaluateExhibit({
    pr: { head_sha: pr.head.sha, base_sha: pr.base.sha, state: pr.state, body: pr.body ?? "", labels: (pr.labels ?? []).map((label) => label.name) },
    comments,
    checks,
    permalinkStatus,
    expectedLabel,
  })
  return { ...result, pr_url: prUrl }
}

/**
 * Human report for the terminal.
 * @param {ReturnType<typeof evaluateExhibit> & {pr_url?: string}} result
 * @returns {string}
 */
export function renderVerifyReport(result) {
  const lines = [`${result.status} ${result.pr_url ?? ""} (head ${result.head.slice(0, 7)})`.trim()]
  for (const entry of result.legs) {
    lines.push(`  [${entry.ok ? "ok" : "no"}] ${entry.name}: ${entry.detail}`)
  }
  if (result.status === "FAIL") lines.push("not shareable until every leg reads ok")
  return lines.join("\n")
}
