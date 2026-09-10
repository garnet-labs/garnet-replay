/**
 * Evidence discipline shared by every surface: capture completeness, the
 * verdict derived from it, claim classes, the comparison pair line, and
 * supersession. Every field here is derived from the record; nothing is
 * hand-written.
 *
 * Absorbed from the fork lanes: pnpm execution-diff cells (expected vs
 * executed SHA per repetition, stable vs variance sets) and the
 * agent-install-kit consumer verdict table (partial capture fails closed).
 */

const SHA_RE = /^[0-9a-f]{40}$/

export const CAPTURE_STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  NONE: "none",
  NOT_DECLARED: "not-declared",
})

export const VERDICTS = Object.freeze({
  NEW_BEHAVIOR: "new-behavior",
  UNCHANGED: "unchanged",
  RECORDED: "recorded",
  UNDETERMINABLE: "undeterminable",
})

export const CLAIM_CLASSES = Object.freeze({
  OBSERVED: "observed-runtime-behavior",
  COMPARISON: "comparison-result",
  CHECK: "required-check-state",
  CONSUMPTION: "reviewer-consumption-evidence",
  UNSUPPORTED: "unsupported-claim",
})

/** What a kernel record can never carry; rendered so nobody infers it. */
export const UNSUPPORTED_CLAIMS = Object.freeze([
  "compile or build success",
  "file writes outside the recorded file kinds",
  "secret reads",
  "absence of behavior in unrecorded jobs",
  "that nothing else happened",
])

export const SCOPES = Object.freeze([
  "previous-recorded-head-to-head",
  "immediate-parent-to-head",
  "pr-base-to-head",
  "constructed-pair",
  "unavailable",
])

function isSha(value) {
  return typeof value === "string" && SHA_RE.test(value)
}

function short(sha) {
  return isSha(sha) ? sha.slice(0, 7) : "unknown"
}

/**
 * One recorded matrix cell. Cells are how a live replay proves each side ran
 * the exact commit it claims, as many times as it claims.
 * @typedef {{side: "baseline"|"update", rep: number, expected_sha: string|null, executed_sha: string|null,
 *   profile_present: boolean, lineage_missing?: number, runner?: string|null, image?: string|null}} Cell
 */

/**
 * Assess capture completeness from the cells a replay expected and recorded.
 * Missing, stale, or mismatched cells make the capture partial; a partial
 * capture never reads as stable absence or as runtime variance.
 * @param {{expectedCells?: number|null, cells?: Cell[], declared?: {status?: unknown, captureQuality?: unknown}|null}} input
 * @returns {{status: string, expected_cells: number|null, recorded_cells: number|null, executed_sha_verified: number|null,
 *   lineage_missing: number|null, final_record: boolean|null, reasons: string[]}}
 */
export function assessCapture({ expectedCells = null, cells = [], declared = null } = {}) {
  const reasons = []
  if (Array.isArray(cells) && cells.length > 0) {
    const expected = Number.isInteger(expectedCells) && expectedCells > 0 ? expectedCells : cells.length
    const recorded = cells.filter((cell) => cell.profile_present === true).length
    const verified = cells.filter((cell) => isSha(cell.expected_sha) && cell.executed_sha === cell.expected_sha).length
    const lineageMissing = cells.reduce((total, cell) => total + (Number.isInteger(cell.lineage_missing) ? cell.lineage_missing : 0), 0)
    if (cells.length < expected) reasons.push(`cell records: ${cells.length}/${expected}`)
    if (recorded < expected) reasons.push(`execution records: ${recorded}/${expected}`)
    for (const cell of cells) {
      if (!isSha(cell.expected_sha)) reasons.push(`${cell.side} rep ${cell.rep}: expected SHA not recorded`)
      else if (cell.executed_sha !== cell.expected_sha) reasons.push(`${cell.side} rep ${cell.rep}: executed ${short(cell.executed_sha)}, expected ${short(cell.expected_sha)}`)
    }
    const identities = new Set(cells.map((cell) => `${cell.runner ?? ""}\u0000${cell.image ?? ""}`))
    if (identities.size > 1) reasons.push("cells ran on differing runner identities")
    if (lineageMissing > 0) reasons.push(`lineage not recorded for ${lineageMissing} chains`)
    const status = recorded === 0
      ? CAPTURE_STATUS.NONE
      : reasons.length === 0 ? CAPTURE_STATUS.COMPLETE : CAPTURE_STATUS.PARTIAL
    return {
      status,
      expected_cells: expected,
      recorded_cells: recorded,
      executed_sha_verified: verified,
      lineage_missing: lineageMissing,
      final_record: recorded === expected,
      reasons,
    }
  }
  if (declared !== null && declared !== undefined && (declared.status !== undefined || declared.captureQuality !== undefined)) {
    if (declared.status === undefined) reasons.push("record declares capture_quality but not status")
    else if (declared.status !== "finalized") reasons.push(`record status is ${JSON.stringify(declared.status)}, not "finalized"`)
    if (declared.captureQuality === undefined) reasons.push("record declares status but not capture_quality")
    else if (declared.captureQuality !== "complete") reasons.push(`record capture_quality is ${JSON.stringify(declared.captureQuality)}, not "complete"`)
    return {
      status: reasons.length === 0 ? CAPTURE_STATUS.COMPLETE : CAPTURE_STATUS.PARTIAL,
      expected_cells: null,
      recorded_cells: null,
      executed_sha_verified: null,
      lineage_missing: null,
      final_record: declared.status === "finalized",
      reasons,
    }
  }
  return {
    status: CAPTURE_STATUS.NOT_DECLARED,
    expected_cells: null,
    recorded_cells: null,
    executed_sha_verified: null,
    lineage_missing: null,
    final_record: null,
    reasons: ["the record carries no capture accounting; completeness is not claimed"],
  }
}

