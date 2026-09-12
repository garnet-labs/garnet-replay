/**
 * Stage 1 planner: replay a real upstream pull request onto the fork as two
 * commits. Commit 1 puts the touched paths in the state the change was made
 * against; commit 2 applies the change. The fork's own recording workflow
 * records both commits; when the fork has none, a recording workflow is added
 * in commit 1.
 *
 * The planner is pure: facts in, an ordered step list out. `--dry-run` prints
 * the same steps that `executePlan` runs, so what is shown is what happens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { ghJson, run, upstreamPr as fetchUpstreamPr, forkDefaultBranch as ghForkDefaultBranch, latestRuntimeReviewComment, parseReplayMarker } from "./gh.mjs"
import { assertForkTarget, assertOutbound, assertTwoCommits, repoFromUrl, stripUpstreamLeak } from "./guards.mjs"
import { parseVersionTransition } from "./observe.mjs"
import { OUT_DIR } from "./ledger.mjs"
import { waitForRecord } from "./wait.mjs"
import { verifyPreparedPaths, verifyPreparedResume } from "./replay-prepared.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const RECORD_TEMPLATE = join(ROOT, "live", "templates", "garnet-record.yml")
export const RECORD_WORKFLOW_PATH = ".github/workflows/garnet-record.yml"
export const DEPENDABOT_CONFIG_PATH = ".github/dependabot.yml"
export const GARNET_ACTION_PIN = "e546567a72e4fede11ec39d6e9f75b539adef22c"

/** Dependabot `package-ecosystem` per harness ecosystem. */
export const DEPENDABOT_ECOSYSTEMS = Object.freeze({
  npm: "npm",
  pnpm: "npm",
  yarn: "npm",
  cargo: "cargo",
  ruby: "bundler",
  uv: "uv",
  go: "gomod",
  bun: "bun",
})

/** Install commands recorded per ecosystem when a recording workflow is added. */
export const INSTALL_COMMANDS = Object.freeze({
  npm: "npm ci --ignore-scripts=false",
  pnpm: "corepack enable && pnpm install --no-frozen-lockfile",
  yarn: "corepack enable && yarn install",
  cargo: "cargo fetch --locked && cargo build --locked",
  ruby: "bundle install",
  uv: "uv sync --frozen",
  go: "go mod download && go build ./...",
})

export const ECOSYSTEM_BY_LOCKFILE = Object.freeze({
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "Cargo.lock": "cargo",
  "Gemfile.lock": "ruby",
  "uv.lock": "uv",
  "go.sum": "go",
  "go.mod": "go",
  "bun.lock": "bun",
  "bun.lockb": "bun",
})

/** Pick the ecosystem from touched paths, or null when none is recognised. */
export function detectEcosystem(paths) {
  const rootLocks = paths.filter((path) => path in ECOSYSTEM_BY_LOCKFILE)
  const candidates = rootLocks.length > 0 ? rootLocks : paths
  const ecosystems = new Set()
  for (const path of candidates) {
    const name = path.split("/").pop()
    if (name in ECOSYSTEM_BY_LOCKFILE) ecosystems.add(ECOSYSTEM_BY_LOCKFILE[name])
  }
  if (ecosystems.size > 1) return null
  if (ecosystems.size === 1) return [...ecosystems][0]
  if (paths.some((path) => path.split("/").pop() === "package.json")) return "npm"
  if (paths.some((path) => path.split("/").pop() === "pyproject.toml")) return "uv"
  if (paths.some((path) => path.split("/").pop() === "Cargo.toml")) return "cargo"
  if (paths.some((path) => path.split("/").pop() === "Gemfile")) return "ruby"
  return null
}

export function slugPart(value) {
  return String(value).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * Routine branch name: `deps/<package>-<version>` when the title carries a
 * transition, `chore/manifests-<n>` when every touched path is a manifest,
 * `chore/update-<n>` otherwise.
 */
export function branchName({ transition = null, upstreamPr, paths = [] }) {
  if (transition !== null && typeof transition.name === "string" && typeof transition.to === "string") {
    return `deps/${slugPart(transition.name)}-${slugPart(transition.to)}`
  }
  const number = Number(upstreamPr)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`invalid --pr '${upstreamPr}'`)
  return `chore/${allManifests(paths) ? "manifests" : "update"}-${number.toString(36)}`
}

function listPaths(paths, limit = 6) {
  const shown = paths.slice(0, limit)
  const more = paths.length - shown.length
  return shown.map((path) => `- ${path}`).join("\n") + (more > 0 ? `\n- and ${more} more` : "")
}

const MANIFEST_FILE_RE =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt|go\.mod|go\.sum|Gemfile|Gemfile\.lock|\.nvmrc|\.tool-versions)$/

/**
 * Whether every path is a dependency manifest or lockfile, so "dependency
 * manifests" is an honest name for the set.
 * @param {string[]} paths
 * @returns {boolean}
 */
export function allManifests(paths) {
  return paths.length > 0 && paths.every((path) => MANIFEST_FILE_RE.test(path))
}

export function contextCommitMessage(paths, { firstPaths = [], transition = null, instrument = false } = {}) {
  if (firstPaths.length > 0 && transition !== null) {
    return `chore(deps): bump ${transition.name} from ${transition.from} to ${transition.to}\n\n${listPaths(firstPaths)}`
  }
  if (paths.length > 0 && paths.every((path) => path.startsWith(".github/"))) {
    return [instrument ? "ci: update workflow configuration" : "ci: record dependency installs on pull requests", "", listPaths(paths)].join("\n")
  }
  const subject = allManifests(paths) ? "chore(deps): sync dependency manifests before update" : "chore: sync touched files before update"
  return [subject, "", listPaths(paths)].join("\n")
}

/**
 * The `.github/` paths a plan writes into commit 1 (recording workflow,
 * Dependabot configuration, a carried recorder). When the touched paths already
 * match the change's base, these are all commit 1 stages and its message
 * follows them.
 * @param {{steps?: Array<{id: string, writeFileContent?: {file: string}, args?: string[]}>, work?: string}} plan
 * @returns {string[]}
 */
export function workflowOnlyFirstPaths(plan) {
  const steps = Array.isArray(plan.steps) ? plan.steps : []
  const out = []
  for (const step of steps) {
    if (step.id === "first-record" || step.id === "first-dependabot") {
      const file = step.writeFileContent?.file
      if (typeof file === "string" && typeof plan.work === "string") out.push(relative(plan.work, file))
    }
    if (step.id === "first-fork-record" && Array.isArray(step.args)) {
      const at = step.args.indexOf("--")
      if (at >= 0) out.push(...step.args.slice(at + 1))
    }
  }
  return out
}

/**
 * Paths commit 1 staged that a `context` plan did not expect: anything but the
 * paths the plan itself adds (`contextPaths`) and its `--first` paths. Empty for
 * every other plan.
 * @param {{firstStages?: string, firstPaths?: string[], contextPaths?: string[]}} plan
 * @param {string[]} staged
 * @returns {string[]}
 */
export function firstStagesMismatch(plan, staged) {
  if (plan.firstStages !== "context") return []
  const allowed = new Set([...(Array.isArray(plan.firstPaths) ? plan.firstPaths : []), ...(Array.isArray(plan.contextPaths) ? plan.contextPaths : [])])
  return staged.filter((path) => !allowed.has(path))
}

/**
 * The directories Dependabot should watch, from the dependency manifests a
 * change touches: `/` for a root manifest, `/frontend` for `frontend/package.json`.
 * `/` alone when the change touches no manifest.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function manifestDirectories(paths) {
  const dirs = paths.filter((path) => MANIFEST_FILE_RE.test(path)).map((path) => {
    const dir = dirname(path)
    return dir === "." ? "/" : `/${dir}`
  })
  const unique = [...new Set(dirs)].sort()
  return unique.length > 0 ? unique : ["/"]
}

/**
 * Commit 1's message once the staged paths are known: the planned message names the
 * touched paths, but when the fork already sits at the base only the recording
 * workflow is staged and the message has to say so.
 * @param {string[]} staged paths `git diff --cached --name-only` reported
 * @param {string} planned the message the plan carried
 * @returns {string}
 */
export function resolvedFirstMessage(staged, planned) {
  if (staged.length > 0 && staged.every((path) => path.startsWith(".github/"))) return contextCommitMessage(staged)
  return planned
}

export function changeCommitMessage(upstreamTitle, upstream, { paths = [], firstPaths = [], transition = null } = {}) {
  let subject = stripUpstreamLeak(upstreamTitle, upstream).split("\n")[0]
    .replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s*\(\s*\)\s*$/, "").replace(/[\s:·-]+$/, "").trim()
  if (firstPaths.length > 0 && transition !== null) {
    subject = `chore(deps): allow ${transition.name} install scripts`
  }
  if (subject === "") subject = "chore(deps): update dependency manifests"
  if (subject.length > 72) subject = `${subject.slice(0, 69).replace(/\s+\S*$/, "")}…`
  const changed = firstPaths.length > 0 ? paths.filter((path) => !firstPaths.includes(path)) : paths
  return `${subject}\n\n${listPaths(changed)}`
}

export function prBodyText({ transition = null, firstPaths = [], paths = [], complete = false } = {}) {
  if (transition !== null && firstPaths.length > 0) {
    return `Bumps \`${transition.name}\` from ${transition.from} to ${transition.to}. It runs an install script, so the second commit adds it to the build-script allowlist.\n`
  }
  if (transition !== null) {
    return `Bumps \`${transition.name}\` from ${transition.from} to ${transition.to}.\n`
  }
  const what = allManifests(paths) ? "dependency manifest" : "file"
  const count = paths.length === 1 ? `One ${what}` : `${paths.length} ${what}s`
  return `Two commits: the first prepares the branch, the second is the change itself.\n\n${count}:\n\n${listPaths(paths, complete ? Infinity : 6)}\n`
}

