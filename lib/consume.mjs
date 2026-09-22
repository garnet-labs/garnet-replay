/**
 * `replay consume <pr-url>`: did a reviewer or agent consume the record?
 * Reads the fork pull request body, reviews, review comments and issue
 * comments, and reports head-bound consumption evidence. Fail closed: a
 * citation counts as `consumed` only when it names the current head commit or
 * quotes the head-bound record; anything else is reported as not consumed.
 *
 * Every weaker signal is still kept as a receipt so the raw consumption data
 * is never discarded behind the binary verdict. Receipt tiers, strongest first:
 *   utterance  – the contract sentence `Runtime evidence (Garnet, head <sha7>):`
 *                or `**Runtime grounding** (head <sha7>)`, bound to the head
 *   citation   – names the head commit next to runtime wording, or links the
 *                record's Execution Profile / run id
 *   observation – repeats a destination or execution-chain token that appears
 *                in the record itself (a reviewer using an observed fact)
 *   mention    – runtime-evidence wording with nothing bound to the record
 * `consumed` is true only for head-bound `utterance` or `citation` receipts.
 */
import { writeFileSync } from "node:fs"
import { run, listPrs, viewPr, prComments, prReviews, prReviewComments, checkRuns, isRuntimeReviewComment, latestRuntimeReviewComment } from "./gh.mjs"
import { parsePrUrl, parseReceipt } from "./receipt.mjs"
import { CLAIM_CLASSES } from "./evidence.mjs"
import { assertVocabClean } from "./guards.mjs"
import { outPath } from "./ledger.mjs"

