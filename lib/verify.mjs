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
import { publicProfile } from "./gh.mjs"

const REPLAY_MARKER_RE = /<!--\s*garnet:replay\s+(\{.*?\})\s*-->/s
const PAIR_LINE_RE = /base [0-9a-f]{7} → head [0-9a-f]{7} · scope [a-z-]+/
const DIFF_HEADER_RE = /@@ ([0-9a-f]{7}) \(previous\) vs ([0-9a-f]{7}) \(this commit\) @@/
const PLACEHOLDER_RE = /(<!--\s*garnet-control-plane-pending-pr-comment:|\b(?:recording in progress|still being recorded|will be updated|updates in place as jobs finish|placeholder|awaiting (?:the )?record|waiting for (?:the )?(?:record|sensor|profile)|not yet recorded|pending record)\b)/i
const RESIDUE_RE = /(app\.devin\.ai|\bdevin\b|\bcognition\b|written by devin|\bharness\b|replay scaffold|DEPENDENCY_REPLAY\.md|<!--\s*garnet-replay-scaffold)/i
const GARNET_CHECK_RE = /garnet/i
const ACTION_STEP_RE = /garnet-org\/action/i
const START_FAILURE_RE = /Jibril did not start: (.*?)\. The workflow continues without runtime monitoring/

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

/** Require the public report to name the requested repository, run, profile and head. */
export function publicProfileIdentity({ profile, permalink, repository, headSha }) {
  const url = new URL(permalink)
  const run = profile?.run
  const wantedRun = url.pathname.split("/").at(-1)
  const wantedProfile = url.searchParams.get("profile")
  if (run === null || typeof run !== "object") {
    return leg("public profile identity", false, "public report carries no run identity")
  }
  const matched = run.repository === repository && run.run_id === wantedRun
    && wantedProfile !== null && run.profile_id === wantedProfile && run.commit_sha === headSha
  return leg("public profile identity", matched,
    `${run.repository ?? "unknown repository"} / run ${run.run_id ?? "unknown"} / profile ${run.profile_id ?? "unknown"}; recorded ${run.commit_sha ?? "unknown"} (${run.ref ?? "unknown ref"}); expected head ${headSha}`)
}

/**
 * Every job in the recording run that ran the Garnet action must have started the sensor.
 * A job whose sensor did not start is silent in the record, so the record
 * covers fewer jobs than ran.
 * @param {{runId: string|null, jobs: {name: string, log: string|null}[]|null}} input
 * @returns {{name: string, ok: boolean, detail: string}}
 */
export function sensorCoverage({ runId, jobs }) {
  if (runId === null) return leg("sensor coverage", false, "the record names no recording run")
  if (jobs === null) return leg("sensor coverage", false, `jobs of run ${runId} could not be read`)
  if (jobs.length === 0) return leg("sensor coverage", false, `no job in run ${runId} ran garnet-org/action`)
  const unread = jobs.filter((job) => job.log === null)
  const failed = jobs.map((job) => ({ job, match: job.log === null ? null : START_FAILURE_RE.exec(job.log) })).filter(({ match }) => match !== null)
  const ok = unread.length === 0 && failed.length === 0
  const parts = [
    ...failed.map(({ job, match }) => `${job.name}: sensor did not start (${match[1]})`),
    ...unread.map((job) => `${job.name}: log unreadable`),
  ]
  return leg("sensor coverage", ok, ok ? `sensor started in ${jobs.length} of ${jobs.length} job${jobs.length === 1 ? "" : "s"}` : `${parts.join("; ")}; ${jobs.length - failed.length - unread.length} of ${jobs.length} jobs covered`)
}

/**
 * Evaluate one exhibit from already-gathered inputs.
 * @param {{
 *   pr: {head_sha: string, base_sha: string, state: string, body: string, labels?: string[]},
 *   comments: {user?: string|null, body: string, updated_at?: string|null}[],
 *   checks: {name: string, status: string, conclusion: string|null, details_url?: string|null}[],
 *   permalinkStatus: number|null,
 *   expectedLabel?: "real"|"constructed"|null,
 *   profileChecks?: {name: string, ok: boolean, detail: string}[],
 *   coverage?: {name: string, ok: boolean, detail: string}|null,
 *   requireCompleteCapture?: boolean,
 * }} input
 * @returns {{status: "PASS"|"FAIL", legs: {name: string, ok: boolean, detail: string}[], reasons: string[], head: string}}
 */
