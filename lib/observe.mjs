/**
 * Stage 0 — rank the upstream's real pull requests for review gaps a runtime
 * record could close. Every point in a total prints its reason beside it, and
 * the printed total equals the sum of the printed reasons (gated in the
 * renderer). Nothing here is runtime evidence; only a record can say what ran.
 */
import { MANIFESTS } from "./find.mjs"
import { anyPathMatches, normalizeWorkload } from "./paths.mjs"

const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "uv.lock", "go.sum", "Gemfile.lock", "poetry.lock", "bun.lockb", "bun.lock"])
const MANIFEST_NAMES = new Set(Object.values(MANIFESTS).flat().filter((name) => !LOCKFILES.has(name)))
const INSTALL_SURFACES = /(^|\/)(package\.json|\.npmrc|\.yarnrc(\.yml)?|pnpm-workspace\.yaml|Cargo\.toml|pyproject\.toml|setup\.py|Gemfile|go\.mod|Dockerfile[^/]*|\.tool-versions|\.node-version|\.nvmrc|\.python-version|rust-toolchain(\.toml)?)$/
const WORKFLOW_PATH = /^\.github\/(workflows|actions)\//
const BOT_AUTHORS = /^(dependabot(\[bot\])?|renovate(\[bot\])?|github-actions(\[bot\])?|greenkeeper(\[bot\])?|snyk-bot|allcontributors(\[bot\])?|pre-commit-ci(\[bot\])?|step-security-bot|posthog-bot)$/i
const TRANSITION_RE = /(?:bump|update|upgrade)\s+(?<name>\S+?)\s+(?:from\s+v?(?<from>\d[\w.+-]*)\s+)?to\s+v?(?<to>\d[\w.+-]*)/i
const CARET_RE = /(?<name>\S+)\s+(?<from>\d[\w.+-]*)\s*(?:->|→|=>)\s*(?<to>\d[\w.+-]*)/

export function basename(path) {
  return String(path).split("/").pop()
}
export function isLockfile(path) {
  return LOCKFILES.has(basename(path))
}
export function isManifest(path) {
  return MANIFEST_NAMES.has(basename(path))
}
export function isWorkflowPath(path) {
  return WORKFLOW_PATH.test(String(path))
}
export function isInstallSurface(path) {
  return INSTALL_SURFACES.test(String(path))
}
export function isBotAuthor(login) {
  return BOT_AUTHORS.test(String(login ?? ""))
}

/** Merge-queue batches (trunk, GitHub merge queue) are not review surfaces. */
export function isMergeQueue(pr) {
  const head = String(pr?.headRefName ?? "")
  const title = String(pr?.title ?? "")
  const login = String(pr?.author?.login ?? pr?.author ?? "")
  return /^(trunk-merge|gh-readonly-queue)\//.test(head) || /^trunk-merge\//.test(title) || /^app\/trunk-io$/i.test(login)
}

/**
 * @param {string} title
 * @returns {{name: string, from: string|null, to: string}|null}
 */
