/**
 * Agent A/B evaluation: the same model and tools on the same real dependency
 * change, with and without the head-bound Garnet record. Pure helpers only;
 * benchmark/agent-ab/*.mjs do the I/O.
 */
import { createHash } from "node:crypto"

import { GARNET_ACTION_PIN } from "./replay-pr.mjs"

/**
 * control: no runtime evidence. tool: the rendered record behind a pull tool.
 * mirror: the verbatim Runtime Review comment mirrored into the description
 * (the stage 2 delivery layer). guided: mirror plus the canonical REVIEW.md.
 */
export const ARMS = ["control", "tool", "mirror", "guided"]
export const EVIDENCE_BEGIN = "<!-- garnet:evidence:begin -->"
export const EVIDENCE_END = "<!-- garnet:evidence:end -->"
export const DECISIONS = ["accept", "reject"]
export const HELD_OUT_SHARE = 0.4

const CHECKOUT_PIN = "11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2"
const SETUP_NODE_PIN = "39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0"

/** Stable task id for an npm package name. */
export function taskId(name) {
  return `npm-${name.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`
}

/** Deterministic dev/held-out split from the task id alone. */
export function splitFor(id) {
  const bucket = parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16) / 0xffffffff
  return bucket < HELD_OUT_SHARE ? "heldout" : "dev"
}

/** Expand corpus.json rows into task descriptors. */
export function corpusTasks(corpus) {
  return corpus.packages.map(([name, version, hypothesis, cohort = "baseline"]) => {
    const id = taskId(name)
    return { id, name, version, hypothesis, cohort, split: splitFor(id) }
  })
}

/** The recording workflow carried identically by both commits of every pair. */
export function recordingWorkflow() {
  return `name: App install

on:
  pull_request:
    paths:
      - "app/**"

permissions: {}

concurrency:
  group: app-install-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: false

jobs:
  install:
    name: Install and import
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@${CHECKOUT_PIN}
        with:
          ref: \${{ github.event.pull_request.head.sha }}

      - uses: actions/setup-node@${SETUP_NODE_PIN}
        with:
          node-version: "20"

      - uses: garnet-org/action@${GARNET_ACTION_PIN} # v2.3.0

      - name: Install dependencies (lifecycle scripts execute here)
        working-directory: app
        run: npm ci --no-audit --no-fund

      - name: Import every dependency
        working-directory: app
        run: node smoke.mjs

      - name: Let sensor settle
        if: always()
        run: sleep 30
`
}

/** Loads every declared dependency once, each in its own process with a time limit. */
export function smokeScript() {
  return `import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const { dependencies = {} } = JSON.parse(readFileSync("package.json", "utf8"))
let failed = 0
for (const name of Object.keys(dependencies)) {
  const code = \`import(\${JSON.stringify(name)}).then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1) })\`
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { stdio: "inherit", timeout: 30000 })
  const ok = result.status === 0
  if (!ok) failed += 1
  console.log(\`\${ok ? "ok" : "FAIL"} \${name}\`)
}
process.exit(failed === 0 ? 0 : 1)
`
}

/** Package registries the policy allows an install to contact. */
export const ALLOWED_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com"]

export const POLICY = `Organization CI policy: a dependency change must not make the CI install/build job contact network destinations other than the package registry (registry.npmjs.org) and CI runner infrastructure, unless the pull request description discloses those destinations. Accept a change that complies; reject one that violates it.`

/**
 * Ground truth for one task from its CI Contacts answer key.
 * reject: undisclosed workload destinations beyond the registry were observed.
 * accept: a comparison exists and no such destination was observed; `basis`
 * says whether capture was declared complete or only observed in the recorded job.
 * undeterminable: no comparison, so the record cannot support either decision.
 * @param {{comparison: boolean, capture: string, workload_added: string[]}} key
 * @param {string} body pull request description
 */
export function truthFor(key, body = "") {
  const text = String(body).toLowerCase()
  const violating = key.workload_added.filter((d) => !ALLOWED_HOSTS.includes(d) && !text.includes(d))
  if (violating.length > 0) return { decision: "reject", violating, basis: "observed" }
  if (key.comparison !== true) return { decision: "undeterminable", violating: [], basis: "no comparison" }
  return { decision: "accept", violating: [], basis: key.capture === "complete" ? "capture complete" : "observed; capture not declared" }
}

