/** Review classification is separate from the App's recorded comparison. */
import { createHash } from "node:crypto"
import { appResult, parsePrUrl, parseReceipt } from "./receipt.mjs"

const SHA = /^[0-9a-f]{40}$/
const ASSESSMENTS = new Set(["finding", "noise", "constructed"])

/** Bind an operator assessment to the exact receipt, including jobs and run links. */
export function receiptFingerprint(body) {
  return createHash("sha256").update(typeof body === "string" ? body : "").digest("hex")
}

/**
 * Fail closed on stale/incomplete evidence. A new host alone is a review lead,
 * not a finding. Noise is assessed per receipt, never by a hostname allowlist.
 * @param {{comment?: object|null, headSha?: string|null, assessment?: object|null, verification?: object|null}} input
 * @returns {object}
 */
export function triageRecord({ comment = null, headSha = null, assessment = null, verification = null } = {}) {
  const body = typeof comment?.body === "string" ? comment.body : ""
  const receipt = parseReceipt(body)
  const summary = receipt.summary
  const app = appResult(summary, body)
  const fingerprint = receiptFingerprint(body)
  const prUrl = canonicalPrUrl(comment?.html_url)
  const result = (classification, reason, evidence = []) => ({
    classification, reason, evidence, fingerprint,
    app_result: app?.result ?? null,
    capture: app?.capture ?? "not declared",
    shareable: ["finding", "quiet-control"].includes(classification) && verification?.status === "PASS"
      && verification?.head === headSha && prUrl !== null && canonicalPrUrl(verification?.pr_url) === prUrl,
  })
  if (comment?.user?.login !== "garnet-runtime-review[bot]") return result("undeterminable", "No trusted App receipt.")
  if (typeof headSha !== "string" || !SHA.test(headSha) || receipt.markerCommit !== headSha
    || summary?.commit !== headSha) return result("undeterminable", "No finalized receipt bound to the current head.")
  if (receipt.final !== true || summary.status !== "finalized" || !["complete", "best-effort"].includes(app?.capture)
    || summary.incomplete !== 0 || !Number.isInteger(summary.jobs) || summary.jobs < 1
    || !Number.isInteger(summary.changed) || summary.changed < 0 || summary.changed > summary.jobs) {
    return result("undeterminable", "Capture is missing, undeclared, pending, or incomplete.")
  }
  if (verification !== null && (verification.legs ?? []).some((leg) => leg.ok !== true
    && ["head-bound", "capture completeness", "comment finalized", "public profile identity", "sensor coverage"].includes(leg.name))) {
    return result("undeterminable", "Live verification could not bind usable capture to this comparison.")
  }
  if (summary.previous === null || summary.previous === undefined || summary.outcome === "first") {
    return result("recorded", "First record; no comparison establishes new behavior.")
  }
  if (typeof summary.previous !== "string" || !SHA.test(summary.previous) || typeof summary.scope !== "string"
    || summary.scope === "" || summary.trimmed === true || (Number.isInteger(summary.unattributed) && summary.unattributed > 0)) {
    return result("undeterminable", "Comparison identity or changed-row detail is incomplete.")
  }
  // Fold counts are a cross-check, not a second source of comparison truth.
  if (app.perJob.length !== summary.jobs) return result("undeterminable", "Not every recorded job has a readable App row.")
  if (app.perJob.filter((job) => job.outcome === "changed" && job.added > 0).length !== summary.changed) {
    return result("undeterminable", "The App summary and job rows disagree on changed jobs.")
  }
  if (app.result === "nothing new" && summary.changed === 0
    && app.perJob.every((job) => job.outcome === "nothing new")) {
    if (summary.vanished > 0 || app.removedJobs.length > 0) {
      return result("recorded", "Job coverage shrank; quiet remaining jobs do not establish a control.")
    }
    return result("quiet-control", "Nothing new in the recorded jobs; capture remains " + app.capture + ".")
  }
  if (app.result !== "changed") return result("undeterminable", "The App has no usable comparison outcome.")
  if (summary.changed === 0) return result("recorded", "Job coverage changed; no compared job recorded new behavior.")
  if (assessment === null) return result("needs-review", "Changed destinations need workload, baseline, and source attribution.")
  if (assessment.fingerprint !== fingerprint || assessment.head !== headSha
    || assessment.previous !== summary.previous || assessment.scope !== summary.scope) {
    return result("needs-review", "The assessment belongs to a different receipt; review this recording again.")
  }
  if (!ASSESSMENTS.has(assessment.classification) || typeof assessment.reason !== "string" || assessment.reason.trim() === ""
    || !Array.isArray(assessment.evidence) || assessment.evidence.length < 2
    || !assessment.evidence.every((url) => typeof url === "string" && /^https:\/\//.test(url))) {
    return result("needs-review", "An assessment needs a reason and baseline/source evidence links.")
  }
  return result(assessment.classification, assessment.reason, assessment.evidence)
}

/** Historical snapshots cannot establish current-head findings or quiet controls. */
export function triageSnapshot(diff) {
  return {
    transition: diff?.pair?.transition ?? null,
    classification: diff?.label === "constructed" ? "constructed" : "undeterminable",
    reason: diff?.label === "constructed" ? "Authored teaching record." : "Saved snapshot; current head and capture have not been revalidated.",
    app_result: diff?.verdict?.value ?? null,
    capture: diff?.capture?.status ?? "not declared",
    shareable: false,
    evidence: [],
  }
}

function canonicalPrUrl(value) {
  try {
    const { owner, repo, number } = parsePrUrl(typeof value === "string" ? value.split("#")[0] : value)
    return `${owner}/${repo}/pull/${number}`.toLowerCase()
  } catch {
    return null
  }
}

/** Counts reconcile to the rows; App changes and findings are different counts. */
export function triageCounts(rows) {
  const counts = {}
  for (const row of rows) {
    const key = row.triage?.classification ?? "undeterminable"
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function cell(value) {
  return String(value ?? "—").replace(/[|`\r\n]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Read-only audit output. Raw receipts remain linked, never edited or suppressed. */
export function renderTriage(rows) {
  const counts = triageCounts(rows)
  const lines = ["# Record triage", "", `${rows.length} records: ${Object.entries(counts).map(([key, count]) => `${count} ${key}`).join(", ")}.`, "",
    "Review assessments retain the App result and capture limits. Re-run verify before sharing a finding or control.", ""]
  for (const row of rows) {
    const label = row.fork_pr.replace("https://github.com/garnet-labs/", "").replace("/pull/", " pull ")
    lines.push("<details>", `<summary><b>${cell(label)}</b> · ${cell(row.triage.classification)}</summary>`, "",
      `[App record](${row.links?.app_comment ?? row.fork_pr})`, "",
      `**App:** ${cell(row.app_line ?? row.triage.app_result)}<br>`,
      `**Capture:** ${cell(row.triage.capture)} · **Verify:** ${cell(row.verify?.status ?? "not run")}`, "",
      cell(row.triage.reason), "",
      `- Head: \`${cell(row.head_sha ?? "unknown")}\``,
      `- Compared: \`${cell(row.compared_sha ?? "none")}\``,
      `- Transition: ${cell(row.transition ?? "not derivable from the record")}`,
      `- Scope: ${cell(row.scope ?? "unavailable")}`,
      ...row.triage.evidence.map((url, index) => `- [Assessment source ${index + 1}](${url})`),
      "", "</details>", "")
  }
  return lines.join("\n") + "\n"
}