export const MIRROR_BEGIN = "<!-- garnet:evidence:begin -->"
export const MIRROR_END = "<!-- garnet:evidence:end -->"
const GROUNDING_RE = /\*\*Runtime grounding\*\*\s*\(head\s+`?([0-9a-f]{7,40})`?\)/i
const UTTERANCE_RE = /Runtime evidence \(Garnet,\s*head\s+`?([0-9a-f]{7,40})`?\)/i
const SHA7_RE = /\b([0-9a-f]{7,40})\b/g
const RUNTIME_WORDS_RE = /garnet|runtime|record|execution chain|outbound/i
const MENTION_RE = /garnet|runtime evidence|runtime review|execution profile|execution chain/i
const SHA7_LINE_RE = /\b[0-9a-f]{7,40}\b/
const DESTINATION_RE = /(?:→|->|connect|reached)\s+`?([a-z0-9-]+(?:(?:\[\.\]|\.)[a-z0-9-]+)+)/gi
const EXCLUDED_LOGINS = Object.freeze(["github-actions[bot]", "dependabot[bot]"])

export const RECEIPT_TIERS = Object.freeze({ UTTERANCE: "utterance", CITATION: "citation", OBSERVATION: "observation", MENTION: "mention" })

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
 * A head citation in reviewer prose: the head commit named on a line that also
 * carries runtime wording, ignoring commits that only appear inside GitHub
 * commit/diff links (review tools stamp "updated until commit <head>" on
 * every pull request, which is not a reading of the record).
 */
function citesHeadInProse(text, headSha) {
  if (typeof text !== "string" || typeof headSha !== "string") return false
  for (const line of text.split("\n")) {
    const prose = line.replace(/https?:\/\/[^\s)>"']+/g, " ").replace(/<[^>]+>/g, " ")
    if (!RUNTIME_WORDS_RE.test(prose)) continue
    if (/^\s*>?\s*(review updated|code review|reviewed) /i.test(prose)) continue
    if (citesHead(prose, headSha)) return true
  }
  return false
}

function defang(host) {
  return host.toLowerCase().replace(/\[\.\]/g, ".")
}

/**
 * Destinations named by the record (defanged or plain), excluding GitHub and
 * Garnet's own hosts, which every comment on the pull request tends to name.
 * @param {string|null} recordBody
 * @returns {string[]}
 */
export function recordDestinations(recordBody) {
  if (typeof recordBody !== "string") return []
  const hosts = new Set()
  for (const match of recordBody.matchAll(DESTINATION_RE)) {
    const host = defang(match[1])
    if (/(^|\.)(github\.com|githubusercontent\.com|garnet\.ai|localhost)$/.test(host)) continue
    if (/^\d+(\.\d+){3}$/.test(host)) continue
    hosts.add(host)
  }
  return [...hosts]
}

function firstMatchingLine(text, patterns) {
  for (const line of text.split("\n")) {
    const plain = line.trim()
    if (plain === "" || plain.startsWith("<!--")) continue
    if (patterns.some((pattern) => pattern.test(plain))) return plain.length > 240 ? `${plain.slice(0, 237)}...` : plain
  }
  return null
}

/**
 * Classify one reviewer or agent utterance against the head-bound record.
 * Returns null when the text does not touch runtime evidence at all.
 * @param {string} text
 * @param {{headSha: string|null, receipt?: {permalink?: string|null, runId?: string|null, profileId?: string|null}|null, destinations?: string[]}} context
 * @returns {{tier: string, headBound: boolean, matched: string[], excerpt: string|null}|null}
 */
export function classifyUtterance(text, { headSha, receipt = null, destinations = [] }) {
  if (typeof text !== "string" || text === "") return null
  const matched = []
  const utterance = UTTERANCE_RE.exec(text) ?? GROUNDING_RE.exec(text)
  if (utterance !== null && bound(utterance[1], headSha)) {
    matched.push(`head ${utterance[1].slice(0, 7)}`)
    return { tier: RECEIPT_TIERS.UTTERANCE, headBound: true, matched, excerpt: firstMatchingLine(text, [UTTERANCE_RE, GROUNDING_RE]) }
  }
  const headCited = citesHeadInProse(text, headSha)
  if (headCited) matched.push(`head ${headSha.slice(0, 7)}`)
  const links = []
  if (typeof receipt?.permalink === "string" && receipt.permalink !== "" && text.includes(receipt.permalink)) links.push(receipt.permalink)
  if (typeof receipt?.runId === "string" && receipt.runId !== "" && new RegExp(`/runs/${receipt.runId}\\b`).test(text)) links.push(`run ${receipt.runId}`)
  if (typeof receipt?.profileId === "string" && receipt.profileId !== "" && text.includes(receipt.profileId)) links.push(`profile ${receipt.profileId}`)
  matched.push(...new Set(links))
  if (headCited || links.length > 0) {
    return { tier: RECEIPT_TIERS.CITATION, headBound: true, matched, excerpt: firstMatchingLine(text, [SHA7_LINE_RE, /app\.garnet\.ai/i, MENTION_RE]) }
  }
  const lower = text.toLowerCase().replace(/\[\.\]/g, ".")
  const observed = destinations.filter((host) => lower.includes(host))
  if (observed.length > 0 && MENTION_RE.test(text)) {
    return { tier: RECEIPT_TIERS.OBSERVATION, headBound: false, matched: observed, excerpt: firstMatchingLine(text, observed.map((host) => new RegExp(host.replace(/\./g, "(?:\\.|\\[\\.\\])"), "i"))) }
  }
  if (utterance !== null) {
    matched.push(`head ${utterance[1].slice(0, 7)} (not the current head)`)
    return { tier: RECEIPT_TIERS.MENTION, headBound: false, matched, excerpt: firstMatchingLine(text, [UTTERANCE_RE, GROUNDING_RE]) }
  }
  if (MENTION_RE.test(text)) return { tier: RECEIPT_TIERS.MENTION, headBound: false, matched, excerpt: firstMatchingLine(text, [MENTION_RE]) }
  return null
}

function receiptFrom(source, kind, classified, { headSha, extra = {} }) {
  const commit = typeof source.commit_id === "string" ? source.commit_id : null
  return {
    kind,
    login: source.user?.login ?? null,
    id: source.id ?? null,
    url: source.html_url ?? null,
    at: source.submitted_at ?? source.created_at ?? null,
    commit: commit === null ? null : commit.slice(0, 7),
    onHead: commit === null ? null : bound(commit, headSha),
    tier: classified.tier,
    headBound: classified.headBound,
    matched: classified.matched,
    excerpt: classified.excerpt,
    ...extra,
  }
}

/**
 * Count receipts per tier, always listing every tier.
 * @param {Array<{tier: string}>} receipts
 * @returns {Record<string, number>}
 */
export function tallyReceipts(receipts) {
  const tally = {}
  for (const tier of Object.values(RECEIPT_TIERS)) tally[tier] = 0
  for (const receipt of receipts) if (typeof tally[receipt.tier] === "number") tally[receipt.tier] += 1
  return tally
}

/**
 * One-line summary of receipt counts, omitting empty tiers.
 * @param {Record<string, number>|undefined} signals
 * @returns {string}
 */
export function describeSignals(signals) {
  const parts = Object.entries(signals ?? {}).filter(([, count]) => count > 0).map(([tier, count]) => `${count} ${tier}`)
  return parts.length === 0 ? "no receipts" : `${parts.reduce((sum, part) => sum + Number(part.split(" ")[0]), 0)} receipt(s): ${parts.join(", ")}`
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
  const headBound = receipt !== null && bound(receipt.markerCommit, headSha)
  const recordBound = headBound && receipt.final
  add("record", recordBound,
    record === null ? "no Runtime Review comment on the pull request"
      : recordBound ? `record bound to head ${headSha.slice(0, 7)}`
        : headBound ? `record for head ${headSha.slice(0, 7)} is still being written`
          : `record bound to ${String(receipt.markerCommit ?? "unknown").slice(0, 7)}, head is ${String(headSha ?? "unknown").slice(0, 7)}`,
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
  const receipts = []
  const destinations = recordDestinations(record?.body ?? null)
  const context = { headSha, receipt, destinations }
  const humanOrAgent = (login) => typeof login === "string" && !/^garnet/i.test(login) && !EXCLUDED_LOGINS.includes(login) && login !== pr?.author?.login
  const strong = (classified) => classified.headBound && (classified.tier === RECEIPT_TIERS.UTTERANCE || classified.tier === RECEIPT_TIERS.CITATION)
  for (const review of reviews) {
    const login = review.user?.login
    if (!humanOrAgent(login)) continue
    const text = typeof review.body === "string" ? review.body : ""
    const classified = classifyUtterance(text, context)
    if (classified === null) continue
    const state = String(review.state ?? "").toLowerCase() || "comment"
    receipts.push(receiptFrom(review, "review", classified, { headSha, extra: { state } }))
    if (strong(classified) && bound(review.commit_id, headSha)) consumers.push(`${login} (review ${state})`)
  }
  for (const comment of reviewComments) {
    const login = comment.user?.login
    if (!humanOrAgent(login)) continue
    const classified = classifyUtterance(typeof comment.body === "string" ? comment.body : "", context)
    if (classified === null) continue
    receipts.push(receiptFrom(comment, "review-comment", classified, { headSha }))
    if (strong(classified) && (comment.commit_id === undefined || bound(comment.commit_id, headSha))) consumers.push(`${login} (comment)`)
  }
  for (const comment of comments) {
    if (isRuntimeReviewComment(comment)) continue
    const login = comment.user?.login
    if (!humanOrAgent(login)) continue
    const classified = classifyUtterance(typeof comment.body === "string" ? comment.body : "", context)
    if (classified === null) continue
    receipts.push(receiptFrom(comment, "comment", classified, { headSha }))
    if (strong(classified)) consumers.push(`${login} (comment)`)
  }
  const unique = [...new Set(consumers)]
  const signals = tallyReceipts(receipts)
  add("consumers", unique.length > 0,
    unique.length > 0 ? `head-bound citation by ${unique.join(", ")}` : "no reviewer or agent cited the head-bound record",
    CLAIM_CLASSES.CONSUMPTION)
  add("receipts", receipts.length > 0,
    receipts.length > 0
      ? `${describeSignals(signals)} · ${[...new Set(receipts.map((row) => row.login))].join(", ")}`
      : "no reviewer or agent utterance touches runtime evidence",
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
  return { headSha, consumed, consumers: unique, mirror: mirrorBound, recordBound, receipts, signals, destinations, findings }
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
  const receipts = Array.isArray(result.receipts) ? result.receipts : []
  if (receipts.length > 0) {
    lines.push(`#### Receipts · ${describeSignals(result.signals)}`)
    lines.push("")
    lines.push("Kept so weaker signals are not lost behind the consumed line; only head-bound utterance and citation rows count as consumption.")
    lines.push("")
    lines.push("| tier | who | where | commit | matched | excerpt |")
    lines.push("|---|---|---|---|---|---|")
    for (const row of receipts) {
      const where = row.url !== null ? `[${row.kind}](${row.url})` : row.kind
      const commit = row.commit === null ? "—" : `\`${row.commit}\`${row.onHead === true ? " (head)" : ""}`
      const excerpt = row.excerpt === null ? "—" : row.excerpt.replace(/\|/g, "\\|")
      lines.push(`| ${row.tier}${row.headBound ? " (head-bound)" : ""} | ${row.login ?? "unknown"} | ${where} | ${commit} | ${row.matched.join(", ") || "—"} | ${excerpt} |`)
    }
    lines.push("")
  }
  assertVocabClean(lines.filter((line) => !line.startsWith("|")).join("\n"))
  return `${lines.join("\n")}\n`
}

