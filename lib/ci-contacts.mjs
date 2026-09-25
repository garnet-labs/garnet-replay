// CI Contacts: "The PR says X. What did its CI actually contact?"
// Pure task construction, prompt rendering, answer parsing and scoring.
// The answer key is the recorded execution diff; the record's own capture and
// comparison state decide whether a "no new behavior" answer is supportable.

export const VERDICTS = ["new-behavior", "no-new-behavior", "cannot-tell"]
export const TRACKS = ["diff", "record"]

// Context lines that name the recording harness rather than the change.
// Applied to the reviewer-facing diff only; each substitution is listed in the task.
const REDACTIONS = [
  {
    pattern: /"description": "Minimal workload for the npm top-10 [^"]*"/g,
    replacement: '"description": "Minimal workload app."',
    note: "package.json description context line naming the recording harness",
  },
]

// Files a replay adds to carry the recording itself; never part of the change under review.
const SCAFFOLD_FILES = new Set([".github/DEPENDENCY_REPLAY.md"])

/**
 * Normalize a destination for comparison: lowercase, strip scheme, path, port,
 * defanging brackets and trailing annotations like " (github infra)".
 * @param {string} value
 * @returns {string}
 */
export function normalizeDestination(value) {
  if (typeof value !== "string") {
    return ""
  }
  let host = value.trim().toLowerCase().replace(/\[\.\]/g, ".")
  host = host.replace(/\s*\(.*\)\s*$/, "")
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  host = host.split("/")[0]
  if (!host.includes("::")) {
    host = host.replace(/:\d+$/, "")
  }
  return host.replace(/\.$/, "")
}

function chainOf(entry) {
  const ancestry = Array.isArray(entry.ancestry) ? entry.ancestry : []
  const runner = ancestry.indexOf("Runner.Worker")
  const tail = runner >= 0 ? ancestry.slice(runner + 1) : ancestry
  return tail.join(" → ")
}

/**
 * Answer key from a replay record (public/replays/**.json).
 * @param {object} replay
 * @returns {{comparison: boolean, capture: string, workload_added: string[], background_added: string[], expected_verdict: string, key_basis: string}}
 */
export function answerKey(replay) {
  const comparison = replay?.comparison?.available === true
  const capture = typeof replay?.capture?.status === "string" ? replay.capture.status : "not-declared"
  const added = Array.isArray(replay?.execution_diff?.network_added) ? replay.execution_diff.network_added : []
  const workload = added.filter((a) => a.section === "workload").map((a) => normalizeDestination(a.destination))
  const background = added.filter((a) => a.section !== "workload").map((a) => normalizeDestination(a.destination))
  let expected = "cannot-tell"
  let basis = "no comparison base: the record cannot say what changed"
  if (comparison && workload.length > 0) {
    expected = "new-behavior"
    basis = "workload destinations added between compared heads"
  } else if (comparison && capture === "complete") {
    expected = "no-new-behavior"
    basis = "no workload destination added and capture declared complete"
  } else if (comparison) {
    basis = "no workload destination added, but capture is not declared complete"
  }
  return {
    comparison,
    capture,
    workload_added: [...new Set(workload)].sort(),
    background_added: [...new Set(background)].sort(),
    expected_verdict: expected,
    key_basis: basis,
  }
}

/**
 * Reviewer-facing record view: neutral wording, pair, capture state, and each
 * added or removed destination with its section and process chain.
 * @param {object} replay
 * @returns {string}
 */
export function renderRecord(replay) {
  const lines = []
  const base = replay?.base?.sha
  const head = replay?.head?.sha
  lines.push("CI execution record (kernel-level, recorded during this PR's CI install/build job)")
  lines.push(`head: ${typeof head === "string" ? head : "unknown"}`)
  if (replay?.comparison?.available === true) {
    lines.push(`compared with: ${base} (${replay.comparison.scope})`)
  } else {
    lines.push("compared with: none (no earlier recording to compare against)")
  }
  const cap = replay?.capture ?? {}
  if (cap.status === "complete") {
    lines.push(`capture: complete (${cap.recorded_cells}/${cap.expected_cells} expected recordings present, executed commit verified)`)
  } else {
    lines.push("capture: not declared (the record does not claim it saw every job or event)")
  }
  const totals = replay?.execution_diff?.totals ?? {}
  lines.push(`jobs recorded: ${totals.jobs_recorded ?? "unknown"}; outbound destinations seen on head: ${totals.destinations ?? "unknown"}`)
  lines.push("section key: workload = processes started by the job's own steps; runner background = CI runner infrastructure")
  const ed = replay?.execution_diff ?? {}
  const rows = [
    ...(Array.isArray(ed.network_added) ? ed.network_added.map((e) => ["+", e]) : []),
    ...(Array.isArray(ed.network_removed) ? ed.network_removed.map((e) => ["-", e]) : []),
  ]
  if (rows.length === 0) {
    lines.push("outbound destination changes: none recorded")
  } else {
    lines.push("outbound destination changes (+ added on head, - absent on head):")
    for (const [sign, e] of rows) {
      const chain = chainOf(e)
      lines.push(`  ${sign} ${e.destination} [${e.section}]${chain !== "" ? ` via ${chain}` : ""}`)
    }
  }
  lines.push("file and process events beyond these chains: not recorded")
  return lines.join("\n")
}

