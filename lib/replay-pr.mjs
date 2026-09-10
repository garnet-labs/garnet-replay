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
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ghJson, run, upstreamPr as fetchUpstreamPr, forkDefaultBranch as ghForkDefaultBranch, latestRuntimeReviewComment, parseReplayMarker } from "./gh.mjs"
import { assertForkTarget, assertOutbound, assertTwoCommits, stripUpstreamLeak } from "./guards.mjs"
import { parseVersionTransition } from "./observe.mjs"
import { OUT_DIR } from "./ledger.mjs"
import { waitForRecord } from "./wait.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const RECORD_TEMPLATE = join(ROOT, "live", "templates", "garnet-record.yml")
export const RECORD_WORKFLOW_PATH = ".github/workflows/garnet-record.yml"

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
})

/** Pick the ecosystem from touched paths, or null when none is recognised. */
export function detectEcosystem(paths) {
  for (const path of paths) {
    const name = path.split("/").pop()
    if (name in ECOSYSTEM_BY_LOCKFILE) return ECOSYSTEM_BY_LOCKFILE[name]
  }
  if (paths.some((path) => path.split("/").pop() === "package.json")) return "npm"
  if (paths.some((path) => path.split("/").pop() === "pyproject.toml")) return "uv"
  if (paths.some((path) => path.split("/").pop() === "Cargo.toml")) return "cargo"
  if (paths.some((path) => path.split("/").pop() === "Gemfile")) return "ruby"
  return null
}

export function slugPart(value) {
  return String(value).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Routine branch name: `deps/<package>-<version>` when the title carries a transition. */
export function branchName({ transition = null, upstreamPr }) {
  if (transition !== null && typeof transition.name === "string" && typeof transition.to === "string") {
    return `deps/${slugPart(transition.name)}-${slugPart(transition.to)}`
  }
  const number = Number(upstreamPr)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`invalid --pr '${upstreamPr}'`)
  return `chore/manifests-${number.toString(36)}`
}

function listPaths(paths) {
  const shown = paths.slice(0, 6)
  const more = paths.length - shown.length
  return shown.map((path) => `- ${path}`).join("\n") + (more > 0 ? `\n- and ${more} more` : "")
}