/**
 * Publishing steps shared by both planners. Commit 1 is pushed alone and the
 * pull request opened on it; commit 2 is pushed only after commit 1 has a
 * record, so the App compares the change against a recorded previous commit.
 * With both commits in one push only the head is recorded and no comparison
 * exists. Records for the pushed commit are waited on by `executePlan`.
 *
 * A rerun rebuilds the two commits locally with new ids, so the fork branch is
 * matched by tree, and when the default branch has moved since the first run,
 * by patch id against the fork commit's parent: commit 1 published → wait for
 * its record, then push commit 2 on top of the published commit 1; both
 * published → nothing to push; any other head on the branch → refuse.
 * @param {{fork: string, branch: string, defaultBranch: string, bodyFile: string, body: string, title: string, draft: boolean, work: string, label?: string|null}} input
 * @returns {Record<string, unknown>[]}
 */
export function publishSteps({ fork, branch, defaultBranch, bodyFile, body, title, draft, work, label = null }) {
  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  return [
    { id: "find-pr", kind: "read", capture: "existingPr", note: "reuse an existing fork pull request on this branch", cmd: "gh", args: ["pr", "list", "--repo", fork, "--head", branch, "--state", "all", "--json", "number,state,isDraft,url"] },
    { id: "reconcile", kind: "reconcile", branch, baseRef: defaultBranch, work, note: "match the fork branch against commit 1 and commit 2 by tree, then by patch; a closed pull request's branch is not reused" },
    { id: "push-first", kind: "write-remote", target: fork, skipIf: "existingPr", note: `push commit 1 alone to ${branch} on the fork`, ...g("push", "--set-upstream", "origin", `HEAD~1:refs/heads/${branch}`) },
    { id: "pr-body", kind: "write-local", writeFileContent: { file: bodyFile, content: body }, note: "write the pull request body" },
    {
      id: "pr-create", kind: "write-remote", target: fork, skipIf: "existingPr", capture: "createdPrUrl",
      note: `open a ${draft ? "draft " : ""}pull request on the fork (base ${defaultBranch})`,
      cmd: "gh", args: ["pr", "create", "--repo", fork, ...(draft ? ["--draft"] : []), "--base", defaultBranch, "--head", branch, "--title", title, "--body-file", bodyFile],
    },
    ...(typeof label === "string"
      ? [{ id: "pr-label", kind: "write-remote", target: fork, note: `label the fork pull request ${label} (the fork's own label; it never reaches the upstream)`, cmd: "gh", args: ["pr", "edit", branch, "--repo", fork, "--add-label", label] }]
      : []),
    { id: "wait-first-record", kind: "wait-record", target: fork, skipIf: "changePublished", sha: "firstSha", note: "wait until commit 1 is recorded; the comparison on commit 2 needs it" },
    { id: "push-change", kind: "write-remote", target: fork, skipIf: "changePublished", note: `push commit 2 to ${branch} on the fork`, ...g("push", "origin", `HEAD:refs/heads/${branch}`) },
  ]
}

/**
 * Which of the two local commits the fork branch already carries, by tree.
 * @param {{remoteTree: string|null, firstTree: string, headTree: string}} input
 * @returns {"none"|"first"|"both"|"mismatch"}
 */
export function publicationState({ remoteTree, firstTree, headTree }) {
  if (typeof remoteTree !== "string" || remoteTree === "") return "none"
  if (remoteTree === headTree) return "both"
  if (remoteTree === firstTree) return "first"
  return "mismatch"
}

export function workDirFor(slug) {
  return join(OUT_DIR, slug, "work")
}

/**
 * @param {object} input
 * @param {string} input.slug
 * @param {string} input.upstream            owner/repo, read-only
 * @param {string} input.fork                owner/repo, the only write target
 * @param {string} input.defaultBranch
 * @param {number|string} input.upstreamPr
 * @param {string} [input.upstreamTitle]
 * @param {string} input.baseSha
 * @param {string} input.headSha
 * @param {{path:string,status:string,previous:string|null}[]} input.changes
 * @param {string[]} [input.firstPaths]      touched paths whose head state lands in commit 1
 * @param {boolean} [input.workExists]
 * @param {string|null} [input.work]           existing fork checkout to reuse (default: out/<slug>/work)
 * @param {"fork-workflow"|"inject"|"instrument"} [input.record]
 * @param {string|null} [input.ecosystem]
 * @param {string|null} [input.branch]
 * @param {{first?:string,change?:string,title?:string,body?:string}} [input.messages]
 * @param {boolean} [input.draft]
 * @param {boolean} [input.syncFork] fast-forward the fork's default branch to the change's base first
 * @param {string|null} [input.baseBranch] open the pull request against a fork branch set to the change's base instead of the default branch
 * @param {string[]} [input.recordWorkflows] the fork's recording workflow paths; exactly one is carried into commit 1 when the base branch lacks it
 * @param {string[]} [input.baseRecords] recording workflows the change's base already runs; with --base-branch nothing is carried then
 * @param {boolean} [input.allowBehind] go ahead when the fork branch is behind the change's base (a warning instead of a stop)
 * @param {string|null} [input.label] a label of the fork to put on the pull request after it opens
 * @param {boolean} [input.dependabotConfigured] whether the fork already has .github/dependabot.yml; when false and recording is injected, commit 1 adds one
 * @param {{path:string, content:string, changes:string[], job:string}|null} [input.instrument] workflow content prepared by instrumentWorkflow
 * @param {string[]|null} [input.recordPaths] the recording workflow's `on.pull_request.paths` filter; null when it runs on every pull request
 */