/** Tool definitions (OpenAI function-calling shape). The record tool exists only in the tool arm. */
export function toolSpecs(arm, { hasTree }) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`)
  const fn = (name, description, properties = {}, required = []) => ({
    type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  })
  const tools = [
    fn("npm_view", "Registry metadata for one published package version: scripts, dependencies, optionalDependencies, bin, os/cpu, binary config.",
      { name: { type: "string" }, version: { type: "string" } }, ["name", "version"]),
    fn("list_package_files", "File list of a published package version's tarball.",
      { name: { type: "string" }, version: { type: "string" } }, ["name", "version"]),
    fn("read_package_file", "Read one file from a published package version's tarball (first 20000 characters).",
      { name: { type: "string" }, version: { type: "string" }, path: { type: "string" } }, ["name", "version", "path"]),
    fn("submit", "Submit your review. Call exactly once, last.", {
      decision: { type: "string", enum: DECISIONS },
      new_destinations: { type: "array", items: { type: "string" }, description: "Hosts the change makes CI contact that it did not before, excluding runner infrastructure; [] if none or unknown." },
      responsible_package: { type: "string", description: "Package whose code causes the new contact, or empty." },
      mechanism: { type: "string", description: "How the contact happens (e.g. postinstall downloads a binary), or empty." },
      repair_files: { type: "object", additionalProperties: { type: "string" }, description: "When rejecting: complete new contents for existing files app/package.json and/or app/smoke.mjs that keep the added dependency at its version, installed and importable, but make the change comply (the lockfile is regenerated from app/package.json; the CI workflow cannot change). {} otherwise." },
      reason: { type: "string" },
    }, ["decision", "new_destinations", "responsible_package", "mechanism", "repair_files", "reason"]),
  ]
  if (hasTree) {
    tools.unshift(fn("read_file", "Read a file from the pull request head (first 20000 characters).", { path: { type: "string" } }, ["path"]))
  }
  if (arm === "tool") {
    tools.unshift(fn("garnet_record", "The Garnet CI execution record bound to this pull request head: what the CI job actually executed and contacted, compared with the previous recorded commit."))
  }
  return tools
}

/** Pull request description as the arm delivers it: the mirror arms append the verbatim record region. */
export function armDescription(task, arm) {
  const body = task.body.trim() === "" ? "(none)" : task.body.trim()
  if (arm !== "mirror" && arm !== "guided") return body
  const record = typeof task.garnet_comment === "string" ? task.garnet_comment.trim() : task.record
  return `${body}\n\n## Runtime evidence (Garnet)\n\n${EVIDENCE_BEGIN}\n${record}\n${EVIDENCE_END}`
}

/**
 * System and first user message. Arms differ only in the description's
 * evidence region and, for guided, the appended review guideline.
 * @param {object} task
 * @param {string} arm
 * @param {{guideline?: string}} [options] REVIEW.md text for the guided arm
 */
export function agentMessages(task, arm = "control", { guideline = "" } = {}) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`)
  const diff = task.diff.split("\n")
  const shown = diff.length > 400 ? `${diff.slice(0, 400).join("\n")}\n... (${diff.length - 400} more diff lines; use read_file for full files)` : task.diff
  const system = `You review dependency pull requests for an engineering team. ${POLICY}\nUse the tools to investigate as much as you need, then call submit once.`
  return [
    { role: "system", content: arm === "guided" && guideline !== "" ? `${system}\n\n${guideline.trim()}` : system },
    { role: "user", content: [
      `## Title\n${task.title}`,
      `## Description\n${armDescription(task, arm)}`,
      `## Diff\n\`\`\`diff\n${shown}\n\`\`\``,
      "CI install job: `npm ci` in app/, then import every dependency (Node 20, ubuntu-latest).",
    ].join("\n\n") },
  ]
}

/**
 * Reviewer-consumption receipt for one episode, using the same classifier
 * `replay consume` applies to real reviewers: tier of the grounding (utterance,
 * citation, observation, mention, or none), whether it binds to the head, and
 * runner-background destinations misattributed to the change.
 * @param {{key: {background_added?: string[], workload_added: string[]}, head_sha?: string|null, receipt?: object|null}} task
 * @param {{decision?: string, new_destinations?: string[], reason?: string, mechanism?: string}|null} submission
 * @param {{classify: Function, normalize: (d: string) => string}} deps
 */
export function consumptionFor(task, submission, { classify, normalize }) {
  if (submission === null) return { tier: "none", head_bound: false, background_misattributed: [] }
  const text = [submission.reason, submission.mechanism].filter((x) => typeof x === "string").join("\n")
  const headSha = typeof task.head_sha === "string" ? task.head_sha : null
  const receipt = headSha === null ? null : classify(text, { headSha, receipt: task.receipt ?? null, destinations: task.key.workload_added })
  const background = new Set(task.key.background_added ?? [])
  return {
    tier: receipt === null ? "none" : receipt.tier,
    head_bound: receipt !== null && receipt.headBound === true,
    background_misattributed: (submission.new_destinations ?? []).map(normalize).filter((d) => background.has(d)),
  }
}

/**
 * Score one submitted review.
 * @param {{decision: string, violating: string[]}} truth
 * @param {{decision?: string, new_destinations?: string[]}|null} submission
 * @param {(d: string) => string} normalize
 */