export function contextCommitMessage(paths, { firstPaths = [], transition = null } = {}) {
  if (firstPaths.length > 0 && transition !== null) {
    return `chore(deps): bump ${transition.name} from ${transition.from} to ${transition.to}\n\n${listPaths(firstPaths)}`
  }
  return ["chore(deps): sync dependency manifests before update", "", listPaths(paths)].join("\n")
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

export function prBodyText({ transition = null, firstPaths = [], paths = [] } = {}) {
  if (transition !== null && firstPaths.length > 0) {
    return `Bumps \`${transition.name}\` from ${transition.from} to ${transition.to}. It runs an install script, so the second commit adds it to the build-script allowlist.\n`
  }
  if (transition !== null) {
    return `Bumps \`${transition.name}\` from ${transition.from} to ${transition.to}.\n`
  }
  return `Dependency manifest update across ${paths.length} path(s).\n`
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
 * @param {{fork: string, branch: string, defaultBranch: string, bodyFile: string, body: string, title: string, draft: boolean, work: string}} input
 * @returns {Record<string, unknown>[]}
 */
export function publishSteps({ fork, branch, defaultBranch, bodyFile, body, title, draft, work }) {
  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  return [
    { id: "find-pr", kind: "read", capture: "existingPr", note: "reuse an existing fork pull request on this branch", cmd: "gh", args: ["pr", "list", "--repo", fork, "--head", branch, "--state", "all", "--json", "number,state,isDraft,url"] },
    { id: "reconcile", kind: "reconcile", branch, work, note: "match the fork branch against commit 1 and commit 2 by tree, then by patch" },
    { id: "push-first", kind: "write-remote", target: fork, skipIf: "existingPr", note: `push commit 1 alone to ${branch} on the fork`, ...g("push", "--set-upstream", "origin", `HEAD~1:refs/heads/${branch}`) },
    { id: "pr-body", kind: "write-local", writeFileContent: { file: bodyFile, content: body }, note: "write the pull request body" },
    {
      id: "pr-create", kind: "write-remote", target: fork, skipIf: "existingPr", capture: "createdPrUrl",
      note: `open a ${draft ? "draft " : ""}pull request on the fork (base ${defaultBranch})`,
      cmd: "gh", args: ["pr", "create", "--repo", fork, ...(draft ? ["--draft"] : []), "--base", defaultBranch, "--head", branch, "--title", title, "--body-file", bodyFile],
    },
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
 * @param {"fork-workflow"|"inject"} [input.record]
 * @param {string|null} [input.ecosystem]
 * @param {string|null} [input.branch]
 * @param {{first?:string,change?:string,title?:string,body?:string}} [input.messages]
 * @param {boolean} [input.draft]
 */
export function planReplay(input) {
  const {
    slug, upstream, fork, defaultBranch, upstreamPr, upstreamTitle = "", baseSha, headSha,
    changes = [], firstPaths = [], workExists = false, work: requestedWork = null, record = "fork-workflow", ecosystem = null,
    branch: requestedBranch = null, messages: overrides = {}, draft = true,
  } = input
  if (typeof fork !== "string" || fork === "") throw new Error(`target '${slug}' has no fork configured`)
  if (fork.toLowerCase() === String(upstream).toLowerCase()) throw new Error("fork must not be the upstream repository")
  if (typeof baseSha !== "string" || typeof headSha !== "string" || baseSha === "" || headSha === "") {
    throw new Error("upstream base/head sha unresolved; refusing to plan")
  }
  if (changes.length === 0) throw new Error("upstream pull request touched no files; nothing to replay")
  for (const path of firstPaths) {
    if (!changes.some((change) => change.path === path)) throw new Error(`--first path ${path} is not touched by the upstream change`)
  }
  if (record === "inject" && (ecosystem === null || !(ecosystem in INSTALL_COMMANDS))) {
    throw new Error(`no recording workflow on the fork and no install command for ecosystem ${String(ecosystem)}; pass --record fork-workflow after adding one`)
  }

  const paths = changes.map((change) => change.path)
  const transition = parseVersionTransition(upstreamTitle)
  const branch = requestedBranch ?? branchName({ transition, upstreamPr })
  const work = requestedWork ?? workDirFor(slug)
  const bodyFile = join(OUT_DIR, slug, `replay-${upstreamPr}-body.md`)
  const forkUrl = `https://github.com/${fork}.git`
  const upstreamUrl = `https://github.com/${upstream}.git`

  const messages = {
    first: overrides.first ?? contextCommitMessage(paths, { firstPaths, transition }),
    change: overrides.change ?? changeCommitMessage(upstreamTitle, upstream, { paths, firstPaths, transition }),
  }
  const title = overrides.title ?? messages.change.split("\n")[0]
  const body = overrides.body ?? prBodyText({ transition, firstPaths, paths })
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
    { id: "branch", kind: "write-local", note: `create ${branch} from ${defaultBranch}`, ...g("checkout", "-B", branch, `origin/${defaultBranch}`) },
    { id: "first-remove", kind: "write-local", note: "commit 1: drop paths the change removes or renames", ...g("rm", "-q", "--ignore-unmatch", "--", ...paths) },
    ...(firstAtBase.length > 0 ? [{ id: "first-base", kind: "write-local", note: "commit 1: touched paths as the change found them", ...g("checkout", baseSha, "--", ...firstAtBase) }] : []),
    ...(firstAtHead.length > 0 ? [{ id: "first-head", kind: "write-local", note: "commit 1: paths carried ahead of the change", ...g("checkout", headSha, "--", ...firstAtHead) }] : []),
    ...(record === "inject" ? [{ id: "first-record", kind: "write-local", writeFileContent: { file: join(work, RECORD_WORKFLOW_PATH), content: recordWorkflow(ecosystem) }, note: "commit 1: add the recording workflow" }, { id: "first-record-add", kind: "write-local", ...g("add", "--", RECORD_WORKFLOW_PATH) }] : []),
    ...(firstPresent.length > 0 ? [{ id: "first-add", kind: "write-local", note: "commit 1: stage the paths present after the reset", ...g("add", "-A", "--", ...firstPresent) }] : []),
    { id: "first-check", kind: "read", capture: "firstDiff", note: "guard: commit 1 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "first-commit", kind: "write-local", note: "commit 1", ...g("commit", "-q", "-m", messages.first) },
    ...(removedAtHead.length > 0 ? [{ id: "change-remove", kind: "write-local", ...g("rm", "-q", "--ignore-unmatch", "--", ...removedAtHead) }] : []),
    { id: "change-head", kind: "write-local", note: "commit 2: the change itself", ...g("checkout", headSha, "--", ...atHead) },
    ...(atHead.length > 0 ? [{ id: "change-add", kind: "write-local", note: "commit 2: stage the paths present at the head", ...g("add", "-A", "--", ...atHead) }] : []),
    { id: "change-check", kind: "read", capture: "changeDiff", note: "guard: commit 2 must change something", ...g("diff", "--cached", "--name-only") },
    { id: "change-commit", kind: "write-local", note: "commit 2", ...g("commit", "-q", "-m", messages.change) },
    { id: "verify-commits", kind: "read", capture: "commitCount", note: "guard: exactly two new commits", ...g("rev-list", "--count", `origin/${defaultBranch}..HEAD`) },
    { id: "first-sha", kind: "read", capture: "firstSha", ...g("rev-parse", "HEAD~1") },
    { id: "head-sha", kind: "read", capture: "forkHeadSha", ...g("rev-parse", "HEAD") },
    ...publishSteps({ fork, branch, defaultBranch, bodyFile, body, title, draft, work }),
  ]

  return {
    slug, upstream, fork, upstreamPr: Number(upstreamPr), branch, defaultBranch, baseSha, headSha, transition,
    scope: "pr-base-to-head", paths, firstPaths, record, ecosystem, work, bodyFile, messages, title, body, draft, steps,
  }
}

export function recordWorkflow(ecosystem) {
  const command = INSTALL_COMMANDS[ecosystem]
  if (typeof command !== "string") throw new Error(`no install command for ecosystem ${String(ecosystem)}`)
  return readFileSync(RECORD_TEMPLATE, "utf8").replace("{{INSTALL_COMMAND}}", command)
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
  lines.push(`branch: ${plan.branch} · base: ${plan.defaultBranch} · scope: ${plan.scope}`)
  if (typeof plan.baseSha === "string" && typeof plan.headSha === "string") lines.push(`compares: ${plan.baseSha.slice(0, 7)} → ${plan.headSha.slice(0, 7)}`)
  else lines.push("compares: commit 1 → commit 2 (shas known after the commits exist)")
  lines.push(`record: ${plan.record === "inject" ? `recording workflow added in commit 1 (${plan.ecosystem})` : "fork's own recording workflow"}`)
  lines.push(`paths (${plan.paths.length}): ${plan.paths.slice(0, 10).join(", ")}${plan.paths.length > 10 ? ", …" : ""}`)
  if (plan.firstPaths.length > 0) lines.push(`carried into commit 1: ${plan.firstPaths.join(", ")}`)
  lines.push("")
  lines.push("commands")
  for (const step of plan.steps) {
    const cwd = typeof step.cwd === "string" ? `(cd ${step.cwd}) ` : ""
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

/** Does the fork default branch already carry a pull_request workflow that runs garnet-org/action? */
export function forkHasRecordingWorkflow(fork, defaultBranch, { exec = run } = {}) {
  let tree
  try {
    tree = ghJson(["api", `repos/${fork}/git/trees/${defaultBranch}:.github/workflows`], { exec })
  } catch {
    return { present: false, workflows: [], name: null }
  }
  const files = Array.isArray(tree?.tree) ? tree.tree.filter((entry) => entry.type === "blob" && /\.ya?ml$/.test(entry.path)) : []
  const workflows = []
  let name = null
  for (const file of files) {
    let body = ""
    try {
      body = exec("gh", ["api", `repos/${fork}/contents/.github/workflows/${file.path}?ref=${defaultBranch}`, "-H", "Accept: application/vnd.github.raw"])
    } catch {
      continue
    }
    if (/garnet-org\/action/.test(body) && /pull_request/.test(body)) {
      workflows.push(`.github/workflows/${file.path}`)
      const match = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(body)
      if (name === null && match !== null) name = match[1].trim()
    }
  }
  return { present: workflows.length > 0, workflows, name }
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
    if (step.skipIf === "existingPr" && existingPr !== null) {
      log(`skip ${step.id}: fork pull request ${existingPr.number} already exists on ${plan.branch}`)
      continue
    }
    if (step.skipIf === "changePublished" && published === "both") {
      log(`skip ${step.id}: commit 2 is already on ${plan.branch} on the fork`)
      continue
    }
    if (step.kind === "reconcile") {
      if (existingPr === null) continue
      const git = (...args) => String(exec("git", ["-C", step.work, ...args], { encoding: "utf8" }) ?? "").trim()
      let remoteHead = null
      try {
        remoteHead = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${step.branch}^{commit}`)
      } catch {
        remoteHead = null
      }
      if (remoteHead === null || remoteHead === "") {
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
      if (published === "both") {
        captured.forkHeadSha = remoteHead
        captured.firstSha = git("rev-parse", `${remoteHead}~1`)
        log(`${step.id}: commits 1 and 2 are already on origin/${step.branch} (${captured.firstSha.slice(0, 7)}, ${remoteHead.slice(0, 7)}), matched by ${matchedBy}`)
        continue
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
    let out
    try {
      const options = { encoding: "utf8" }
      if (typeof step.cwd === "string") options.cwd = step.cwd
      if (step.env !== undefined) options.env = { ...process.env, ...step.env }
      out = exec(step.cmd, step.args, options)
    } catch (error) {
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
        existingPr = list.find((pr) => pr.state === "OPEN") ?? list[0] ?? null
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

