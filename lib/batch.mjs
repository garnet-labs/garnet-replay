/**
 * Batch orchestration for fork-scoped replay targets.
 *
 * The batch runner deliberately keeps each command in a child process. The
 * existing commands use synchronous git/GitHub calls, while a batch must keep
 * unrelated forks moving without sharing mutable command state.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, appendFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { run as ghRun } from "./gh.mjs"
import { assertForkTarget, assertRepoSlug, assertSlug, assertNoUpstreamLeak, assertVocabClean } from "./guards.mjs"
import { loadTarget, targetPath, OUT_DIR } from "./ledger.mjs"
import { rankObservations, recommend } from "./observe.mjs"
import { GARNET_ACTION_PIN, GARNET_ACTION_PIN_LABEL, isExcludedRepinPath, planRepin, recordingWorkflowsAt, workDirFor } from "./replay-pr.mjs"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const KNOWN_PRODUCT_LEGS = Object.freeze(["capture completeness", "public profile identity"])
const DEFAULT_WAIT_MINUTES = 45

function tail(value, width = 500) {
  const text = String(value ?? "").trim()
  return text.length <= width ? text : text.slice(-width)
}

function infraReasonKey(reason) {
  return String(reason ?? "").replace(/no push access to \S+ \(HTTP 403\)/, "no push access (HTTP 403)")
}

function parsePositiveInteger(value, name, { allowZero = false } = {}) {
  const number = Number(value)
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number < 1)) {
    throw new Error(`${name} must be an integer ${allowZero ? "at least 0" : "greater than 0"}`)
  }
  return number
}

function repoName(upstream) {
  return upstream.split("/")[1]
}

function normalizeRecord(record) {
  if (record === null || record === undefined) return null
  if (typeof record !== "object" || Array.isArray(record)) throw new Error("record must be an object")
  const mode = record.mode
  const job = record.job
  if (mode !== "instrument" || typeof job !== "string" || job === "") {
    throw new Error("record requires mode instrument and a non-empty job")
  }
  return { mode, job }
}

function normalizeFind(find) {
  if (find === null || find === undefined) return {}
  if (typeof find !== "object" || Array.isArray(find)) throw new Error("find must be an object")
  const normalized = {}
  for (const key of ["author", "search"]) {
    if (find[key] !== undefined && (typeof find[key] !== "string" || find[key] === "")) throw new Error(`find.${key} must be a non-empty string`)
    if (typeof find[key] === "string") normalized[key] = find[key]
  }
  if (find.limit !== undefined) normalized.limit = parsePositiveInteger(find.limit, "find.limit")
  if (find.paths !== undefined) {
    if (!Array.isArray(find.paths) || find.paths.some((path) => typeof path !== "string" || path === "")) throw new Error("find.paths must be a string array")
    normalized.paths = [...find.paths]
  }
  return normalized
}

function normalizeRow(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("target row must be an object")
  const slug = assertSlug(raw.slug)
  const blocked = raw.blocked === null || raw.blocked === undefined ? null : raw.blocked
  if (blocked !== null && (typeof blocked !== "string" || blocked === "")) throw new Error("blocked must be a non-empty string")
  let upstream = null
  let fork = null
  if (raw.upstream !== null && raw.upstream !== undefined) {
    upstream = assertRepoSlug(raw.upstream)
    fork = raw.fork === null || raw.fork === undefined ? `garnet-labs/${repoName(upstream)}` : assertRepoSlug(raw.fork)
    assertForkTarget(fork, fork)
    if (fork.split("/")[0].toLowerCase() !== "garnet-labs") throw new Error("fork must belong to garnet-labs")
  } else if (blocked === null) {
    throw new Error("upstream is required unless target is blocked")
  } else if (raw.fork !== null && raw.fork !== undefined) {
    throw new Error("blocked target with no upstream cannot declare a fork")
  }
  let pr = null
  if (raw.pr !== null && raw.pr !== undefined) pr = parsePositiveInteger(raw.pr, "pr")
  const find = normalizeFind(raw.find)
  const record = normalizeRecord(raw.record)
  const liveArgs = raw.liveArgs === null || raw.liveArgs === undefined ? [] : raw.liveArgs
  if (!Array.isArray(liveArgs) || liveArgs.some((arg) => typeof arg !== "string" || arg === "")) throw new Error("liveArgs must be a string array")
  const work = raw.work === null || raw.work === undefined
    ? (upstream === null ? join(homedir(), "work", slug) : workDirFor(slug))
    : raw.work
  if (typeof work !== "string" || work === "") throw new Error("work must be a non-empty string")
  const expandedWork = work === "~" ? homedir() : work.startsWith("~/") ? join(homedir(), work.slice(2)) : work
  return { slug, upstream, fork, pr, find, record, work: resolve(expandedWork), liveArgs: [...liveArgs], blocked }
}

/**
 * Validate every row while allowing malformed rows to continue as board
 * entries. Structural errors in the targets document itself still fail closed.
 * @param {unknown} document
 * @returns {{name: string, rows: object[]}}
 */
