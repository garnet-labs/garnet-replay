/**
 * Stage 1, fork transition: when no upstream pull request carries the change,
 * author it on the fork as two routine commits. Commit 1 bumps one dependency
 * to a real published version with its install scripts still blocked; commit 2
 * is the trust decision that lets them run. The fork's own recording workflow
 * records both commits, so the comment on commit 2 shows exactly what the
 * decision let run.
 *
 * pnpm only: pnpm 10 blocks dependency build scripts unless the package is
 * listed in `onlyBuiltDependencies`, which is what makes the two states real.
 */
import { join } from "node:path"
import { assertForkTarget, assertOutbound } from "./guards.mjs"
import { OUT_DIR } from "./ledger.mjs"
import { branchName, changeCommitMessage, contextCommitMessage, prBodyText, publishSteps, workDirFor } from "./replay-pr.mjs"

export const LOCKFILE = "pnpm-lock.yaml"
export const WORKSPACE_FILE = "pnpm-workspace.yaml"
export const ALLOWLIST_KEY = "onlyBuiltDependencies"

/**
 * Resolved version of `dep` for one importer in a pnpm v9 lockfile.
 * @param {string} lockText
 * @param {string} importer  "." for the root, otherwise the package directory
 * @param {string} dep
 * @returns {{specifier:string, version:string}|null}
 */
export function resolvedVersion(lockText, importer, dep) {
  const lines = String(lockText ?? "").split("\n")
  const start = lines.findIndex((line) => line === `  ${importer}:`)
  if (start < 0) return null
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^  \S/.test(line) || /^\S/.test(line)) break
    if (line === `      ${dep}:` || line === `      '${dep}':`) {
      const specifier = /^\s+specifier:\s*(.+)$/.exec(lines[i + 1] ?? "")
      const version = /^\s+version:\s*(.+)$/.exec(lines[i + 2] ?? "")
      if (specifier === null || version === null) return null
      return { specifier: specifier[1].trim().replace(/^'(.*)'$/, "$1"), version: version[1].trim().replace(/\(.*$/, "") }
    }
  }
  return null
}

/**
 * Text-preserving bump of one dependency spec in a package.json source.
 * @param {string} source
 * @param {string} dep
 * @param {string} spec  the new range, e.g. "^25.9.0"
 */
export function bumpManifest(source, dep, spec) {
  const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`("${escaped}"\\s*:\\s*)"[^"]*"`, "g")
  const matches = String(source).match(pattern) ?? []
  if (matches.length === 0) throw new Error(`manifest does not declare ${dep}`)
  if (matches.length > 1) throw new Error(`manifest declares ${dep} ${matches.length} times; refusing to guess`)
  return String(source).replace(pattern, `$1${JSON.stringify(spec)}`)
}

/**
 * Add `dep` to the pnpm build-script allowlist, preserving the file's own formatting.
 * Handles a JSON array under `pnpm.onlyBuiltDependencies` (package.json) or a
 * YAML list under `onlyBuiltDependencies:` (pnpm-workspace.yaml).
 */