/**
 * Verdict table. Partial or missing capture is undeterminable, never
 * unchanged and never new behavior: a verdict is a claim about the whole
 * change, and a partial capture cannot carry it. Additions recorded under
 * a partial capture stay in the reasons as observations.
 * @param {{capture: ReturnType<typeof assessCapture>, comparisonAvailable: boolean,
 *   workloadAdded: number|null, workloadRemoved: number|null, variance?: number}} input
 * @returns {{verdict: string, reasons: string[]}}
 */
export function decideVerdict({ capture, comparisonAvailable, workloadAdded, workloadRemoved, variance = 0 }) {
  const added = Number.isInteger(workloadAdded) ? workloadAdded : null
  const removed = Number.isInteger(workloadRemoved) ? workloadRemoved : null
  if (capture.status === CAPTURE_STATUS.NONE) {
    return { verdict: VERDICTS.UNDETERMINABLE, reasons: ["no execution record was captured", ...capture.reasons] }
  }
  if (!comparisonAvailable) {
    if (capture.status === CAPTURE_STATUS.PARTIAL) {
      return { verdict: VERDICTS.UNDETERMINABLE, reasons: ["no comparison pair", ...capture.reasons] }
    }
    return { verdict: VERDICTS.RECORDED, reasons: ["first snapshot: no previous commit to compare against, so no change claim is possible"] }
  }
  if (added === null || removed === null) {
    return { verdict: VERDICTS.UNDETERMINABLE, reasons: ["the record carries no workload delta counts"] }
  }
  if (capture.status === CAPTURE_STATUS.PARTIAL) {
    const reasons = ["capture is partial, so no verdict on the change is available"]
    if (added > 0) reasons.push(`${added} outbound connection${added === 1 ? "" : "s"} recorded only after the change in the cells that were captured; this is an observation, not a comparison result`)
    reasons.push(...capture.reasons)
    return { verdict: VERDICTS.UNDETERMINABLE, reasons }
  }
  if (added > 0) {
    const reasons = [`${added} outbound connection${added === 1 ? "" : "s"} recorded only after the change`]
    if (variance > 0) reasons.push(`${variance} outbound connection${variance === 1 ? "" : "s"} varied between repetitions and ${variance === 1 ? "is" : "are"} excluded from the comparison`)
    return { verdict: VERDICTS.NEW_BEHAVIOR, reasons }
  }
  if (variance > 0) {
    return {
      verdict: VERDICTS.UNDETERMINABLE,
      reasons: [`${variance} outbound connection${variance === 1 ? "" : "s"} varied between repetitions, so an unchanged reading is not available`],
    }
  }
  const reasons = removed > 0
    ? [`${removed} outbound connection${removed === 1 ? "" : "s"} recorded only before the change; nothing new recorded`]
    : ["no outbound connection was added or removed across the recorded jobs"]
  if (capture.status === CAPTURE_STATUS.NOT_DECLARED) reasons.push("scope: the recorded jobs only; the record carries no capture accounting")
  return { verdict: VERDICTS.UNCHANGED, reasons }
}

