/**
 * One JSON ledger per target repository (`targets/<slug>.json`). Every command
 * reads and writes through this module; `docs/harness.md` documents the shape.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSlug } from "./guards.mjs"
import { mergeWorkload, normalizeWorkload } from "./paths.mjs"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const TARGETS_DIR = join(ROOT, "targets")
export const OUT_DIR = join(ROOT, "out")

export const STAGES = Object.freeze([
  { n: 0, name: "find", command: "replay find", question: "Is there a review gap worth recording on a real change?" },
  { n: 1, name: "replay", command: "replay live", question: "Does the record show new behavior on the fork?" },
  { n: 2, name: "card", command: "replay card", question: "Would this have helped the review?" },
  { n: 3, name: "cohort", command: "replay cohort", question: "What are the rates over 10–50 pull requests?" },
  { n: 4, name: "pilot", command: "replay consume", question: "Is live evidence consumed by a reviewer or agent?" },
  { n: 5, name: "integration", command: "replay stage2", question: "Does approve/escalate behavior change with the record present?" },
  { n: 6, name: "production", command: "ledger-tracked", question: "Do base→head evidence and policy run without an operator?" },
])

/**
 * @param {string} slug
 * @returns {string}
 */
export function targetPath(slug) {
  return join(TARGETS_DIR, `${assertSlug(slug)}.json`)
}

export function listTargets() {
  if (!existsSync(TARGETS_DIR)) return []
  return readdirSync(TARGETS_DIR).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort()
}

export function loadTarget(slug) {
  const path = targetPath(slug)
  if (!existsSync(path)) {
    throw new Error(`unknown target '${slug}' (expected ${path}); start with: replay find <owner/repo> --fork <owner/repo> --slug ${slug}`)
  }
  return JSON.parse(readFileSync(path, "utf8"))
}

/**
 * Create or reopen a target. A target tracks one upstream and writes to one fork.
 * @param {string} slug
 * @param {{upstream?: string|null, fork?: string|null}} options
 */
const RECORD_MODES = new Set(["fork-workflow", "inject", "instrument"])

/**
 * Normalized record declaration `{mode, job}`, or null. The mode selects how
 * `replay live` records the fork pull request; `instrument` also names the
 * existing workflow job to record inside (`<workflow-file>/<job>`).
 * @param {unknown} record
 * @returns {{mode: string, job: string|null}|null}
 */
export function normalizeRecord(record) {
  if (record === null || record === undefined) return null
  if (typeof record !== "object" || Array.isArray(record)) throw new Error("record must be {mode, job}")
  const entry = /** @type {Record<string, unknown>} */ (record)
  if (typeof entry.mode !== "string" || !RECORD_MODES.has(entry.mode)) {
    throw new Error(`record mode must be one of ${[...RECORD_MODES].join("|")}`)
  }
  const job = entry.job ?? null
  if (entry.mode === "instrument" && (typeof job !== "string" || job === "")) {
    throw new Error("record mode 'instrument' needs job <workflow-file>/<job>")
  }
  if (entry.mode !== "instrument" && job !== null) throw new Error(`record mode '${entry.mode}' takes no job`)
  return { mode: entry.mode, job }
}

/**
 * @param {{mode: string, job: string|null}|null|undefined} current
 * @param {unknown} incoming
 * @returns {{mode: string, job: string|null}|null} merged declaration; throws on conflict
 */
export function mergeRecord(current, incoming) {
  const next = normalizeRecord(incoming)
  if (next === null) return current ?? null
  if (current === null || current === undefined) return next
  const kept = normalizeRecord(current)
  const same = kept !== null && kept.mode === next.mode && kept.job === next.job
  if (!same) {
    const show = (decl) => (decl === null ? "none" : `${decl.mode}${decl.job === null ? "" : ` ${decl.job}`}`)
    throw new Error(`target already declares record ${show(kept)}; refusing ${show(next)}`)
  }
  return kept
}

export function ensureTarget(slug, { upstream = null, fork = null, record = null, workload = null } = {}) {
  const path = targetPath(slug)
  if (existsSync(path)) {
    const target = JSON.parse(readFileSync(path, "utf8"))
    if (upstream !== null && target.upstream !== upstream) throw new Error(`target '${slug}' already tracks upstream ${target.upstream}`)
    if (fork !== null && typeof target.fork !== "string") target.fork = fork
    if (fork !== null && target.fork !== fork) throw new Error(`target '${slug}' already writes to fork ${target.fork}`)
    if (record !== null) target.record = mergeRecord(target.record, record)
    if (workload !== null) target.workload = mergeWorkload(target.workload, workload)
    return target
  }
  if (upstream === null || fork === null) throw new Error(`new target '${slug}' needs --fork <owner/repo> (and the upstream as the first argument)`)
  if (upstream.toLowerCase() === fork.toLowerCase()) throw new Error("the fork must not be the upstream repository")
  return {
    slug,
    upstream,
    fork,
    record: normalizeRecord(record),
    workload: normalizeWorkload(workload),
    notes: [],
    observations: [],
    replays: [],
    evidence: [],
    cohorts: [],
    consumption: [],
    stage2: { state: "unstarted" },
    ladder: { 4: { state: "unstarted" }, 5: { state: "unstarted" }, 6: { state: "unstarted" } },
  }
}

/**
 * Highest ladder stage with evidence in the ledger. −1 when nothing is recorded.
 * @param {Record<string, any>} target
 * @returns {number}
 */
export function deriveStage(target) {
  let stage = -1
  if (Array.isArray(target.observations) && target.observations.length > 0) stage = 0
  if (Array.isArray(target.replays) && target.replays.some((row) => row.state === "recorded")) stage = 1
  if (Array.isArray(target.evidence) && target.evidence.some((row) => row.verdict !== undefined && row.verdict !== "undeterminable")) stage = 2
  if (Array.isArray(target.cohorts) && target.cohorts.length > 0) stage = 3
  if (Array.isArray(target.consumption) && target.consumption.some((row) => row.consumed === true)) stage = 4
  for (const n of [5, 6]) if (target.ladder?.[n]?.state === "done") stage = n
  return stage
}

export function saveTarget(target) {
  mkdirSync(TARGETS_DIR, { recursive: true })
  const out = { ...target, stage: deriveStage(target) }
  writeFileSync(targetPath(target.slug), `${JSON.stringify(out, null, 2)}\n`)
  return out
}

export function outPath(slug, file) {
  const dir = join(OUT_DIR, assertSlug(slug))
  mkdirSync(dir, { recursive: true })
  return join(dir, file)
}

/**
 * Upsert a row by key, preserving order.
 * @template T
 * @param {T[]} rows
 * @param {T} row
 * @param {(row: T) => unknown} key
 * @returns {{rows: T[], added: boolean}}
 */
export function upsertRow(rows, row, key) {
  const list = Array.isArray(rows) ? rows.slice() : []
  const index = list.findIndex((existing) => key(existing) === key(row))
  if (index === -1) {
    list.push(row)
    return { rows: list, added: true }
  }
  list[index] = { ...list[index], ...row }
  return { rows: list, added: false }
}
