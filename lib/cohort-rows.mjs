// Cohort rows: one read-only JSON row per fork pull request, built from the
// finalized head-bound App comment, the fork's reviewer and proof records, and
// the upstream pull request. Nothing here decides; it reads what each source states.

import { run } from "./gh.mjs"
import { assertVocabClean } from "./guards.mjs"
import { appResult, parsePrUrl, parseReceipt } from "./receipt.mjs"
import { verifyExhibit } from "./verify.mjs"

const GARNET_BOT = "garnet-runtime-review[bot]"
const STAMPHOG_MARKER = "<!-- stamphog-sticky-review -->"
const STAMPHOG_VERDICT_RE = /reviewed `([0-9a-f]{7,40})` — verdict: \*\*([A-Z_]+)\*\*/
const LIFTED_RE = /lifted for ([^|]+?) by Dependency proof/
const NOT_ATTESTED_RE = /not attested: ([^|\n]+)/

/**
 * Read the fork reviewer's sticky comment: the head it reviewed, its verdict,
 * and the files the proof attested or failed to attest, as it states them.
 * @param {{body?: string, html_url?: string}|undefined} comment
 * @returns {{verdict: string|null, head: string|null, attested: string[], notAttested: string[], url: string|null}}
 */
export function reviewerResult(comment) {
  const body = typeof comment?.body === "string" ? comment.body : ""
  const verdict = STAMPHOG_VERDICT_RE.exec(body)
  const lifted = LIFTED_RE.exec(body)
  const missing = NOT_ATTESTED_RE.exec(body)
  const list = (m) => m === null ? [] : m[1].split(",").map((s) => s.trim()).filter((s) => s !== "")
  return {
    verdict: verdict?.[2] ?? null,
    head: verdict?.[1] ?? null,
    attested: list(lifted),
    notAttested: list(missing),
    url: typeof comment?.html_url === "string" ? comment.html_url : null,
  }
}

/**
 * Hours from opening to merge, to one decimal; null when not merged.
 * @param {string|null} created
 * @param {string|null} merged
 * @returns {number|null}
 */
export function hoursOpen(created, merged) {
  if (typeof created !== "string" || typeof merged !== "string") return null
  return Math.round((Date.parse(merged) - Date.parse(created)) / 36e5 * 10) / 10
}

/**
 * Build one cohort row from already-fetched records.
 * @param {object} input
 * @returns {object}
 */
export function buildRow({ entry, pr, files, comments, proof, upstream = null, verification = null }) {
  const head = pr.head.sha
  const garnet = comments.filter((c) => c.user?.login === GARNET_BOT).at(-1)
  const receipt = parseReceipt(garnet?.body ?? "")
  const bound = receipt.markerCommit === head && receipt.final === true
  const app = bound ? appResult(receipt.summary, receipt.body) : null
  const reviewer = reviewerResult(comments.filter((c) => typeof c.body === "string" && c.body.includes(STAMPHOG_MARKER)).at(-1))
  const classification = entry.classification ?? {}
  const newHosts = (app?.perJob ?? []).flatMap((job) => job.hosts.map((host) => ({
    host, job: job.job, process: job.process, class: classification[host] ?? "unclassified",
  })))
  return {
    fork_pr: pr.html_url,
    upstream_pr: entry.upstream ?? null,
    author_class: entry.authorClass ?? (pr.user?.type === "Bot" ? "bot" : "human"),
    chained: entry.chained === true,
    files: files.map((f) => f.filename),
    head_sha: head,
    compared_sha: bound ? (receipt.summary?.previous ?? null) : null,
    scope: bound ? (receipt.summary?.scope ?? null) : null,
    record: bound ? "finalized, bound to head" : garnet === undefined ? "no App comment" : "not finalized or not bound to head",
    jobs_recorded: app?.jobs ?? null,
    capture_quality: app?.capture ?? null,
    app_result: app?.result ?? "capture incomplete",
    app_line: app?.line ?? null,
    per_job: (app?.perJob ?? []).map(({ job, outcome, process, hosts }) => ({ job, outcome, process, hosts })),
    removed_jobs: app?.removedJobs ?? [],
    new_hosts: newHosts,
    attestation: {
      proof_check: proof === null ? null : proof.conclusion,
      attested: reviewer.attested.length > 0,
      files: reviewer.attested,
      not_attested: reviewer.notAttested,
    },
    reviewer: { name: "stamphog", verdict: reviewer.verdict, reviewed_head: reviewer.head, current: reviewer.head !== null && head.startsWith(reviewer.head), url: reviewer.url },
    upstream: upstream,
    links: { app_comment: garnet?.html_url ?? null, public_run: receipt.permalink, proof_check: proof?.html_url ?? null },
    verify: verification === null ? null : {
      status: verification.status,
      failed: [...new Set(verification.legs.filter((leg) => leg.ok !== true).map((leg) => leg.name))],
    },
  }
}

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ")
}