export function planReplay(input) {
  const {
    slug, upstream, fork, defaultBranch, upstreamPr, upstreamTitle = "", baseSha, headSha,
    changes = [], firstPaths = [], workExists = false, work: requestedWork = null, record = "fork-workflow", ecosystem = null,
    branch: requestedBranch = null, messages: overrides = {}, draft = true, syncFork = false, baseBranch = null, recordWorkflows = [],
    recordFilters = null, baseRecords = [], allowBehind = false, label = null, dependabotConfigured = true, forkHoldsBase = null, instrument = null,
  } = input
  if (baseBranch !== null && (typeof baseBranch !== "string" || baseBranch === "" || baseBranch === defaultBranch)) {
    throw new Error(`--base-branch must name a fork branch other than ${defaultBranch}`)
  }
  if (baseBranch !== null && syncFork) throw new Error("--base-branch and --sync-fork are alternatives; pass one")
  const baseRecordsItself = baseBranch !== null && record === "fork-workflow" && baseRecords.length > 0
  const carried = baseRecordsItself ? [] : recordWorkflows
  if (baseBranch !== null && record === "fork-workflow" && carried.length === 0 && !baseRecordsItself) {
    throw new Error(`--base-branch starts from the change's base, which has no recording workflow of the fork; none was found on ${defaultBranch}, so pass --record inject`)
  }
  if (baseBranch !== null && record === "fork-workflow" && carried.length > 1) {
    throw new Error(`${defaultBranch} carries ${recordWorkflows.length} recording workflows; commit 1 carries one, so pass --record-workflow <path> with one of: ${recordWorkflows.join(", ")}`)
  }
  for (const path of carried) assertOutbound(path, upstream)
  if (label !== null && (typeof label !== "string" || label.trim() === "")) throw new Error("--label needs a label name")
  const baseRef = baseBranch ?? defaultBranch
  if (typeof fork !== "string" || fork === "") throw new Error(`target '${slug}' has no fork configured`)
  if (fork.toLowerCase() === String(upstream).toLowerCase()) throw new Error("fork must not be the upstream repository")
  if (typeof baseSha !== "string" || typeof headSha !== "string" || baseSha === "" || headSha === "") {
    throw new Error("upstream base/head sha unresolved; refusing to plan")
  }
  if (changes.length === 0) throw new Error("upstream pull request touched no files; nothing to replay")
  for (const path of firstPaths) {
    if (!changes.some((change) => change.path === path)) throw new Error(`--first path ${path} is not touched by the upstream change`)
  }
  if (record === "inject" && (typeof ecosystem !== "string" || !(ecosystem in INSTALL_COMMANDS))) {
    throw new Error(`no recording workflow on the fork and no install command for ecosystem ${String(ecosystem)}; pass --record fork-workflow after adding one`)
  }
  if (record === "instrument" && (instrument === null || typeof instrument.path !== "string" || typeof instrument.content !== "string" || !Array.isArray(instrument.changes) || typeof instrument.job !== "string")) {
    throw new Error("instrument mode needs workflow content and job")
  }

  const paths = changes.map((change) => change.path)
  if (record === "instrument" && instrument !== null && paths.some((path) => path === instrument.path)) {
    throw new Error(`the change edits ${instrument.path}; pick another workflow/job or another change`)
  }
  const effectiveRecordFilters = record === "fork-workflow" || record === "instrument"
    ? recordFilters ?? (record === "instrument" && instrument !== null
      ? (() => {
          const filter = pullRequestPathFilter(instrument.content)
          return filter === null ? null : { [instrument.path]: filter }
        })()
      : null)
    : null
  const changePaths = paths.filter((path) => !firstPaths.includes(path))
  if (effectiveRecordFilters !== null && !recordsAnyPath(effectiveRecordFilters, changePaths)) {
    const filters = [...new Set(Object.values(effectiveRecordFilters).flat())]
    throw new Error(`the fork's recording workflows run only when ${filters.join(", ")} change; commit 2 touches none of them, so it would record nothing. Pick a change that touches them or pass --record inject`)
  }
  const transition = parseVersionTransition(upstreamTitle)
  const branch = requestedBranch ?? branchName({ transition, upstreamPr, paths })
  const work = requestedWork ?? workDirFor(slug)
  const bodyFile = join(OUT_DIR, slug, `replay-${upstreamPr}-body.md`)
  const forkUrl = `https://github.com/${fork}.git`
  const upstreamUrl = `https://github.com/${upstream}.git`

  const contextPaths = [
    ...(record === "inject" ? [RECORD_WORKFLOW_PATH] : []),
    ...(record === "instrument" && instrument !== null ? [instrument.path] : []),
    ...((record === "inject" || record === "instrument") && dependabotConfigured === false && typeof ecosystem === "string" && ecosystem in DEPENDABOT_ECOSYSTEMS ? [DEPENDABOT_CONFIG_PATH] : []),
    ...(carried.length > 0 && baseBranch !== null && record === "fork-workflow" ? carried : []),
  ]
  const holdsBase = syncFork || baseBranch !== null ? true : forkHoldsBase
  if (holdsBase === true && firstPaths.length === 0 && contextPaths.length === 0) {
    throw new Error(
      `${fork}@${baseRef} already holds the touched paths as the change found them and commit 1 has nothing else to stage; pass --first <path> to carry one of the change's paths into commit 1`,
    )
  }
  const firstStages = holdsBase === true ? "context" : holdsBase === false ? "touched" : "unknown"
  const messages = {
    first: overrides.first ?? (firstStages === "context" && firstPaths.length === 0 ? contextCommitMessage(contextPaths, { instrument: record === "instrument" }) : contextCommitMessage(paths, { firstPaths, transition })),
    change: overrides.change ?? changeCommitMessage(upstreamTitle, upstream, { paths, firstPaths, transition }),
  }
  const title = overrides.title ?? messages.change.split("\n")[0]
  const setupPaths = contextPaths.filter((path) => !paths.includes(path))
  const setupBody = setupPaths.length === 0 ? "" : `\nCommit 1 also prepares ${setupPaths.length} additional ${setupPaths.length === 1 ? "file" : "files"}:\n\n${setupPaths.map((path) => `- ${path}`).join("\n")}\n`
  const body = overrides.body ?? prBodyText({ transition, firstPaths, paths, complete: true }) + setupBody
  for (const text of [branch, messages.first, messages.change, title, body]) assertOutbound(text, upstream)
  assertForkTarget(forkUrl, fork)

  const atBase = changes.filter((change) => change.status !== "added").map((change) => change.previous ?? change.path)
  const atHead = changes.filter((change) => change.status !== "removed").map((change) => change.path)
  const firstAtHead = atHead.filter((path) => firstPaths.includes(path))
  const firstAtBase = atBase.filter((path) => !firstPaths.includes(path))
  const removedAtHead = changes.filter((change) => change.status === "removed" || change.previous !== null).map((change) => change.previous ?? change.path)
  const firstPresent = [...firstAtBase, ...firstAtHead]

  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  const steps = [
    workExists
      ? { id: "fetch-fork", kind: "write-local", note: "reuse the fork checkout", ...g("fetch", "--prune", "origin") }
      : { id: "clone-fork", kind: "write-local", note: "clone the fork (never the upstream)", cmd: "git", args: ["clone", forkUrl, work] },
    { id: "remote-upstream", kind: "write-local", allowFail: true, note: "add a read-only upstream remote", ...g("remote", "add", "upstream", upstreamUrl) },
    { id: "remote-upstream-nopush", kind: "write-local", note: "disable pushing to upstream", ...g("remote", "set-url", "--push", "upstream", "DISABLED-no-push") },
    { id: "fetch-upstream", kind: "read", note: "fetch the upstream base commit and the pull request head ref", ...g("fetch", "--no-tags", "upstream", baseSha, `refs/pull/${upstreamPr}/head`) },
    { id: "verify-head", kind: "read", note: "guard: the recorded head sha must be the fetched pull request head", ...g("cat-file", "-e", `${headSha}^{commit}`) },
    { id: "verify-origin", kind: "read", capture: "originUrl", note: "guard: origin must be the fork", ...g("remote", "get-url", "origin") },
    { id: "verify-clean", kind: "read", capture: "worktreeStatus", note: "guard: the checkout must have no uncommitted changes", ...g("status", "--porcelain", "--untracked-files=no") },
    ...(syncFork
      ? [
          { id: "sync-fork", kind: "write-remote", target: fork, note: `fast-forward ${defaultBranch} on the fork to the change's base (git refuses anything but a fast-forward)`, ...g("push", "origin", `${baseSha}:refs/heads/${defaultBranch}`) },
          { id: "sync-fork-fetch", kind: "read", ...g("fetch", "--prune", "origin") },
        ]
      : []),
    ...(baseBranch !== null
      ? [
          { id: "base-branch", kind: "write-remote", target: fork, note: `set ${baseBranch} on the fork to the change's base (created, or fast-forwarded; git refuses anything else)`, ...g("push", "origin", `${baseSha}:refs/heads/${baseBranch}`) },
          { id: "base-branch-fetch", kind: "read", ...g("fetch", "--prune", "origin") },
        ]
      : []),
    { id: "base-distance", kind: "read", capture: "baseBehind", allowBehind, note: `guard: how far ${baseRef} on the fork is behind the change's base`, ...g("rev-list", "--count", baseSha, `^origin/${baseRef}`) },
    { id: "branch", kind: "write-local", note: `create ${branch} from ${baseRef}`, ...g("checkout", "-B", branch, `origin/${baseRef}`) },
    { id: "first-remove", kind: "write-local", note: "commit 1: drop paths the change removes or renames", ...g("rm", "-q", "--ignore-unmatch", "--", ...paths) },
    ...(firstAtBase.length > 0 ? [{ id: "first-base", kind: "write-local", note: "commit 1: touched paths as the change found them", ...g("checkout", baseSha, "--", ...firstAtBase) }] : []),
    ...(firstAtHead.length > 0 ? [{ id: "first-head", kind: "write-local", note: "commit 1: paths carried ahead of the change", ...g("checkout", headSha, "--", ...firstAtHead) }] : []),
    ...(record === "inject" ? [{ id: "first-record", kind: "write-local", writeFileContent: { file: join(work, RECORD_WORKFLOW_PATH), content: recordWorkflow(ecosystem) }, note: "commit 1: add the recording workflow; Dependabot pull requests on the fork run it too" }, { id: "first-record-add", kind: "write-local", ...g("add", "--", RECORD_WORKFLOW_PATH) }] : []),
    ...(record === "instrument" && instrument !== null ? [{ id: "first-instrument", kind: "write-local", writeFileContent: { file: join(work, instrument.path), content: instrument.content }, note: `commit 1: update ${instrument.path}` }, { id: "first-instrument-add", kind: "write-local", ...g("add", "--", instrument.path) }] : []),
    ...((record === "inject" || record === "instrument") && dependabotConfigured === false && typeof ecosystem === "string" && ecosystem in DEPENDABOT_ECOSYSTEMS
      ? [
          { id: "first-dependabot", kind: "write-local", writeFileContent: { file: join(work, DEPENDABOT_CONFIG_PATH), content: dependabotConfig(ecosystem, manifestDirectories(paths)) }, note: `commit 1: add ${DEPENDABOT_CONFIG_PATH} so the fork gets its own dependency pull requests, each recorded` },
          { id: "first-dependabot-add", kind: "write-local", ...g("add", "--", DEPENDABOT_CONFIG_PATH) },
        ]
      : []),
    ...(carried.length > 0 && baseBranch !== null && record === "fork-workflow"
      ? [
          { id: "first-fork-record", kind: "write-local", note: `commit 1: the fork's recording workflow as ${defaultBranch} has it`, ...g("checkout", `origin/${defaultBranch}`, "--", ...carried) },
          { id: "first-fork-record-add", kind: "write-local", ...g("add", "--", ...carried) },
        ]
      : []),
    ...(firstPresent.length > 0 ? [{ id: "first-add", kind: "write-local", note: "commit 1: stage the paths present after the reset", ...g("add", "-A", "--", ...firstPresent) }] : []),
    { id: "first-check", kind: "read", capture: "firstDiff", note: "guard: commit 1 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "first-commit", kind: "write-local", note: "commit 1", messageFrom: "firstDiff", ...g("commit", "-q", "-m", messages.first) },
    ...(removedAtHead.length > 0 ? [{ id: "change-remove", kind: "write-local", ...g("rm", "-q", "--ignore-unmatch", "--", ...removedAtHead) }] : []),
    { id: "change-head", kind: "write-local", note: "commit 2: the change itself", ...g("checkout", headSha, "--", ...atHead) },
    ...(atHead.length > 0 ? [{ id: "change-add", kind: "write-local", note: "commit 2: stage the paths present at the head", ...g("add", "-A", "--", ...atHead) }] : []),
    { id: "change-check", kind: "read", capture: "changeDiff", note: "guard: commit 2 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "change-commit", kind: "write-local", note: "commit 2", ...g("commit", "-q", "-m", messages.change) },
    { id: "verify-commits", kind: "read", capture: "commitCount", note: "guard: exactly two new commits", ...g("rev-list", "--count", `origin/${baseRef}..HEAD`) },
    { id: "first-sha", kind: "read", capture: "firstSha", ...g("rev-parse", "HEAD~1") },
    { id: "head-sha", kind: "read", capture: "forkHeadSha", ...g("rev-parse", "HEAD") },
    ...publishSteps({ fork, branch, defaultBranch: baseRef, bodyFile, body, title, draft, work, label }),
  ]

  return {
    slug, upstream, fork, upstreamPr: Number(upstreamPr), branch, defaultBranch, baseRef, baseBranch, recordWorkflows: carried, baseRecords: baseRecordsItself ? baseRecords : [],
    recordFilters: effectiveRecordFilters,
    baseSha, headSha, transition, scope: "pr-base-to-head", paths, firstPaths, contextPaths, record, ecosystem, work, bodyFile, messages, title, body, draft, syncFork, allowBehind, label,
    dependabotAdded: (record === "inject" || record === "instrument") && dependabotConfigured === false && typeof ecosystem === "string" && ecosystem in DEPENDABOT_ECOSYSTEMS,
    dependabotDirectories: (record === "inject" || record === "instrument") && dependabotConfigured === false && typeof ecosystem === "string" && ecosystem in DEPENDABOT_ECOSYSTEMS ? manifestDirectories(paths) : [],
    instrument, firstStages, steps,
  }
}

export function recordWorkflow(ecosystem) {
  const command = INSTALL_COMMANDS[ecosystem]
  if (typeof command !== "string") throw new Error(`no install command for ecosystem ${String(ecosystem)}`)
  return readFileSync(RECORD_TEMPLATE, "utf8")
    .replace("{{INSTALL_COMMAND}}", command)
    .replace(/(\s*)- uses: garnet-org\/action@[^\n]+/, `$1- uses: garnet-org/action@${GARNET_ACTION_PIN} # main 2026-09-04`)
}

/**
 * Plan a fast-forward-or-merge refresh of a fork's default branch.
 * @param {{upstream:string, fork:string, defaultBranch:string, work:string, workExists?:boolean}} input
 * @returns {Record<string, unknown>}
 */
export function planRefresh({ upstream, fork, defaultBranch, work, workExists = false }) {
  if (typeof upstream !== "string" || upstream === "" || typeof fork !== "string" || fork === "") throw new Error("refresh needs upstream and fork")
  if (fork.toLowerCase() === upstream.toLowerCase()) throw new Error("fork must not be the upstream repository")
  if (typeof defaultBranch !== "string" || defaultBranch === "") throw new Error("refresh needs the fork default branch")
  if (typeof work !== "string" || work === "") throw new Error("refresh needs a work directory")
  assertForkTarget(`https://github.com/${fork}.git`, fork)
  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  const upstreamUrl = `https://github.com/${upstream}.git`
  const steps = [
    workExists
      ? { id: "fetch-fork", kind: "write-local", note: "reuse the fork checkout", ...g("fetch", "--prune", "origin") }
      : { id: "clone-fork", kind: "write-local", note: "clone the fork (never the upstream)", cmd: "git", args: ["clone", `https://github.com/${fork}.git`, work] },
    { id: "verify-origin", kind: "read", capture: "originUrl", note: "guard: origin must be the fork", ...g("remote", "get-url", "origin") },
    { id: "remote-upstream", kind: "write-local", allowFail: true, note: "add a read-only upstream remote", ...g("remote", "add", "upstream", upstreamUrl) },
    { id: "remote-upstream-url", kind: "write-local", note: "set the read-only upstream URL", ...g("remote", "set-url", "upstream", upstreamUrl) },
    { id: "verify-upstream-url", kind: "read", capture: "upstreamUrl", note: "guard: upstream must be the configured repository", ...g("remote", "get-url", "upstream") },
    { id: "remote-upstream-nopush", kind: "write-local", note: "disable pushing to upstream", ...g("remote", "set-url", "--push", "upstream", "DISABLED-no-push") },
    { id: "fetch-upstream", kind: "read", note: "fetch the upstream default branch", ...g("fetch", "--no-tags", "upstream", `refs/heads/${defaultBranch}`) },
    { id: "refresh-before", kind: "read", capture: "refreshBefore", note: "count upstream commits missing from the fork and fork-only commits", ...g("rev-list", "--left-right", "--count", `upstream/${defaultBranch}...origin/${defaultBranch}`) },
    ...(workExists ? [{ id: "verify-worktree", kind: "read", capture: "worktreeStatus", note: "guard: reused checkout must be clean", ...g("status", "--porcelain") }] : []),
    { id: "refresh-branch", kind: "write-local", note: `checkout ${defaultBranch} from origin`, ...g("checkout", "-B", defaultBranch, `origin/${defaultBranch}`) },
    { id: "refresh-merge", kind: "write-local", onError: "refresh-merge", note: `merge upstream/${defaultBranch}`, ...g("merge", "--no-edit", "-m", `Merge upstream ${defaultBranch}`, `upstream/${defaultBranch}`) },
    { id: "refresh-push", kind: "write-remote", target: fork, note: `push refreshed ${defaultBranch} to the fork`, ...g("push", "origin", defaultBranch) },
    { id: "refresh-after", kind: "read", capture: "refreshAfter", note: "confirm the refreshed branch distance", ...g("rev-list", "--left-right", "--count", `upstream/${defaultBranch}...origin/${defaultBranch}`) },
  ]
  return { mode: "refresh", upstream, upstreamUrl, fork, defaultBranch, work, workExists, steps }
}

/**
 * @param {{mode:string, upstream:string, fork:string, defaultBranch:string, work:string, steps:Array<Record<string, unknown>>}} plan
 * @returns {string}
 */
export function renderRefreshPlan(plan) {
  const lines = [
    `refresh plan · ${plan.fork} · upstream ${plan.upstream}`,
    `fork (only write target): ${plan.fork}`,
    `branch: ${plan.defaultBranch}`,
    "",
    "commands",
  ]
  for (const step of plan.steps) {
    if (step.cmd) lines.push(`  ${step.cmd} ${step.args.join(" ")}${step.note ? `   # ${step.note}` : ""}`)
  }
  lines.push("dry run: nothing was executed.")
  return `${lines.join("\n")}\n`
}

function workflowJobRanges(body) {
  const lines = String(body ?? "").split("\n")
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsAt < 0) return { lines, jobsAt, jobIndent: -1, ranges: new Map() }
  let jobIndent = -1
  const starts = []
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const indent = line.search(/\S/)
    if (indent === 0) break
    if (jobIndent < 0) jobIndent = indent
    const match = /^\s+([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (indent === jobIndent && match !== null) starts.push({ name: match[1], start: i })
  }
  const ranges = new Map()
  for (let i = 0; i < starts.length; i += 1) {
    ranges.set(starts[i].name, { start: starts[i].start, end: i + 1 < starts.length ? starts[i + 1].start : (() => {
      for (let j = starts[i].start + 1; j < lines.length; j += 1) {
        const line = lines[j]
        if (line.trim() === "" || line.trim().startsWith("#")) continue
        if (line.search(/\S/) <= jobIndent) return j
      }
      return lines.length
    })() })
  }
  return { lines, jobsAt, jobIndent, ranges }
}

function jobPropertyIndent(lines, range) {
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (lines[i].trim() === "" || lines[i].trim().startsWith("#")) continue
    return lines[i].search(/\S/)
  }
  return range.start >= 0 ? lines[range.start].search(/\S/) + 2 : 2
}

function hasPullRequestTrigger(body) {
  return /^\s+pull_request\s*:/m.test(body) || /^\s*on:\s*\[[^\]]*\bpull_request\b/m.test(body)
    || /^\s*on:\s*pull_request\s*$/m.test(body) || /^\s+-\s*pull_request\s*$/m.test(body)
}

function checkAddedWorkflowLine(line) {
  assertOutbound(line, "upstream/repository")
  return line
}

function removeDroppedNeeds(lines, ranges, dropped) {
  const consumers = new Map([...dropped].map((name) => [name, []]))
  for (const [job, range] of [...ranges.entries()].sort((left, right) => right[1].start - left[1].start)) {
    const out = []
    for (let i = range.start; i < range.end; i += 1) {
      const line = lines[i]
      const inline = /^(\s+)needs:\s*\[(.*?)\]\s*(?:#.*)?$/.exec(line)
      if (inline !== null) {
        const names = inline[2].split(",").map((name) => name.trim().replace(/^["']|["']$/g, "")).filter((name) => name !== "")
        const kept = names.filter((name) => !dropped.has(name))
        for (const name of names) if (dropped.has(name)) consumers.get(name).push(job)
        if (kept.length === 0) continue
        out.push(`${inline[1]}needs: [${kept.join(", ")}]`)
        continue
      }
      const scalar = /^(\s+)needs:\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*(?:#.*)?$/.exec(line)
      if (scalar !== null) {
        const name = scalar[2] ?? scalar[3] ?? scalar[4]
        if (dropped.has(name)) {
          consumers.get(name).push(job)
          continue
        }
        out.push(line)
        continue
      }
      const block = /^(\s+)needs:\s*$/.exec(line)
      if (block !== null) {
        const items = []
        let j = i + 1
        for (; j < range.end && lines[j].search(/\S/) > block[1].length; j += 1) {
          const item = /^(\s+)-\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*(?:#.*)?$/.exec(lines[j])
          if (item === null) {
            items.push(lines[j])
            continue
          }
          const name = item[2] ?? item[3] ?? item[4]
          if (dropped.has(name)) consumers.get(name).push(job)
          else items.push(lines[j])
        }
        if (items.some((lineItem) => /^\s+-\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*(?:#.*)?$/.test(lineItem))) {
          out.push(line, ...items)
        }
        i = j - 1
        continue
      }
      out.push(line)
    }
    lines.splice(range.start, range.end - range.start, ...out)
  }
  return consumers
}

/**
 * Rewrite one workflow so `job` runs under the Garnet sensor.
 * @param {string} body workflow file contents
 * @param {{job: string, runsOn?: string|null, dropJobs?: string[]}} options
 * @returns {{content: string, changes: string[]}} the rewritten file and one line per edit made
 */
export function instrumentWorkflow(body, { job, runsOn = null, dropJobs = [] }) {
  const source = String(body ?? "")
  if (!hasPullRequestTrigger(source)) throw new Error("workflow does not run on pull_request")
  const requestedDrops = [...new Set(dropJobs)]
  const initial = workflowJobRanges(source)
  if (!initial.ranges.has(job)) throw new Error(`workflow has no job ${job}`)
  for (const name of requestedDrops) if (!initial.ranges.has(name)) throw new Error(`workflow has no job ${name}`)
  const dropped = new Set(requestedDrops)
  const lines = [...initial.lines]
  const changes = []
  const ranges = workflowJobRanges(lines.join("\n")).ranges
  if (dropped.size > 0) {
    const removeRanges = [...ranges.entries()].filter(([name]) => dropped.has(name)).sort((a, b) => b[1].start - a[1].start)
    for (const [, range] of removeRanges) lines.splice(range.start, range.end - range.start)
    const keptRanges = workflowJobRanges(lines.join("\n")).ranges
    const consumers = removeDroppedNeeds(lines, keptRanges, dropped)
    const changedConsumers = [...new Set(requestedDrops.flatMap((name) => consumers.get(name) ?? []))]
    for (const name of requestedDrops) {
      const suffix = changedConsumers.length > 0 ? ` (removed from needs of: ${changedConsumers.join(", ")})` : ""
      changes.push(`dropped job ${name}${suffix}`)
    }
  }
  const current = workflowJobRanges(lines.join("\n"))
  if (!current.ranges.has(job)) throw new Error(`workflow has no job ${job}`)
  const range = current.ranges.get(job)
  const keyIndent = jobPropertyIndent(lines, range)
  const bodyLines = lines.slice(range.start + 1, range.end)
  if (bodyLines.some((line) => /garnet-org\/action/.test(line))) throw new Error(`job ${job} already runs garnet-org/action`)
  const stepsProperty = bodyLines.findIndex((line) => new RegExp(`^\\s{${keyIndent}}steps:\\s*$`).test(line))
  if (stepsProperty < 0) throw new Error(`job ${job} has no steps (reusable workflow caller); instrument the called workflow instead`)
  const runIndex = bodyLines.findIndex((line) => new RegExp(`^\\s{${keyIndent}}runs-on:\\s*`).test(line))
  let runnerExpression = false
  if (runIndex >= 0) runnerExpression = bodyLines[runIndex].includes("${{")
  if (runsOn !== null) {
    if (typeof runsOn !== "string" || runsOn.trim() === "") throw new Error("--runs-on needs a label")
    if (runIndex < 0) throw new Error(`job ${job} has no runs-on`)
    const match = /^(\s*runs-on:\s*)(.*)$/.exec(bodyLines[runIndex])
    const previous = match?.[2] ?? ""
    bodyLines[runIndex] = `${match[1]}${runsOn}`
    changes.push(`${job}: runs-on ${previous} → ${runsOn}`)
    runnerExpression = false
  }
  const permissionsIndex = bodyLines.findIndex((line) => new RegExp(`^\\s{${keyIndent}}permissions:`).test(line))
  const permissionLines = [`${" ".repeat(keyIndent + 2)}contents: read`, `${" ".repeat(keyIndent + 2)}id-token: write`].map(checkAddedWorkflowLine)
  if (permissionsIndex < 0) {
    const insertion = runIndex >= 0 ? runIndex + 1 : 0
    bodyLines.splice(insertion, 0, `${" ".repeat(keyIndent)}permissions:`, ...permissionLines)
  } else {
    const permissionsIndent = bodyLines[permissionsIndex].search(/\S/)
    const value = bodyLines[permissionsIndex].slice(bodyLines[permissionsIndex].indexOf(":") + 1).trim()
    if (value === "{}") {
      bodyLines.splice(permissionsIndex, 1, `${" ".repeat(permissionsIndent)}permissions:`, ...permissionLines)
    } else if (value.startsWith("{") && value.endsWith("}")) {
      const entries = value.slice(1, -1).split(",").map((entry) => {
        const match = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(entry)
        return match === null ? null : [match[1], match[2]]
      }).filter((entry) => entry !== null)
      const permissions = new Map(entries)
      permissions.set("contents", permissions.get("contents") ?? "read")
      permissions.set("id-token", "write")
      bodyLines.splice(
        permissionsIndex,
        1,
        `${" ".repeat(permissionsIndent)}permissions:`,
        ...[...permissions].map(([name, permission]) => `${" ".repeat(permissionsIndent + 2)}${name}: ${permission}`).map(checkAddedWorkflowLine),
      )
    } else if (value !== "") {
      bodyLines.splice(permissionsIndex, 1, `${" ".repeat(permissionsIndent)}permissions:`, ...permissionLines)
    } else {
      let end = permissionsIndex + 1
      while (end < bodyLines.length && (bodyLines[end].trim() === "" || bodyLines[end].search(/\S/) > permissionsIndent)) end += 1
      const existing = new Map()
      for (let i = permissionsIndex + 1; i < end; i += 1) {
        const permission = /^(\s+)([A-Za-z0-9_-]+):\s*(\S+)?/.exec(bodyLines[i])
        if (permission !== null) existing.set(permission[2], { index: i, value: permission[3] ?? "" })
      }
      const additions = []
      if (!existing.has("contents")) additions.push(permissionLines[0])
      if (!existing.has("id-token")) additions.push(permissionLines[1])
      if (existing.get("id-token")?.value !== undefined && existing.get("id-token")?.value !== "write") {
        const index = existing.get("id-token").index
        bodyLines[index] = `${bodyLines[index].split("id-token:")[0]}id-token: write`
      }
      if (additions.length > 0) bodyLines.splice(end, 0, ...additions)
    }
  }
  changes.push(`${job}: permissions contents: read, id-token: write`)
  const firstStepOffset = stepsProperty >= 0
    ? bodyLines.slice(stepsProperty + 1).findIndex((line) => /^\s+-\s+/.test(line))
    : -1
  const stepIndent = firstStepOffset >= 0 ? bodyLines[stepsProperty + 1 + firstStepOffset].search(/\S/) : keyIndent + 2
  const stepStart = firstStepOffset >= 0 ? stepsProperty + 1 + firstStepOffset : -1
  let checkoutEnd = -1
  if (stepStart >= 0) {
    const stepStarts = []
    for (let i = stepStart; i < bodyLines.length; i += 1) {
      if (i === stepStart || (bodyLines[i].search(/\S/) === stepIndent && /^\s+-\s+/.test(bodyLines[i]))) stepStarts.push(i)
    }
    for (let i = 0; i < stepStarts.length; i += 1) {
      const start = stepStarts[i]
      const end = stepStarts[i + 1] ?? bodyLines.length
      if (bodyLines.slice(start, end).some((line) => /^\s+(?:-\s+)?uses:\s*actions\/checkout(?:@|\s|$)/.test(line))) {
        checkoutEnd = end
      }
    }
  }
  const actionLines = [
    `${" ".repeat(stepIndent)}- uses: garnet-org/action@${GARNET_ACTION_PIN} # main 2026-09-04`,
    ...(runnerExpression ? [`${" ".repeat(stepIndent + 2)}if: runner.os == 'Linux'`] : []),
  ].map(checkAddedWorkflowLine)
  const insertion = checkoutEnd >= 0 ? checkoutEnd : stepStart >= 0 ? stepStart : stepsProperty >= 0 ? stepsProperty + 1 : bodyLines.length
  bodyLines.splice(insertion, 0, ...actionLines)
  changes.push(`${job}: garnet-org/action step after checkout`)
  lines.splice(range.start + 1, range.end - range.start - 1, ...bodyLines)
  for (const name of dropped) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (lines.some((line) => new RegExp(`needs:.*\\b${escaped}\\b`).test(line))) {
      throw new Error(`cannot rewrite needs referencing dropped job ${name}`)
    }
  }
  return { content: lines.join("\n"), changes }
}

/**
 * A weekly Dependabot configuration for the ecosystem, plus GitHub Actions
 * pins. Each Dependabot pull request on the fork then runs the recording
 * workflow like any other pull request.
 * @param {string} ecosystem one of INSTALL_COMMANDS' keys
 * @param {string[]} [directories] manifest directories to watch, `/` by default
 * @returns {string}
 */
export function dependabotConfig(ecosystem, directories = ["/"]) {
  const packageEcosystem = DEPENDABOT_ECOSYSTEMS[ecosystem]
  if (typeof packageEcosystem !== "string") throw new Error(`no Dependabot ecosystem for ${String(ecosystem)}`)
  if (!Array.isArray(directories) || directories.length === 0 || directories.some((dir) => typeof dir !== "string" || !dir.startsWith("/"))) {
    throw new Error("Dependabot directories must be absolute repository paths")
  }
  return [
    "version: 2",
    "updates:",
    ...directories.flatMap((directory) => [
      `  - package-ecosystem: ${packageEcosystem}`,
      `    directory: ${directory}`,
      "    schedule:",
      "      interval: weekly",
      "    open-pull-requests-limit: 5",
    ]),
    "  - package-ecosystem: github-actions",
    "    directory: /",
    "    schedule:",
    "      interval: weekly",
    "",
  ].join("\n")
}

export function renderPlan(plan) {
  const quote = (arg) => (arg.includes("\n") ? "<message below>" : /[\s"']/.test(arg) ? JSON.stringify(arg) : arg)
  const lines = []
  if (plan.mode === "transition") {
    lines.push(`transition plan · ${plan.slug} · ${plan.transition.name} ${plan.transition.from} → ${plan.transition.to} (authored on the fork, no upstream change)`)
  } else {
    lines.push(`replay plan · ${plan.slug} · upstream change ${plan.upstreamPr} (number stays local)`)
  }
  lines.push(`fork (only write target): ${plan.fork}`)
  lines.push(`branch: ${plan.branch} · base: ${plan.baseRef ?? plan.defaultBranch}${typeof plan.baseBranch === "string" ? " (set to the change's base)" : ""} · scope: ${plan.scope}`)
  if (typeof plan.baseSha === "string" && typeof plan.headSha === "string") lines.push(`compares: ${plan.baseSha.slice(0, 7)} → ${plan.headSha.slice(0, 7)}`)
  else lines.push("compares: commit 1 → commit 2 (shas known after the commits exist)")
  lines.push(`record: ${plan.record === "prepared-workflow" ? "prepared recording workflow in commit 1, identical on commit 2" : plan.record === "inject" ? `recording workflow added in commit 1 (${plan.ecosystem}); Dependabot pull requests on the fork run it too` : plan.record === "instrument" && plan.instrument !== null ? `${plan.instrument.path} job ${plan.instrument.job} runs under the Garnet sensor from commit 1 (${plan.instrument.changes.join("; ")})` : Array.isArray(plan.baseRecords) && plan.baseRecords.length > 0 ? `the change's base already runs its own recording workflow (${plan.baseRecords.join(", ")})` : Array.isArray(plan.recordWorkflows) && plan.recordWorkflows.length > 0 && typeof plan.baseBranch === "string" ? `fork's recording workflow carried into commit 1 (${plan.recordWorkflows.join(", ")})` : describeRecorders(plan.recordFilters)}`)
  if (plan.dependabotAdded === true) lines.push(`dependabot: ${DEPENDABOT_CONFIG_PATH} added in commit 1 (${DEPENDABOT_ECOSYSTEMS[plan.ecosystem]}, weekly, ${plan.dependabotDirectories.join(", ")})`)
  if (typeof plan.label === "string") lines.push(`label: ${plan.label}`)
  lines.push(`paths (${plan.paths.length}): ${plan.paths.slice(0, 10).join(", ")}${plan.paths.length > 10 ? ", …" : ""}`)
  if (plan.firstPaths.length > 0) lines.push(`carried into commit 1: ${plan.firstPaths.join(", ")}`)
  if (plan.firstStages === "context") lines.push(`commit 1 stages: only what the plan adds (the touched paths on ${plan.baseRef ?? plan.defaultBranch} match the change's base)`)
  else if (plan.firstStages === "touched") lines.push(`commit 1 stages: the touched paths as the change found them (${plan.baseRef ?? plan.defaultBranch} on the fork differs on at least one)`)
  else if (plan.firstStages === "unknown") lines.push("commit 1 stages: decided at the checkout (the touched paths on the fork could not be compared ahead of time)")
  lines.push("")
  lines.push("commands")
  for (const step of plan.steps) {
    const cwd = typeof step.cwd === "string" ? `(cd ${step.cwd}) ` : ""
    if (step.kind === "prepared-paths" || step.kind === "prepared-resume") lines.push(`  check ${step.id}`)
    if (step.kind === "wait-record") lines.push(`  wait for the record of commit 1 on ${step.target}${step.note ? `   # ${step.note}` : ""}`)
    else if (step.kind === "reconcile") lines.push(`  if a pull request exists: compare origin/${step.branch} with HEAD~1 and HEAD by tree, then by patch${step.note ? `   # ${step.note}` : ""}`)
    else if (step.cmd) lines.push(`  ${cwd}${step.cmd} ${step.args.map(quote).join(" ")}${step.note ? `   # ${step.note}` : ""}`)
    else if (step.writeFileContent) lines.push(`  write ${step.writeFileContent.file}${step.note ? `   # ${step.note}` : ""}`)
    else if (step.editFile) lines.push(`  edit ${step.editFile.file}${step.note ? `   # ${step.note}` : ""}`)
    else if (step.assertFileIncludes) lines.push(`  check ${step.assertFileIncludes.file} includes ${JSON.stringify(step.assertFileIncludes.text)}${step.note ? `   # ${step.note}` : ""}`)
  }
  lines.push("")
  lines.push("commit 1")
  lines.push(...plan.messages.first.split("\n").map((line) => `  ${line}`.trimEnd()))
  const workflowPaths = workflowOnlyFirstPaths(plan)
  if (plan.firstStages === "unknown" && workflowPaths.length > 0 && !plan.messages.first.startsWith("ci: ")) {
    lines.push("  or, if the fork already holds the touched paths as the change found them and commit 1 stages only these:")
    lines.push(...contextCommitMessage(workflowPaths).split("\n").map((line) => `  ${line}`.trimEnd()))
  }
  lines.push("")
  lines.push("commit 2")
  lines.push(...plan.messages.change.split("\n").map((line) => `  ${line}`.trimEnd()))
  lines.push("")
  lines.push(`pull request${plan.draft ? " (draft)" : ""}`)
  lines.push(`  title: ${plan.title}`)
  lines.push(...plan.body.split("\n").map((line) => `  ${line}`.trimEnd()))
  lines.push("dry run: nothing was executed.")
  return `${lines.join("\n")}\n`
}

/** Fail closed: no head-bound record comment → pending; mismatch → undeterminable. */
export function reconcileState(comments, forkHeadSha) {
  if (!Array.isArray(comments) || comments.length === 0) return "pending"
  const comment = latestRuntimeReviewComment(comments)
  if (comment === null) return "pending"
  const body = String(comment.body ?? "")
  const marker = parseReplayMarker(body)
  const bound = /<!--\s*garnet:commit\s+([0-9a-f]{7,40})\s*-->/.exec(body)
  const commit = marker?.head ?? bound?.[1] ?? null
  if (commit === null || typeof forkHeadSha !== "string" || forkHeadSha === "") return "undeterminable"
  const left = commit.toLowerCase()
  const right = forkHeadSha.toLowerCase()
  return left.startsWith(right) || right.startsWith(left) ? "recorded" : "undeterminable"
}

export function parseForkPrNumber(url, fork) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)\s*$/.exec(String(url ?? "").trim())
  if (match === null) throw new Error(`unrecognized pull request url ${JSON.stringify(String(url))}`)
  assertForkTarget(match[1], fork)
  return Number(match[2])
}

/**
 * The `paths:` list under `on.pull_request` of a workflow file, or null when the
 * workflow runs on every pull request. Both YAML forms are read: the block list
 * (`paths:` followed by `- item` lines) and the flow list (`paths: [a, b]`).
 * @param {string} body
 * @returns {string[]|null}
 */
export function pullRequestPathFilter(body) {
  const lines = String(body ?? "").split("\n")
  const trigger = lines.findIndex((line) => /^\s+pull_request:\s*$/.test(line))
  if (trigger < 0) return null
  const triggerIndent = lines[trigger].search(/\S/)
  for (let i = trigger + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const indent = line.search(/\S/)
    if (indent <= triggerIndent) return null
    const flow = /^\s+paths:\s*\[(.*)\]\s*(?:#.*)?$/.exec(line)
    if (flow !== null) {
      const filters = flow[1].split(",").map((item) => item.trim().replace(/^["']|["']$/g, "").trim()).filter((item) => item !== "")
      return filters.length > 0 ? filters : null
    }
    if (!/^\s+paths:\s*$/.test(line)) continue
    const filters = []
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^(\s+)-\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/.exec(lines[j])
      if (item === null || item[1].length <= indent) break
      filters.push(item[2].trim())
    }
    return filters.length > 0 ? filters : null
  }
  return null
}

/**
 * The path filters commit 2 has to reach, one per selected recording workflow,
 * or null when one of them runs on every pull request or has no readable
 * filter. Each workflow's filter is kept whole because negations (`!docs/**`)
 * only mean something inside their own list.
 * @param {Record<string, string[]|null>} paths filter per workflow path, as `recordingWorkflowsAt` reports it
 * @param {string[]} workflows the selected workflow paths
 * @returns {Record<string, string[]>|null}
 */
export function selectedPathFilters(paths, workflows) {
  const known = workflows.filter((workflow) => workflow in paths)
  if (known.length === 0 || known.some((workflow) => paths[workflow] === null)) return null
  return Object.fromEntries(known.map((workflow) => [workflow, paths[workflow]]))
}

/**
 * Does at least one recording workflow run when these paths change?
 * @param {Record<string, string[]>} filters as `selectedPathFilters` returns them
 * @param {string[]} changePaths
 * @returns {boolean}
 */
export function recordsAnyPath(filters, changePaths) {
  return Object.values(filters).some((filter) => changePaths.some((path) => matchesPathFilter(path, filter)))
}

/**
 * One line naming the fork recorders a plan relies on, with each one's filter.
 * @param {Record<string, string[]>|null|undefined} filters absent on transition plans, which rely on the fork's recorder unfiltered
 * @returns {string}
 */
export function describeRecorders(filters) {
  if (filters === null || filters === undefined || Object.keys(filters).length === 0) return "fork's own recording workflow (every pull request)"
  return `fork's own recording workflow: ${Object.entries(filters).map(([workflow, filter]) => `${workflow} (paths: ${filter.join(", ")})`).join("; ")}`
}

/**
 * GitHub Actions path-filter match: `*` stays within one segment, `**` spans
 * segments, a leading `!` negates. Later filters win, as in Actions.
 * @param {string} path
 * @param {string[]} filters
 */
export function matchesPathFilter(path, filters) {
  let matched = false
  for (const raw of filters) {
    const negated = raw.startsWith("!")
    const pattern = negated ? raw.slice(1) : raw
    const source = pattern
      .split(/(\*\*\/?|\*)/)
      .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
      .join("")
    if (new RegExp(`^${source}$`).test(path)) matched = !negated
  }
  return matched
}

/**
 * Which workflow files, by name, run garnet-org/action on pull requests: the
 * ones that name the action, and the ones whose jobs call a local reusable
 * workflow (`uses: ./.github/workflows/x.yml` or `$/.github/workflows/x.yml`)
 * that names it. A reusable workflow is not a recorder by itself; the caller
 * with the `pull_request` trigger is.
 * @param {Record<string, string>} bodies workflow file name → contents
 * @returns {string[]} file names, in the order given
 */
export function recordingWorkflowFiles(bodies) {
  const runsAction = (file) => /garnet-org\/action/.test(bodies[file] ?? "")
  const calledWorkflows = (body) => [...body.matchAll(/^\s*uses:\s*["']?(?:\.|\$)\/\.github\/workflows\/([^\s"'@]+)/gm)].map((match) => match[1])
  return Object.keys(bodies).filter((file) => {
    const body = bodies[file]
    if (!/^\s*pull_request:|^\s*-\s*pull_request\s*$|\bon:\s*\[[^\]]*pull_request/m.test(body)) return false
    return runsAction(file) || calledWorkflows(body).some(runsAction)
  })
}

/**
 * The jobs of a workflow, each with the pull request label its own `if:` names
 * through `contains(github.event.pull_request.labels.*.name, 'x')` and the
 * jobs it `needs:`.
 * @param {string} body workflow file contents
 * @returns {Record<string, {label: string|null, needs: string[]}>}
 */
export function workflowJobs(body) {
  const lines = String(body ?? "").split("\n")
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  const jobs = {}
  if (jobsAt < 0) return jobs
  let jobIndent = -1
  let keyIndent = -1
  let current = null
  let needsList = false
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const indent = line.search(/\S/)
    if (indent === 0) break
    if (jobIndent < 0) jobIndent = indent
    const jobKey = /^\s+([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (indent === jobIndent && jobKey !== null) {
      current = { label: null, needs: [] }
      jobs[jobKey[1]] = current
      keyIndent = -1
      needsList = false
      continue
    }
    if (current === null) continue
    if (keyIndent < 0) keyIndent = indent
    if (needsList && indent > keyIndent) {
      const item = /^\s+-\s*([A-Za-z0-9_-]+)\s*$/.exec(line)
      if (item !== null) current.needs.push(item[1])
      continue
    }
    needsList = false
    if (indent !== keyIndent) continue
    const condition = /^\s+if:\s*(.*)$/.exec(line)
    if (condition !== null) {
      const label = /contains\(\s*github\.event\.pull_request\.labels\.\*\.name\s*,\s*['"]([^'"]+)['"]\s*\)/.exec(condition[1])
      current.label = label !== null ? label[1] : null
    }
    const needs = /^\s+needs:\s*(.*)$/.exec(line)
    if (needs !== null) {
      const value = needs[1].trim()
      if (value === "") needsList = true
      else if (value.startsWith("[")) current.needs.push(...value.replace(/^\[|\]$/g, "").split(",").map((name) => name.trim().replace(/^["']|["']$/g, "")).filter((name) => name !== ""))
      else current.needs.push(value.replace(/^["']|["']$/g, ""))
    }
  }
  return jobs
}

/**
 * The pull request label a workflow requires before any of its jobs run: a job
 * is gated when its own `if:` names the label, or when everything it `needs:`
 * is gated. Null when at least one job runs on an unlabelled pull request, when
 * gated jobs name different labels, or when no jobs were found.
 * @param {string} body workflow file contents
 * @returns {string|null}
 */
export function requiredLabel(body) {
  const jobs = workflowJobs(body)
  const names = Object.keys(jobs)
  if (names.length === 0) return null
  const gate = {}
  for (const name of names) gate[name] = jobs[name].label
  let changed = true
  while (changed) {
    changed = false
    for (const name of names) {
      if (gate[name] !== null || jobs[name].needs.length === 0) continue
      const upstream = jobs[name].needs.map((dep) => (dep in gate ? gate[dep] : null))
      if (upstream.every((label) => label !== null)) {
        gate[name] = upstream[0]
        changed = true
      }
    }
  }
  const labels = [...new Set(names.map((name) => gate[name]))]
  return labels.length === 1 && labels[0] !== null ? labels[0] : null
}

/**
 * Recording workflows at `ref` of `repo`: pull_request workflows that run
 * garnet-org/action, directly or through a local reusable workflow, with each
 * one's `on.pull_request.paths` filter (null when it runs on every path) and
 * the label its jobs require (null when they run on any pull request).
 * @returns {{present: boolean, workflows: string[], name: string|null, paths: Record<string, string[]|null>, labels: Record<string, string|null>}}
 */
export function recordingWorkflowsAt(repo, ref, { exec = run } = {}) {
  let tree
  try {
    tree = ghJson(["api", `repos/${repo}/git/trees/${ref}:.github/workflows`], { exec })
  } catch {
    return { present: false, workflows: [], name: null, paths: {}, labels: {} }
  }
  const files = Array.isArray(tree?.tree) ? tree.tree.filter((entry) => entry.type === "blob" && /\.ya?ml$/.test(entry.path)) : []
  const bodies = {}
  for (const file of files) {
    try {
      bodies[file.path] = exec("gh", ["api", `repos/${repo}/contents/.github/workflows/${file.path}?ref=${ref}`, "-H", "Accept: application/vnd.github.raw"])
    } catch {
      continue
    }
  }
  const workflows = []
  const paths = {}
  const labels = {}
  let name = null
  for (const file of recordingWorkflowFiles(bodies)) {
    const workflowPath = `.github/workflows/${file}`
    workflows.push(workflowPath)
    paths[workflowPath] = pullRequestPathFilter(bodies[file])
    labels[workflowPath] = requiredLabel(bodies[file])
    const match = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(bodies[file])
    if (name === null && match !== null) name = match[1].trim()
  }
  return { present: workflows.length > 0, workflows, name, paths, labels }
}

/**
 * The recording workflows that will run on the replay's pull request: every
 * unlabelled one, plus the label-gated ones whose label the run applies.
 * @param {{workflows: string[], labels: Record<string, string|null>}} recording as `recordingWorkflowsAt` reports it
 * @param {string|null} label the `--label` the run applies, if any
 * @returns {{eligible: string[], gated: Record<string, string>}} gated: workflow → label it needs
 */
export function eligibleRecorders(recording, label) {
  const eligible = []
  const gated = {}
  for (const workflow of recording.workflows) {
    const needed = recording.labels[workflow] ?? null
    if (needed === null || needed === label) eligible.push(workflow)
    else gated[workflow] = needed
  }
  return { eligible, gated }
}

function blobShaAt(repo, ref, path, exec) {
  try {
    const file = ghJson(["api", `repos/${repo}/contents/${path}?ref=${ref}`], { exec })
    return file !== null && typeof file === "object" && typeof file.sha === "string" ? file.sha : null
  } catch (error) {
    if (/\b404\b|Not Found/.test(String(error?.message ?? error))) return null
    throw error
  }
}

const HOLDS_BASE_PATH_LIMIT = 40

/**
 * Does the fork's `ref` already hold every path the change touches exactly as
 * the change's base holds them (same blob, or absent in both)? Then commit 1
 * stages only what the plan adds (`.github/` files, `--first` paths). Returns
 * null when the answer is unknown: too many paths to compare, or an API error
 * other than 404.
 * @param {{upstream: string, baseSha: string, fork: string, ref: string, changes: Array<{path: string, previous: string|null}>}} input
 * @returns {boolean|null}
 */
export function forkHoldsBase({ upstream, baseSha, fork, ref, changes }, { exec = run } = {}) {
  const paths = [...new Set(changes.flatMap((change) => (change.previous === null ? [change.path] : [change.path, change.previous])))]
  if (paths.length === 0 || paths.length > HOLDS_BASE_PATH_LIMIT) return null
  try {
    for (const path of paths) {
      if (blobShaAt(upstream, baseSha, path, exec) !== blobShaAt(fork, ref, path, exec)) return false
    }
    return true
  } catch {
    return null
  }
}

/** Does the fork default branch already carry a pull_request workflow that runs garnet-org/action? */
export function forkHasRecordingWorkflow(fork, defaultBranch, { exec = run } = {}) {
  return recordingWorkflowsAt(fork, defaultBranch, { exec })
}

/**
 * Does `repo` carry `.github/dependabot.yml` at `ref`?
 * @param {string} repo owner/name
 * @param {string} ref branch or commit
 * @returns {boolean}
 */
export function hasDependabotConfig(repo, ref, { exec = run } = {}) {
  try {
    const file = ghJson(["api", `repos/${repo}/contents/${DEPENDABOT_CONFIG_PATH}?ref=${ref}`], { exec })
    return file !== null && typeof file === "object" && file.type === "file"
  } catch (error) {
    if (/\b404\b|Not Found/.test(String(error?.message ?? error))) return false
    throw new Error(`could not read ${DEPENDABOT_CONFIG_PATH} on ${repo}@${ref}: ${String(error?.message ?? error).split("\n")[0]}`)
  }
}

export { fetchUpstreamPr }
export function forkDefaultBranch(fork, { exec = run } = {}) {
  return ghForkDefaultBranch(fork, { exec })
}

const defaultIo = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  },
  mkdirp: (path) => mkdirSync(path, { recursive: true }),
}

/**
 * @param {Record<string, unknown>} plan
 * @param {{exec?: typeof run, io?: typeof defaultIo, log?: (line: string) => void,
 *   wait?: {enabled?: boolean, timeoutMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number}}} [options]
 */
export async function executePlan(plan, { exec = run, io = defaultIo, log = console.log, wait = {} } = {}) {
  const captured = {}
  let existingPr = null
  let published = "none"
  io.mkdirp(dirname(plan.work))
  for (const step of plan.steps) {
    if (step.kind === "prepared-paths") {
      verifyPreparedPaths(step, exec)
      continue
    }
    if (step.kind === "prepared-resume") {
      verifyPreparedResume(step, exec)
      continue
    }
    if (step.skipIf === "existingPr" && existingPr !== null) {
      log(`skip ${step.id}: fork pull request ${existingPr.number} already exists on ${plan.branch}`)
      continue
    }
    if (step.skipIf === "changePublished" && published === "both") {
      log(`skip ${step.id}: commit 2 is already on ${plan.branch} on the fork`)
      continue
    }
    if (step.kind === "reconcile") {
      const git = (...args) => String(exec("git", ["-C", step.work, ...args], { encoding: "utf8" }) ?? "").trim()
      let remoteHead = null
      try {
        remoteHead = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${step.branch}^{commit}`)
      } catch {
        remoteHead = null
      }
      if (remoteHead === "") remoteHead = null
      if (existingPr === null) {
        if (remoteHead !== null && Array.isArray(captured.closedPrs) && captured.closedPrs.length > 0) {
          throw new Error(`${step.id} failed: origin/${step.branch} is still at ${remoteHead.slice(0, 7)} from closed fork pull request ${captured.closedPrs.map((pr) => pr.number).join(", ")}; a fresh pull request needs its own branch. Pass --branch <name>, or delete the fork branch by hand first`)
        }
        continue
      }
      if (remoteHead === null) {
        throw new Error(`${step.id} failed: fork pull request ${existingPr.number} exists but origin/${step.branch} is gone; close or reopen the pull request by hand before rerunning`)
      }
      const remoteTree = git("rev-parse", `${remoteHead}^{tree}`)
      const firstTree = git("rev-parse", "HEAD~1^{tree}")
      const headTree = git("rev-parse", "HEAD^{tree}")
      let matchedBy = "tree"
      published = publicationState({ remoteTree, firstTree, headTree })
      if (published === "mismatch") {
        const patchId = (from, to) => {
          const diff = String(exec("git", ["-C", step.work, "diff", from, to], { encoding: "utf8" }) ?? "")
          const out = String(exec("git", ["-C", step.work, "patch-id", "--stable"], { encoding: "utf8", input: diff, stdio: ["pipe", "pipe", "pipe"] }) ?? "")
          return out.trim().split(/\s+/)[0] ?? ""
        }
        const same = (left, right) => left !== "" && left === right
        const localFirst = patchId("HEAD~2", "HEAD~1")
        const localChange = patchId("HEAD~1", "HEAD")
        const remoteLast = patchId(`${remoteHead}~1`, remoteHead)
        matchedBy = "patch"
        if (same(remoteLast, localFirst)) {
          published = "first"
        } else if (same(remoteLast, localChange)) {
          let remoteFirst = ""
          try {
            remoteFirst = patchId(`${remoteHead}~2`, `${remoteHead}~1`)
          } catch {
            remoteFirst = ""
          }
          if (same(remoteFirst, localFirst)) published = "both"
        }
      }
      if (published === "mismatch") {
        throw new Error(`${step.id} failed: origin/${step.branch} is at ${remoteHead.slice(0, 7)}, which matches neither commit 1 nor commit 2 of this plan by tree or by patch; not overwriting it`)
      }
      const remoteCount = Number(git("rev-list", "--count", `origin/${step.baseRef}..${remoteHead}`))
      const expected = published === "both" ? 2 : 1
      if (remoteCount !== expected) {
        throw new Error(`${step.id} failed: origin/${step.branch} carries ${Number.isFinite(remoteCount) ? remoteCount : "an unknown number of"} commit(s) past ${step.baseRef} where commit ${expected === 2 ? "1 and 2" : "1"} alone would be ${expected}; the two-commit shape is gone, so nothing is pushed onto it. Pass --branch <name> for a fresh branch`)
      }
      if (published === "both") {
        captured.forkHeadSha = remoteHead
        captured.firstSha = git("rev-parse", `${remoteHead}~1`)
        log(`${step.id}: commits 1 and 2 are already on origin/${step.branch} (${captured.firstSha.slice(0, 7)}, ${remoteHead.slice(0, 7)}), matched by ${matchedBy}`)
        continue
      }
      const remoteRoot = git("rev-parse", `${remoteHead}~1`)
      const localRoot = git("rev-parse", "HEAD~2")
      if (remoteRoot !== localRoot) {
        throw new Error(`${step.id} failed: origin/${step.branch} starts from ${remoteRoot.slice(0, 7)} but ${step.baseRef} on the fork is now at ${localRoot.slice(0, 7)}; commit 2 on top of it would carry that drift into the comparison, so nothing is pushed onto it. Pass --branch <name> for a fresh branch from the current base`)
      }
      let rebuilt
      if (matchedBy === "tree") {
        rebuilt = git("commit-tree", headTree, "-p", remoteHead, "-m", plan.messages.change)
        git("update-ref", `refs/heads/${step.branch}`, rebuilt)
      } else {
        const localHead = git("rev-parse", "HEAD")
        git("checkout", "-q", "-B", step.branch, remoteHead)
        try {
          git("cherry-pick", localHead)
        } catch (error) {
          try { git("cherry-pick", "--abort") } catch { /* nothing to abort */ }
          throw new Error(`${step.id} failed: commit 2 does not apply on top of the fork's commit 1 (${remoteHead.slice(0, 7)}): ${error instanceof Error ? error.message : String(error)}`)
        }
        rebuilt = git("rev-parse", "HEAD")
      }
      captured.firstSha = remoteHead
      captured.forkHeadSha = rebuilt
      log(`${step.id}: commit 1 is on origin/${step.branch} as ${remoteHead.slice(0, 7)} (matched by ${matchedBy}); commit 2 rebuilt on it as ${rebuilt.slice(0, 7)}`)
      continue
    }
    if (step.kind === "wait-record") {
      assertForkTarget(step.target, plan.fork)
      const sha = captured[step.sha]
      if (typeof sha !== "string" || sha === "") throw new Error(`${step.id} failed: no ${step.sha} captured`)
      if (captured.forkPr === undefined) throw new Error(`${step.id} failed: no fork pull request to wait on`)
      if (wait.enabled === false) {
        log(`skip ${step.id}: --no-wait; commit 2 is pushed now and the App has no recorded previous commit to compare against`)
        captured.firstRecord = { state: "not-waited", detail: "--no-wait" }
        continue
      }
      const result = await waitForRecord({ fork: plan.fork, forkPr: captured.forkPr, sha, exec, log, ...wait })
      captured.firstRecord = result
      if (result.state !== "recorded") {
        throw new Error(`${step.id} failed: ${result.detail}. Commit 1 is on the fork as pull request ${captured.forkPr}; rerun the same command once it is recorded, or pass --no-wait to push commit 2 without a comparison`)
      }
      continue
    }
    if (step.writeFileContent) {
      io.writeFile(step.writeFileContent.file, step.writeFileContent.content)
      continue
    }
    if (step.editFile) {
      io.writeFile(step.editFile.file, step.editFile.transform(io.readFile(step.editFile.file)))
      continue
    }
    if (step.assertFileIncludes) {
      const { file, text: needle } = step.assertFileIncludes
      if (!io.readFile(file).includes(needle)) throw new Error(`${step.id} failed: ${file} does not include ${JSON.stringify(needle)}`)
      continue
    }
    if (step.kind === "write-remote") assertForkTarget(step.target, plan.fork)
    let args = step.args
    if (step.messageFrom === "firstDiff" && Array.isArray(captured.firstDiff)) {
      const at = args.indexOf("-m")
      const unplanned = firstStagesMismatch(plan, captured.firstDiff)
      if (unplanned.length > 0) {
        throw new Error(`${step.id} failed: the plan expected commit 1 to stage only what it adds, but the checkout also staged ${unplanned.join(", ")}; the fork's ${plan.baseRef ?? plan.defaultBranch} moved since the plan was made. Rerun the command to plan against the current fork`)
      }
      const message = resolvedFirstMessage(captured.firstDiff, args[at + 1])
      assertOutbound(message, plan.upstream)
      args = [...args.slice(0, at + 1), message, ...args.slice(at + 2)]
    }
    let out
    try {
      const options = { encoding: "utf8" }
      if (typeof step.cwd === "string") options.cwd = step.cwd
      if (step.env !== undefined) options.env = { ...process.env, ...step.env }
      out = exec(step.cmd, args, options)
    } catch (error) {
      if (step.onError === "refresh-merge") {
        let conflicted = ""
        try {
          conflicted = String(exec("git", ["-C", plan.work, "diff", "--name-only", "--diff-filter=U"], { encoding: "utf8" }) ?? "").trim()
        } catch {}
        try { exec("git", ["-C", plan.work, "merge", "--abort"], { encoding: "utf8" }) } catch {}
        const paths = conflicted.split("\n").filter(Boolean)
        throw new Error(`${step.id} failed: merge conflict${paths.length === 0 ? "" : ` in ${paths.join(", ")}`}`)
      }
      if (step.allowFail === true) continue
      throw new Error(`${step.id} failed: ${error.message}`)
    }
    if (typeof step.capture !== "string") continue
    const text = String(out ?? "").trim()
    switch (step.capture) {
      case "originUrl":
        assertForkTarget(text, plan.fork)
        captured.originUrl = text
        break
      case "upstreamUrl": {
        const repo = repoFromUrl(text)
        if (repo === null || repo.toLowerCase() !== String(plan.upstream).toLowerCase()) {
          throw new Error(`${step.id} failed: upstream URL ${JSON.stringify(text)} does not match ${JSON.stringify(plan.upstreamUrl)}`)
        }
        captured.upstreamUrl = text
        break
      }
      case "baseBehind": {
        const behind = Number(text)
        captured.baseBehind = Number.isFinite(behind) ? behind : null
        if (captured.baseBehind !== null && captured.baseBehind > 0) {
          const message = `${plan.baseRef} on the fork is ${captured.baseBehind} commit(s) behind the change's base; paths the change does not touch stay as the fork has them, so commit 1 is not the change's base and an install can fail on it. Pass --sync-fork to fast-forward the fork first, --base-branch <name> to open the pull request against a fork branch set to the base, or --allow-behind to go ahead knowingly.`
          if (step.allowBehind === true) log(`warning: ${message}`)
          else throw new Error(message)
        }
        break
      }
      case "refreshBefore":
      case "refreshAfter": {
        const counts = text.split(/\s+/).map(Number)
        if (counts.length !== 2 || counts.some((count) => !Number.isFinite(count))) throw new Error(`${step.id} failed: invalid ahead/behind count ${JSON.stringify(text)}`)
        const [behind, ahead] = counts
        captured[step.capture] = { behind, ahead }
        log(`refresh ${step.capture === "refreshBefore" ? "before" : "after"}: ${behind} behind, ${ahead} ahead`)
        break
      }
      case "worktreeStatus":
        if (text !== "") {
          throw new Error(`the checkout at ${plan.work} has uncommitted changes; commit or stash them first (the harness never discards work):\n${text}`)
        }
        break
      case "firstDiff":
        if (text === "") throw new Error("commit 1 would be empty: the touched paths already match the fork default branch")
        captured.firstDiff = text.split("\n")
        break
      case "changeDiff":
        if (text === "") throw new Error("the change commit would be empty: the change is already present on the fork")
        captured.changeDiff = text.split("\n")
        break
      case "commitCount":
        assertTwoCommits(text)
        captured.commitCount = 2
        break
      case "lockfileDiff":
        if (text !== "") throw new Error(`the lockfile changed (${text}); this transition must leave it as the default branch has it`)
        captured.lockfileDiff = []
        break
      case "existingPr": {
        let list = []
        try {
          list = JSON.parse(text === "" ? "[]" : text)
        } catch {
          list = []
        }
        existingPr = list.find((pr) => pr.state === "OPEN") ?? null
        const closed = list.filter((pr) => pr.state !== "OPEN")
        captured.closedPrs = closed
        if (existingPr === null && closed.length > 0) {
          log(`${closed.map((pr) => `pull request ${pr.number} (${String(pr.state).toLowerCase()})`).join(", ")} on ${plan.branch} is not reused; a fresh pull request follows`)
        }
        captured.existingPr = existingPr
        if (existingPr !== null && existingPr.number !== undefined) captured.forkPr = Number(existingPr.number)
        break
      }
      case "createdPrUrl":
        captured.createdPrUrl = text.split("\n").filter(Boolean).pop()
        captured.forkPr = parseForkPrNumber(captured.createdPrUrl, plan.fork)
        break
      default:
        captured[step.capture] = text
    }
  }
  captured.reconciled = existingPr !== null
  return captured
}

export function upsertReplay(target, row) {
  const next = { ...target, replays: [...(target.replays ?? [])] }
  const sameRow = (entry) => (row.upstreamPr === null || row.upstreamPr === undefined
    ? entry.branch === row.branch
    : Number(entry.upstreamPr) === Number(row.upstreamPr))
  const index = next.replays.findIndex(sameRow)
  if (index >= 0) next.replays[index] = { ...next.replays[index], ...row }
  else next.replays.push(row)
  return next
}