export function consumePr(prUrl, { exec = run, write = null } = {}) {
  const { owner, repo: name, number } = parsePrUrl(prUrl)
  const repo = `${owner}/${name}`
  const pr = viewPr(repo, number, { exec })
  const comments = prComments(repo, number, { exec })
  const reviews = prReviews(repo, number, { exec })
  const reviewComments = prReviewComments(repo, number, { exec })
  const checks = typeof pr.headRefOid === "string" ? checkRuns(repo, pr.headRefOid, { exec }) : []
  const result = evaluateConsumption({ pr: { ...pr, author: pr.author }, comments, reviews, reviewComments, checks })
  const report = renderConsumeReport(result, { prUrl })
  let path = null
  let rawPath = null
  if (typeof write === "string") {
    path = outPath(write, `pr-${number}-consume.md`)
    writeFileSync(path, report)
    rawPath = outPath(write, `pr-${number}-consume.json`)
    writeFileSync(rawPath, `${JSON.stringify({
      pr: prUrl, repo, number, headSha: result.headSha, checkedAt: new Date().toISOString(),
      consumed: result.consumed, consumers: result.consumers, mirror: result.mirror, recordBound: result.recordBound,
      signals: result.signals, destinations: result.destinations, receipts: result.receipts, findings: result.findings,
      sources: {
        comments: comments.map((row) => ({ id: row.id ?? null, login: row.user?.login ?? null, at: row.created_at ?? null, url: row.html_url ?? null, body: row.body ?? "" })),
        reviews: reviews.map((row) => ({ id: row.id ?? null, login: row.user?.login ?? null, at: row.submitted_at ?? null, state: row.state ?? null, commit: row.commit_id ?? null, url: row.html_url ?? null, body: row.body ?? "" })),
        reviewComments: reviewComments.map((row) => ({ id: row.id ?? null, login: row.user?.login ?? null, at: row.created_at ?? null, commit: row.commit_id ?? null, url: row.html_url ?? null, body: row.body ?? "" })),
        checks: checks.map((row) => ({ name: row.name ?? null, status: row.status ?? null, conclusion: row.conclusion ?? null })),
      },
    }, null, 2)}\n`)
  }
  return { repo, number, result, report, path, rawPath }
}

