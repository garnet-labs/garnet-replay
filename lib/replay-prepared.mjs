import { join, posix } from "node:path"
import { lstatSync } from "node:fs"
import { assertForkTarget, assertOutbound, assertRepoSlug } from "./guards.mjs"
import { OUT_DIR } from "./ledger.mjs"
import { branchName, publishSteps, pullRequestPathFilter, recordingWorkflowFiles, recordsAnyPath, requiredLabel } from "./replay-pr.mjs"

function preparedFiles(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`${name} must contain path-to-content entries`)
  }
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== "string" || path === "" || path.startsWith("/") || path.includes("\\") ||
        posix.normalize(path) !== path || path.split("/").some((part) => part === ".." || part === ".git") ||
        /[\x00-\x1f]/.test(path) || path.startsWith("-")) {
      throw new Error(`invalid prepared file: ${path}`)
    }
  }
  return value
}

/**
 * Plan two authored states using the same publication and recording gates as
 * upstream replays. Contents are explicit; no package manager or policy changes
 * are inferred. The recording workflow is identical on both commits.
 */
export function planPrepared({
  slug, upstream, fork, defaultBranch, work, spec, branch: requestedBranch = null,
  draft = true, label = null, messages: overrides = {}, resume = false,
}) {
  assertRepoSlug(fork)
  if (fork.toLowerCase() === upstream.toLowerCase()) throw new Error("fork must not be the upstream repository")
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) throw new Error("prepared input must be an object")
  const baseline = preparedFiles(spec.baseline, "baseline")
  const change = preparedFiles(spec.change, "change")
  const transition = spec.transition
  for (const key of ["name", "from", "to"]) {
    if (typeof transition?.[key] !== "string" || transition[key].trim() === "") throw new Error(`prepared transition needs ${key}`)
    assertOutbound(transition[key], upstream)
  }
  if (transition.from === transition.to) throw new Error("prepared transition needs different versions")
  const firstPaths = Object.keys(baseline).sort()
  const paths = Object.keys(change).sort()
  if (paths.some((path) => !(path in baseline))) throw new Error("every change path must have an explicit baseline")
  if (paths.every((path) => change[path] === baseline[path])) throw new Error("prepared change would be empty")
  const workflow = spec.workflow
  if (typeof workflow !== "string" || !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflow) || !(workflow in baseline)) {
    throw new Error("prepared workflow must be included in baseline")
  }
  if (paths.some((path) => path.startsWith(".github/workflows/"))) throw new Error("the recording workflows must stay identical across the pair")
  const bodies = Object.fromEntries(firstPaths.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
    .map((path) => [posix.basename(path), baseline[path]]))
  if (!recordingWorkflowFiles(bodies).includes(posix.basename(workflow))) throw new Error("prepared workflow must record pull requests")
  const needed = requiredLabel(baseline[workflow])
  if (needed !== null && needed !== label) throw new Error(`prepared workflow requires --label ${needed}`)
  const filters = pullRequestPathFilter(baseline[workflow])
  if (filters !== null && !recordsAnyPath({ [workflow]: filters }, paths)) throw new Error("prepared change touches none of the recording workflow paths")
  const branch = requestedBranch ?? branchName({ transition, upstreamPr: 0 })
  if (branch === defaultBranch || branch.startsWith("-")) throw new Error("prepared branch must be a feature branch")
  const messages = {
    first: overrides.first ?? `ci: record installs with ${transition.name} ${transition.from}`,
    change: overrides.change ?? `chore(deps): update ${transition.name} to ${transition.to}`,
  }
  const title = overrides.title ?? messages.change
  const body = overrides.body ?? `Updates \`${transition.name}\` from ${transition.from} to ${transition.to} under the same install conditions.\n\nComparison: immediate-parent-to-head.\n`
  for (const text of [branch, ...Object.values(messages), title, body, ...firstPaths]) assertOutbound(text, upstream)
  assertForkTarget(fork, fork)
  const bodyFile = join(OUT_DIR, slug, `prepared-${branch.replace(/[^a-z0-9.]+/gi, "-")}-body.md`)
  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  const write = (files, stage) => Object.entries(files).map(([path, content]) => ({
    id: `${stage}-file:${path}`, kind: "write-local", writeFileContent: { file: join(work, path), content },
  }))
  const steps = [
    { id: "verify-origin", kind: "read", capture: "originUrl", ...g("remote", "get-url", "origin") },
    { id: "verify-worktree", kind: "read", capture: "worktreeStatus", ...g("status", "--porcelain") },
    { id: "fetch-fork", kind: "write-local", ...g("fetch", "origin") },
    { id: "prepared-paths", kind: "prepared-paths", work, paths: firstPaths, ref: `origin/${defaultBranch}` },
    ...(resume
      ? [
          { id: "prepared-resume", kind: "prepared-resume", work, branch, defaultBranch, baseline, change, messages },
          { id: "branch", kind: "write-local", ...g("checkout", branch) },
        ]
      : [
          { id: "branch", kind: "write-local", ...g("checkout", "-b", branch, `origin/${defaultBranch}`) },
          ...write(baseline, "first"),
          { id: "first-add", kind: "write-local", ...g("add", "--", ...firstPaths) },
          { id: "first-check", kind: "read", capture: "firstDiff", ...g("diff", "--cached", "--name-only") },
          { id: "first-commit", kind: "write-local", ...g("commit", "-m", messages.first) },
          ...write(change, "change"),
          { id: "change-add", kind: "write-local", ...g("add", "--", ...paths) },
          { id: "change-check", kind: "read", capture: "changeDiff", ...g("diff", "--cached", "--name-only") },
          { id: "change-commit", kind: "write-local", ...g("commit", "-m", messages.change) },
        ]),
    { id: "verify-commits", kind: "read", capture: "commitCount", ...g("rev-list", "--count", `origin/${defaultBranch}..HEAD`) },
    { id: "prepared-states", kind: "prepared-resume", work, branch, defaultBranch, baseline, change, messages },
    { id: "first-sha", kind: "read", capture: "firstSha", ...g("rev-parse", "HEAD~1") },
    { id: "head-sha", kind: "read", capture: "forkHeadSha", ...g("rev-parse", "HEAD") },
    ...publishSteps({ fork, branch, defaultBranch, bodyFile, body, title, draft, work, label }),
  ]
  return {
    mode: "prepared", slug, upstream, fork, upstreamPr: null, defaultBranch, baseRef: defaultBranch,
    baseSha: null, headSha: null, work, branch, messages, title, body, bodyFile, draft, label,
    firstPaths: [], paths, contextPaths: firstPaths, transition, scope: "immediate-parent-to-head",
    record: "prepared-workflow", ecosystem: null, steps,
  }
}

