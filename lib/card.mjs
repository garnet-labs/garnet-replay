/**
 * Stage 2 of the ladder: the evidence card. Reads the fork pull request's
 * head-bound Runtime Review comment, applies the fail-closed verdict table,
 * and renders one short Markdown card. Quoted comment bytes are carried
 * verbatim; renderer-owned copy is vocabulary- and width-gated.
 */
import { writeFileSync } from "node:fs"
import { run, prComments, prHeadSha, latestRuntimeReviewComment, parseReplayMarker } from "./gh.mjs"
import { parseReceipt } from "./receipt.mjs"
import { CLAIM_CLASSES, VERDICTS, verdictPhrase } from "./evidence.mjs"
import { assertVocabClean } from "./guards.mjs"
import { outPath } from "./ledger.mjs"

export const ASK = "Would this have helped the review?"
export const VERDICT_LIST = Object.freeze(Object.values(VERDICTS))
const SHA_RE = /^[0-9a-f]{7,40}$/

export function sha7(value) {
  return typeof value === "string" && SHA_RE.test(value) ? value.slice(0, 7) : null
}

function bound(commit, headSha) {
  const left = String(commit).toLowerCase()
  const right = String(headSha).toLowerCase()
  return left.length <= right.length ? right.startsWith(left) : left.startsWith(right)
}

/**
 * Fail closed: no comment → pending; no head binding → head-unbound; a binding
 * that is not the current head → stale; unreadable summary → pending. Only a
 * head-bound, readable summary yields new-behavior | unchanged | recorded.
 */
export function classify({ comment, headSha }) {
  if (comment === null || comment === undefined || typeof comment.body !== "string") {
    return { verdict: VERDICTS.UNDETERMINABLE, reason: "pending", commit: null, summary: null }
  }
  const receipt = parseReceipt(comment.body)
  const replay = parseReplayMarker(comment.body)
  const commit = receipt.markerCommit ?? (typeof replay?.head === "string" ? replay.head : null)
  if (commit === null) return { verdict: VERDICTS.UNDETERMINABLE, reason: "head-unbound", commit: null, summary: receipt.summary }
  if (typeof headSha !== "string" || !SHA_RE.test(headSha)) {
    return { verdict: VERDICTS.UNDETERMINABLE, reason: "head-unbound", commit, summary: receipt.summary }
  }
  if (!bound(commit, headSha)) return { verdict: VERDICTS.UNDETERMINABLE, reason: "stale", commit, summary: receipt.summary }
  if (replay !== null && typeof replay.verdict === "string") {
    const known = VERDICT_LIST.includes(replay.verdict) ? replay.verdict : VERDICTS.UNDETERMINABLE
    return { verdict: known, reason: known === VERDICTS.UNDETERMINABLE ? (typeof replay.reason === "string" ? replay.reason : "incomplete") : null, commit, summary: replay }
  }
  const summary = receipt.summary
  if (summary === null) return { verdict: VERDICTS.UNDETERMINABLE, reason: "pending", commit, summary: null }
  if (summary.previous === null || summary.previous === undefined) return { verdict: VERDICTS.RECORDED, reason: null, commit, summary }
  const moved = ["changed", "added", "removed"].map((key) => Number(summary[key] ?? 0)).some((n) => n > 0)
  return { verdict: moved ? VERDICTS.NEW_BEHAVIOR : VERDICTS.UNCHANGED, reason: null, commit, summary }
}

/** The comment's own finding line: the first italic blockquote line. */
export function findingLine(body) {
  if (typeof body !== "string") return null
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd()
    if (/^>\s+\*.+\*$/.test(line)) return line.replace(/^>\s+/, "")
  }
  return null
}

