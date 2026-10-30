import { ghJson, run, forkDefaultBranch } from "./gh.mjs"
import { groundingAt, ground } from "./ground.mjs"
import { listTargets, loadTarget } from "./ledger.mjs"
import { GARNET_ACTION_PIN, GARNET_ACTION_PIN_LABEL, actionWorkflowBodies, isExcludedRepinPath, repinActionRef, workflowBodiesAt } from "./replay-pr.mjs"
import { repin } from "./commands.mjs"

/** Workflows whose latest completed run is a fleet health signal. */
export const FLEET_GATES = Object.freeze(["merge-gate.yml", "garnet-evidence-gate.yml", "garnet-dependabot-record.yml"])

/**
 * Drift for one fork: what `--apply` repairs and what needs a person.
 * @param {{pinBehind: string[], kit: "grounded"|"missing"|"conflict", gates: Record<string, string|null>}} row
 * @returns {{repair: string[], manual: string[]}}
 */
/** Gates whose `failure` is a fail-closed verdict on one pull request, not a broken gate. */
export const FLEET_VERDICT_GATES = Object.freeze(["merge-gate.yml", "garnet-evidence-gate.yml"])

export function fleetDrift(row) {
  const repair = []
  const manual = []
  if (row.pinBehind.length > 0) repair.push(`pin behind ${GARNET_ACTION_PIN_LABEL}: ${row.pinBehind.join(", ")}`)
  if (row.kit === "missing") repair.push("reviewer kit missing")
  if (row.kit === "conflict") manual.push("reviewer kit conflicts with upstream config")
  for (const [workflow, conclusion] of Object.entries(row.gates)) {
    const healthy = ["success", "neutral", "action_required", ...(FLEET_VERDICT_GATES.includes(workflow) ? ["failure"] : [])]
    if (conclusion !== null && !healthy.includes(conclusion)) manual.push(`${workflow} last run ${conclusion}`)
  }
  return { repair, manual }
}

/**
 * Recording workflows on the default branch that are not on the harness pin.
 * @param {Record<string, string>} bodies workflow path → contents
 * @returns {string[]}
 */
export function pinBehind(bodies) {
  return Object.entries(actionWorkflowBodies(bodies))
    .filter(([path]) => !isExcludedRepinPath(path))
    .filter(([, body]) => repinActionRef(body).before.some((ref) => ref !== GARNET_ACTION_PIN))
    .map(([path]) => path.replace(".github/workflows/", ""))
}

/**
 * @param {string} fork
 * @param {string} workflow
 * @param {{exec?: typeof run}} [options]
 * @returns {string|null} latest completed run conclusion, null when it never ran, "unreadable" when the API read failed
 */
export function latestConclusion(fork, workflow, { exec = run } = {}) {
  try {
    const runs = ghJson(["api", `repos/${fork}/actions/workflows/${workflow}/runs?status=completed&per_page=5`], { exec })
    const done = (runs.workflow_runs ?? []).filter((entry) => entry.conclusion !== "skipped" && entry.conclusion !== "cancelled")
    return done.length === 0 ? null : String(done[0].conclusion)
  } catch {
    return "unreadable"
  }
}

/**
 * replay fleet [--apply] [--json]: pin, reviewer kit and gate health on every target fork.
 * Exits non-zero while any fork needs repair or a person.
 */
export async function fleet(args, { exec = run, log = console.log, doRepin = repin, doGround = ground } = {}) {
  const apply = args.includes("--apply")
  const progress = args.includes("--json") ? (...parts) => process.stderr.write(`${parts.join(" ")}\n`) : log
  const rows = []
  for (const slug of listTargets()) {
    const target = loadTarget(slug)
    if (typeof target.fork !== "string") continue
    const branch = forkDefaultBranch(target.fork, { exec })
    const bodies = workflowBodiesAt(target.fork, branch, { exec }).bodies
    if (Object.keys(actionWorkflowBodies(bodies)).length === 0) continue
    const state = groundingAt(target.fork, null, { exec })
    const row = {
      slug, fork: target.fork, branch,
      pinBehind: pinBehind(bodies),
      kit: state.grounded ? "grounded" : state.conflict ? "conflict" : "missing",
      gates: Object.fromEntries(FLEET_GATES.filter((name) => bodies[`.github/workflows/${name}`] !== undefined).map((name) => [name, latestConclusion(target.fork, name, { exec })])),
    }
    let drift = fleetDrift(row)
    if (apply && drift.repair.length > 0) {
      try {
        if (row.pinBehind.length > 0) await doRepin([slug], { exec, log: progress })
        if (row.kit === "missing") await doGround([slug], { exec, log: progress })
        const pending = row.kit === "missing" ? ["reviewer kit onboarding PR awaits merge"] : []
        drift = { repair: [], manual: [...drift.manual, ...pending], repaired: drift.repair }
      } catch (error) {
        drift = { repair: drift.repair, manual: [...drift.manual, `repair failed: ${String(error.message ?? error).split("\n")[0]}`] }
      }
    }
    rows.push({ ...row, ...drift })
  }
  if (args.includes("--json")) log(JSON.stringify(rows, null, 2))
  else {
    log(`fleet · ${rows.length} forks · garnet-org/action@${GARNET_ACTION_PIN.slice(0, 12)} (${GARNET_ACTION_PIN_LABEL})`)
    for (const row of rows) {
      const status = row.manual.length > 0 ? "NEEDS YOU" : row.repair.length > 0 ? "DRIFT" : "ok"
      log(`${status.padEnd(9)} ${row.fork} · pin ${row.pinBehind.length === 0 ? "current" : "behind"} · kit ${row.kit}${[...(row.repaired ?? []).map((x) => `fixed: ${x}`), ...row.repair, ...row.manual].map((x) => `\n          ${x}`).join("")}`)
    }
  }
  return rows
}

/** @param {{repair: string[], manual: string[]}[]} rows */
export function fleetExitCode(rows) {
  return rows.some((row) => row.manual.length > 0 || row.repair.length > 0) ? 1 : 0
}
