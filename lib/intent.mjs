/**
 * Intent check: declared runtime claims about a change, evaluated
 * deterministically against the base and head records of one pull request.
 * Pure decision functions — no I/O, no network, no clocks.
 *
 * Outcomes (lib/evidence.mjs vocabulary; rendered phrases live in lib/card.mjs):
 *   supported      both sides recorded, complete capture, steps present, predicate holds
 *   contradicted   same preconditions, predicate false
 *   unobservable   preconditions hold but the matched behaviour appears on neither
 *                  side, so removal/addition cannot be told apart from "never exercised"
 *   undeterminable a side is null, capture is not complete, or a scoped step is
 *                  missing on either side
 */
import { stepEntries } from "./profile-diff.mjs"

export const INTENT_KINDS = Object.freeze(["network", "process"])
export const INTENT_EXPECTS = Object.freeze([
  "present-before-absent-after",
  "absent-before-present-after",
  "present-both",
  "absent-both",
  "no-added",
  "no-removed",
])
export const INTENT_OUTCOMES = Object.freeze([
  "supported",
  "contradicted",
  "unobservable",
  "undeterminable",
])

/**
 * Normalize a match object to { destination } or { ancestry }.
 * @param {Record<string, any>} match
 * @param {string} kind
 */
function normalizeMatch(match, kind) {
  if (match === null || typeof match !== "object" || Array.isArray(match)) {
    throw new Error("a claim needs a match object ({ destination } for network, { ancestry } for process), or none for no-added/no-removed")
  }
  const destination = typeof match.destination === "string" && match.destination !== "" ? match.destination : null
  const ancestry = typeof match.ancestry === "string" && match.ancestry !== "" ? match.ancestry : null
  if (kind === "network" && ancestry !== null) throw new Error("network claims match on destination, not ancestry")
  if (kind === "process" && destination !== null) throw new Error("process claims match on ancestry, not destination")
  if (destination === null && ancestry === null) return {}
  return destination !== null ? { destination } : { ancestry }
}

/**
 * Parse a claim from `kind:match:expect[:step]` text or an object
 * `{ id?, kind, match?, expect, steps?, source? }`. `match` in the string form
 * is a destination for `kind: network` and an ancestry substring for
 * `kind: process`; it may be empty for no-added/no-removed claims.
 * @param {string|Record<string, any>} input
 * @returns {{id: string, kind: string, match: Record<string, string>, expect: string, steps: string[], source: string}}
 */
export function parseClaim(input) {
  if (typeof input === "string") {
    const parts = input.split(":")
    if (parts.length < 3 || parts.length > 4) {
      throw new Error(`a claim is 'kind:match:expect[:step]', got ${JSON.stringify(input)}`)
    }
    const [kind, matchText, expect, step] = parts
    if (!INTENT_KINDS.includes(kind)) throw new Error(`unknown claim kind ${JSON.stringify(kind)}`)
    if (!INTENT_EXPECTS.includes(expect)) throw new Error(`unknown claim expectation ${JSON.stringify(expect)}`)
    const match = matchText === "" ? {} : normalizeMatch(kind === "network" ? { destination: matchText } : { ancestry: matchText }, kind)
    return {
      id: `${kind}:${matchText}:${expect}`,
      kind,
      match,
      expect,
      steps: typeof step === "string" && step !== "" ? [step] : [],
      source: "cli",
    }
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("a claim is a string or an object")
  }
  const kind = input.kind
  const expect = input.expect
  if (!INTENT_KINDS.includes(kind)) throw new Error(`unknown claim kind ${JSON.stringify(kind)}`)
  if (!INTENT_EXPECTS.includes(expect)) throw new Error(`unknown claim expectation ${JSON.stringify(expect)}`)
  const match = normalizeMatch(input.match ?? {}, kind)
  const steps = Array.isArray(input.steps)
    ? input.steps.filter((step) => typeof step === "string" && step !== "")
    : []
  const id = typeof input.id === "string" && input.id !== ""
    ? input.id
    : `${kind}:${match.destination ?? match.ancestry ?? ""}:${expect}`
  const source = typeof input.source === "string" && input.source !== "" ? input.source : "declared"
  return { id, kind, match, expect, steps, source }
}