/**
 * Fork pull requests that carry a Runtime Review comment: the set worth
 * checking for consumption. Returns numbers, newest first.
 * @param {string} fork owner/repo
 * @param {{limit?: number, state?: string, exec?: typeof run}} options
 * @returns {Array<{number: number, recorded: boolean}>}
 */
export function harvestCandidates(fork, { limit = 50, state = "all", exec = run } = {}) {
  const prs = listPrs(fork, { limit, state, exec })
  return prs.map((row) => ({ number: Number(row.number), recorded: latestRuntimeReviewComment(prComments(fork, row.number, { exec })) !== null }))
}

/**
 * `replay harvest`: one row per fork pull request, for the board and the notes.
 * @param {Array<{number: number, result: ReturnType<typeof evaluateConsumption>|null, skipped?: string}>} rows
 * @param {{fork: string}} context
 */
export function renderHarvestReport(rows, { fork }) {
  const lines = []
  const checked = rows.filter((row) => row.result !== null)
  const consumed = checked.filter((row) => row.result.consumed)
  const withReceipts = checked.filter((row) => row.result.receipts.length > 0)
  lines.push(`### Consumption harvest · ${fork}`)
  lines.push("")
  lines.push(`${checked.length} pull request(s) with a record checked · ${consumed.length} consumed (head-bound) · ${withReceipts.length} with at least one receipt · ${rows.length - checked.length} skipped (no record)`)
  lines.push("")
  lines.push("| pull request | head | record | mirror | consumed | receipts |")
  lines.push("|---|---|---|---|---|---|")
  for (const row of rows) {
    if (row.result === null) {
      lines.push(`| ${row.number} | — | no | — | — | skipped: ${row.skipped ?? "no record"} |`)
      continue
    }
    const r = row.result
    lines.push(`| ${row.number} | ${r.headSha === null ? "—" : `\`${r.headSha.slice(0, 7)}\``} | ${r.recordBound ? "head-bound" : "not head-bound"} | ${r.mirror ? "yes" : "no"} | ${r.consumed ? `yes · ${r.consumers.join(", ")}` : "no"} | ${describeSignals(r.signals)} |`)
  }
  lines.push("")
  lines.push("A receipt is not consumption. Rows without a head-bound utterance or citation are kept so the evidence of reviewer attention is not lost; they do not advance the ladder.")
  assertVocabClean(lines.filter((line) => !line.startsWith("|")).join("\n"))
  return `${lines.join("\n")}\n`
}
