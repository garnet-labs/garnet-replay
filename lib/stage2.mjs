/**
 * Stage 2 (opt-in): wire the fork's real review workflow around the record.
 * Adds, in one pull request to the fork default branch:
 *   - a recording workflow when the fork has none (same template as Stage 1),
 *   - a privileged evidence mirror (workflow_run, default branch, no fork code runs),
 *   - an acceptance gate job `garnet/evidence` that fails without a head-bound record,
 *   - REVIEW.md reviewer/agent grounding rules,
 *   - a re-review request once per head after the record is bound (mirror workflow),
 *   - one thin adapter file per targeted reviewer, each pointing at REVIEW.md.
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
  rereviewScript: ".github/scripts/garnet-rereview.mjs",
  gateWorkflow: ".github/workflows/garnet-evidence-gate.yml",
  review: "REVIEW.md",
})

/**
 * Reviewer → adapter files (template name → path in the fork). Every adapter is
 * a thin pointer at REVIEW.md; the canonical text lives there once.
 * Reviewers without a repository file (codex reads AGENTS.md) have none.
 */
export const REVIEWER_ADAPTERS = Object.freeze({
  devin: Object.freeze({ "skill.md": ".agents/skills/garnet-runtime-review/SKILL.md" }),
  coderabbit: Object.freeze({ "coderabbit.yaml": ".coderabbit.yaml" }),
  greptile: Object.freeze({ "greptile-config.json": ".greptile/config.json", "greptile-rules.md": ".greptile/rules.md" }),
  bugbot: Object.freeze({ "bugbot.md": ".cursor/BUGBOT.md" }),
  copilot: Object.freeze({ "copilot-instructions.md": ".github/copilot-instructions.md", "skill.md": ".github/skills/garnet-runtime-review/SKILL.md" }),
  qodo: Object.freeze({ "pr_agent.toml": ".pr_agent.toml" }),
  codex: Object.freeze({}),
})

export const REVIEWERS = Object.freeze(Object.keys(REVIEWER_ADAPTERS))

/** Reviewers whose re-request needs a repository secret beyond the workflow token. */
export const API_TOKEN_REVIEWERS = Object.freeze(["devin"])

/** Targeting decision (2026-09-22): the three reviewers with observed head-bound receipts or exact utterances. */
export const DEFAULT_REVIEWERS = Object.freeze(["devin", "coderabbit", "greptile"])

export const STAGE2_BRANCH = "ci/garnet-evidence"

/**
 * @param {string|string[]|null|undefined} input `--reviewers a,b` or a list
 * @returns {string[]} known reviewers in input order, deduplicated
 */
export function parseReviewers(input) {
  if (input === null || input === undefined) return [...DEFAULT_REVIEWERS]
  const raw = Array.isArray(input) ? input : String(input).split(",")
  const out = []
  for (const item of raw) {
    const name = String(item).trim().toLowerCase()
    if (name === "") continue
    if (!REVIEWERS.includes(name)) throw new Error(`unknown reviewer '${name}'; known: ${REVIEWERS.join(", ")}`)
    if (!out.includes(name)) out.push(name)
  }
  return out
}

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
 * @param {string[]} [input.reviewers]  reviewers to adapt and re-request (default DEFAULT_REVIEWERS)
 * @param {string[]} [input.existing]   fork paths already present; adapters there are kept unless replaceAdapters
 * @param {boolean} [input.replaceAdapters]
 */
export function planStage2(input) {
  const { slug, upstream, fork, defaultBranch, ecosystem = null, recording, workExists = false, draft = true, existing = [], replaceAdapters = false } = input
  const reviewers = parseReviewers(input.reviewers)
  if (reviewers.length === 0) throw new Error("at least one reviewer is required; pass --reviewers")
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
  const adapters = {}
  const keptAdapters = []
  for (const reviewer of reviewers) {
    for (const [name, path] of Object.entries(REVIEWER_ADAPTERS[reviewer])) {
      if (!replaceAdapters && existing.includes(path)) {
        if (!keptAdapters.includes(path)) keptAdapters.push(path)
        continue
      }
      adapters[path] = template(join("adapters", name))
    }
  }
  const files = {
    ...(addRecord ? { [RECORD_WORKFLOW_PATH]: recordWorkflow(ecosystem) } : {}),
    [STAGE2_FILES.mirrorWorkflow]: template("garnet-evidence-mirror.yml").replaceAll("{{RECORD_WORKFLOW_NAME}}", recordName).replaceAll("{{REVIEWERS}}", reviewers.join(",")),
    [STAGE2_FILES.mirrorScript]: template("garnet-evidence-mirror.mjs"),
    [STAGE2_FILES.rereviewScript]: template("garnet-rereview.mjs"),
    [STAGE2_FILES.gateWorkflow]: template("garnet-evidence-gate.yml").replaceAll("{{RECORD_WORKFLOW_NAME}}", recordName),
    [STAGE2_FILES.review]: template("REVIEW.md"),
    ...adapters,
  }
  const title = "ci: mirror runtime evidence into pull requests, gate on it, re-request reviews"
  const body = [
    "Adds the evidence delivery around the recorded dependency install:",
    "",
    "- `Garnet evidence mirror` copies the head-bound Garnet comment into the pull request description (`workflow_run`, default branch, no pull request code runs), then requests the configured reviewers once per head so they review with the record present.",
    "- `garnet/evidence` fails when no record is bound to the pull request head; mark it required to make evidence a merge condition.",
    "- `REVIEW.md` tells reviewers and review agents how to cite the record.",
    `- Reviewer adapter files point each configured review tool at \`REVIEW.md\`${Object.keys(adapters).length > 0 ? `: ${Object.keys(adapters).map((p) => `\`${p}\``).join(", ")}` : ""}. The tool list is \`GARNET_REVIEWERS\` in the mirror workflow.`,
    ...(keptAdapters.length > 0 ? [`- Existing adapter files kept as they are: ${keptAdapters.map((p) => `\`${p}\``).join(", ")}.`] : []),
    ...(addRecord ? ["- `Garnet Runtime Visibility` records the dependency install on every pull request."] : []),
    ...(reviewers.some((r) => API_TOKEN_REVIEWERS.includes(r)) ? ["- Review tools that are requested through their own API need the repository secret named in the mirror workflow; without it that request is logged and skipped."] : []),
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
  return { slug, upstream, fork, defaultBranch, branch: STAGE2_BRANCH, recordName, addRecord, ecosystem, reviewers, adapters: Object.keys(adapters), keptAdapters, work, files, paths, title, body, bodyFile, draft, steps }
}

export function renderStage2Plan(plan) {
  const lines = [
    `stage 2 plan · ${plan.slug}`,
    `fork (only write target): ${plan.fork} · branch ${plan.branch} → ${plan.defaultBranch}`,
    `recording workflow: ${plan.addRecord ? `added (${plan.ecosystem})` : `existing "${plan.recordName}"`}`,
    `reviewers re-requested after the record binds: ${plan.reviewers.join(", ")}`,
    ...(plan.keptAdapters.length > 0 ? [`adapters kept (already in the fork): ${plan.keptAdapters.join(", ")}`] : []),
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
