/**
 * Stage 2 (opt-in): wire the fork's real review workflow around the record.
 * Adds, in one pull request to the fork default branch:
 *   - a recording workflow when the fork has none (same template as Stage 1),
 *   - a privileged evidence mirror (workflow_run, default branch, no fork code runs),
 *   - an acceptance gate job `garnet/evidence` that fails without a head-bound record,
 *   - REVIEW.md reviewer/agent grounding rules.
 * Privileged workflows only take effect once merged to the default branch.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertForkTarget, assertOutbound } from "./guards.mjs"
import { INSTALL_COMMANDS, RECORD_WORKFLOW_PATH, recordWorkflow, workDirFor } from "./replay-pr.mjs"
import { OUT_DIR } from "./ledger.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const TEMPLATES = join(ROOT, "live", "templates", "stage2")

export const STAGE2_FILES = Object.freeze({
  mirrorWorkflow: ".github/workflows/garnet-evidence-mirror.yml",
  mirrorScript: ".github/scripts/garnet-evidence-mirror.mjs",
  gateWorkflow: ".github/workflows/garnet-evidence-gate.yml",
  review: "REVIEW.md",
})

export const STAGE2_BRANCH = "ci/garnet-evidence"

function template(name) {
  return readFileSync(join(TEMPLATES, name), "utf8")
}

/**
 * @param {object} input
 * @param {string} input.slug
 * @param {string} input.upstream
 * @param {string} input.fork
 * @param {string} input.defaultBranch
 * @param {string|null} [input.ecosystem]  required when the fork has no recording workflow
 * @param {{present:boolean, workflows:string[], name?:string|null}} input.recording
 * @param {boolean} [input.workExists]
 */
export function planStage2(input) {
  const { slug, upstream, fork, defaultBranch, ecosystem = null, recording, workExists = false, draft = true } = input
  if (typeof fork !== "string" || fork === "") throw new Error(`target '${slug}' has no fork configured`)
  if (fork.toLowerCase() === String(upstream).toLowerCase()) throw new Error("fork must not be the upstream repository")
  const addRecord = recording.present !== true
  if (addRecord && (ecosystem === null || !(ecosystem in INSTALL_COMMANDS))) {
    throw new Error(`the fork has no recording workflow; pass --ecosystem <${Object.keys(INSTALL_COMMANDS).join("|")}>`)
  }
  const recordName = addRecord ? "Garnet Runtime Visibility" : recording.name
  if (typeof recordName !== "string" || recordName === "") throw new Error("could not resolve the recording workflow name")

  const work = workDirFor(slug)
  const forkUrl = `https://github.com/${fork}.git`
  const files = {
    ...(addRecord ? { [RECORD_WORKFLOW_PATH]: recordWorkflow(ecosystem) } : {}),
    [STAGE2_FILES.mirrorWorkflow]: template("garnet-evidence-mirror.yml").replaceAll("{{RECORD_WORKFLOW_NAME}}", recordName),
    [STAGE2_FILES.mirrorScript]: template("garnet-evidence-mirror.mjs"),
    [STAGE2_FILES.gateWorkflow]: template("garnet-evidence-gate.yml").replaceAll("{{RECORD_WORKFLOW_NAME}}", recordName),
    [STAGE2_FILES.review]: template("REVIEW.md"),
  }
  const title = "ci: mirror runtime evidence into pull requests and gate on it"
  const body = [
    "Adds the evidence delivery around the recorded dependency install:",
    "",
    "- `Garnet evidence mirror` copies the head-bound Garnet comment into the pull request description (`workflow_run`, default branch, no pull request code runs).",
    "- `garnet/evidence` fails when no record is bound to the pull request head; mark it required to make evidence a merge condition.",
    "- `REVIEW.md` tells reviewers and review agents how to cite the record.",
    ...(addRecord ? ["- `Garnet Runtime Visibility` records the dependency install on every pull request."] : []),
    "",
    "Both privileged workflows take effect after this lands on the default branch.",
    "",
  ].join("\n")
  for (const text of [title, body]) assertOutbound(text, upstream)
  assertForkTarget(forkUrl, fork)
  const bodyFile = join(OUT_DIR, slug, "stage2-body.md")
  const paths = Object.keys(files)
  const g = (...args) => ({ cmd: "git", args: ["-C", work, ...args] })
  const steps = [
    workExists
      ? { id: "fetch-fork", kind: "write-local", note: "reuse the fork checkout", ...g("fetch", "--prune", "origin") }
      : { id: "clone-fork", kind: "write-local", note: "clone the fork", cmd: "git", args: ["clone", forkUrl, work] },
    { id: "verify-origin", kind: "read", capture: "originUrl", note: "guard: origin must be the fork", ...g("remote", "get-url", "origin") },
    { id: "branch", kind: "write-local", note: `create ${STAGE2_BRANCH} from ${defaultBranch}`, ...g("checkout", "-B", STAGE2_BRANCH, `origin/${defaultBranch}`) },
    ...paths.map((path) => ({ id: `write-${path}`, kind: "write-local", writeFileContent: { file: join(work, path), content: files[path] }, note: `write ${path}` })),
    { id: "add", kind: "write-local", ...g("add", "--", ...paths) },
    { id: "check", kind: "read", capture: "changeDiff", note: "guard: the commit must change something", ...g("diff", "--cached", "--name-only") },
    { id: "commit", kind: "write-local", note: "one commit", ...g("commit", "-q", "-m", title) },
    { id: "head-sha", kind: "read", capture: "forkHeadSha", ...g("rev-parse", "HEAD") },
    { id: "find-pr", kind: "read", capture: "existingPr", note: "reuse an existing pull request on this branch", cmd: "gh", args: ["pr", "list", "--repo", fork, "--head", STAGE2_BRANCH, "--state", "all", "--json", "number,state,isDraft,url"] },
    { id: "push", kind: "write-remote", target: fork, skipIf: "existingPr", note: `push ${STAGE2_BRANCH} to the fork`, ...g("push", "--force-with-lease", "--set-upstream", "origin", STAGE2_BRANCH) },
    { id: "pr-body", kind: "write-local", writeFileContent: { file: bodyFile, content: body }, note: "write the pull request body" },
    { id: "pr-create", kind: "write-remote", target: fork, skipIf: "existingPr", capture: "createdPrUrl", note: `open a ${draft ? "draft " : ""}pull request on the fork (base ${defaultBranch})`, cmd: "gh", args: ["pr", "create", "--repo", fork, ...(draft ? ["--draft"] : []), "--base", defaultBranch, "--head", STAGE2_BRANCH, "--title", title, "--body-file", bodyFile] },
  ]
  return { slug, upstream, fork, defaultBranch, branch: STAGE2_BRANCH, recordName, addRecord, ecosystem, work, files, paths, title, body, bodyFile, draft, steps }
}

export function renderStage2Plan(plan) {
  const lines = [
    `stage 2 plan · ${plan.slug}`,
    `fork (only write target): ${plan.fork} · branch ${plan.branch} → ${plan.defaultBranch}`,
    `recording workflow: ${plan.addRecord ? `added (${plan.ecosystem})` : `existing "${plan.recordName}"`}`,
    "files",
    ...plan.paths.map((path) => `  ${path}`),
    "",
    "pull request",
    `  title: ${plan.title}`,
    ...plan.body.split("\n").map((line) => `  ${line}`.trimEnd()),
    "after merge: mark the job `garnet/evidence` required in branch protection to gate merges on a head-bound record.",
    "dry run: nothing was executed.",
  ]
  return `${lines.join("\n")}\n`
}