/**
 * The claims one exhibit may make, each with its class. Consumers copy
 * these sentences; nothing outside this list is a supported claim.
 * @param {{verdict: string, reasons: string[], capture: ReturnType<typeof assessCapture>, pair: ReturnType<typeof pairRecord>,
 *   totals: {workload: {added: number|null, removed: number|null}, runner_background: {added: number|null, removed: number|null}, jobs_recorded: number|null},
 *   check?: {name: string, state: string}|null, consumption?: {consumer: string, evidence_url: string}[]}} input
 * @returns {{class: string, text: string}[]}
 */
export function buildClaims({ verdict, reasons, capture, pair, totals, check = null, consumption = [] }) {
  const claims = []
  const workload = totals?.workload ?? { added: null, removed: null }
  const background = totals?.runner_background ?? { added: null, removed: null }
  const jobs = totals?.jobs_recorded
  if (capture.status !== CAPTURE_STATUS.NONE) {
    claims.push({
      class: CLAIM_CLASSES.OBSERVED,
      text: `Recorded on head ${short(pair.head_sha)}${Number.isInteger(jobs) ? ` across ${jobs} job${jobs === 1 ? "" : "s"}` : ""}: workload outbound connections +${workload.added ?? "?"} −${workload.removed ?? "?"}, runner background +${background.added ?? "?"} −${background.removed ?? "?"}.`,
    })
  }
  if (verdict === VERDICTS.UNDETERMINABLE) {
    claims.push({ class: CLAIM_CLASSES.UNSUPPORTED, text: `Undeterminable: ${reasons.join("; ")}.` })
  } else if (verdict === VERDICTS.RECORDED) {
    claims.push({ class: CLAIM_CLASSES.COMPARISON, text: `First snapshot on ${short(pair.head_sha)}; no comparison exists and no change is claimed.` })
  } else {
    claims.push({
      class: CLAIM_CLASSES.COMPARISON,
      text: `${verdict === VERDICTS.NEW_BEHAVIOR ? "New behavior" : "No new behavior"} between ${short(pair.base_sha)} and ${short(pair.head_sha)} (${pair.scope}): ${reasons[0]}.`,
    })
  }
  if (check !== null && check !== undefined) {
    claims.push({ class: CLAIM_CLASSES.CHECK, text: `Check ${check.name} is ${check.state} on head ${short(pair.head_sha)}.` })
  }
  for (const entry of consumption) {
    claims.push({ class: CLAIM_CLASSES.CONSUMPTION, text: `${entry.consumer} read this record: ${entry.evidence_url}` })
  }
  claims.push({ class: CLAIM_CLASSES.UNSUPPORTED, text: `Not carried by this record: ${UNSUPPORTED_CLAIMS.join(", ")}.` })
  return claims
}

/**
 * The one comparison pair every surface prints. Same text in JSON, the PR
 * comment, the result page, and the verifier.
 * @param {{baseSha: string|null, headSha: string|null, scope: string, label: "real"|"constructed", transition?: string|null}} input
 * @returns {{base_sha: string|null, head_sha: string|null, scope: string, label: string, transition: string|null, line: string}}
 */