export function garnetLink(body) {
  if (typeof body !== "string") return null
  const match = /https:\/\/app\.garnet\.ai\/public\/runs\/\d+(?:\?[^\s)"'<]*)?/i.exec(body)
  return match === null ? null : match[0].replace(/&amp;/g, "&")
}

const TREE_PREFIX_RE = /^[ \u2502\u251c\u2514\u2500]*/
const TERMINAL = "○"

/** Rendered tree blocks in document order: `<pre>` snapshots and ```diff fences. */
export function treeBlocks(body) {
  if (typeof body !== "string") return []
  const cut = body.indexOf("Reading this")
  const lines = (cut >= 0 ? body.slice(0, cut) : body).split("\n")
  const blocks = []
  let current = null
  for (const line of lines) {
    if (current !== null) {
      const end = current.kind === "pre" ? line.trim() === "</pre>" : line.trim() === "```"
      if (end) {
        blocks.push(current)
        current = null
        continue
      }
      current.lines.push(line)
      continue
    }
    if (line.trim() === "<pre>") current = { kind: "pre", lines: [] }
    else if (line.trim() === "```diff") current = { kind: "diff", lines: [] }
  }
  return blocks
}

/** One execution chain = one root-to-action path, carried verbatim. Moved paths first. */
export function extractChains(body, { max = 3 } = {}) {
  const out = []
  for (const block of treeBlocks(body)) {
    const stack = []
    for (const line of block.lines) {
      if (line.trim() === "" || line.startsWith("@@")) continue
      const mark = block.kind === "diff" ? line.slice(0, 1) : " "
      const rest = block.kind === "diff" ? line.slice(1) : line
      if (rest.trim() === "") continue
      const indent = rest.match(TREE_PREFIX_RE)[0].length
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
      if (rest.slice(indent).startsWith(TERMINAL)) {
        const marked = mark === "+" || mark === "-"
        out.push({ kind: block.kind, marked, mark: marked ? mark : " ", lines: [...stack.map((s) => s.line), line] })
      } else {
        stack.push({ indent, line })
      }
    }
  }
  return [...out.filter((c) => c.marked), ...out.filter((c) => !c.marked)].slice(0, max)
}

export function renderChainBlock(chain) {
  if (chain.kind === "diff") return ["```diff", ...chain.lines, "```"].join("\n")
  return ["<pre>", ...chain.lines, "</pre>"].join("\n")
}

export function scopeLabel(scope) {
  if (scope === "base-to-head" || scope === "pr-base-to-head") return "pull request base → head"
  if (scope === "immediate-parent-to-head") return "immediate parent → head"
  if (scope === "previous-recorded-head-to-head") return "previous recorded head → head"
  return "not in the ledger, undeterminable"
}

export function buildModel({ slug, forkPr, headSha, comment, replay = null, maxChains = 3 }) {
  const { verdict, reason, commit, summary } = classify({ comment, headSha })
  const body = typeof comment?.body === "string" ? comment.body : ""
  const headBound = verdict !== VERDICTS.UNDETERMINABLE
  return {
    slug,
    forkPr,
    verdict,
    reason,
    headSha: typeof headSha === "string" ? headSha : null,
    commentCommit: commit,
    previousSha: typeof summary?.previous === "string" ? summary.previous : (typeof summary?.base === "string" ? summary.base : null),
    summary,
    finding: findingLine(body),
    chains: headBound ? extractChains(body, { max: maxChains }) : [],
    link: headBound ? garnetLink(body) : null,
    scope: replay?.scope ?? null,
    transition: replay?.transition ?? null,
  }
}

function headline(model) {
  if (model.reason === "stale") {
    return `The newest record is bound to \`${sha7(model.commentCommit) ?? "unknown"}\`, not the current head \`${sha7(model.headSha) ?? "unknown"}\`.`
  }
  if (model.reason === "head-unbound") return "The newest record carries no head commit binding."
  return "No head-bound record exists for this pull request yet."
}

export function renderCard(model) {
  const own = []
  const lines = []
  const add = (line, quoted = false) => {
    lines.push(line)
    if (!quoted) own.push(line)
  }
  add(`<!-- garnet:card slug=${model.slug} pr=${model.forkPr} state=${model.verdict} -->`)
  add(`### What ran, and what changed · pull request ${model.forkPr}`)
  add("")
  if (model.finding !== null && model.verdict !== VERDICTS.UNDETERMINABLE) add(`> ${model.finding}`, true)
  else add(`> ${headline(model)}`)
  add("")
  add(`Result: **${verdictPhrase(model.verdict)}**${model.reason !== null ? ` (${model.reason})` : ""} · ${CLAIM_CLASSES.COMPARISON}`)
  add("")
  add("**Comparison pair**")
  add("")
  add(`- head: ${model.headSha !== null ? `\`${sha7(model.headSha)}\` · \`${model.headSha}\`` : "undeterminable"}`)
  add(`- record bound to: ${model.commentCommit !== null ? `\`${sha7(model.commentCommit)}\`` : "undeterminable"}`)
  const previous = model.verdict === VERDICTS.UNDETERMINABLE
    ? "undeterminable"
    : (model.previousSha !== null ? `\`${sha7(model.previousSha)}\` · \`${model.previousSha}\`` : "none, first record on this pull request")
  add(`- compared with: ${previous}`)
  const transition = model.transition
  add(`- version transition: ${transition !== null && typeof transition.from === "string" && typeof transition.to === "string" ? `\`${transition.name}\` ${transition.from} → ${transition.to}` : "not derivable from the record"}`)
  add(`- scope: ${scopeLabel(model.scope)}`)
  add("")
  add(`**Execution chains** · quoted from the record · ${CLAIM_CLASSES.OBSERVED}`)
  add("")
  if (model.chains.length > 0) {
    model.chains.forEach((chain, index) => {
      add(renderChainBlock(chain), true)
      if (index < model.chains.length - 1) add("")
    })
  } else {
    add("_No head-bound chains to quote._")
  }
  add("")
  add(`**${ASK}**`)
  if (model.link !== null) {
    add("")
    add(`[View this run in Garnet →](${model.link})`)
  }
  add("")
  assertVocabClean(own.join("\n"))
  for (const line of own) {
    if (line.includes("](http") || line.includes("`") || line.startsWith("<!--")) continue
    if (line.length > 96) throw new Error(`card: renderer-owned line exceeds phone width: ${line.slice(0, 40)}…`)
  }
  return lines.join("\n")
}

