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
const MENTION_RE = /garnet(?:'s)? (?:record|runtime|evidence|comment|check|profile|action|run)|runtime evidence|runtime review|runtime grounding|execution profile|execution chain|recorded (?:run|job|install|execution)/i
const NEGATIVE_RE = /\b(?:no|without|absent|missing|pending|stale|awaiting|undeterminable|not (?:yet )?(?:available|present|bound|recorded|finalized|found))\b/i
const URL_RE = /https?:\/\/[^\s)>"']+/g
const TAG_RE = /<[^>]+>/g
const SHA7_LINE_RE = /\b[0-9a-f]{7,40}\b/
const DESTINATION_RE = /(?:→|->|connect|reached)\s+`?([a-z0-9-]+(?:(?:\[\.\]|\.)[a-z0-9-]+)+)/gi
const EXCLUDED_LOGINS = Object.freeze(["github-actions[bot]", "dependabot[bot]"])

export const RECEIPT_TIERS = Object.freeze({ UTTERANCE: "utterance", CITATION: "citation", OBSERVATION: "observation", MENTION: "mention" })

/** Manual UAT fields; only `replay uat` writes them, never the classifier. */
export const UAT_FIELDS = Object.freeze(["coldRead", "decisionImpact", "attribution", "valueHypothesis"])
export const UAT_RESULTS = Object.freeze(["supported", "not-supported", "unknown"])
export const REREVIEW_MARKER_RE = /<!--\s*garnet:rereview\s+([0-9a-f]{40})\s*-->/

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
    const prose = stripLinks(line)
    if (!RUNTIME_WORDS_RE.test(prose)) continue
    if (/^\s*>?\s*(review updated|code review|reviewed) /i.test(prose)) continue
    if (citesHead(prose, headSha)) return true
  }
  return false
}

function stripLinks(text) {
  return text.replace(URL_RE, " ").replace(TAG_RE, " ")
}

/**
 * Whether the line that names the head says the evidence is absent, pending or
 * stale. Such a line proves the reviewer looked for a record, not that one was
 * read, so it must not advance the pilot.
 */
function negativeLine(text, pattern) {
  for (const line of text.split("\n")) {
    if (!pattern.test(stripLinks(line))) continue
    return NEGATIVE_RE.test(stripLinks(line))
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
  const prose = stripLinks(text)
  const lower = prose.toLowerCase().replace(/\[\.\]/g, ".")
  const observed = destinations.filter((host) => lower.includes(host))
  const repeated = observed.map((host) => `destination ${host}`)
  const utteranceRe = UTTERANCE_RE.test(text) ? UTTERANCE_RE : GROUNDING_RE
  const utterance = utteranceRe.exec(text)
  if (utterance !== null && bound(utterance[1], headSha)) {
    matched.push(`head ${utterance[1].slice(0, 7)}`)
    const negative = negativeLine(text, utteranceRe)
    if (negative) matched.push("reports no evidence")
    matched.push(...repeated)
    return { tier: RECEIPT_TIERS.UTTERANCE, headBound: !negative, matched, excerpt: firstMatchingLine(text, [UTTERANCE_RE, GROUNDING_RE]) }
  }
  const headCited = citesHeadInProse(text, headSha)
  if (headCited) matched.push(`head ${headSha.slice(0, 7)}`)
  const links = []
  if (typeof receipt?.permalink === "string" && receipt.permalink !== "" && text.includes(receipt.permalink)) links.push(receipt.permalink)
  if (typeof receipt?.runId === "string" && receipt.runId !== "" && new RegExp(`/runs/${receipt.runId}\\b`).test(text)) links.push(`run ${receipt.runId}`)
  if (typeof receipt?.profileId === "string" && receipt.profileId !== "" && text.includes(receipt.profileId)) links.push(`profile ${receipt.profileId}`)
  matched.push(...new Set(links))
  if (headCited || links.length > 0) {
    const negative = links.length === 0 && negativeLine(text, new RegExp(`\\b${headSha.slice(0, 7)}`, "i"))
    if (negative) matched.push("reports no evidence")
    matched.push(...repeated)
    return { tier: RECEIPT_TIERS.CITATION, headBound: !negative, matched, excerpt: firstMatchingLine(text, [SHA7_LINE_RE, /app\.garnet\.ai/i, MENTION_RE]) }
  }
  if (observed.length > 0 && MENTION_RE.test(prose)) {
    return { tier: RECEIPT_TIERS.OBSERVATION, headBound: false, matched: observed, excerpt: firstMatchingLine(text, observed.map((host) => new RegExp(host.replace(/\./g, "(?:\\.|\\[\\.\\])"), "i"))) }
  }
  if (utterance !== null) {
    matched.push(`head ${utterance[1].slice(0, 7)} (not the current head)`)
    return { tier: RECEIPT_TIERS.MENTION, headBound: false, matched, excerpt: firstMatchingLine(text, [UTTERANCE_RE, GROUNDING_RE]) }
  }
  if (MENTION_RE.test(prose)) return { tier: RECEIPT_TIERS.MENTION, headBound: false, matched, excerpt: firstMatchingLine(text, [MENTION_RE]) }
  return null
}

/**
 * A strong receipt written before the record comment existed cannot have read
 * it; keep the row, drop its head binding.
 */
function beforeRecord(source, recordAt) {
  if (typeof recordAt !== "string") return false
  const at = source.submitted_at ?? source.created_at ?? null
  if (typeof at !== "string") return false
  const left = Date.parse(at)
  const right = Date.parse(recordAt)
  return Number.isFinite(left) && Number.isFinite(right) && left < right
}

function bindToRecord(source, classified, recordAt) {
  if (classified === null || !classified.headBound || !beforeRecord(source, recordAt)) return classified
  return { ...classified, headBound: false, matched: [...classified.matched, "written before the record"] }
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
 * When was a re-review requested for this head, if ever?
 * @param {Array<{body?: string, created_at?: string}>} comments
 * @param {string|null} headSha
 * @returns {string|null} ISO time of the request comment
 */
export function rereviewRequestedAt(comments, headSha) {
  if (typeof headSha !== "string") return null
  for (const comment of comments) {
    const m = typeof comment?.body === "string" ? REREVIEW_MARKER_RE.exec(comment.body) : null
    if (m !== null && m[1] === headSha) return typeof comment.created_at === "string" ? comment.created_at : "unknown"
  }
  return null
}

function after(at, since) {
  if (typeof at !== "string" || typeof since !== "string") return false
  const left = Date.parse(at)
  const right = Date.parse(since)
  return Number.isFinite(left) && Number.isFinite(right) && left >= right
}

/**
 * The consumption funnel one row deep: each stage is observed or not, and
 * `consumedHow` says by which path each strong receipt arrived. Manual UAT
 * fields start empty; the classifier never fills them.
 * @param {object} input
 * @param {boolean} input.recordBound
 * @param {boolean} input.mirror
 * @param {string|null} input.rereviewAt
 * @param {string|null} input.recordAt
 * @param {Array<{login: string|null, kind: string, tier: string, headBound: boolean, at: string|null}>} input.receipts
 */
export function buildFunnel({ recordBound, mirror, rereviewAt, recordAt, receipts }) {
  const attention = receipts.filter((row) => after(row.at, recordAt))
  const strong = receipts.filter((row) => row.headBound && (row.tier === RECEIPT_TIERS.UTTERANCE || row.tier === RECEIPT_TIERS.CITATION))
  const observed = receipts.filter((row) => row.tier === RECEIPT_TIERS.OBSERVATION || (row.headBound && row.matched.some((m) => /^destination /.test(m))))
  const path = (row) => rereviewAt !== null && after(row.at, rereviewAt) ? "after-rereview" : after(row.at, recordAt) ? "after-record" : "before-record"
  return {
    delivered: recordBound,
    visible: mirror,
    rereviewRequested: rereviewAt !== null,
    attention: attention.length > 0,
    grounded: strong.length > 0,
    observation: observed.length > 0,
    consumedHow: strong.map((row) => ({ who: row.login, where: row.kind, tier: row.tier, path: path(row), at: row.at })),
    coldRead: null,
    decisionImpact: "unknown",
    attribution: "unknown",
    valueHypothesis: "unknown",
  }
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
  const recordAt = typeof record?.created_at === "string" ? record.created_at : null
  const context = { headSha, receipt, destinations }
  const humanOrAgent = (login) => typeof login === "string" && !/^garnet/i.test(login) && !EXCLUDED_LOGINS.includes(login) && login !== pr?.author?.login
  const strong = (classified) => classified.headBound && (classified.tier === RECEIPT_TIERS.UTTERANCE || classified.tier === RECEIPT_TIERS.CITATION)
  for (const review of reviews) {
    const login = review.user?.login
    if (!humanOrAgent(login)) continue
    const text = typeof review.body === "string" ? review.body : ""
    const classified = bindToRecord(review, classifyUtterance(text, context), recordAt)
    if (classified === null) continue
    const state = String(review.state ?? "").toLowerCase() || "comment"
    receipts.push(receiptFrom(review, "review", classified, { headSha, extra: { state } }))
    if (strong(classified) && bound(review.commit_id, headSha)) consumers.push(`${login} (review ${state})`)
  }
  for (const comment of reviewComments) {
    const login = comment.user?.login
    if (!humanOrAgent(login)) continue
    const classified = bindToRecord(comment, classifyUtterance(typeof comment.body === "string" ? comment.body : "", context), recordAt)
    if (classified === null) continue
    receipts.push(receiptFrom(comment, "review-comment", classified, { headSha }))
    if (strong(classified) && (comment.commit_id === undefined || bound(comment.commit_id, headSha))) consumers.push(`${login} (comment)`)
  }
  for (const comment of comments) {
    if (isRuntimeReviewComment(comment)) continue
    const login = comment.user?.login
    if (!humanOrAgent(login)) continue
    const classified = bindToRecord(comment, classifyUtterance(typeof comment.body === "string" ? comment.body : "", context), recordAt)
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
  const funnel = buildFunnel({ recordBound, mirror: mirrorBound, rereviewAt: rereviewRequestedAt(comments, headSha), recordAt, receipts })
  return { headSha, consumed, consumers: unique, mirror: mirrorBound, recordBound, receipts, signals, destinations, funnel, findings }
}

/**
 * One line: which funnel stages were observed, how each strong receipt arrived,
 * and the manual UAT fields as they stand.
 * @param {ReturnType<typeof buildFunnel>} funnel
 * @returns {string}
 */
export function describeFunnel(funnel) {
  const stages = ["delivered", "visible", "rereviewRequested", "attention", "grounded", "observation"]
    .map((stage) => `${stage} ${funnel[stage] === true ? "yes" : "no"}`)
  const how = funnel.consumedHow.length === 0 ? "consumed-how: none" : `consumed-how: ${funnel.consumedHow.map((row) => `${row.who ?? "unknown"} (${row.tier}, ${row.where}, ${row.path})`).join("; ")}`
  const uat = `cold-read ${funnel.coldRead === null ? "not yet rated" : `${funnel.coldRead} of 5`} · decision-impact ${funnel.decisionImpact} · attribution ${funnel.attribution} · value-hypothesis ${funnel.valueHypothesis}`
  return `${stages.join(" · ")} · ${how} · ${uat}`
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
  if (result.funnel !== undefined) {
    lines.push(`funnel: ${describeFunnel(result.funnel)}`)
    lines.push("")
  }
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

export function consumePr(prUrl, { exec = run, write = null, comments: known = null } = {}) {
  const { owner, repo: name, number } = parsePrUrl(prUrl)
  const repo = `${owner}/${name}`
  const pr = viewPr(repo, number, { exec })
  const comments = Array.isArray(known) ? known : prComments(repo, number, { exec })
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
  return { repo, number, result, report, path, rawPath, rawRef: typeof write === "string" ? `out/${write}/pr-${number}-consume.json` : null }
}

/**
 * Fork pull requests that carry a Runtime Review comment: the set worth
 * checking for consumption. Returns numbers, newest first.
 * @param {string} fork owner/repo
 * @param {{limit?: number, state?: string, exec?: typeof run}} options
 * @returns {Array<{number: number, recorded: boolean, comments: object[]}>}
 */
export function harvestCandidates(fork, { limit = 50, state = "all", exec = run } = {}) {
  const prs = listPrs(fork, { limit, state, exec })
  return prs.map((row) => {
    const comments = prComments(fork, row.number, { exec })
    return { number: Number(row.number), recorded: latestRuntimeReviewComment(comments) !== null, comments }
  })
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