function redact(diff) {
  const applied = []
  let out = diff
  for (const r of REDACTIONS) {
    const next = out.replace(r.pattern, r.replacement)
    if (next !== out) {
      applied.push(r.note)
    }
    out = next
  }
  return { diff: out, applied }
}

/**
 * Unified diff text from GitHub PR file entries, without replay scaffolding.
 * @param {{filename: string, status: string, patch?: string}[]} files
 * @returns {string}
 */
export function diffFromFiles(files) {
  const parts = []
  for (const f of files) {
    if (SCAFFOLD_FILES.has(f.filename)) {
      continue
    }
    const header = `diff --git a/${f.filename} b/${f.filename}\n--- ${f.status === "added" ? "/dev/null" : `a/${f.filename}`}\n+++ b/${f.filename}`
    parts.push(typeof f.patch === "string" ? `${header}\n${f.patch}` : `${header}\n(binary or oversized patch not shown)`)
  }
  return parts.join("\n")
}

/**
 * One task: reviewer inputs, record view, and answer key.
 * @param {{id: string, label: string, title: string, body: string, diff: string, replay: object, source_note: string}} input
 */
export function buildTask(input) {
  const { diff, applied } = redact(input.diff)
  const key = answerKey(input.replay)
  const visible = key.workload_added.filter((d) => diff.toLowerCase().includes(d))
  return {
    id: input.id,
    label: input.label,
    source_note: input.source_note,
    redactions: applied,
    title: input.title,
    body: input.body,
    diff,
    record: renderRecord(input.replay),
    key: { ...key, visible_in_diff: visible, hidden_from_diff: key.workload_added.filter((d) => !visible.includes(d)) },
  }
}

const ANSWER_SPEC = `Answer with one JSON object and nothing else:
{
  "new_destinations": ["<host>", ...],
  "verdict": "new-behavior" | "no-new-behavior" | "cannot-tell",
  "reason": "<one or two sentences>"
}
new_destinations: outbound network destinations (hostnames or IPs) that this PR causes its CI install/build job to contact and that it did not contact before the change. Leave out CI runner infrastructure. Use [] if none or unknown.
verdict: "new-behavior" if the change makes CI do something new on the network; "no-new-behavior" only if you can support that it does not; "cannot-tell" if the material does not let you decide.`

/**
 * Prompt for a task on a track. The diff track never includes the record.
 * @param {ReturnType<typeof buildTask>} task
 * @param {"diff"|"record"} track
 * @returns {string}
 */
export function renderPrompt(task, track) {
  if (!TRACKS.includes(track)) {
    throw new Error(`unknown track ${track}`)
  }
  const parts = [
    "You are reviewing a pull request. The question: what does this change make CI actually run and contact on the network during its install/build job?",
    "",
    `## Title\n${task.title}`,
    "",
    `## Description\n${task.body.trim() === "" ? "(none)" : task.body.trim()}`,
    "",
    `## Diff\n\`\`\`diff\n${task.diff}\n\`\`\``,
  ]
  if (track === "record") {
    parts.push("", `## CI execution record for this PR\n\`\`\`text\n${task.record}\n\`\`\``)
  }
  parts.push("", ANSWER_SPEC)
  return parts.join("\n")
}

/**
 * Parse a model reply into an answer, tolerating code fences and prose around the JSON.
 * @param {string} text
 * @returns {{new_destinations: string[], verdict: string, reason: string, parse_error: string|null}}
 */