export function findReplay(target, forkPr) {
  return (Array.isArray(target.replays) ? target.replays : []).find((row) => Number(row.forkPr) === Number(forkPr)) ?? null
}

export function upsertEvidence(target, row) {
  const list = Array.isArray(target.evidence) ? target.evidence : (target.evidence = [])
  const index = list.findIndex((entry) => Number(entry.forkPr) === Number(row.forkPr))
  if (index >= 0) list[index] = { ...list[index], ...row }
  else list.push(row)
  return target
}

export async function cardForPr(target, forkPr, { exec = run, write = true, now = () => new Date().toISOString() } = {}) {
  const repo = target.fork
  if (typeof repo !== "string" || repo === "") throw new Error(`target '${target.slug}' has no fork configured`)
  let headSha = null
  try {
    headSha = prHeadSha(repo, forkPr, { exec })
  } catch {
    headSha = null
  }
  let comments = []
  try {
    comments = prComments(repo, forkPr, { exec })
  } catch {
    comments = []
  }
  const comment = latestRuntimeReviewComment(Array.isArray(comments) ? comments : [])
  const model = buildModel({ slug: target.slug, forkPr, headSha, comment, replay: findReplay(target, forkPr) })
  const card = renderCard(model)
  const rel = `out/${target.slug}/pr-${forkPr}-card.md`
  if (write) writeFileSync(outPath(target.slug, `pr-${forkPr}-card.md`), card)
  return {
    row: {
      forkPr: Number(forkPr),
      card: rel,
      verdict: model.verdict,
      reason: model.reason,
      headSha: model.headSha,
      previousSha: model.previousSha,
      scope: model.scope,
      renderedAt: now(),
    },
    model,
    card,
  }
}
