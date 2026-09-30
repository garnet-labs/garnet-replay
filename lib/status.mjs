/**
 * `replay status`: the operator home screen. Renders the 0–6 ladder board from
 * the target ledgers. A stage is done only when its own artifact exists in the
 * ledger; pending, head-unbound or undeterminable rows are never done.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { STAGES, OUT_DIR, listTargets, loadTarget, deriveStage } from "./ledger.mjs"
import { VERDICTS } from "./evidence.mjs"
import { describeSignals } from "./consume.mjs"

export const MARK = Object.freeze({ done: "[x]", "in-flight": "[~]", unstarted: "[ ]" })

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

export function stageRow(target, n) {
  const observations = target.observations ?? []
  const replays = target.replays ?? []
  const evidence = target.evidence ?? []
  const cohorts = target.cohorts ?? []
  const consumption = target.consumption ?? []
  switch (n) {
    case 0:
      return observations.length > 0
        ? { state: "done", detail: `${plural(observations.length, "candidate")} in ledger` }
        : { state: "unstarted", detail: "no candidates ranked" }
    case 1: {
      const recorded = replays.filter((row) => row.state === "recorded")
      if (recorded.length > 0) return { state: "done", detail: `fork pull request ${recorded[recorded.length - 1].forkPr} (recorded)` }
      const open = replays.filter((row) => row.state !== "recorded")
      if (open.length > 0) {
        const row = open[open.length - 1]
        return { state: "in-flight", detail: `fork pull request ${row.forkPr ?? "(none yet)"} · ${row.state ?? "pending"}` }
      }
      return { state: "unstarted", detail: "no replay opened" }
    }
    case 2: {
      const good = evidence.filter((row) => typeof row.verdict === "string" && row.verdict !== VERDICTS.UNDETERMINABLE)
      if (good.length > 0) {
        const row = good[good.length - 1]
        return { state: "done", detail: `${row.card ?? "card path missing"} (${row.verdict})` }
      }
      if (evidence.length > 0) {
        const row = evidence[evidence.length - 1]
        return { state: "in-flight", detail: `fork pull request ${row.forkPr} · ${row.verdict ?? "pending"}${row.reason ? ` (${row.reason})` : ""}` }
      }
      return { state: "unstarted", detail: "no card rendered" }
    }
    case 3: {
      if (cohorts.length > 0) {
        const row = cohorts[cohorts.length - 1]
        return { state: "done", detail: `${row.report ?? "report path missing"} (${(row.prs ?? []).length} pull requests)` }
      }
      return { state: "unstarted", detail: "no cohort report" }
    }
    case 4: {
      const consumed = consumption.filter((row) => row.consumed === true)
      if (consumed.length > 0) {
        const row = consumed[consumed.length - 1]
        return { state: "done", detail: `fork pull request ${row.forkPr} · ${row.consumers.join(", ")}` }
      }
      if (consumption.length > 0) {
        const row = consumption[consumption.length - 1]
        const receipts = consumption.reduce((sum, r) => sum + (Array.isArray(r.receipts) ? r.receipts.length : 0), 0)
        const latest = Array.isArray(row.receipts) && row.receipts.length > 0 ? ` · ${describeSignals(row.signals)}` : ""
        return { state: "in-flight", detail: `fork pull request ${row.forkPr} · no head-bound consumption yet${latest} · ${receipts} receipt(s) across ${consumption.length} checked` }
      }
      return { state: "unstarted", detail: "no consumption checked" }
    }
    case 5: {
      const stage2 = target.stage2 ?? {}
      if (stage2.state === "done") return { state: "done", detail: stage2.note ?? "mirror + gate on the fork default branch" }
      if (stage2.state === "in-flight") return { state: "in-flight", detail: stage2.note ?? "mirror + gate opened, not yet on the default branch" }
      return { state: "unstarted", detail: "replay stage2 <slug> not run" }
    }
    default: {
      const entry = target.ladder?.[n] ?? target.ladder?.[String(n)] ?? {}
      const state = entry.state === "done" ? "done" : entry.state === "in-flight" ? "in-flight" : "unstarted"
      return { state, detail: entry.note ?? "base→head record and policy without an operator" }
    }
  }
}

export function stageRows(target) {
  return STAGES.map((stage) => ({ n: stage.n, name: stage.name, ...stageRow(target, stage.n) }))
}

export function nextStage(target) {
  const pending = stageRows(target).find((row) => row.state !== "done")
  return pending ? pending.n : 6
}

export function nextCommand(target, n = nextStage(target)) {
  const slug = target.slug
  switch (n) {
    case 0:
      return `replay find ${target.upstream ?? "<owner/repo>"} --slug ${slug} --fork ${target.fork ?? "<owner/repo>"}`
    case 1:
      return `replay live ${slug} --pr <N>   # highest score in targets/${slug}.json`
    case 2: {
      const done = new Set((target.evidence ?? []).filter((row) => row.verdict && row.verdict !== VERDICTS.UNDETERMINABLE).map((row) => row.forkPr))
      const row = (target.replays ?? []).filter((r) => r.state === "recorded" && !done.has(r.forkPr)).pop()
        ?? (target.replays ?? []).filter((r) => r.forkPr).pop()
      return `replay card ${slug} --pr ${row?.forkPr ?? "<forkPr>"}`
    }
    case 3:
      return `replay cohort ${slug} --from-observations --limit 20`
    case 4: {
      const row = (target.replays ?? []).filter((r) => r.forkPr).pop()
      return `replay consume https://github.com/${target.fork ?? "<fork>"}/pull/${row?.forkPr ?? "<forkPr>"}`
    }
    case 5:
      return `replay stage2 ${slug} --ecosystem <npm|pnpm|yarn|cargo|ruby|uv|go>`
    default:
      return `# stage 6 is ledger-tracked: set ladder.6 in targets/${slug}.json once base→head records run without an operator`
  }
}

export function targetView(target) {
  const stage = deriveStage(target)
  const next = nextStage(target)
  const stageMeta = STAGES[next]
  return {
    slug: target.slug,
    upstream: target.upstream ?? "undeterminable",
    fork: target.fork ?? "undeterminable",
    stage,
    stageLabel: stage < 0 ? "none yet" : `${stage} ${STAGES[stage].name}`,
    next,
    nextName: stageMeta.name,
    rows: stageRows(target),
    question: stageMeta.question,
    command: nextCommand(target, next),
    error: target.loadError ?? null,
  }
}

export function renderTargetText(target) {
  const view = targetView(target)
  const out = [`${view.slug}  ${view.upstream} → ${view.fork}`, `  current stage: ${view.stageLabel}`]
  if (view.error !== null) out.push(`  ledger unreadable, undeterminable: ${view.error}`)
  for (const row of view.rows) out.push(`  ${MARK[row.state]} ${row.n} ${row.name.padEnd(11)} ${row.state.padEnd(10)} ${row.detail}`)
  out.push(`  exit question (stage ${view.next} ${view.nextName}): ${view.question}`)
  out.push(`  next: ${view.command}`)
  return out.join("\n")
}

export function renderTargetMd(target) {
  const view = targetView(target)
  const out = [
    `## ${view.slug}`,
    "",
    `\`${view.upstream}\` → \`${view.fork}\` · current stage: **${view.stageLabel}**`,
    "",
    ...(view.error !== null ? [`Ledger unreadable, **undeterminable**: ${view.error}`, ""] : []),
    "| | stage | state | latest |",
    "|---|---|---|---|",
    ...view.rows.map((row) => `| ${MARK[row.state]} | ${row.n} ${row.name} | ${row.state} | ${row.detail} |`),
    "",
    `Exit question (stage ${view.next} ${view.nextName}): ${view.question}`,
    "",
    `Next: \`${view.command}\``,
    "",
  ]
  return out.join("\n")
}

export function loadAll(slugs = listTargets()) {
  return slugs.map((slug) => {
    try {
      return loadTarget(slug)
    } catch (error) {
      return { slug, loadError: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function renderBoardText(targets) {
  if (targets.length === 0) return "no targets yet · start with: replay find <owner/repo> --slug <slug> --fork <owner/repo>"
  return targets.map(renderTargetText).join("\n\n")
}

export function renderBoardMd(targets) {
  const head = ["# Target ladder", "", `${targets.length} target(s) · generated by \`replay status\``, ""]
  if (targets.length === 0) return `${head.join("\n")}No targets yet.\n`
  return `${head.join("\n")}${targets.map(renderTargetMd).join("\n")}`
}

export function writeBoard(targets) {
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, "STATUS.md")
  writeFileSync(path, renderBoardMd(targets))
  return path
}
