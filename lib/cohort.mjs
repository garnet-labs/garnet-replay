/**
 * Stage 3 of the ladder: the cohort report. Drives the evidence card over many
 * fork pull requests and aggregates the results. Every aggregate number is
 * re-read from the rendered rows beneath it before the report is returned.
 */
import { writeFileSync } from "node:fs"
import { run } from "./gh.mjs"
import { VERDICTS } from "./evidence.mjs"
import { assertVocabClean } from "./guards.mjs"
import { outPath } from "./ledger.mjs"
import { ASK, VERDICT_LIST, cardForPr, scopeLabel, sha7, upsertEvidence } from "./card.mjs"

export function tally(rows) {
  const counts = Object.fromEntries(VERDICT_LIST.map((v) => [v, 0]))
  for (const row of rows) {
    if (!VERDICT_LIST.includes(row.verdict)) throw new Error(`unknown result '${row.verdict}' on fork pull request ${row.forkPr}`)
    counts[row.verdict] += 1
  }
  const total = rows.length
  const rates = Object.fromEntries(VERDICT_LIST.map((v) => [v, total > 0 ? counts[v] / total : 0]))
  return { total, counts, rates }
}

export function pct(rate) {
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`
}

export function reasonBreakdown(rows) {
  const out = new Map()
  for (const row of rows) {
    if (row.verdict !== VERDICTS.UNDETERMINABLE) continue
    const key = typeof row.reason === "string" && row.reason !== "" ? row.reason : "unspecified"
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return [...out.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
}

export function comparisonPair(row) {
  const head = sha7(row.headSha)
  const previous = sha7(row.previousSha)
  if (head === null) return "head undeterminable"
  if (row.verdict === VERDICTS.UNDETERMINABLE) return `\`${head}\` vs undeterminable`
  if (previous === null) return `\`${head}\` vs none (first record)`
  return `\`${previous}\` → \`${head}\``
}

export function renderCohort({ slug, index, rows, noiseNotes = [] }) {
  const sorted = [...rows].sort((a, b) => Number(a.forkPr) - Number(b.forkPr))
  const { total, counts, rates } = tally(sorted)
  const unchanged = sorted.filter((row) => row.verdict === VERDICTS.UNCHANGED)
  const own = []
  const lines = []
  const add = (line, quoted = false) => {
    lines.push(line)
    if (!quoted) own.push(line)
  }
  add(`<!-- garnet:cohort slug=${slug} k=${index} prs=${sorted.length} -->`)
  add(`### Cohort report · ${slug} · ${total} fork pull request(s)`)
  add("")
  add("**What the records show across this cohort**")
  add("")
  for (const v of VERDICT_LIST) add(`- ${v}: ${counts[v]} of ${total} (${pct(rates[v])})`)
  const reasons = reasonBreakdown(sorted)
  if (reasons.length > 0) {
    add("")
    add(`- undeterminable by reason: ${reasons.map(([k, n]) => `${k} ${n}`).join(" · ")}`)
  }
  add("")
  add("**Queue-compression candidates** · pull requests whose recorded outbound connections did not move")
  add("")
  if (unchanged.length > 0) for (const row of unchanged) add(`- fork pull request ${row.forkPr} · ${comparisonPair(row)} · ${scopeLabel(row.scope)}`)
  else add("- none in this cohort")
  add("")
  add("**False-noise notes**")
  add("")
  if (noiseNotes.length > 0) for (const note of noiseNotes) add(`- ${note}`, true)
  else add("- none recorded by the operator for this cohort")
  add("")
  add("**Per pull request**")
  add("")
  add("| fork pull request | result | comparison pair | scope |")
  add("|---|---|---|---|")
  for (const row of sorted) {
    add(`| ${row.forkPr} | ${row.verdict}${row.reason !== null && row.reason !== undefined ? ` (${row.reason})` : ""} | ${comparisonPair(row)} | ${scopeLabel(row.scope)} |`)
  }
  add("")
  add(`**${ASK}**`)
  add("")
  const text = lines.join("\n")
  assertAggregatesMatchRows(text, sorted, counts, total, `cohort-${index}.md`)
  assertVocabClean(own.join("\n"))
  return text
}