export function parseAnswer(text) {
  const empty = { new_destinations: [], verdict: "invalid", reason: "", parse_error: null }
  if (typeof text !== "string") {
    return { ...empty, parse_error: "no text" }
  }
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) {
    return { ...empty, parse_error: "no JSON object" }
  }
  let obj
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    return { ...empty, parse_error: `bad JSON: ${error.message}` }
  }
  const dests = Array.isArray(obj.new_destinations) ? obj.new_destinations.filter((d) => typeof d === "string") : []
  const verdict = VERDICTS.includes(obj.verdict) ? obj.verdict : "invalid"
  return {
    new_destinations: [...new Set(dests.map(normalizeDestination).filter((d) => d !== ""))].sort(),
    verdict,
    reason: typeof obj.reason === "string" ? obj.reason : "",
    parse_error: verdict === "invalid" ? `verdict ${JSON.stringify(obj.verdict)} not one of ${VERDICTS.join(", ")}` : null,
  }
}

/**
 * Score one answer against its key.
 * outcome: caught | missed_said_clean | abstained | correct_clean | correct_abstain | false_alarm | overclaimed_clean | invalid
 * @param {ReturnType<typeof buildTask>["key"]} key
 * @param {ReturnType<typeof parseAnswer>} answer
 */
export function scoreAnswer(key, answer) {
  const truth = new Set(key.workload_added)
  const background = new Set(key.background_added)
  const predicted = answer.new_destinations
  const tp = predicted.filter((d) => truth.has(d)).length
  const fp = predicted.length - tp
  const backgroundFp = predicted.filter((d) => background.has(d)).length
  let outcome
  const v = answer.verdict
  if (v === "invalid") {
    outcome = "invalid"
  } else if (key.expected_verdict === "new-behavior") {
    outcome = v === "new-behavior" ? "caught" : v === "no-new-behavior" ? "missed_said_clean" : "abstained"
  } else if (key.expected_verdict === "no-new-behavior") {
    outcome = v === "no-new-behavior" ? "correct_clean" : v === "cannot-tell" ? "abstained" : "false_alarm"
  } else {
    outcome = v === "cannot-tell" ? "correct_abstain" : v === "no-new-behavior" ? "overclaimed_clean" : "false_alarm"
  }
  return {
    outcome,
    verdict_correct: v === key.expected_verdict,
    tp,
    fp,
    fn: truth.size - tp,
    background_fp: backgroundFp,
    hidden_named: predicted.filter((d) => key.hidden_from_diff.includes(d)).length,
  }
}

/**
 * Aggregate scores for one model on one track.
 * @param {{task: ReturnType<typeof buildTask>, score: ReturnType<typeof scoreAnswer>}[]} rows
 */
export function summarize(rows) {
  const hidden = rows.filter((r) => r.task.key.hidden_from_diff.length > 0)
  const visible = rows.filter((r) => r.task.key.expected_verdict === "new-behavior" && r.task.key.hidden_from_diff.length === 0)
  const unsupported = rows.filter((r) => r.task.key.expected_verdict === "cannot-tell")
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0)
  const tp = sum(rows, (r) => r.score.tp)
  const fp = sum(rows, (r) => r.score.fp)
  const fn = sum(rows, (r) => r.score.fn)
  return {
    tasks: rows.length,
    verdict_accuracy: rows.length === 0 ? null : sum(rows, (r) => (r.score.verdict_correct ? 1 : 0)) / rows.length,
    hidden_tasks: hidden.length,
    hidden_flagged: sum(hidden, (r) => (r.score.outcome === "caught" ? 1 : 0)),
    hidden_said_clean: sum(hidden, (r) => (r.score.outcome === "missed_said_clean" ? 1 : 0)),
    hidden_named_destination: sum(hidden, (r) => (r.score.hidden_named > 0 ? 1 : 0)),
    visible_tasks: visible.length,
    visible_flagged: sum(visible, (r) => (r.score.outcome === "caught" ? 1 : 0)),
    unsupported_tasks: unsupported.length,
    overclaimed_clean: sum(unsupported, (r) => (r.score.outcome === "overclaimed_clean" ? 1 : 0)),
    false_alarms: sum(rows, (r) => (r.score.outcome === "false_alarm" ? 1 : 0)),
    destination_precision: tp + fp === 0 ? null : tp / (tp + fp),
    destination_recall: tp + fn === 0 ? null : tp / (tp + fn),
    background_fp: sum(rows, (r) => r.score.background_fp),
    invalid: sum(rows, (r) => (r.score.outcome === "invalid" ? 1 : 0)),
  }
}