/**
 * Render rows as one Markdown table. Every row names head, compared commit, scope and capture.
 * @param {object[]} rows
 * @returns {string}
 */
export function renderRowsTable(rows) {
  const lines = [
    "| Fork PR | Upstream PR | Author | Head → compared (scope) | Capture | Jobs | App result | New hosts (job · process · class) | Attested | Reviewer | Upstream merge | verify |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ]
  for (const row of rows) {
    const hosts = row.new_hosts.length === 0 ? "none" : row.new_hosts.map((h) => `\`${h.host}\` (${h.job} · ${h.process ?? "?"} · ${h.class})`).join("<br>")
    const attested = row.attestation.attested ? `yes (${row.attestation.files.length} files)` : row.attestation.not_attested.length > 0 ? `no: ${row.attestation.not_attested.join(", ")}` : "no"
    const reviewer = row.reviewer.verdict === null ? "none" : `[${row.reviewer.verdict}](${row.reviewer.url})${row.reviewer.current ? "" : " (older head)"}`
    const up = row.upstream === null ? "not read" : `${row.upstream.merged ? `merged after ${row.upstream.hours_open_to_merge} h` : row.upstream.state}${row.upstream.approver !== null ? ` · approved by ${row.upstream.approver}` : ""}${row.upstream.reverted === true ? " · reverted" : ""}`
    const changed = row.per_job.filter((j) => j.outcome === "changed").length
    const app = row.jobs_recorded === null ? row.app_result : `${row.app_result} · ${changed} of ${row.jobs_recorded} jobs changed${row.removed_jobs.length > 0 ? ` · ${row.removed_jobs.length} removed (not a change by itself)` : ""}`
    const capture = row.capture_quality === "best-effort" ? "best-effort (scoped)" : row.capture_quality ?? "not declared"
    lines.push(`| ${[
      `[#${row.fork_pr.split("/").pop()}](${row.fork_pr})`,
      row.upstream_pr === null ? "—" : `${row.upstream_pr}${row.chained ? " (chained)" : ""}`,
      row.author_class,
      `\`${row.head_sha.slice(0, 7)}\` → ${row.compared_sha === null ? "none" : `\`${row.compared_sha.slice(0, 7)}\``} (${row.scope ?? "none"})`,
      capture, row.jobs_recorded ?? "—", app, hosts, attested, reviewer, up,
      row.verify === null ? "not run" : `${row.verify.status}${row.verify.failed.length > 0 ? `: ${row.verify.failed.join(", ")}` : ""}`,
    ].map(cell).join(" | ")} |`)
  }
  const text = lines.join("\n")
  assertVocabClean(text)
  return text
}

/**
 * Render the research-note skeleton around the table. Counts come from the rows only.
 * @param {object[]} rows
 * @param {{question?: string, hypothesis?: string}} [opts]
 * @returns {string}
 */
export function renderResearchNote(rows, { question = "<question>", hypothesis = "<hypothesis>" } = {}) {
  const count = (fn) => rows.filter(fn).length
  const changed = count((r) => r.app_result === "changed")
  const nothing = count((r) => r.app_result === "nothing new")
  const incomplete = count((r) => r.app_result === "capture incomplete")
  const bestEffort = count((r) => r.capture_quality === "best-effort")
  const verifyPass = count((r) => r.verify?.status === "PASS")
  const infra = rows.flatMap((r) => r.new_hosts).filter((h) => h.class === "infra").length
  const unclassified = rows.flatMap((r) => r.new_hosts).filter((h) => h.class === "unclassified").length
  const note = [
    "# Research note", "",
    "## Question", question, "",
    "## Hypothesis", hypothesis, "",
    "## Method",
    "Each upstream pull request was replayed as one commit onto the fork; the fork's own workflows recorded it on GitHub-hosted runners. Each row reads the finalized App comment bound to the head, the fork's proof check and reviewer comment, and the upstream pull request. Garnet's evidence is not approval.", "",
    "## Sample", `${rows.length} fork pull requests; ${bestEffort} with best-effort capture.`, "",
    "## Results", `App results: ${changed} changed, ${nothing} nothing new, ${incomplete} capture incomplete. Strict \`replay verify\`: ${verifyPass} of ${rows.length} PASS.`, "",
    renderRowsTable(rows), "",
    "## Findings", "<findings: one per row group, citing the row>", "",
    "## Limitations",
    `- Best-effort capture is a scoped result, never complete capture; "nothing new" is only that scoped result.`,
    `- Profiles bind to the test-merge ref, so strict public profile identity does not pass on these rows.`,
    `- New hosts classified infra: ${infra}; unclassified: ${unclassified}. The classification is the operator's, per host, job and process.`, "",
    "## Conclusion", "<conclusion>", "",
  ].join("\n")
  assertVocabClean(note)
  return note
}

/**
 * Fetch one row through the GitHub API and the public record. Read-only.
 * @param {{fork: string, upstream?: string, authorClass?: string, chained?: boolean, classification?: Record<string,string>}} entry
 */
export async function collectRow(entry, { exec = run, verifyImpl = verifyExhibit, token = null, withVerify = true } = {}) {
  const { owner, repo, number } = parsePrUrl(entry.fork)
  const api = (path) => JSON.parse(exec("gh", ["api", "--paginate", "--slurp", path])).flat()
  const pr = JSON.parse(exec("gh", ["api", `repos/${owner}/${repo}/pulls/${number}`]))
  const files = api(`repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  const comments = api(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`)
  const checks = api(`repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).flatMap((page) => page.check_runs ?? [])
  const proof = checks.filter((c) => c.name === "Dependency proof").sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at))).at(-1) ?? null
  let upstream = null
  if (typeof entry.upstream === "string") {
    const up = parsePrUrl(entry.upstream)
    const upr = JSON.parse(exec("gh", ["api", `repos/${up.owner}/${up.repo}/pulls/${up.number}`]))
    const reviews = api(`repos/${up.owner}/${up.repo}/pulls/${up.number}/reviews?per_page=100`)
    const approval = reviews.filter((r) => r.state === "APPROVED").at(-1)
    const reverts = upr.merged_at === null ? null : JSON.parse(exec("gh", ["api", "-X", "GET", "search/issues", "-f", `q=repo:${up.owner}/${up.repo} is:pr in:body ${upr.html_url} Revert`])).total_count > 0
    upstream = {
      state: upr.state, merged: upr.merged_at !== null,
      verdict: approval !== undefined ? "APPROVED" : null, approver: approval?.user?.login ?? null,
      hours_open_to_merge: hoursOpen(upr.created_at, upr.merged_at), reverted: reverts,
    }
  }
  const verification = withVerify ? await verifyImpl(entry.fork, { token, exec }) : null
  return buildRow({ entry, pr, files, comments, proof, upstream, verification })
}