export function validateTargets(document) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) throw new Error("targets file must be an object")
  if (typeof document.name !== "string" || document.name === "") throw new Error("targets file requires a name")
  if (!Array.isArray(document.targets)) throw new Error("targets file requires a targets array")
  const rows = document.targets.map((raw) => {
    try {
      return { ...normalizeRow(raw), validation: null }
    } catch (error) {
      const slug = typeof raw?.slug === "string" ? raw.slug : `row-${document.targets.indexOf(raw) + 1}`
      return {
        slug,
        upstream: typeof raw?.upstream === "string" ? raw.upstream : null,
        fork: typeof raw?.fork === "string" ? raw.fork : null,
        pr: null,
        onboardingPr: null,
        replayPr: null,
        work: null,
        find: {},
        record: null,
        liveArgs: [],
        blocked: null,
        validation: String(error.message),
      }
    }
  })
  return { name: document.name, rows }
}

/**
 * Group valid rows by fork and reject duplicate slugs or shared checkouts
 * across different forks.
 * @param {object[]} rows
 * @returns {{groups: {fork: string, rows: object[]}[], rejected: object[]}}
 */
export function planGroups(rows) {
  const rejected = []
  const groups = new Map()
  const slugCounts = new Map()
  for (const row of rows) {
    if (typeof row.slug !== "string" || row.slug === "") continue
    const key = row.slug.toLowerCase()
    slugCounts.set(key, (slugCounts.get(key) ?? 0) + 1)
  }
  for (const row of rows) {
    if (row.validation !== null) continue
    if ((slugCounts.get(row.slug.toLowerCase()) ?? 0) > 1) {
      rejected.push({ ...row, validation: "duplicate-slug" })
      continue
    }
    if (row.blocked !== null || row.fork === null) continue
    const key = row.fork.toLowerCase()
    if (!groups.has(key)) groups.set(key, { fork: row.fork, rows: [] })
    groups.get(key).rows.push(row)
  }
  const workOwners = new Map()
  for (const group of groups.values()) {
    for (const row of group.rows) {
      const work = row.work.toLowerCase()
      if (!workOwners.has(work)) workOwners.set(work, [])
      workOwners.get(work).push({ row, group })
    }
  }
  const sharedWork = new Set()
  for (const [work, owners] of workOwners) {
    if (new Set(owners.map((owner) => owner.group)).size > 1) {
      sharedWork.add(work)
      for (const owner of owners) rejected.push({ ...owner.row, validation: "shared-checkout" })
    }
  }
  const filteredGroups = [...groups.values()].map((group) => ({
    ...group,
    rows: group.rows.filter((row) => !sharedWork.has(row.work.toLowerCase())),
  })).filter((group) => group.rows.length > 0)
  return { groups: filteredGroups, rejected }
}

function selectedObservation(target) {
  const observations = Array.isArray(target?.observations) ? target.observations : []
  const replays = new Set((Array.isArray(target?.replays) ? target.replays : []).map((row) => Number(row.upstreamPr)))
  const eligible = observations.filter((row) => !replays.has(Number(row.upstreamPr)))
  if (eligible.length === 0) return null
  return recommend(rankObservations(eligible), target?.workload ?? null)
}

/**
 * Pure state-machine decision for one target.
 * @param {object} row
 * @param {object} facts
 * @returns {object}
 */