export function allowBuildScripts(source, dep, { file }) {
  const text = String(source)
  if (file.endsWith(".json")) {
    const open = new RegExp(`("${ALLOWLIST_KEY}"\\s*:\\s*\\[)([\\s\\S]*?)(\\n?\\s*\\])`)
    const match = open.exec(text)
    if (match === null) throw new Error(`${file} has no ${ALLOWLIST_KEY} array`)
    const items = match[2]
    if (new RegExp(`"${dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(items)) throw new Error(`${dep} is already allowed in ${file}`)
    const indent = /\n(\s+)"/.exec(items)?.[1] ?? "  "
    const body = `${items.replace(/\s+$/, "")},\n${indent}${JSON.stringify(dep)}`
    return text.replace(open, `$1${body}$3`)
  }
  const lines = text.split("\n")
  const start = lines.findIndex((line) => new RegExp(`^${ALLOWLIST_KEY}:\\s*$`).test(line))
  if (start < 0) throw new Error(`${file} has no ${ALLOWLIST_KEY} list`)
  let end = start + 1
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end += 1
  const existing = lines.slice(start + 1, end).map((line) => line.replace(/^\s+-\s*/, "").replace(/^['"]|['"]$/g, ""))
  if (existing.includes(dep)) throw new Error(`${dep} is already allowed in ${file}`)
  const indent = /^(\s+)-/.exec(lines[start + 1] ?? "")?.[1] ?? "    "
  const item = /^[@]/.test(dep) ? `'${dep}'` : dep
  lines.splice(end, 0, `${indent}- ${item}`)
  return lines.join("\n")
}

/**
 * @param {object} input
 * @param {string} input.slug
 * @param {string} input.upstream
 * @param {string} input.fork
 * @param {string} input.defaultBranch
 * @param {string} input.dependency
 * @param {string} input.from             resolved version on the fork default branch
 * @param {string} input.to               real published version to move to
 * @param {string} [input.spec]           manifest range, default `^<to>`
 * @param {string} [input.packageDir]     importer directory, "." for the root
 * @param {string} input.allowlistFile    package.json or pnpm-workspace.yaml carrying onlyBuiltDependencies
 * @param {string|null} [input.work]
 * @param {boolean} [input.workExists]
 * @param {string|null} [input.branch]
 * @param {boolean} [input.draft]
 * @param {{first?:string,change?:string,title?:string,body?:string}} [input.messages]
 */
export function planTransition(input) {
  const {
    slug, upstream, fork, defaultBranch, dependency, from, to, spec = `^${to}`, packageDir = ".",
    allowlistFile, work: requestedWork = null, workExists = false, branch: requestedBranch = null, draft = true, messages: overrides = {},
  } = input
  if (typeof fork !== "string" || fork === "") throw new Error(`target '${slug}' has no fork configured`)
  if (fork.toLowerCase() === String(upstream).toLowerCase()) throw new Error("fork must not be the upstream repository")
  for (const [name, value] of Object.entries({ dependency, from, to, allowlistFile })) {
    if (typeof value !== "string" || value === "") throw new Error(`transition needs ${name}`)
  }
  if (from === to) throw new Error(`transition needs two different versions (got ${from} twice)`)
  if (![`package.json`, WORKSPACE_FILE].includes(allowlistFile)) throw new Error(`allowlist must live in package.json or ${WORKSPACE_FILE}, got ${allowlistFile}`)

  const transition = { name: dependency, from, to }
  const manifest = packageDir === "." ? "package.json" : `${packageDir.replace(/\/$/, "")}/package.json`
  const firstPaths = [manifest, LOCKFILE]
  const paths = [...new Set([...firstPaths, allowlistFile])]
  const branch = requestedBranch ?? branchName({ transition, upstreamPr: 0 })
  const work = requestedWork ?? workDirFor(slug)
  const bodyFile = join(OUT_DIR, slug, `transition-${branch.replace(/[^a-z0-9.]+/gi, "-")}-body.md`)
  const forkUrl = `https://github.com/${fork}.git`

  const messages = {
    first: overrides.first ?? contextCommitMessage(paths, { firstPaths, transition }),
    change: overrides.change ?? changeCommitMessage("", upstream, { paths, firstPaths, transition }),
  }
  const title = overrides.title ?? messages.first.split("\n")[0]
  const body = overrides.body ?? prBodyText({ transition, firstPaths, paths })
  for (const text of [branch, messages.first, messages.change, title, body]) assertOutbound(text, upstream)
  assertForkTarget(forkUrl, fork)

  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  const steps = [
    workExists
      ? { id: "fetch-fork", kind: "write-local", note: "reuse the fork checkout", ...g("fetch", "--prune", "origin") }
      : { id: "clone-fork", kind: "write-local", note: "clone the fork (never the upstream)", cmd: "git", args: ["clone", forkUrl, work] },
    { id: "verify-origin", kind: "read", capture: "originUrl", note: "guard: origin must be the fork", ...g("remote", "get-url", "origin") },
    { id: "branch", kind: "write-local", note: `create ${branch} from ${defaultBranch}`, ...g("checkout", "-B", branch, `origin/${defaultBranch}`) },
    { id: "verify-from", kind: "read", assertFileIncludes: { file: join(work, LOCKFILE), text: `${dependency}@${from}` }, note: `guard: the fork default branch resolves ${dependency} to ${from}` },
    { id: "bump-manifest", kind: "write-local", editFile: { file: join(work, manifest), transform: (source) => bumpManifest(source, dependency, spec) }, note: `commit 1: ${manifest} ${dependency} → ${spec}` },
    { id: "resolve-lockfile", kind: "write-local", cwd: work, env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" }, note: "commit 1: resolve the lockfile with the repository's own pnpm; no scripts run", cmd: "corepack", args: ["pnpm", "install", "--lockfile-only"] },
    { id: "verify-to", kind: "read", assertFileIncludes: { file: join(work, LOCKFILE), text: `${dependency}@${to}` }, note: `guard: the lockfile now resolves ${dependency} to ${to}` },
    { id: "first-add", kind: "write-local", ...g("add", "--", ...firstPaths) },
    { id: "first-check", kind: "read", capture: "firstDiff", note: "guard: commit 1 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "first-commit", kind: "write-local", note: "commit 1", ...g("commit", "-q", "-m", messages.first) },
    { id: "allow-scripts", kind: "write-local", editFile: { file: join(work, allowlistFile), transform: (source) => allowBuildScripts(source, dependency, { file: allowlistFile }) }, note: `commit 2: allow ${dependency} build scripts in ${allowlistFile}` },
    { id: "change-add", kind: "write-local", ...g("add", "--", allowlistFile) },
    { id: "change-check", kind: "read", capture: "changeDiff", note: "guard: commit 2 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "change-commit", kind: "write-local", note: "commit 2", ...g("commit", "-q", "-m", messages.change) },
    { id: "verify-commits", kind: "read", capture: "commitCount", note: "guard: exactly two new commits", ...g("rev-list", "--count", `origin/${defaultBranch}..HEAD`) },
    { id: "first-sha", kind: "read", capture: "firstSha", ...g("rev-parse", "HEAD~1") },
    { id: "head-sha", kind: "read", capture: "forkHeadSha", ...g("rev-parse", "HEAD") },
    ...publishSteps({ fork, branch, defaultBranch, bodyFile, body, title, draft, work }),
  ]

  return {
    mode: "transition", slug, upstream, fork, upstreamPr: null, branch, defaultBranch, baseSha: null, headSha: null, transition,
    scope: "immediate-parent-to-head", paths, firstPaths, record: "fork-workflow", ecosystem: "pnpm", packageDir, manifest, allowlistFile,
    work, bodyFile, messages, title, body, draft, steps,
  }
}