export function pairRecord({ baseSha, headSha, scope, label, transition = null }) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown comparison scope: ${scope}`)
  const base = isSha(baseSha) ? baseSha : null
  const head = isSha(headSha) ? headSha : null
  const parts = [
    base === null ? `head ${short(head)} · no base` : `base ${short(base)} → head ${short(head)}`,
    `scope ${scope}`,
  ]
  if (typeof transition === "string" && transition !== "") parts.push(transition)
  parts.push(label === "constructed" ? "constructed" : "real")
  return { base_sha: base, head_sha: head, scope, label: label === "constructed" ? "constructed" : "real", transition: transition ?? null, line: parts.join(" · ") }
}

/**
 * A record is bound to one head. When the PR head or base moves (rebase,
 * new commit) the record is superseded and must not be read as current.
 * @param {{recordHeadSha: string|null, currentHeadSha: string|null, recordBaseSha?: string|null, currentBaseSha?: string|null}} input
 * @returns {{superseded: boolean, record_head: string|null, current_head: string|null, reasons: string[]}}
 */
export function assessSupersession({ recordHeadSha, currentHeadSha, recordBaseSha = null, currentBaseSha = null }) {
  const reasons = []
  if (!isSha(recordHeadSha)) reasons.push("the record is not bound to a head SHA")
  if (!isSha(currentHeadSha)) reasons.push("the current head is unknown")
  if (isSha(recordHeadSha) && isSha(currentHeadSha) && recordHeadSha !== currentHeadSha) {
    reasons.push(`head moved: record ${short(recordHeadSha)}, current ${short(currentHeadSha)}`)
  }
  if (isSha(recordBaseSha) && isSha(currentBaseSha) && recordBaseSha !== currentBaseSha) {
    reasons.push(`base moved: record ${short(recordBaseSha)}, current ${short(currentBaseSha)}`)
  }
  return {
    superseded: reasons.length > 0,
    record_head: isSha(recordHeadSha) ? recordHeadSha : null,
    current_head: isSha(currentHeadSha) ? currentHeadSha : null,
    reasons,
  }
}

/**
 * Stable versus varying destinations across repetitions of one side.
 * A destination is stable when every repetition recorded it.
 * @param {Set<string>[]} repetitions
 * @returns {{stable: Set<string>, variance: Set<string>}}
 */
export function stableAcrossRepetitions(repetitions) {
  const all = new Set(repetitions.flatMap((set) => [...set]))
  const stable = new Set([...all].filter((entry) => repetitions.every((set) => set.has(entry))))
  const variance = new Set([...all].filter((entry) => !stable.has(entry)))
  return { stable, variance }
}

/**
 * Attach the evidence fields to an Execution Diff built by any mode.
 * Idempotent: an object that already carries them is re-derived from its
 * own totals and capture so migrated files agree with fresh ones.
 * @param {Record<string, unknown>} diff
 * @param {{cells?: Cell[], expectedCells?: number|null, declared?: {status?: unknown, captureQuality?: unknown}|null,
 *   currentHeadSha?: string|null, check?: {name: string, state: string}|null, consumption?: {consumer: string, evidence_url: string}[], variance?: number}} [options]
 * @returns {Record<string, unknown>}
 */
export function withEvidenceFields(diff, options = {}) {
  const totals = diff.execution_diff?.totals ?? {}
  const existingCapture = diff.capture
  const capture = options.cells !== undefined || options.declared !== undefined || existingCapture === undefined
    ? assessCapture({ expectedCells: options.expectedCells ?? null, cells: options.cells ?? [], declared: options.declared ?? null })
    : existingCapture
  const transition = diff.pull_request?.dependency
    ? `${diff.pull_request.dependency.name} ${diff.pull_request.dependency.from ?? "none"} → ${diff.pull_request.dependency.to ?? "?"}`
    : null
  const pair = pairRecord({
    baseSha: diff.base?.sha ?? null,
    headSha: diff.head?.sha ?? null,
    scope: diff.comparison?.scope ?? "unavailable",
    label: diff.label,
    transition,
  })
  const variance = Number.isInteger(options.variance) ? options.variance : Number.isInteger(diff.repetitions?.variance) ? diff.repetitions.variance : 0
  const decision = decideVerdict({
    capture,
    comparisonAvailable: diff.comparison?.available === true,
    workloadAdded: totals.workload?.added ?? null,
    workloadRemoved: totals.workload?.removed ?? null,
    variance,
  })
  const supersession = assessSupersession({
    recordHeadSha: diff.head?.sha ?? null,
    currentHeadSha: options.currentHeadSha ?? diff.supersession?.current_head ?? diff.head?.sha ?? null,
  })
  const claims = buildClaims({
    verdict: decision.verdict,
    reasons: decision.reasons,
    capture,
    pair,
    totals,
    check: options.check ?? diff.check ?? null,
    consumption: options.consumption ?? diff.consumption ?? [],
  })
  return {
    ...diff,
    pair,
    capture,
    verdict: { value: decision.verdict, reasons: decision.reasons },
    supersession,
    claims,
  }
}

/**
 * Wording every rendered surface uses for a verdict. Machine names stay in
 * JSON; people read these.
 * @param {string} verdict
 * @returns {string}
 */
export function verdictPhrase(verdict) {
  if (verdict === VERDICTS.NEW_BEHAVIOR) return "new behavior recorded"
  if (verdict === VERDICTS.UNCHANGED) return "no new behavior recorded"
  if (verdict === VERDICTS.RECORDED) return "first record, no comparison"
  return "undeterminable"
}