export function nextAction(row, facts) {
  if (row.validation !== null) return { stage: "validate", action: "terminal", state: "invalid", reason: row.validation }
  if (row.blocked !== null) return { stage: "validate", action: "terminal", state: "blocked", reason: row.blocked }
  if (facts.findFailed === true) return { stage: "find", action: "terminal", state: "find-failed", reason: facts.reason ?? "find failed" }
  if ((facts.ledgerExists !== true || facts.upstreamPr === null) && facts.dryRunMissingCandidate !== true) {
    if (facts.findChecked === true && facts.upstreamPr === null) return { stage: "find", action: "terminal", state: "no-candidate", reason: "no eligible upstream change" }
    return { stage: "find", action: "find", reason: "target ledger or candidate is missing" }
  }
  if (facts.forkExists !== true) {
    if (facts.forkFailed === true) return { stage: "fork", action: "terminal", state: "blocked-infra", reason: facts.reason ?? "fork unavailable" }
    return { stage: "fork", action: "fork", reason: "fork is not available" }
  }
  if (facts.writeProbed !== true) {
    if (facts.writeFailed === true) return { stage: "write", action: "terminal", state: "blocked-infra", reason: facts.reason ?? `no push access to ${row.fork} (HTTP 403)` }
    return { stage: "write", action: "probe", reason: "fork write access is unknown" }
  }
  if (facts.refreshFailed === true) return { stage: "refresh", action: "terminal", state: "blocked-infra", reason: facts.reason ?? "fork freshness unknown" }
  if (facts.refreshChecked !== true) return { stage: "refresh", action: "compare", reason: "check fork freshness" }
  if (facts.refreshRunFailed === true) return { stage: "refresh", action: "terminal", state: "blocked-infra", reason: facts.reason ?? "fork refresh failed" }
  if (facts.setupNothing === true) {
    // Continue below to the live stage after the dry-run has established the
    // recorder is already present.
  } else if (facts.setupChecked !== true) {
    return { stage: "setup", action: "dry-run", reason: "re-check recorder plan" }
  } else if (facts.setupPrState === "merged") {
    return { stage: "setup", action: "terminal", state: "onboarding-merged-but-no-recorder", reason: "onboarding PR is merged but setup still plans changes" }
  } else if (facts.setupPrState === "open") {
    return { stage: "setup", action: "terminal", state: "awaiting-onboarding-merge", reason: facts.setupPrUrl ?? "onboarding pull request is open" }
  } else if (facts.setupPrState === "closed") {
    return { stage: "setup", action: "terminal", state: "onboarding-closed", reason: "onboarding pull request closed without merging" }
  } else if (facts.setupPrState === "unknown") {
    return { stage: "setup", action: "terminal", state: "blocked-infra", reason: facts.reason ?? "onboarding pull request state is unavailable" }
  } else if (facts.setupNeedsRecord === true) {
    return { stage: "setup", action: "terminal", state: "needs-record-job", reason: "setup requires an explicit recorder job" }
  } else if (facts.setupChecked === true && facts.setupNothing !== true && facts.setupDone !== true && facts.dryRun === true) {
    return { stage: "setup", action: "terminal", state: "awaiting-onboarding-merge", reason: "onboarding must be merged before repin" }
  } else if (facts.setupDone !== true) {
    return { stage: "setup", action: "real", reason: "onboarding recorder is needed" }
  }
  if (facts.repinFailed === true) return { stage: "repin", action: "terminal", state: "blocked-infra", reason: facts.reason ?? "repin failed" }
  if (facts.repinChecked !== true) return { stage: "repin", action: "inspect", reason: "check fork action pin" }
  if (facts.replayDone === true) {
    // Existing recorded replay rows still need a fresh verify.
  } else if (facts.liveRefused === true) {
    return { stage: "live", action: "terminal", state: "live-refused", reason: facts.reason ?? "live dry-run refused" }
  } else if (facts.liveFailed === true) {
    return { stage: "live", action: "terminal", state: "live-failed", reason: facts.reason ?? "live failed" }
  } else if (facts.liveDryRunChecked !== true) {
    return { stage: "live", action: "dry-run", reason: "check live plan and recorder health" }
  } else if (facts.liveExecuted !== true) {
    return { stage: "live", action: "real", reason: "live plan is safe" }
  }
  if (facts.verifyResult === null || facts.verifyResult === undefined) return { stage: "verify", action: "verify", reason: "verify external state" }
  const result = facts.verifyResult
  if (result.receipt?.noProfile === true) {
    return { stage: "verify", action: "terminal", state: "not-recorded", reason: "the final App comment says not recorded" }
  }
  if (result.pending === true || result.status === "PENDING" || result.commentMissing === true || result.finalized === false) {
    return { stage: "verify", action: "terminal", state: "awaiting-record", reason: result.reason ?? "record is missing or pending" }
  }
  if (result.status === "PASS") return { stage: "card", action: "card", reason: "verify passed" }
  const failing = Array.isArray(result.legs) ? result.legs.filter((leg) => leg.ok === false).map((leg) => leg.name) : []
  if (failing.length > 0 && failing.every((name) => KNOWN_PRODUCT_LEGS.includes(name))) {
    return { stage: "verify", action: "terminal", state: "fail-product-gates", reason: failing.join(", ") }
  }
  return { stage: "verify", action: "terminal", state: "fail-specimen", reason: failing.join(", ") || "verification failed" }
}

function defaultRunCommand(argv, { cwd, env, logFile }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const log = (chunk) => appendFile(logFile, chunk).catch(() => {})
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      void log(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
      void log(chunk)
    })
    child.on("error", rejectPromise)
    child.on("close", (code) => resolvePromise({ code: Number.isInteger(code) ? code : 1, stdout, stderr }))
  })
}

function readLedgerDefault(slug) {
  if (!existsSync(targetPath(slug))) return null
  return loadTarget(slug)
}

function probeForkDefault(fork, exec, env) {
  try {
    exec("gh", ["api", `repos/${fork}`], { encoding: "utf8", env })
    return true
  } catch {
    return false
  }
}

function probeWriteDefault(row, exec, root, env) {
  const cwd = existsSync(row.work) ? row.work : root
  const probeBranch = `replay-write-probe-${row.slug}`
  try {
    const stdout = exec("git", ["-C", cwd, "push", "--dry-run", `https://github.com/${row.fork}.git`, `HEAD:refs/heads/${probeBranch}`], { encoding: "utf8", env })
    return { ok: true, stdout: redactUrlCredentials(stdout), stderr: "", error: "" }
  } catch (error) {
    const stderr = String(error?.stderr ?? "")
    return {
      ok: false,
      stdout: redactUrlCredentials(error?.stdout ?? ""),
      stderr: redactUrlCredentials(stderr),
      error: redactUrlCredentials(error?.message ?? ""),
    }
  }
}

function forkFreshness(row, exec, env) {
  const upstreamDefault = String(exec("gh", ["api", `repos/${row.upstream}`, "--jq", ".default_branch"], { encoding: "utf8", env })).trim()
  const forkDefault = String(exec("gh", ["api", `repos/${row.fork}`, "--jq", ".default_branch"], { encoding: "utf8", env })).trim()
  if (upstreamDefault === "" || forkDefault === "") throw new Error("default branch is unavailable")
  const compare = exec("gh", ["api", `repos/${row.upstream}/compare/${upstreamDefault}...${row.fork.split("/")[0]}:${forkDefault}`], { encoding: "utf8", env })
  const details = typeof compare === "string" ? JSON.parse(compare) : compare
  if (!Number.isInteger(details?.behind_by) || details.behind_by < 0) throw new Error("compare response has no valid behind_by")
  return { forkBehind: details.behind_by, forkDefault }
}

