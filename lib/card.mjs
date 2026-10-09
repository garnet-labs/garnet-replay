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
    if (replay.capture !== "complete" || replay.final !== true) {
      return { verdict: VERDICTS.UNDETERMINABLE, reason: "incomplete", commit, summary: replay }
    }
    const known = VERDICT_LIST.includes(replay.verdict) ? replay.verdict : VERDICTS.UNDETERMINABLE
    return { verdict: known, reason: known === VERDICTS.UNDETERMINABLE ? (typeof replay.reason === "string" ? replay.reason : "incomplete") : null, commit, summary: replay }
  }
  const summary = receipt.summary
  if (!receipt.final) return { verdict: VERDICTS.UNDETERMINABLE, reason: "pending", commit, summary }
  const capture = summary.capture_quality ?? summary.capture ?? null
  if (capture !== "complete") {
    return { verdict: VERDICTS.UNDETERMINABLE, reason: "incomplete", commit, summary }
  }
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

/** Preserve the recorded job sections, excluding the comment's teaching example. */
export function recordedEvidence(body) {
  if (typeof body !== "string") return ""
  const explainer = /^<details\b[^>]*>\s*<summary\b[^>]*>(?:(?!<\/summary>)[\s\S])*?(?:How to read this|Reading this)(?:(?!<\/summary>)[\s\S])*?<\/summary>/im.exec(body)
  const record = explainer === null ? body : body.slice(0, explainer.index)
  return record.replace(/<!--[\s\S]*?-->/g, "").replace(/\n---\s*$/, "").trim()
}

/** Rendered tree blocks in document order: `<pre>` snapshots and ```diff fences. */
export function treeBlocks(body) {
  if (typeof body !== "string") return []
  const lines = recordedEvidence(body).split("\n")
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
    else if (/^```(?:text)?$/.test(line.trim())) current = { kind: "text", lines: [] }
  }
  return blocks
}

/** One execution chain = one root-to-action path, carried verbatim. Moved paths first. */
export function extractChains(body, { max = Infinity } = {}) {
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
  if (chain.kind === "text") return ["```text", ...chain.lines, "```"].join("\n")
  return ["<pre>", ...chain.lines, "</pre>"].join("\n")
}

export function scopeLabel(scope) {
  if (scope === "base-to-head" || scope === "pr-base-to-head") return "pull request base → head"
  if (scope === "immediate-parent-to-head") return "immediate parent → head"
  if (scope === "previous-recorded-head-to-head") return "previous recorded head → head"
  return "not in the ledger, undeterminable"
}

export function buildModel({ slug, forkPr, headSha, comment, replay = null, intent = null, maxChains = Infinity }) {
  const { verdict, reason, commit, summary } = classify({ comment, headSha })
  const body = typeof comment?.body === "string" ? comment.body : ""
  const headBound = typeof commit === "string" && typeof headSha === "string"
    && SHA_RE.test(commit) && SHA_RE.test(headSha) && bound(commit, headSha)
  const previousSha = typeof summary?.previous === "string" ? summary.previous : (typeof summary?.base === "string" ? summary.base : null)
  const recordedScope = previousSha === null ? null
    : typeof replay?.firstSha === "string" && bound(previousSha, replay.firstSha)
      ? "immediate-parent-to-head" : "previous-recorded-head-to-head"
  return {
    slug,
    forkPr,
    verdict,
    reason,
    headSha: typeof headSha === "string" ? headSha : null,
    commentCommit: commit,
    previousSha,
    summary,
    finding: findingLine(body),
    chains: headBound ? extractChains(body, { max: maxChains }) : [],
    evidence: headBound ? recordedEvidence(body) : "",
    link: headBound ? garnetLink(body) : null,
    scope: typeof replay?.firstSha !== "string" && replay?.scope === "immediate-parent-to-head"
      ? replay.scope : recordedScope ?? replay?.scope ?? null,
    transition: replay?.transition ?? null,
    intent: intent !== null && typeof intent === "object" ? intent : replay?.intent ?? null,
  }
}

function headline(model) {
  if (model.verdict !== VERDICTS.UNDETERMINABLE) return "The recorded comparison is shown below."
  if (model.reason === "incomplete") return "Capture is incomplete for this comparison."
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
  const previous = model.previousSha !== null
    ? `\`${sha7(model.previousSha)}\` · \`${model.previousSha}\``
    : model.verdict === VERDICTS.UNDETERMINABLE ? "undeterminable" : "none, first record on this pull request"
  add(`- compared with: ${previous}`)
  const transition = model.transition
  add(`- version transition: ${transition !== null && typeof transition.from === "string" && typeof transition.to === "string" ? `\`${transition.name}\` ${transition.from} → ${transition.to}` : "not derivable from the record"}`)
  add(`- scope: ${scopeLabel(model.scope)}`)
  add(`- capture: ${model.summary?.capture_quality ?? model.summary?.capture ?? "not declared"}`)
  add("")
  if (model.intent !== null && Array.isArray(model.intent.claims)) {
    add(`**Intended behaviour** · ${CLAIM_CLASSES.INTENT}`)
    add("")
    for (const claim of model.intent.claims) {
      const phrase = claim.outcome === "supported"
        ? "Expected behaviour change is present in the record"
        : claim.outcome === "contradicted"
          ? "Record contradicts the stated change"
          : claim.outcome === "unobservable"
            ? "Not observable in either record"
            : `Not determinable: ${claim.reason ?? "insufficient evidence"}`
      add(`- \`${claim.id}\`: ${phrase}`)
    }
    const uncovered = [
      ...(Array.isArray(model.intent.uncovered?.added) ? model.intent.uncovered.added : []),
      ...(Array.isArray(model.intent.uncovered?.removed) ? model.intent.uncovered.removed : []),
    ].map((row) => row.destination ?? row.ancestry ?? "unknown").filter((name) => name !== "unknown")
    if (uncovered.length > 0) {
      add("")
      add("Change the pull request does not describe:")
      for (const name of uncovered) add(`- \`${name}\``)
    }
    add("")
  }
  add("Run verification and assess reviewer value before sharing.")
  add("")
  add(`**Execution chains** · quoted from the record · ${CLAIM_CLASSES.OBSERVED}`)
  add("")
  if (model.evidence !== "") {
    add(model.evidence, true)
  } else {
    add("_No head-bound chains to quote._")
  }
  add("")
  add(`**${ASK}**`)
  add("")
  add("Reviewer outcome: not recorded on this card.")
  add("Assess the recorded workload scope and action attribution before sharing.")
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
  const replay = findReplay(target, forkPr)
  const evidenceRow = (Array.isArray(target.evidence) ? target.evidence : [])
    .find((row) => Number(row.forkPr) === Number(forkPr)) ?? null
  const model = buildModel({ slug: target.slug, forkPr, headSha, comment, replay, intent: evidenceRow?.intent ?? null })
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