export function assertAggregatesMatchRows(text, rows, counts, total, where) {
  const tableRows = text.split("\n").filter((line) => /^\| \d+ \|/.test(line))
  if (tableRows.length !== rows.length) throw new Error(`${where}: rendered ${tableRows.length} rows for ${rows.length} pull requests`)
  const seen = Object.fromEntries(VERDICT_LIST.map((v) => [v, 0]))
  for (const line of tableRows) {
    const state = line.split("|")[2].trim().replace(/\s*\(.*\)$/, "")
    if (!VERDICT_LIST.includes(state)) throw new Error(`${where}: unreadable result cell '${state}'`)
    seen[state] += 1
  }
  let sum = 0
  for (const v of VERDICT_LIST) {
    if (seen[v] !== counts[v]) throw new Error(`${where}: aggregate ${v}=${counts[v]} but ${seen[v]} row(s) rendered beneath it`)
    sum += counts[v]
  }
  if (sum !== total) throw new Error(`${where}: bucket counts sum to ${sum}, cohort holds ${total} pull request(s)`)
  const compression = text.split("\n").filter((line) => /^- fork pull request \d+ · /.test(line)).length
  if (compression !== counts[VERDICTS.UNCHANGED]) {
    throw new Error(`${where}: ${compression} queue-compression candidate(s) listed for ${counts[VERDICTS.UNCHANGED]} unchanged row(s)`)
  }
  return true
}

export function selectPrs(target, { prs = null, fromObservations = false, limit = null } = {}) {
  let list
  if (Array.isArray(prs) && prs.length > 0) list = prs.map(Number)
  else if (fromObservations) {
    const byUpstream = new Map((target.replays ?? []).map((row) => [Number(row.upstreamPr), row]))
    list = (target.observations ?? [])
      .map((o) => byUpstream.get(Number(o.upstreamPr)))
      .filter((row) => row !== undefined)
      .map((row) => Number(row.forkPr))
      .filter((n) => Number.isInteger(n))
  } else throw new Error("usage: replay cohort <slug> --prs <n,n,...> | --from-observations [--limit N]")
  const seen = new Set()
  const unique = list.filter((n) => Number.isInteger(n) && !seen.has(n) && seen.add(n))
  return limit !== null && limit !== undefined ? unique.slice(0, limit) : unique
}

export async function mapInflight(items, max, fn) {
  const results = new Array(items.length)
  let next = 0
  const width = Math.max(1, Math.min(max || 1, items.length || 1))
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

export async function runCohort(target, opts = {}, { exec = run, write = true, drive = cardForPr } = {}) {
  const prs = selectPrs(target, opts)
  if (prs.length === 0) throw new Error(`no fork pull requests selected for '${target.slug}'`)
  const results = await mapInflight(prs, opts.maxInflight ?? 4, (pr) => drive(target, pr, { exec, write }))
  const rows = results.map((r) => r.row)
  for (const row of rows) upsertEvidence(target, row)
  const index = (target.cohorts?.length ?? 0) + 1
  const report = renderCohort({ slug: target.slug, index, rows, noiseNotes: opts.note ?? [] })
  const rel = `out/${target.slug}/cohort-${index}.md`
  if (write) writeFileSync(outPath(target.slug, `cohort-${index}.md`), report)
  const { counts, rates } = tally(rows)
  const cohortRow = { report: rel, prs, counts, rates, noiseNotes: (opts.note ?? []).join(" · "), renderedAt: new Date().toISOString() }
  ;(target.cohorts ?? (target.cohorts = [])).push(cohortRow)
  return { report, rows, cohortRow, index }
}
