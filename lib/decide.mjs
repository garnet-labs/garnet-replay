/**
 * Merge-safety decision v0 over an Execution Diff (buildExecutionDiff output).
 * Pure: the decision is driven only by the record's verdict and the workload
 * section of the recorded network additions. Runner background deltas are
 * reported, never weighed. Anything missing, partial, stale, or unbound fails
 * closed to undeterminable.
 */
import { VERDICTS, verdictPhrase } from "./evidence.mjs"
import { isDependencyPullRequest } from "./gate.mjs"
import { assertVocabClean } from "./guards.mjs"

export const DECISIONS = Object.freeze({
  MERGE: "merge",
  HOLD: "hold",
  UNDETERMINABLE: "undeterminable",
})

function sectionDestinations(entries, section) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry !== null && typeof entry === "object" && entry.section === section)
    .map((entry) => entry.destination)
    .filter((destination) => typeof destination === "string" && destination !== "")
}

function changeClass(diff, prMeta, files) {
  if (prMeta !== undefined || files !== undefined) {
    return isDependencyPullRequest(prMeta ?? {}, files ?? []) ? "dependency" : "code"
  }
  return diff?.pull_request?.dependency !== undefined ? "dependency" : "code"
}

function newWorkloadReason(diff, names) {
  const total = diff.execution_diff?.totals?.workload?.added
  if (Number.isInteger(total) && total > names.length) {
    return `${total} new workload destination${total === 1 ? "" : "s"} (${names.length} named)`
  }
  if (names.length > 0) {
    return `${names.length} new workload destination${names.length === 1 ? "" : "s"}: ${names.join(", ")}`
  }
  return `${Number.isInteger(total) ? total : "?"} new workload destination(s)`
}

/**
 * @param {Record<string, any>|null} diff   // from lib/execution-diff.mjs buildExecutionDiff; null for no/stale record
 * @param {{prMeta?: Record<string,any>, files?: Array<Record<string,any>|string>}} [context]
 * @returns {{decision: string, change_class: "dependency"|"code", verdict: string|null, reasons: string[],
 *   new_workload_destinations: string[], removed_workload_destinations: string[],
 *   runner_background: {added: number|null, removed: number|null}, capture: string,
 *   head_sha: string|null, compared_sha: string|null, receipt_url: string|null, pair: string|null}}
 */
export function decideMergeSafety(diff, context = {}) {
  const prMeta = context !== null && typeof context === "object" ? context.prMeta : undefined
  const files = context !== null && typeof context === "object" ? context.files : undefined
  if (diff === null || typeof diff !== "object") {
    return {
      decision: DECISIONS.UNDETERMINABLE,
      change_class: changeClass(null, prMeta, files),
      verdict: null,
      reasons: ["no head-bound finalized Garnet record"],
      new_workload_destinations: [],
      removed_workload_destinations: [],
      runner_background: { added: null, removed: null },
      capture: "unavailable",
      head_sha: null,
      compared_sha: null,
      receipt_url: null,
      pair: null,
    }
  }
  const verdict = typeof diff.verdict?.value === "string" ? diff.verdict.value : VERDICTS.UNDETERMINABLE
  const verdictReasons = Array.isArray(diff.verdict?.reasons) ? diff.verdict.reasons : []
  const added = sectionDestinations(diff.execution_diff?.network_added, "workload")
  const removed = sectionDestinations(diff.execution_diff?.network_removed, "workload")
  const background = diff.execution_diff?.totals?.runner_background ?? {}
  let decision
  let reasons
  if (verdict === VERDICTS.UNCHANGED) {
    decision = DECISIONS.MERGE
    reasons = ["no new workload destination recorded after the change", ...verdictReasons]
  } else if (verdict === VERDICTS.NEW_BEHAVIOR) {
    decision = DECISIONS.HOLD
    reasons = [newWorkloadReason(diff, added), ...verdictReasons]
  } else {
    decision = DECISIONS.UNDETERMINABLE
    reasons = verdictReasons.length > 0 ? verdictReasons : ["the record carries no comparison result"]
  }
  return {
    decision,
    change_class: changeClass(diff, prMeta, files),
    verdict,
    reasons,
    new_workload_destinations: added,
    removed_workload_destinations: removed,
    runner_background: {
      added: Number.isInteger(background.added) ? background.added : null,
      removed: Number.isInteger(background.removed) ? background.removed : null,
    },
    capture: typeof diff.capture?.status === "string" ? diff.capture.status : "unavailable",
    head_sha: typeof diff.head?.sha === "string" ? diff.head.sha : null,
    compared_sha: typeof diff.base?.sha === "string" ? diff.base.sha : null,
    receipt_url: typeof diff.receipt_urls?.head === "string" ? diff.receipt_urls.head : null,
    pair: typeof diff.pair?.line === "string" ? diff.pair.line : null,
  }
}

/**
 * Human-readable rendering for stdout and $GITHUB_STEP_SUMMARY. Vocabulary is
 * contract-checked; a banned term throws instead of shipping.
 * @param {ReturnType<typeof decideMergeSafety>} result
 * @param {string} prUrl
 * @returns {string}
 */
export function renderDecision(result, prUrl) {
  const lines = [`decision: ${result.decision}`]
  if (typeof result.verdict === "string") {
    lines.push(`record: ${verdictPhrase(result.verdict)} (${result.verdict})`)
  }
  if (typeof result.pair === "string") lines.push(`pair: ${result.pair}`)
  lines.push(`capture: ${result.capture}`)
  lines.push(`change: ${result.change_class}`)
  lines.push("reasons:")
  for (const reason of result.reasons) lines.push(`  - ${reason}`)
  if (result.new_workload_destinations.length > 0) {
    lines.push("new workload destinations:")
    for (const destination of result.new_workload_destinations) lines.push(`  - ${destination}`)
  }
  if (result.removed_workload_destinations.length > 0) {
    lines.push("removed workload destinations:")
    for (const destination of result.removed_workload_destinations) lines.push(`  - ${destination}`)
  }
  const background = result.runner_background ?? { added: null, removed: null }
  lines.push(Number.isInteger(background.added) && Number.isInteger(background.removed)
    ? `runner background: +${background.added} −${background.removed}, not part of the decision`
    : "runner background: counts not carried by this record, not part of the decision")
  if (typeof result.receipt_url === "string") lines.push(`receipt: ${result.receipt_url}`)
  if (typeof prUrl === "string" && prUrl !== "") lines.push(`pull request: ${prUrl}`)
  return assertVocabClean(lines.join("\n"))
}

/**
 * Process exit code for the decision: merge 0, hold 1, undeterminable 2.
 * @param {{decision?: string}} result
 * @returns {0|1|2}
 */
export function decideExitCode(result) {
  if (result?.decision === DECISIONS.MERGE) return 0
  if (result?.decision === DECISIONS.HOLD) return 1
  return 2
}