/** Reject links in the target paths before the plan writes through them. */
export function verifyPreparedPaths({ work, paths, ref }, exec) {
  const prefixes = [...new Set(paths.flatMap((path) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))))]
  const entries = String(exec("git", ["-C", work, "ls-tree", ref, "--", ...prefixes])).split("\n")
  if (entries.some((entry) => /^(120000|160000) /.test(entry))) throw new Error("prepared files must not traverse symlinks or submodules")
  for (const path of prefixes) {
    try {
      if (lstatSync(join(work, path)).isSymbolicLink()) throw new Error("prepared files must not traverse symlinks")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
}

/** Resume only the same two non-merge commits with the declared file contents. */
export function verifyPreparedResume({ work, branch, defaultBranch, baseline, change, messages }, exec) {
  const git = (...args) => String(exec("git", ["-C", work, ...args]))
  const base = git("rev-parse", `origin/${defaultBranch}`).trim()
  if (git("rev-parse", `${branch}~2`).trim() !== base ||
      git("rev-list", "--count", `${base}..${branch}`).trim() !== "2") throw new Error("prepared resume requires the same base and exactly two commits")
  for (const [ref, files, allowed, message] of [
    [`${branch}~1`, baseline, Object.keys(baseline), messages.first],
    [branch, { ...baseline, ...change }, Object.keys(change), messages.change],
  ]) {
    if (git("rev-list", "--parents", "-n", "1", ref).trim().split(/\s+/).length !== 2) throw new Error("prepared commits must have one parent")
    const changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", ref).trim().split("\n")
    if (changed[0] === "" || changed.some((path) => !allowed.includes(path))) throw new Error("prepared resume contains undeclared changes")
    if (git("show", "-s", "--format=%B", ref).trim() !== message.trim()) throw new Error("prepared resume commit message differs")
    for (const [path, content] of Object.entries(files)) {
      if (git("show", `${ref}:${path}`) !== content) throw new Error(`prepared resume differs at ${ref}:${path}`)
    }
  }
}