function destinationMatches(name, pattern) {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2)
    return name === suffix || name.endsWith(`.${suffix}`)
  }
  return name === pattern
}

function entryMatches(entry, claim) {
  if (claim.kind === "network") {
    return typeof claim.match.destination === "string" && destinationMatches(entry.destination, claim.match.destination)
  }
  if (typeof claim.match.ancestry !== "string") return false
  return entry.ancestry.join(" → ").includes(claim.match.ancestry)
}

function scopedEntries(index, steps) {
  if (steps === null) return [...index.values()].flat()
  return steps.flatMap((step) => index.get(step) ?? [])
}

function matchedValues(index, steps, claim) {
  const seen = new Set()
  for (const entry of scopedEntries(index, steps)) {
    if (!entryMatches(entry, claim)) continue
    seen.add(claim.kind === "network" ? entry.destination : entry.ancestry.join(" → "))
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
}

/** Destination or ancestry rows the scoped delta reports on one side only. */
function scopedDeltaRows(baseIndex, headIndex, scopeSteps) {
  const rows = []
  const steps = scopeSteps === null ? [...new Set([...baseIndex.keys(), ...headIndex.keys()])] : scopeSteps
  for (const step of steps) {
    const before = scopedEntries(baseIndex, [step])
    const after = scopedEntries(headIndex, [step])
    const beforeDestinations = new Set(before.map((entry) => entry.destination))
    const afterDestinations = new Set(after.map((entry) => entry.destination))
    for (const entry of after) {
      if (entry.destination !== "" && !beforeDestinations.has(entry.destination)) {
        rows.push({ side: "added", destination: entry.destination, step })
      }
    }
    for (const entry of before) {
      if (entry.destination !== "" && !afterDestinations.has(entry.destination)) {
        rows.push({ side: "removed", destination: entry.destination, step })
      }
    }
    const beforeAncestries = new Set(before.map((entry) => entry.ancestry.join(" → ")))
    const afterAncestries = new Set(after.map((entry) => entry.ancestry.join(" → ")))
    for (const entry of after) {
      const ancestry = entry.ancestry.join(" → ")
      if (ancestry !== "" && !beforeAncestries.has(ancestry)) {
        rows.push({ side: "added", ancestry, step })
      }
    }
    for (const entry of before) {
      const ancestry = entry.ancestry.join(" → ")
      if (ancestry !== "" && !afterAncestries.has(ancestry)) {
        rows.push({ side: "removed", ancestry, step })
      }
    }
  }
  return rows
}

function rowCovered(row, claims, scopeSteps) {
  return claims.some((claim) => {
    if (claim.match.destination === undefined && claim.match.ancestry === undefined) return false
    const claimSteps = claim.steps.length > 0 ? claim.steps : scopeSteps
    if (claimSteps !== null && !claimSteps.includes(row.step)) return false
    if (row.destination !== undefined && claim.kind === "network") {
      return typeof claim.match.destination === "string" && destinationMatches(row.destination, claim.match.destination)
    }
    if (row.ancestry !== undefined && claim.kind === "process") {
      return typeof claim.match.ancestry === "string" && row.ancestry.includes(claim.match.ancestry)
    }
    return false
  })
}

/**
 * Evaluate declared claims against base and head records (records already
 * normalized by lib/profile-diff.mjs — objects with an `egress` array whose
 * entries carry `name`, `ancestry`, and `step`).
 * @param {{base: Record<string, any>|null, head: Record<string, any>|null,
 *   claims: Array<string|Record<string, any>>, steps?: string[]|null,
 *   capture?: {status?: string}|null}} input
 * @returns {{outcome: string, steps: string[], claims: Array<Record<string, any>>,
 *   uncovered: {added: Array<Record<string, any>>, removed: Array<Record<string, any>>},
 *   stepsMissing: {base: string[], head: string[]}}}
 */
export function evaluateClaims({ base = null, head = null, claims = [], steps = null, capture = null } = {}) {
  const parsed = claims.map((claim) => parseClaim(claim))
  const declared = Array.isArray(steps) ? steps.filter((step) => typeof step === "string" && step !== "") : null
  const scopeSteps = declared !== null
    ? declared
    : [...new Set(parsed.flatMap((claim) => claim.steps))]
  const scope = scopeSteps.length > 0 ? scopeSteps : null
  const baseIndex = stepEntries(base)
  const headIndex = stepEntries(head)
  const stepsMissing = {
    base: scope === null || base === null ? [] : scope.filter((step) => !baseIndex.has(step)),
    head: scope === null || head === null ? [] : scope.filter((step) => !headIndex.has(step)),
  }
  const captureComplete = capture !== null && capture !== undefined && capture.status === "complete"

  const evaluated = parsed.map((claim) => {
    const row = { ...claim, before: [], after: [] }
    if (base === null || head === null) {
      return { ...row, outcome: "undeterminable", reason: base === null ? "no base record" : "no head record" }
    }
    if (!captureComplete) {
      const status = capture === null || capture === undefined ? "not-declared" : String(capture.status ?? "not-declared")
      return { ...row, outcome: "undeterminable", reason: `capture is ${status}, not complete` }
    }
    const claimSteps = claim.steps.length > 0 ? claim.steps : scope
    if (claimSteps !== null) {
      const missingBase = claimSteps.filter((step) => !baseIndex.has(step))
      const missingHead = claimSteps.filter((step) => !headIndex.has(step))
      if (missingBase.length > 0 || missingHead.length > 0) {
        const parts = [
          ...(missingBase.length > 0 ? [`step ${missingBase.map((step) => `"${step}"`).join(", ")} missing from the base record`] : []),
          ...(missingHead.length > 0 ? [`step ${missingHead.map((step) => `"${step}"`).join(", ")} missing from the head record`] : []),
        ]
        return { ...row, outcome: "undeterminable", reason: parts.join("; ") }
      }
    }
    const before = matchedValues(baseIndex, claimSteps, claim)
    const after = matchedValues(headIndex, claimSteps, claim)
    row.before = before
    row.after = after
    if (claim.expect === "no-added" || claim.expect === "no-removed") {
      const rows = scopedDeltaRows(baseIndex, headIndex, claimSteps)
      const offending = rows.filter((delta) => delta.side === (claim.expect === "no-added" ? "added" : "removed"))
      if (claim.expect === "no-added") row.after = offending.map((delta) => delta.destination ?? delta.ancestry)
      else row.before = offending.map((delta) => delta.destination ?? delta.ancestry)
      return { ...row, outcome: offending.length === 0 ? "supported" : "contradicted" }
    }
    const presentBefore = before.length > 0
    const presentAfter = after.length > 0
    if (!presentBefore && !presentAfter
      && (claim.expect === "present-before-absent-after" || claim.expect === "absent-before-present-after")) {
      return { ...row, outcome: "unobservable", reason: "matched behaviour recorded on neither side" }
    }
    const holds = claim.expect === "present-before-absent-after" ? presentBefore && !presentAfter
      : claim.expect === "absent-before-present-after" ? !presentBefore && presentAfter
      : claim.expect === "present-both" ? presentBefore && presentAfter
      : !presentBefore && !presentAfter
    return { ...row, outcome: holds ? "supported" : "contradicted" }
  })

  const rows = scopedDeltaRows(baseIndex, headIndex, scope)
  const uncovered = {
    added: rows.filter((row) => row.side === "added" && !rowCovered(row, evaluated, scope)),
    removed: rows.filter((row) => row.side === "removed" && !rowCovered(row, evaluated, scope)),
  }
  return {
    outcome: aggregateIntent({ claims: evaluated, uncovered }),
    steps: scope ?? [],
    claims: evaluated,
    uncovered,
    stepsMissing,
  }
}

/**
 * Aggregate evaluated claims into the intent block's outcome.
 * @param {{claims: Array<Record<string, any>>, uncovered: {added: Array<Record<string, any>>, removed: Array<Record<string, any>>}}} input
 * @returns {"supported"|"contradicted"|"needs-explanation"|"undeterminable"}
 */
export function aggregateIntent({ claims = [], uncovered = { added: [], removed: [] } } = {}) {
  if (claims.length === 0) return "undeterminable"
  if (claims.some((claim) => claim.outcome === "contradicted")) return "contradicted"
  if (claims.some((claim) => claim.outcome === "undeterminable" || claim.outcome === "unobservable")) {
    return "undeterminable"
  }
  return uncovered.added.length === 0 && uncovered.removed.length === 0 ? "supported" : "needs-explanation"
}