function actionPinSummary(bodies) {
  const refs = []
  for (const [path, body] of Object.entries(bodies)) {
    if (isExcludedRepinPath(path)) continue
    for (const match of String(body).matchAll(/garnet-org\/action@([^\s"'#]+)(?:[ \t]*#[ \t]*([^\r\n]+))?/g)) {
      const [, ref = "", rawLabel = ""] = match
      const existingLabel = rawLabel.trim().match(/\bv[0-9][A-Za-z0-9.-]*/)
      const label = ref === GARNET_ACTION_PIN ? GARNET_ACTION_PIN_LABEL : existingLabel?.[0] ?? ""
      const value = `${ref.slice(0, 8)}${label === "" ? "" : ` (${label})`}`
      if (!refs.includes(value)) refs.push(value)
    }
  }
  return refs.length === 0 ? "—" : refs.sort().join(", ")
}

function redactUrlCredentials(value) {
  return String(value ?? "").replace(/\b(https?:\/\/)[^/\s@]+@/g, "$1[REDACTED]@")
}

function childArgs(root, command, values) {
  return ["node", join(root, "bin", "replay.mjs"), command, ...values]
}

function recordArgs(row) {
  return row.record === null ? [] : ["--record", row.record.mode, "--job", row.record.job]
}

function parseVerifyOutput(output) {
  const lines = String(output ?? "").trim().split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) throw new Error("verify --json returned no JSON")
  try {
    return JSON.parse(lines.at(-1))
  } catch {
    throw new Error(`verify --json returned invalid JSON: ${tail(output)}`)
  }
}

function forkPrUrl(fork, number) {
  return number === null || number === undefined ? null : `https://github.com/${fork}/pull/${number}`
}

function chosenPr(target, row) {
  if (row.pr !== null) return row.pr
  return selectedObservation(target)?.upstreamPr ?? null
}

async function runTarget(row, options) {
  const { deps, root, logFile, dryRun, waitMinutes } = options
  const result = {
    ...row,
    upstreamPr: row.pr,
    onboardingPr: null,
    replayPr: null,
    state: "not-started",
    stage: "validate",
    reason: null,
    verify: null,
    shareable: false,
    verdict: "undeterminable",
    publicReports: [],
    card: null,
    actionPin: "—",
  }
  if (row.validation !== null || row.blocked !== null) {
    const decision = nextAction(row, {})
    return { ...result, state: decision.state, stage: decision.stage, reason: decision.reason }
  }
  let target = deps.readLedger(row.slug)
  if (target?.setupPr !== null && target?.setupPr !== undefined) result.onboardingPr = forkPrUrl(row.fork, Number(target.setupPr))
  let currentStage = "find"
  const facts = { ledgerExists: target !== null, upstreamPr: chosenPr(target, row), findChecked: false, dryRun }
  if (dryRun && facts.ledgerExists === true && facts.upstreamPr === null) {
    facts.findChecked = true
    facts.dryRunMissingCandidate = true
  }
  const run = async (command, values) => {
    const output = await deps.runCommand(childArgs(root, command, values), { cwd: root, env: options.env, logFile })
    if (output === null || typeof output !== "object" || !Number.isInteger(output.code)) throw new Error(`${command} returned an invalid child result`)
    return output
  }
  try {
    let decision = nextAction(row, facts)
    if (decision.action === "find") {
      currentStage = "find"
      const values = [row.upstream, "--slug", row.slug, "--fork", row.fork]
      if (row.find.author !== undefined) values.push("--author", row.find.author)
      if (row.find.search !== undefined) values.push("--search", row.find.search)
      if (row.find.limit !== undefined) values.push("--limit", String(row.find.limit))
      if (row.find.paths !== undefined) values.push("--paths", row.find.paths.join(","))
      const output = await run("find", values)
      facts.findChecked = true
      facts.findFailed = output.code !== 0
      if (facts.findFailed) facts.reason = tail(output.stderr || output.stdout)
      target = deps.readLedger(row.slug)
      facts.ledgerExists = target !== null
      facts.upstreamPr = chosenPr(target, row)
      if (dryRun && facts.ledgerExists === true && facts.upstreamPr === null) facts.dryRunMissingCandidate = true
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason }
    result.upstreamPr = facts.upstreamPr
    currentStage = "fork"
    facts.forkExists = deps.probeFork(row.fork)
    if (!facts.forkExists) {
      if (dryRun) return { ...result, upstreamPr: facts.upstreamPr, state: "blocked-infra", stage: "fork", reason: `fork unavailable during dry-run: ${row.fork}` }
      const output = await run("fork", [row.upstream])
      if (output.code !== 0) {
        return { ...result, upstreamPr: facts.upstreamPr, state: "blocked-infra", stage: "fork", reason: tail(output.stderr || output.stdout) || `fork unavailable: ${row.fork}` }
      }
      facts.forkExists = true
    }
    decision = nextAction(row, facts)
    currentStage = "write"
    if (decision.action === "probe") {
      let probe
      try {
        probe = deps.probeWrite(row)
      } catch (error) {
        probe = { ok: false, stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? ""), error: String(error?.message ?? "") }
      }
      const probeOutput = [
        probe.stdout ? `write probe stdout:\n${probe.stdout}` : "",
        probe.stderr ? `write probe stderr:\n${probe.stderr}` : "",
      ].filter((part) => part !== "").join("\n")
      if (probeOutput !== "") await appendFile(logFile, `${probeOutput}\n`)
      facts.writeProbed = probe.ok === true
      if (!facts.writeProbed) {
        facts.writeFailed = true
        facts.reason = /\b403\b/.test(String(probe.stderr ?? ""))
          ? `no push access to ${row.fork} (HTTP 403)`
          : `write probe failed for ${row.fork}: ${tail(probe.stderr || probe.error) || "no stderr"}`
      }
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason }
    currentStage = "refresh"
    try {
      const freshness = deps.readForkFreshness === undefined
        ? forkFreshness(row, deps.exec, options.env)
        : deps.readForkFreshness(row)
      facts.forkBehind = freshness.forkBehind
      facts.forkDefault = freshness.forkDefault
      facts.refreshChecked = true
      if (facts.forkBehind > 0) {
        const refreshed = await run("refresh", dryRun ? [row.slug, "--dry-run"] : [row.slug])
        if (!dryRun && refreshed.code !== 0) {
          facts.refreshRunFailed = true
          facts.reason = tail(refreshed.stderr || refreshed.stdout)
        }
      }
    } catch {
      facts.refreshFailed = true
      facts.reason = "fork freshness unknown"
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason }
    currentStage = "setup"
    const setupDry = await run("setup", [row.slug, "--dry-run", "--work", row.work, ...recordArgs(row)])
    facts.setupChecked = true
    facts.setupNothing = /nothing to onboard/i.test(`${setupDry.stdout}\n${setupDry.stderr}`)
    if (setupDry.code !== 0 && !facts.setupNothing) {
      return { ...result, upstreamPr: facts.upstreamPr, state: "setup-failed", stage: "setup", reason: tail(setupDry.stderr || setupDry.stdout) }
    }
    if (!facts.setupNothing) {
      const setupPr = target?.setupPr ?? null
      if (setupPr !== null && setupPr !== undefined) {
        result.onboardingPr = forkPrUrl(row.fork, Number(setupPr))
        try {
          const pr = deps.exec("gh", ["api", `repos/${row.fork}/pulls/${setupPr}`], { encoding: "utf8", env: options.env })
          const parsed = typeof pr === "string" ? JSON.parse(pr) : pr
          facts.setupPrState = parsed.merged === true ? "merged" : String(parsed.state ?? "").toLowerCase()
          if (facts.setupPrState === "merged") {
            const recheck = await run("setup", [row.slug, "--dry-run", "--work", row.work, ...recordArgs(row)])
            facts.setupNothing = /nothing to onboard/i.test(`${recheck.stdout}\n${recheck.stderr}`)
            if (recheck.code !== 0 && !facts.setupNothing) {
              return { ...result, upstreamPr: facts.upstreamPr, state: "setup-failed", stage: "setup", reason: tail(recheck.stderr || recheck.stdout), onboardingPr: result.onboardingPr }
            }
            if (facts.setupNothing) facts.setupPrState = null
          }
        } catch (error) {
          facts.setupPrState = "unknown"
          facts.reason = `onboarding pull request state is unavailable: ${tail(error?.stderr ?? error?.message)}`
        }
      } else if (row.record === null && (target?.record === null || target?.record === undefined)) {
        facts.setupNeedsRecord = true
      } else if (!dryRun) {
        const setupReal = await run("setup", [row.slug, "--work", row.work, ...recordArgs(row)])
        if (setupReal.code !== 0) return { ...result, upstreamPr: facts.upstreamPr, state: "setup-failed", stage: "setup", reason: tail(setupReal.stderr || setupReal.stdout) }
        facts.setupDone = true
        target = deps.readLedger(row.slug)
        result.onboardingPr = forkPrUrl(row.fork, target?.setupPr ?? null)
        return {
          ...result,
          upstreamPr: facts.upstreamPr,
          state: "awaiting-onboarding-merge",
          stage: "setup",
          reason: result.onboardingPr ?? "setup opened or prepared onboarding; merge the recorder change before replay",
          onboardingPr: result.onboardingPr,
        }
      } else {
        facts.setupNeedsRecord = row.record === null && (target?.record === null || target?.record === undefined)
      }
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason, onboardingPr: result.onboardingPr }
    currentStage = "repin"
    try {
      const recording = deps.readRecordingWorkflows === undefined
        ? recordingWorkflowsAt(row.fork, facts.forkDefault, deps.exec)
        : deps.readRecordingWorkflows(row.fork, facts.forkDefault)
      const bodies = recording?.bodies ?? {}
      const before = actionPinSummary(bodies)
      const plan = planRepin({ fork: row.fork, defaultBranch: facts.forkDefault, work: row.work, workflows: bodies })
      result.actionPin = before
      facts.repinChecked = true
      if (plan.changes.length > 0) {
        const repinned = await run("repin", dryRun ? [row.slug, "--dry-run"] : [row.slug, "--work", row.work])
        if (repinned.code !== 0) {
          facts.repinFailed = true
          facts.reason = tail(repinned.stderr || repinned.stdout)
        } else if (!dryRun) {
          result.actionPin = `${before} → ${GARNET_ACTION_PIN.slice(0, 8)}`
        }
      }
    } catch (error) {
      facts.repinFailed = true
      facts.reason = tail(error?.stderr ?? error?.message) || "fork action pin is unavailable"
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason, onboardingPr: result.onboardingPr, actionPin: result.actionPin }
    if (facts.dryRunMissingCandidate === true) {
      return {
        ...result,
        upstreamPr: facts.upstreamPr,
        state: "needs-find",
        stage: "find",
        reason: "find is skipped in dry-run; no eligible candidate in the ledger",
        onboardingPr: result.onboardingPr,
        actionPin: result.actionPin,
      }
    }
    currentStage = "live"
    target = deps.readLedger(row.slug)
    facts.replayDone = Array.isArray(target?.replays) && target.replays.some((replay) => Number(replay.upstreamPr) === Number(facts.upstreamPr) && replay.forkPr !== null && replay.forkPr !== undefined)
    const replay = Array.isArray(target?.replays) ? target.replays.find((item) => Number(item.upstreamPr) === Number(facts.upstreamPr)) : null
    if (replay?.forkPr !== null && replay?.forkPr !== undefined) result.replayPr = forkPrUrl(row.fork, Number(replay.forkPr))
    if (!facts.replayDone) {
      const liveValues = [row.slug, "--pr", String(facts.upstreamPr), "--work", row.work, "--dry-run", ...row.liveArgs]
      const liveDry = await run("live", liveValues)
      facts.liveDryRunChecked = true
      const health = `${liveDry.stdout}\n${liveDry.stderr}`.match(/recorder health:\s*([^\r\n]+)/i)
      const healthLine = health?.[0] ?? ""
      const liveOutput = `${liveDry.stdout}\n${liveDry.stderr}`
      const allowPendingRefusal = liveOutput.includes("without --allow-pending-recorder, the run stops here")
      if (liveDry.code !== 0 || allowPendingRefusal) {
        facts.liveRefused = true
        const detail = tail(liveDry.stderr || liveDry.stdout) || "live dry-run refused"
        facts.reason = healthLine !== "" && !detail.includes(healthLine) ? `${healthLine}\n${detail}` : detail
      } else if (!dryRun) {
        const liveReal = await run("live", [row.slug, "--pr", String(facts.upstreamPr), "--work", row.work, "--wait-minutes", String(waitMinutes), ...row.liveArgs])
        if (liveReal.code !== 0) {
          facts.liveFailed = true
          const detail = tail(liveReal.stderr || liveReal.stdout)
          facts.reason = healthLine !== "" && !detail.includes(healthLine) ? `${healthLine}\n${detail}` : detail
          target = deps.readLedger(row.slug)
          const recorded = Array.isArray(target?.replays)
            ? target.replays.find((item) => Number(item.upstreamPr) === Number(facts.upstreamPr) && item.forkPr !== null && item.forkPr !== undefined)
            : null
          if (recorded !== null) {
            facts.liveFailed = false
            facts.replayDone = true
            result.replayPr = forkPrUrl(row.fork, Number(recorded.forkPr))
          }
        } else {
          facts.liveExecuted = true
          target = deps.readLedger(row.slug)
          const recorded = Array.isArray(target?.replays)
            ? target.replays.find((item) => Number(item.upstreamPr) === Number(facts.upstreamPr) && item.forkPr !== null && item.forkPr !== undefined)
            : null
          if (recorded !== null) result.replayPr = forkPrUrl(row.fork, Number(recorded.forkPr))
        }
      }
    }
    decision = nextAction(row, facts)
    if (decision.action === "terminal") return { ...result, upstreamPr: facts.upstreamPr, state: decision.state, stage: decision.stage, reason: decision.reason, replayPr: result.replayPr, onboardingPr: result.onboardingPr }
    currentStage = "verify"
    const verifyUrl = result.replayPr
    if (verifyUrl === null) return { ...result, upstreamPr: facts.upstreamPr, state: "awaiting-record", stage: "verify", reason: "replay pull request is not recorded yet" }
    const verifyRun = await run("verify", [verifyUrl, "--json"])
    const verifyResult = parseVerifyOutput(verifyRun.stdout)
    const legs = Array.isArray(verifyResult.legs) ? verifyResult.legs.map((leg) => ({ name: String(leg.name), ok: leg.ok === true, detail: String(leg.detail ?? "") })) : []
    const verify = { status: String(verifyResult.status ?? "FAIL"), legs }
    const publicReports = []
    for (const permalink of Array.isArray(verifyResult.permalinks) ? verifyResult.permalinks : []) {
      if (typeof permalink !== "string") continue
      const match = permalink.match(/^https:\/\/app\.garnet\.ai\/public\/runs\/([^?]+)\?profile=([^&]+)$/)
      if (match !== null) {
        publicReports.push(permalink, `https://app.garnet.ai/api/public/runs/${match[1]}?profile=${match[2]}`)
      }
    }
    const commentPresentLeg = legs.find((leg) => leg.name === "comment present")
    const commentFinalizedLeg = legs.find((leg) => leg.name === "comment finalized")
    const receipt = verifyResult.receipt
    const noProfile = receipt?.noProfile === true
    const waiting = noProfile !== true && (
      receipt?.pending === true
      || receipt?.commentPresent === false
      || receipt?.finalized === false
      || (commentPresentLeg !== undefined && commentPresentLeg.ok !== true)
      || (commentPresentLeg?.ok === true && commentFinalizedLeg !== undefined && commentFinalizedLeg.ok !== true)
    )
    const verifyDecision = nextAction(row, { ...facts, verifyResult: { ...verifyResult, legs, pending: waiting } })
    if (verifyDecision.action === "terminal") {
      return { ...result, upstreamPr: facts.upstreamPr, state: verifyDecision.state, stage: "verify", reason: verifyDecision.reason, verify, shareable: false, verdict: "undeterminable", publicReports, replayPr: result.replayPr, onboardingPr: result.onboardingPr }
    }
    currentStage = "card"
    const cardRun = await run("card", [verifyUrl])
    if (cardRun.code !== 0) return { ...result, upstreamPr: facts.upstreamPr, state: "card-failed", stage: "card", reason: tail(cardRun.stderr || cardRun.stdout), verify, shareable: true, verdict: "pass", publicReports, replayPr: result.replayPr, onboardingPr: result.onboardingPr }
    const cardMatch = `${cardRun.stdout}\n${cardRun.stderr}`.match(/(?:wrote|card):\s*(\S+)/i)
    return { ...result, upstreamPr: facts.upstreamPr, state: "pass", stage: "card", reason: "verify passed", verify, shareable: true, verdict: "pass", publicReports, card: cardMatch?.[1] ?? tail(cardRun.stdout, 200), replayPr: result.replayPr, onboardingPr: result.onboardingPr }
  } catch (error) {
    return { ...result, upstreamPr: facts.upstreamPr, state: "error", stage: currentStage, reason: tail(error?.message ?? error) }
  }
}

function boardRow(row) {
  return {
    slug: row.slug,
    upstream: row.upstream,
    fork: row.fork,
    upstreamPr: row.upstreamPr ?? null,
    onboardingPr: row.onboardingPr ?? null,
    replayPr: row.replayPr ?? null,
    state: row.state,
    stage: row.stage,
    reason: row.reason,
    verify: row.verify ?? null,
    shareable: row.shareable === true,
    verdict: row.verdict ?? "undeterminable",
    publicReports: Array.isArray(row.publicReports) ? row.publicReports : [],
    card: row.card ?? null,
    actionPin: row.actionPin ?? "—",
    outreach: "gated",
  }
}

// Verify leg names are harness-internal; the board is renderer-owned copy and
// must pass the vocabulary guard, so legs named with contract terms get a label.
const BOARD_LEG_LABELS = Object.freeze({ "verdict determinable": "outcome determinable" })

/**
 * Render and guard the human board. Upstream PRs are deliberately described
 * as changes rather than repository-qualified references.
 * @param {object} board
 * @returns {string}
 */
export function renderBoard(board) {
  const lines = [
    `# ${board.name}`,
    "",
    "| target | fork | onboarding PR | replay PR | action pin | state | verify legs (failing legs named) | public report | outreach |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const row of board.rows) {
    const target = row.upstreamPr === null ? row.slug : `${row.slug} — upstream change ${row.upstreamPr}`
    const onboarding = row.onboardingPr === null ? "—" : `onboarding PR ${row.onboardingPr.match(/\/(\d+)$/)?.[1] ?? "available"}`
    const replay = row.replayPr === null ? "—" : `replay PR ${row.replayPr.match(/\/(\d+)$/)?.[1] ?? "available"}`
    const failing = row.verify === null ? "—" : row.verify.legs.filter((leg) => leg.ok !== true).map((leg) => BOARD_LEG_LABELS[leg.name] ?? leg.name).join(", ") || "all legs pass"
    const report = row.publicReports.length === 0 ? "—" : row.publicReports.map((url) => `[report](${url})`).join(" ")
    lines.push(`| ${target} | ${row.fork ?? "—"} | ${onboarding} | ${replay} | ${row.actionPin ?? "—"} | ${row.state} | ${failing} | ${report} | ${row.outreach} |`)
  }
  const text = `${lines.join("\n")}\n`
  assertVocabClean(text)
  for (const row of board.rows) {
    if (typeof row.upstream === "string" && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(row.upstream)) {
      assertNoUpstreamLeak(text, row.upstream)
    }
  }
  return text
}

async function resolveToken(exec, env) {
  const result = { ...env }
  if (typeof result.GH_TOKEN === "string" && result.GH_TOKEN !== "") return result
  try {
    const token = String(exec("gh", ["auth", "token"], { encoding: "utf8" }) ?? "").trim()
    if (token !== "") result.GH_TOKEN = token
  } catch {
    // gh may be authenticated through its config rather than GH_TOKEN.
  }
  return result
}

function parseOptions(args) {
  const targetFile = args[0]
  if (typeof targetFile !== "string" || targetFile === "" || targetFile.startsWith("--")) throw new Error("batch requires <targets.json>")
  const option = (name, fallback = null) => {
    const index = args.indexOf(name)
    return index === -1 ? fallback : args[index + 1] ?? fallback
  }
  const out = option("--out")
  const onlyValue = option("--only")
  const concurrency = parsePositiveInteger(option("--concurrency", "2"), "concurrency")
  const waitMinutes = parsePositiveInteger(option("--wait-minutes", String(DEFAULT_WAIT_MINUTES)), "wait-minutes", { allowZero: true })
  return {
    targetFile: resolve(targetFile),
    out: out === null ? null : resolve(out),
    only: onlyValue === null ? null : onlyValue.split(",").map((slug) => assertSlug(slug.trim())),
    concurrency,
    waitMinutes,
    dryRun: args.includes("--dry-run"),
  }
}

/**
 * Execute a batch with injectable filesystem, GitHub probes, and child runner.
 * @param {string[]} args
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
export async function runBatch(args, deps = {}) {
  const options = parseOptions(args)
  const root = deps.root ?? ROOT
  const exec = deps.exec ?? ghRun
  const readLedger = deps.readLedger ?? readLedgerDefault
  const runCommand = deps.runCommand ?? defaultRunCommand
  const env = await resolveToken(exec, deps.env ?? process.env)
  const probeFork = deps.probeFork ?? ((fork) => probeForkDefault(fork, exec, env))
  const probeWrite = deps.probeWrite ?? ((row) => probeWriteDefault(row, exec, root, env))
  const document = JSON.parse(readFileSync(options.targetFile, "utf8"))
  const validated = validateTargets(document)
  let rows = validated.rows
  if (options.only !== null) rows = rows.filter((row) => options.only.includes(row.slug))
  const plan = planGroups(rows)
  const startedAt = new Date().toISOString()
  const outDir = options.out ?? join(OUT_DIR, `batch-${startedAt.slice(0, 10)}`)
  const logsDir = join(outDir, "logs")
  await mkdir(logsDir, { recursive: true })
  let harnessSha = "unknown"
  try {
    harnessSha = String(exec("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })).trim()
  } catch {}
  const completed = []
  const infra = { lastReason: null, lastKey: null, count: 0, stopped: false }
  const onFinished = (row) => {
    completed.push(row)
    if (row.state === "blocked-infra") {
      const key = infraReasonKey(row.reason)
      if (infra.lastKey === key) infra.count += 1
      else {
        infra.lastReason = row.reason
        infra.lastKey = key
        infra.count = 1
      }
      if (infra.count > 1) infra.lastReason = row.reason
      if (infra.count >= 2) infra.stopped = true
    } else {
      infra.lastReason = null
      infra.lastKey = null
      infra.count = 0
    }
  }
  const runGroup = async (group) => {
    const results = []
    for (const row of group.rows) {
      if (infra.stopped) {
        const skipped = {
          ...row,
          upstreamPr: row.pr ?? null,
          onboardingPr: null,
          replayPr: null,
          state: "not-started",
          stage: "batch",
          reason: `stopped: repeated infra blocker ${infra.lastReason}`,
          verify: null,
          shareable: false,
          verdict: "undeterminable",
          publicReports: [],
          card: null,
        }
        results.push(skipped)
        continue
      }
      const logFile = join(logsDir, `${row.slug}.log`)
      let result
      try {
        await writeFile(logFile, "")
        result = await runTarget(row, { deps: { ...deps, exec, readLedger, runCommand, probeFork, probeWrite }, root, logFile, env, dryRun: options.dryRun, waitMinutes: options.waitMinutes })
      } catch (error) {
        result = {
          ...row,
          upstreamPr: row.pr ?? null,
          onboardingPr: null,
          replayPr: null,
          state: "error",
          stage: "batch",
          reason: tail(error?.message ?? error),
          verify: null,
          shareable: false,
          verdict: "undeterminable",
          publicReports: [],
          card: null,
        }
      }
      results.push(result)
      onFinished(result)
    }
    return results
  }
  const queue = [...plan.groups]
  const workers = Array.from({ length: Math.min(options.concurrency, Math.max(queue.length, 1)) }, async () => {
    while (queue.length > 0) {
      const group = queue.shift()
      if (group === undefined) return
      await runGroup(group)
    }
  })
  await Promise.all(workers)
  if (infra.stopped) {
    const finishedSlugs = new Set(completed.map((row) => row.slug))
    for (const group of plan.groups) {
      for (const row of group.rows) {
        if (finishedSlugs.has(row.slug)) continue
        completed.push({
          ...row,
          upstreamPr: row.pr ?? null,
          onboardingPr: null,
          replayPr: null,
          state: "not-started",
          stage: "batch",
          reason: `stopped: repeated infra blocker ${infra.lastReason}`,
          verify: null,
          shareable: false,
          verdict: "undeterminable",
          publicReports: [],
          card: null,
        })
      }
    }
  }
  const invalid = rows.filter((row) => row.validation !== null)
  const rejected = [...invalid, ...plan.rejected].map((row) => ({
    ...row,
    upstreamPr: row.pr ?? null,
    onboardingPr: null,
    replayPr: null,
    state: "invalid",
    stage: "validate",
    reason: row.validation,
    verify: null,
    shareable: false,
    verdict: "undeterminable",
    publicReports: [],
    card: null,
  }))
  const rejectedSlugs = new Set(rejected.map((row) => row.slug))
  const blocked = rows.filter((row) => row.blocked !== null && !rejectedSlugs.has(row.slug)).map((row) => ({
    ...row,
    upstreamPr: row.pr ?? null,
    onboardingPr: null,
    replayPr: null,
    state: "blocked",
    stage: "validate",
    reason: row.blocked,
    verify: null,
    shareable: false,
    verdict: "undeterminable",
    publicReports: [],
    card: null,
  }))
  const finishedAt = new Date().toISOString()
  const board = {
    name: validated.name,
    harnessSha,
    startedAt,
    finishedAt,
    rows: [...completed, ...rejected, ...blocked].map(boardRow),
  }
  const boardMarkdown = renderBoard(board)
  writeFileSync(join(outDir, "board.json"), `${JSON.stringify(board, null, 2)}\n`)
  writeFileSync(join(outDir, "board.md"), boardMarkdown)
  return { ...board, outDir, boardMarkdown, logsDir }
}

export { KNOWN_PRODUCT_LEGS }
