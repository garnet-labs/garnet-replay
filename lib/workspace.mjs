import { targetView } from "./status.mjs"

const KINDS = [
  { key: "network", recorded: "network", title: "Outbound connections" },
  { key: "processes", recorded: "process", title: "Process observations" },
  { key: "files", recorded: "file", title: "File observations" },
]

/** Project one schema-validated saved artifact without changing its evidence. */
export function workspaceRecord(diff, id) {
  const groups = ["workload", "runner background"].map((section) => ({
    section,
    kinds: KINDS.map((kind) => ({
      ...kind,
      recorded: diff.execution_diff.kinds_recorded.includes(kind.recorded),
      added: diff.execution_diff[`${kind.key}_added`].filter((entry) => entry.section === section),
      removed: diff.execution_diff[`${kind.key}_removed`].filter((entry) => entry.section === section),
    })),
  }))
  const reasons = []
  if (["none", "partial"].includes(diff.capture.status)) reasons.push(`Capture is ${diff.capture.status}.`)
  if (diff.capture.expected_cells !== null && (
    diff.capture.recorded_cells !== diff.capture.expected_cells
    || diff.capture.executed_sha_verified !== diff.capture.expected_cells
  )) reasons.push("The declared cells do not all carry matching executed SHAs and records.")
  if (diff.capture.recorded_cells === 0) reasons.push("No cells were recorded.")
  if (diff.capture.lineage_missing !== null && diff.capture.lineage_missing > 0) reasons.push("Some execution lineage is missing.")
  if (diff.capture.final_record === false) reasons.push("The saved record is not final.")
  if (diff.supersession.superseded === true) reasons.push(...diff.supersession.reasons, "The saved pair is superseded.")
  if (diff.head.sha === null || diff.pair.head_sha !== diff.head.sha
    || diff.pair.base_sha !== diff.base.sha || diff.pair.scope !== diff.comparison.scope
    || diff.supersession.record_head !== diff.head.sha
    || (diff.supersession.current_head !== null && diff.supersession.current_head !== diff.head.sha)
    || (diff.comparison.available && (diff.base.sha === null || diff.comparison.scope === "unavailable"))) {
    reasons.push("The saved comparison identities do not agree.")
  }
  if (groups.some((group) => group.kinds.some((kind) => !kind.recorded && kind.added.length + kind.removed.length > 0))) {
    reasons.push("Some observations have no declared recorded kind.")
  }
  if (diff.comparison.available !== true && ["new-behavior", "unchanged"].includes(diff.verdict.value)) {
    reasons.push("A comparison verdict requires both sides.")
  }
  const verdict = reasons.length > 0 ? "undeterminable" : diff.verdict.value
  const observations = groups.map((group) => {
    const added = group.kinds.reduce((total, kind) => total + kind.added.length, 0)
    const removed = group.kinds.reduce((total, kind) => total + kind.removed.length, 0)
    return `${group.section}: +${added} / −${removed}`
  }).join(" · ")
  return {
    id,
    repository: `${diff.repo.owner}/${diff.repo.name}`,
    number: diff.pull_request.number,
    title: diff.pull_request.title,
    url: diff.pull_request.url,
    label: diff.label ?? diff.pair.label,
    recordedAt: diff.recorded.at,
    verdict,
    reasons: [...reasons, `Recorded observations · ${observations}`],
    capture: diff.capture.status,
    head: diff.head.sha,
    base: diff.base.sha,
    groups,
    artifact: diff,
  }
}

/** Catalog rows exclude detailed evidence, which is loaded on selection. */
export function recordSummary(record) {
  const { artifact, groups, reasons, ...summary } = record
  return summary
}

/** Preserve all ledger rows alongside the CLI's canonical stage projection. */
export function workspaceTarget(target) {
  if (typeof target?.slug !== "string" || typeof target.fork !== "string" || typeof target.upstream !== "string"
    || !Array.isArray(target.observations) || !Array.isArray(target.replays)) {
    throw new Error("Target needs a slug, fork, observations, and replays.")
  }
  for (const key of ["observations", "replays", "evidence", "cohorts", "consumption"]) {
    if (target[key] !== undefined && (!Array.isArray(target[key])
      || target[key].some((row) => row === null || typeof row !== "object" || Array.isArray(row)))) {
      throw new Error(`Target ${key} must contain object rows.`)
    }
  }
  return { ...target, view: targetView(target) }
}