export function parseVersionTransition(title) {
  const text = String(title ?? "")
  const match = text.match(TRANSITION_RE) ?? text.match(CARET_RE)
  if (match === null) return null
  return { name: match.groups.name.replace(/[`'"]/g, ""), from: match.groups.from ?? null, to: match.groups.to }
}

export function majorOf(version) {
  const match = String(version ?? "").match(/^v?(\d+)/)
  return match === null ? null : Number(match[1])
}

export function isMajorTransition(transition) {
  if (transition === null || transition.from === null) return false
  const from = majorOf(transition.from)
  const to = majorOf(transition.to)
  return from !== null && to !== null && from !== to
}

/**
 * Facts read from a `gh pr list --json` row. No judgement here.
 */
export function prFacts(pr) {
  const files = Array.isArray(pr.files) ? pr.files : []
  const paths = files.map((file) => (typeof file === "string" ? file : file.path)).filter((path) => typeof path === "string")
  const additions = files.reduce((sum, file) => sum + (Number(file?.additions) || 0), 0)
  const deletions = files.reduce((sum, file) => sum + (Number(file?.deletions) || 0), 0)
  return {
    number: Number(pr.number),
    title: String(pr.title ?? ""),
    author: pr.author?.login ?? pr.author ?? null,
    state: String(pr.state ?? "").toUpperCase(),
    createdAt: pr.createdAt ?? null,
    isDraft: pr.isDraft === true,
    paths,
    fileCount: paths.length,
    additions,
    deletions,
    lockfiles: paths.filter(isLockfile),
    manifests: paths.filter(isManifest),
    workflows: paths.filter(isWorkflowPath),
    installSurfaces: paths.filter(isInstallSurface),
    transition: parseVersionTransition(pr.title),
    bot: isBotAuthor(pr.author?.login ?? pr.author),
  }
}

/**
 * Each rule prints one reason and one integer. Reasons never overlap in meaning
 * so a reader can add the column by eye.
 */
export const GAP_RULES = Object.freeze([
  { id: "no-record", points: 3, reason: "no runtime record exists for this change", when: (facts) => facts.fileCount > 0 },
  { id: "install-surface", points: 3, reason: "install-time execution surface changed", when: (facts) => facts.installSurfaces.length > 0 },
  { id: "lockfile", points: 2, reason: "lockfile delta", when: (facts) => facts.lockfiles.length > 0 },
  { id: "manifest", points: 1, reason: "manifest changed", when: (facts) => facts.manifests.length > 0 },
  { id: "workflow", points: 2, reason: "workflow surface changed", when: (facts) => facts.workflows.length > 0 },
  { id: "bot-author", points: 2, reason: "bot-authored, reviewed on trust", when: (facts) => facts.bot },
  { id: "dependency-only", points: 2, reason: "dependency-only diff, nothing else to read", when: (facts) => facts.fileCount > 0 && facts.paths.every((path) => isLockfile(path) || isManifest(path)) },
  { id: "major", points: 2, reason: "major version transition", when: (facts) => isMajorTransition(facts.transition) },
  { id: "wide", points: 1, reason: "wide change surface (more than 20 files)", when: (facts) => facts.fileCount > 20 },
  { id: "undeterminable-surface", points: 1, reason: "change surface undeterminable from metadata", when: (facts) => facts.fileCount === 0 },
])

export function scoreGap(facts, rules = GAP_RULES, workload = null) {
  const reasons = rules.filter((rule) => rule.when(facts)).map((rule) => ({ id: rule.id, points: rule.points, reason: rule.reason }))
  const scope = normalizeWorkload(workload)
  if (scope !== null && anyPathMatches(facts.paths, scope.paths)) {
    reasons.push({ id: "workload-surface", points: 3, reason: `touches ${scope.name} workload surface` })
  }
  const total = reasons.reduce((sum, row) => sum + row.points, 0)
  return { total, reasons }
}

export function classifyPr(facts) {
  if (facts.fileCount === 0) return "undeterminable"
  if (facts.paths.every((path) => isLockfile(path) || isManifest(path))) return "dependency"
  if (facts.workflows.length > 0 && facts.workflows.length === facts.fileCount) return "workflow"
  if (facts.installSurfaces.length > 0) return "install-surface"
  return "code"
}

/**
 * @param {Record<string, unknown>} pr
 * @param {{name: string, paths: string[]}|null} [workload] named workload whose paths rank up
 * @returns {object} one observation row
 */
export function observationFor(pr, workload = null) {
  const facts = prFacts(pr)
  const gap = scoreGap(facts, GAP_RULES, workload)
  return {
    evidence_class: "candidate-evidence",
    upstreamPr: facts.number,
    title: facts.title,
    author: facts.author,
    bot: facts.bot,
    state: facts.state,
    createdAt: facts.createdAt,
    kind: classifyPr(facts),
    transition: facts.transition,
    files: facts.fileCount,
    paths: facts.paths,
    gap,
  }
}

export function rankObservations(observations) {
  return [...observations].sort((left, right) => (right.gap.total - left.gap.total) || (right.upstreamPr - left.upstreamPr))
}

export function recommend(observations, workload = null) {
  const ranked = rankObservations(observations)
  const scope = normalizeWorkload(workload)
  if (scope !== null) {
    const hit = ranked.find((row) => anyPathMatches(row.paths, scope.paths))
    if (hit !== undefined) return hit
  }
  return ranked.find((row) => row.kind === "dependency" && row.transition !== null) ?? ranked[0] ?? null
}

function shortTitle(title, width = 64) {
  const text = String(title).replace(/\s+/g, " ").trim()
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

/**
 * Terminal report. The total column is asserted equal to its printed reasons.
 * @param {object[]} observations
 * @param {{slug?: string|null, upstream: string, scanned?: number, setAside?: number, workload?: {name: string, paths: string[]}|null}} meta
 */
export function renderObserveOutput(observations, { slug = null, upstream, scanned = observations.length, setAside = 0, workload = null }) {
  const ranked = rankObservations(observations)
  const aside = setAside > 0 ? ` · ${setAside} merge-queue batch(es) set aside` : ""
  const lines = [`candidate evidence only · ${upstream} · ${ranked.length} of ${scanned} pull request(s) ranked${aside} · nothing here is a runtime record`]
  for (const row of ranked) {
    const sum = row.gap.reasons.reduce((acc, reason) => acc + reason.points, 0)
    if (sum !== row.gap.total) throw new Error(`gap total ${row.gap.total} does not equal its printed reasons (${sum}) for #${row.upstreamPr}`)
    const transition = row.transition === null ? "" : ` · ${row.transition.name} ${row.transition.from ?? "?"} → ${row.transition.to}`
    lines.push("")
    lines.push(`#${row.upstreamPr}  gap ${String(row.gap.total).padStart(2)}  ${row.kind.padEnd(15)} ${row.files} file(s) · ${row.bot ? "bot" : row.author ?? "unknown author"}${transition}`)
    lines.push(`      ${shortTitle(row.title)}`)
    for (const reason of row.gap.reasons) lines.push(`      +${reason.points} ${reason.reason}`)
  }
  const pick = recommend(ranked, workload)
  lines.push("")
  if (pick === null) lines.push("no candidates: widen --limit or point at a repository with dependency traffic")
  else lines.push(`next: replay live ${slug ?? "<slug>"} --pr ${pick.upstreamPr}`)
  return lines.join("\n")
}