export const REPAIRABLE = ["app/package.json", "app/smoke.mjs"]

/**
 * Turn a submitted repair into a prepared pair: baseline is the pull request
 * head as reviewed, change is the repaired files. Returns null when the repair
 * touches nothing repairable or drops the added dependency.
 * @param {{tree: Record<string,string>, package: {name: string, version: string}}} task
 * @param {Record<string,string>|undefined} files
 */
export function repairChange(task, files) {
  const change = Object.fromEntries(Object.entries(files ?? {})
    .map(([path, content]) => [path.replace(/^\.?\//, ""), content])
    .filter(([path, content]) => REPAIRABLE.includes(path) && typeof content === "string" && content !== task.tree[path]))
  if (Object.keys(change).length === 0) return null
  const manifest = change["app/package.json"] ?? task.tree["app/package.json"]
  let deps
  try { deps = JSON.parse(manifest).dependencies ?? {} } catch { return null }
  if (deps[task.package.name] !== task.package.version) return null
  return change
}

/**
 * A repair is verified when the re-recorded repaired head no longer contacts
 * any violating host, the install-and-import job still succeeds, and the
 * dependency is still declared at its version (checked by repairChange).
 * @param {string[]} violating
 * @param {{workload: string[], checkSucceeded: boolean}} recorded workload destinations seen on the repaired head
 */
export function repairVerified(violating, recorded) {
  return recorded.checkSucceeded && violating.every((d) => !recorded.workload.includes(d))
}

export function scoreReview(truth, submission, normalize) {
  if (submission === null || !DECISIONS.includes(submission.decision)) {
    return { valid: false, decision_correct: false, false_accept: truth.decision === "reject", false_reject: false, diagnosis_correct: false, named_violating: 0 }
  }
  const named = new Set((submission.new_destinations ?? []).map(normalize).filter((d) => d !== "" && !ALLOWED_HOSTS.includes(d)))
  const hits = truth.violating.filter((d) => named.has(d)).length
  const decisionCorrect = truth.decision === "undeterminable" ? null : submission.decision === truth.decision
  const diagnosis = truth.decision === "reject"
    ? submission.decision === "reject" && hits === truth.violating.length && named.size === hits
    : truth.decision === "accept" ? submission.decision === "accept" && named.size === 0 : null
  return {
    valid: true,
    decision_correct: decisionCorrect,
    false_accept: truth.decision === "reject" && submission.decision === "accept",
    false_reject: truth.decision === "accept" && submission.decision === "reject",
    diagnosis_correct: diagnosis,
    named_violating: hits,
  }
}

/** Wilson 95% interval for k of n; null when n is 0. */
export function wilson(k, n) {
  if (n === 0) return null
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/** Exact two-sided sign test on discordant pairs (b: only control right, c: only treatment right). */
export function signTest(b, c) {
  const n = b + c
  if (n === 0) return 1
  const k = Math.min(b, c)
  let tail = 0
  for (let i = 0; i <= k; i += 1) {
    let coef = 1
    for (let j = 0; j < i; j += 1) coef = (coef * (n - j)) / (j + 1)
    tail += coef / 2 ** n
  }
  return Math.min(1, 2 * tail)
}

/**
 * Aggregate one arm's scored episodes.
 * @param {{truth: ReturnType<typeof truthFor>, score: ReturnType<typeof scoreReview>, episode: {turns: number, tool_calls: number, usage: {input_tokens: number|null, output_tokens: number|null}}}[]} rows
 */
export function summarizeArm(rows) {
  const violations = rows.filter((r) => r.truth.decision === "reject")
  const clean = rows.filter((r) => r.truth.decision === "accept")
  const decided = rows.filter((r) => r.truth.decision !== "undeterminable")
  const count = (xs, f) => xs.filter(f).length
  const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)
  const tokens = rows.map((r) => r.episode.usage)
  const tokensKnown = tokens.every((u) => u.input_tokens !== null && u.output_tokens !== null)
  return {
    episodes: rows.length,
    violations: violations.length,
    false_accepts: count(violations, (r) => r.score.false_accept),
    clean: clean.length,
    false_rejects: count(clean, (r) => r.score.false_reject),
    decided: decided.length,
    decision_correct: count(decided, (r) => r.score.decision_correct === true),
    diagnosis_correct: count(decided, (r) => r.score.diagnosis_correct === true),
    invalid: count(rows, (r) => !r.score.valid),
    mean_turns: mean(rows.map((r) => r.episode.turns)),
    mean_tool_calls: mean(rows.map((r) => r.episode.tool_calls)),
    mean_input_tokens: tokensKnown ? mean(tokens.map((u) => u.input_tokens)) : null,
    mean_output_tokens: tokensKnown ? mean(tokens.map((u) => u.output_tokens)) : null,
  }
}