export function evaluateExhibit({ pr, comments, checks, permalinkStatus, expectedLabel = null, profileChecks = [], coverage = null, requireCompleteCapture = false }) {
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

  const appCapture = receipt.summary === null ? null : receipt.summary.capture_quality ?? receipt.summary.capture ?? null
  if (requireCompleteCapture) {
    const capture = marker === null ? appCapture : marker.capture
    legs.push(leg("capture completeness", capture === "complete",
      capture === "complete" ? "capture declared complete" : `capture ${capture ?? "not declared"}; comparison undeterminable`))
  }
  const finalizedDeclared = marker !== null
    ? marker.capture === "complete" && marker.final === true
    : receipt.final && (appCapture === null || appCapture === "complete")
  const placeholder = PLACEHOLDER_RE.exec(body)
  legs.push(leg(
    "comment finalized",
    comment !== null && finalizedDeclared && placeholder === null,
    comment === null ? "no record"
      : placeholder !== null ? `placeholder text present: "${placeholder[0]}"`
        : finalizedDeclared
          ? (marker !== null || appCapture !== null ? "record declares a complete, final capture" : "record is final; its contract does not declare capture completeness")
          : marker !== null ? `record declares capture ${JSON.stringify(marker.capture ?? null)}, not complete and final`
            : receipt.summary === null ? "no machine summary on the record"
              : receipt.pending ? "record still pending"
                : appCapture !== null ? `record declares capture ${JSON.stringify(appCapture)}, not complete`
                  : `record status ${JSON.stringify(receipt.summary.status ?? null)}, not finalized`,
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
  const summaryPair = receipt.summary !== null && typeof receipt.summary.commit === "string" && /^[0-9a-f]{40}$/.test(receipt.summary.commit)
    && typeof receipt.summary.previous === "string" && /^[0-9a-f]{40}$/.test(receipt.summary.previous)
    ? { previous: receipt.summary.previous, commit: receipt.summary.commit }
    : null
  const pairPresent = PAIR_LINE_RE.test(body) || diffHeader !== null || summaryPair !== null || (marker !== null && typeof marker.pair === "string" && marker.pair !== "")
  const headerMatches = diffHeader === null || pr.head_sha.startsWith(diffHeader[2])
  const summaryMatches = summaryPair === null || summaryPair.commit === pr.head_sha
  const pairMatches = marker === null
    ? receipt.markerCommit === pr.head_sha && headerMatches && summaryMatches
    : marker.commit === pr.head_sha && (marker.scope !== "pr-base-to-head" || marker.base === pr.base_sha)
  legs.push(leg(
    "pair line",
    pairPresent && pairMatches,
    !pairPresent ? "no pair line on the comment"
      : !pairMatches ? "pair does not name the current PR commits"
        : diffHeader !== null && marker === null ? `pair ${diffHeader[1]} (previous) → ${diffHeader[2]} (this commit) names the current head`
          : summaryPair !== null && marker === null ? `pair ${summaryPair.previous.slice(0, 7)} (previous) → ${summaryPair.commit.slice(0, 7)} (this commit) from the record summary`
            : "pair names the current base/head",
  ))

  legs.push(leg("public permalink", permalinkStatus === 200, receipt.permalink === null ? "no public profile link on the comment" : `GET ${receipt.permalink} → ${permalinkStatus ?? "unreachable"}`))

  const recordRunPath = receipt.runId === null ? null : `/actions/runs/${receipt.runId}/`
  const recordingChecks = recordRunPath === null ? [] : checks.filter((check) => typeof check.details_url === "string" && check.details_url.includes(recordRunPath))
  const garnetChecks = recordingChecks.length > 0 ? recordingChecks : checks.filter((check) => GARNET_CHECK_RE.test(check.name))
  const pendingChecks = garnetChecks.filter((check) => check.status !== "completed")
  const unsuccessful = garnetChecks.filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion))
  legs.push(leg(
    "check settled",
    garnetChecks.length > 0 && pendingChecks.length === 0 && unsuccessful.length === 0,
    garnetChecks.length === 0 ? (recordRunPath === null ? "no Garnet check on the head commit" : `no check on the head commit belongs to run ${receipt.runId}, the run the record names`)
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
  legs.push(...profileChecks)
  if (coverage !== null) legs.push(coverage)

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

async function githubGetText(path, token, fetchImpl) {
  const headers = { "x-github-api-version": "2022-11-28" }
  if (typeof token === "string" && token !== "") headers.authorization = `Bearer ${token}`
  const response = await fetchImpl(`https://api.github.com${path}`, { headers, redirect: "follow" })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.text()
}

async function recordingJobs(base, runId, token, fetchImpl) {
  if (runId === null) return null
  try {
    const jobs = await githubGetAll(`${base}/actions/runs/${runId}/jobs?per_page=100`, token, fetchImpl, "jobs")
    const instrumented = jobs.filter((job) => (job.steps ?? []).some((step) => ACTION_STEP_RE.test(step.name ?? "") && step.conclusion !== "skipped"))
    return Promise.all(instrumented.map(async (job) => {
      try {
        return { name: job.name, log: await githubGetText(`${base}/actions/jobs/${job.id}/logs`, token, fetchImpl) }
      } catch {
        return { name: job.name, log: null }
      }
    }))
  } catch {
    return null
  }
}

async function githubGetAll(pathWithQuery, token, fetchImpl, key) {
  const entries = []
  for (let page = 1; page <= 20; page += 1) {
    const separator = pathWithQuery.includes("?") ? "&" : "?"
    const body = await githubGet(`${pathWithQuery}${separator}page=${page}`, token, fetchImpl)
    const pageEntries = key === null ? body : body?.[key]
    if (!Array.isArray(pageEntries)) return entries
    entries.push(...pageEntries)
    if (typeof body?.total_count === "number" && entries.length >= body.total_count) return entries
    if (pageEntries.length < 100) return entries
  }
  return entries
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
  const rawComments = await githubGetAll(`${base}/issues/${number}/comments?per_page=100`, token, fetchImpl, null)
  const checkRuns = await githubGetAll(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`, token, fetchImpl, "check_runs")
  const comments = rawComments.map((comment) => ({
    user: comment.user?.login ?? null,
    body: typeof comment.body === "string" ? comment.body : "",
    updated_at: comment.updated_at ?? null,
  }))
  const garnetComment = comments.filter((comment) => isGarnetComment({ user: { login: comment.user ?? "" }, body: comment.body }) || REPLAY_MARKER_RE.test(comment.body)).at(-1)
  const permalink = garnetComment === undefined ? null : parseReceipt(garnetComment.body).permalink
  const permalinks = [...new Set([...(garnetComment?.body ?? "").matchAll(/https:\/\/app\.garnet\.ai\/public\/runs\/\d+(?:\?[^\s)"'<]*)?/gi)]
    .map((match) => match[0].replace(/&amp;/g, "&")))]
  const profileChecks = await Promise.all(permalinks.map(async (link) => {
    try {
      const profile = await publicProfile(link, { fetchImpl })
      return publicProfileIdentity({ profile, permalink: link, repository: `${owner}/${repo}`, headSha: pr.head.sha })
    } catch (error) {
      return leg("public profile identity", false, `${link}: ${error.message}`)
    }
  }))
  if (profileChecks.length === 0) {
    profileChecks.push(leg("public profile identity", false, "no exact public run/profile selector on the record"))
  }
  let permalinkStatus = null
  if (permalink !== null) {
    try {
      const response = await fetchImpl(permalink, { method: "GET", redirect: "follow" })
      permalinkStatus = response.status
    } catch {
      permalinkStatus = null
    }
  }
  const runId = garnetComment === undefined ? null : parseReceipt(garnetComment.body).runId
  const coverage = sensorCoverage({ runId, jobs: await recordingJobs(base, runId, token, fetchImpl) })
  const checks = checkRuns.map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion ?? null, details_url: typeof run.details_url === "string" ? run.details_url : null }))
  const result = evaluateExhibit({
    pr: { head_sha: pr.head.sha, base_sha: pr.base.sha, state: pr.state, body: pr.body ?? "", labels: (pr.labels ?? []).map((label) => label.name) },
    comments,
    checks,
    permalinkStatus,
    expectedLabel,
    profileChecks,
    coverage,
    requireCompleteCapture: true,
  })
  return { ...result, pr_url: prUrl }
}

/**
 * Process exit code for the share gate: only PASS exits 0.
 * @param {{status: string}} result
 * @returns {0|1}
 */
export function verifyExitCode(result) {
  return result.status === "PASS" ? 0 : 1
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
