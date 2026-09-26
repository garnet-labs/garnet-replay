/**
 * Ladder commands: find · live --pr · card · cohort · verify · consume · harvest · status · stage2.
 * Each command reads and writes one target ledger (`targets/<slug>.json`) and
 * one artifact directory (`out/<slug>/`). Network and git go through `gh.mjs`
 * with an injectable `exec`, so every command has an offline test.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { run, ghJson, listPrs, prComments, prHeadSha } from "./gh.mjs"
import { assertForkTarget, assertRepoSlug, assertSlug } from "./guards.mjs"
import { ensureTarget, loadTarget, outPath, saveTarget, upsertRow } from "./ledger.mjs"
import { isMergeQueue, observationFor, rankObservations, renderObserveOutput } from "./observe.mjs"
import { anyPathMatches } from "./paths.mjs"
import { findSpecimens, renderFindReport } from "./find.mjs"
import {
  DEPENDABOT_CONFIG_PATH, DEPENDABOT_ECOSYSTEMS, ECOSYSTEM_BY_LOCKFILE, INSTALL_COMMANDS, RECORD_WORKFLOW_PATH, dependabotConfig, detectEcosystem, eligibleRecorders, executePlan, fetchUpstreamPr, forkDefaultBranch, forkHasRecordingWorkflow, forkHoldsBase, hasDependabotConfig, instrumentWorkflow, planPureReplay, planRefresh, planRepin, planReplay, planSetup, pullRequestPathFilter, recordingWorkflowsAt,
  reconcileState, recordWorkflow, renderPlan, renderRefreshPlan, renderRepinPlan, renderSetupPlan, selectedPathFilters, setupPrBodyText, upsertReplay, workDirFor,
} from "./replay-pr.mjs"
import { recorderHealth } from "./recorder-health.mjs"
import { ALLOWLIST_KEY, IGNORED_KEY, LOCKFILE, WORKSPACE_FILE, buildScriptList, lockedVersions, planAllowBuild, planTransition, resolvedVersion } from "./replay-transition.mjs"
import { cardForPr, upsertEvidence } from "./card.mjs"
import { runCohort } from "./cohort.mjs"
import { consumePr, harvestCandidates, renderHarvestReport } from "./consume.mjs"
import { renderVerifyReport, verifyExhibit } from "./verify.mjs"
import { loadAll, renderBoardText, writeBoard } from "./status.mjs"
import { planStage2, renderStage2Plan } from "./stage2.mjs"
import { planPrepared } from "./replay-prepared.mjs"
import { buildExecutionDiff } from "./execution-diff.mjs"
import { decideMergeSafety, renderDecision } from "./decide.mjs"
import { fetchPullRequest, parsePrUrl } from "./receipt.mjs"

export function option(args, name, fallback = null) {
  const index = args.indexOf(name)
  return index === -1 || args[index + 1] === undefined ? fallback : args[index + 1]
}

export function flag(args, name) {
  return args.includes(name)
}

function csv(value) {
  return typeof value === "string" && value !== "" ? value.split(",").map((part) => part.trim()).filter(Boolean) : []
}

function multi(args, name) {
  const out = []
  args.forEach((arg, index) => {
    if (arg === name && args[index + 1] !== undefined) out.push(args[index + 1])
  })
  return out
}

/** replay find <owner/repo> --slug s --fork owner/repo [--limit 30] [--state all] | --history <dir> */
export function find(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const history = option(args, "--history")
  if (history !== null) {
    const result = findSpecimens(history, { limit: Number(option(args, "--limit", "200")), top: Number(option(args, "--top", "15")) })
    log(renderFindReport(result))
    return result
  }
  const upstream = assertRepoSlug(args[0])
  const slug = assertSlug(option(args, "--slug", upstream.split("/")[1].toLowerCase()))
  const fork = option(args, "--fork")
  const recordMode = option(args, "--record-mode")
  const recordJob = option(args, "--record-job")
  const workloadName = option(args, "--workload-name")
  const workloadPaths = csv(option(args, "--workload-paths"))
  const record = recordMode === null && recordJob === null ? null : { mode: recordMode, job: recordJob }
  const workload = workloadName === null && workloadPaths.length === 0 ? null : { name: workloadName, paths: workloadPaths }
  const target = ensureTarget(slug, { upstream, fork: fork === null ? null : assertRepoSlug(fork), record, workload })
  const limit = Number(option(args, "--limit", "30"))
  const author = option(args, "--author")
  const kind = option(args, "--kind")
  const pathGlobs = csv(option(args, "--paths"))
  const prs = listPrs(upstream, { limit, state: option(args, "--state", "all"), author, search: option(args, "--search"), exec })
  const reviewable = prs.filter((pr) => !isMergeQueue(pr))
  const scope = target.workload ?? null
  const observations = rankObservations(reviewable.map((pr) => observationFor(pr, scope)))
    .filter((row) => kind === null || row.kind === kind)
    .filter((row) => pathGlobs.length === 0 || anyPathMatches(row.paths, pathGlobs))
  const observedAt = new Date().toISOString()
  for (const row of observations) target.observations = upsertRow(target.observations, { ...row, observedAt }, (r) => Number(r.upstreamPr)).rows
  save(target)
  log(renderObserveOutput(observations, { slug, upstream, scanned: prs.length, setAside: prs.length - reviewable.length, workload: scope }))
  return { target, observations }
}

function messageOverrides(args) {
  return {
    first: option(args, "--first-message") ?? undefined,
    change: option(args, "--change-message") ?? undefined,
    title: option(args, "--title") ?? undefined,
    body: option(args, "--body") ?? undefined,
  }
}

function workflowJobOption(value) {
  if (value === null) return null
  const prefix = ".github/workflows/"
  const normalized = value.startsWith(prefix) ? value.slice(prefix.length) : value
  const slash = normalized.lastIndexOf("/")
  if (slash <= 0 || slash === normalized.length - 1) throw new Error("--job needs <workflow-file>/<job>")
  return { file: normalized.slice(0, slash), job: normalized.slice(slash + 1) }
}

/**
 * Effective --record/--job for `replay live`: explicit flags win, then the
 * target's declared record mode, then null (the caller falls back to
 * fork-workflow/inject). Pure.
 * @param {string[]} args
 * @param {object|null} target
 * @returns {{mode: string|null, job: string|null}}
 */
export function effectiveRecord(args, target) {
  const declared = target !== null && typeof target === "object" && !Array.isArray(target)
    && target.record !== null && typeof target.record === "object" && !Array.isArray(target.record)
    ? target.record
    : null
  const mode = option(args, "--record")
    ?? (declared !== null && typeof declared.mode === "string" ? declared.mode : null)
  const job = option(args, "--job")
    ?? (declared !== null && typeof declared.job === "string" ? declared.job : null)
  return { mode, job }
}

/** File content as the fork default branch has it (`git show origin/<branch>:<file>`), or null when absent. */
function atDefaultBranch(work, defaultBranch, file, exec) {
  try {
    return exec("git", ["-C", work, "show", `origin/${defaultBranch}:${file}`], { encoding: "utf8" })
  } catch {
    return null
  }
}

/** Where the fork keeps pnpm's build-script allowlist; pnpm-workspace.yaml wins when it carries the key. */
function allowlistFileIn(work, defaultBranch, exec) {
  const workspace = atDefaultBranch(work, defaultBranch, WORKSPACE_FILE, exec)
  if (workspace !== null && new RegExp(`^${ALLOWLIST_KEY}:`, "m").test(workspace)) return WORKSPACE_FILE
  const manifest = atDefaultBranch(work, defaultBranch, "package.json", exec)
  if (manifest !== null && manifest.includes(`"${ALLOWLIST_KEY}"`)) return "package.json"
  throw new Error(`neither ${WORKSPACE_FILE} nor package.json on ${defaultBranch} carries ${ALLOWLIST_KEY}; the fork does not block build scripts, so there is no allow decision to make`)
}

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"]

/**
 * Install-phase scripts the published package declares, read with the repository's own pnpm.
 * @returns {string[]} script names, [] when the package declares none
 */
export function installScriptsOf(work, dependency, version, exec) {
  let out
  try {
    out = exec("corepack", ["pnpm", "view", `${dependency}@${version}`, "scripts", "--json"], { cwd: work, encoding: "utf8", env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } })
  } catch (error) {
    throw new Error(`could not read ${dependency}@${version} from the registry: ${error.message}`)
  }
  const text = String(out ?? "").trim()
  if (text === "") return []
  const scripts = JSON.parse(text)
  if (scripts === null || typeof scripts !== "object") return []
  return INSTALL_SCRIPTS.filter((name) => typeof scripts[name] === "string" && scripts[name] !== "")
}

/**
 * replay live <slug> --pr N [--first path,...] [--record fork-workflow|inject] [--record-workflow path,...] [--ecosystem x] [--branch b] [--work dir] [--sync-fork | --base-branch b | --allow-behind] [--label l] [--allow-pending-recorder] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 *   On an onboarded fork the replay is one commit (the change itself) recorded
 *   by the fork's own workflow; without onboarding the run refuses and points
 *   at `replay setup`. --record inject bundles a recorder into the replay for
 *   non-onboarded or experimental runs.
 * replay live <slug> --pr N --record instrument --job <workflow-file>/<job> [--runs-on label] [--drop-job a,b] [--work dir] [--dry-run]
 *   --record/--job default to the target's declared record mode (set with
 *   replay find --record-mode/--record-job); explicit flags win.
 * replay live <slug> --dependency <name> --to <version> [--from <version>] [--spec ^v] [--package-dir dir] [--work dir] [--branch b] [--allow-pending-recorder] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 * replay live <slug> --allow-build <name> [--version v] [--work dir] [--branch b] [--allow-pending-recorder] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 *
 * Before any write, the fork's recent pull requests are read for Runtime Review
 * comments. When the fork's own recorder is relied on and nothing has finalized
 * lately (`stalled` or `none`), the run stops unless --allow-pending-recorder
 * is passed; a dry run only reports it.
 */
export async function livePr(args, { exec = run, log = console.log, save = saveTarget, io = undefined, beforeExecute = () => {} } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  const upstream = target.upstream
  const fork = target.fork
  const dependency = option(args, "--dependency")
  const allowBuild = option(args, "--allow-build")
  const prepared = option(args, "--prepared")
  const upstreamPr = Number(option(args, "--pr"))
  const { mode: requested, job: jobFlag } = effectiveRecord(args, target)
  const jobOption = workflowJobOption(jobFlag)
  if (jobOption !== null && requested !== "instrument") throw new Error("--job requires --record instrument")
  if (requested === "instrument" && jobOption === null) throw new Error("--record instrument requires --job <workflow-file>/<job>")
  if (requested !== null && !["fork-workflow", "inject", "instrument"].includes(requested)) throw new Error(`unsupported --record mode '${requested}'`)
  if (prepared === null && dependency === null && allowBuild === null && (!Number.isInteger(upstreamPr) || upstreamPr <= 0)) {
    throw new Error("live requires --pr <upstream pull request number>, --dependency <name> --to <version>, or --allow-build <name>")
  }
  const work = option(args, "--work") ?? workDirFor(slug)
  const workExists = existsSync(work)
  if (prepared !== null && (dependency !== null || allowBuild !== null || option(args, "--pr") !== null || flag(args, "--no-wait"))) {
    throw new Error("--prepared cannot be combined with another live mode or --no-wait")
  }
  const defaultBranch = forkDefaultBranch(fork, { exec })
  const recording = prepared === null ? forkHasRecordingWorkflow(fork, defaultBranch, { exec }) : { present: false, workflows: [], paths: {}, labels: {} }
  const label = option(args, "--label")
  const recorders = eligibleRecorders(recording, label)
  const onboarded = prepared === null && recording.present && recorders.eligible.length > 0
  for (const [workflow, needed] of Object.entries(recorders.gated)) log(`not counted as a recorder: ${workflow} runs only on pull requests labelled ${needed}`)
  const transitionNeedsRecorder = () => {
    if (!recording.present) throw new Error(`${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; a transition needs the fork's own recording workflow`)
    if (recorders.eligible.length === 0) {
      const gated = Object.entries(recorders.gated).map(([workflow, needed]) => `${workflow} (label ${needed})`).join(", ")
      throw new Error(`${fork}@${defaultBranch} records only labelled pull requests: ${gated}; pass --label <name> to run one`)
    }
  }
  let plan
  if (prepared !== null) {
    if (!workExists) throw new Error("--prepared needs an existing fork checkout")
    plan = planPrepared({
      slug, upstream, fork, defaultBranch, work, spec: JSON.parse(readFileSync(prepared, "utf8")),
      branch: option(args, "--branch"), baseBranch: option(args, "--base-branch"),
      label, draft: !flag(args, "--no-draft"),
      messages: messageOverrides(args), resume: flag(args, "--resume"),
    })
  } else if (allowBuild !== null) {
    transitionNeedsRecorder()
    if (!workExists) throw new Error(`transition needs a fork checkout to read the lockfile; clone ${fork} to ${work} or pass --work <dir>`)
    const lock = atDefaultBranch(work, defaultBranch, LOCKFILE, exec)
    if (lock === null) throw new Error(`${fork}@${defaultBranch} has no ${LOCKFILE}; transitions are pnpm only`)
    const locked = lockedVersions(lock, allowBuild)
    if (locked.length === 0) throw new Error(`${LOCKFILE} on ${defaultBranch} does not carry ${allowBuild}; --allow-build is for a dependency already installed with its build script skipped`)
    const allowlistFile = allowlistFileIn(work, defaultBranch, exec)
    const settings = atDefaultBranch(work, defaultBranch, allowlistFile, exec)
    for (const key of [ALLOWLIST_KEY, IGNORED_KEY]) {
      if (buildScriptList(settings, { file: allowlistFile, key }).includes(allowBuild)) throw new Error(`${allowlistFile} on ${defaultBranch} already lists ${allowBuild} under ${key}; there is no decision left to make`)
    }
    const withScripts = locked.filter((version) => installScriptsOf(work, allowBuild, version, exec).length > 0)
    if (withScripts.length === 0) throw new Error(`${allowBuild} (${locked.join(", ")}) declares no install script; allowing its build scripts would change nothing`)
    log(`${allowBuild} ${withScripts.join(", ")} declares an install script; pnpm skips it on ${defaultBranch}`)
    plan = planAllowBuild({
      slug, upstream, fork, defaultBranch, dependency: allowBuild, versions: locked, allowlistFile, work, workExists,
      branch: option(args, "--branch"), draft: !flag(args, "--no-draft"), messages: messageOverrides(args),
    })
  } else if (dependency !== null) {
    const to = option(args, "--to")
    if (to === null) throw new Error("--dependency needs --to <published version>")
    transitionNeedsRecorder()
    if (!workExists) throw new Error(`transition needs a fork checkout to read the lockfile; clone ${fork} to ${work} or pass --work <dir>`)
    const packageDir = option(args, "--package-dir", ".")
    const lock = atDefaultBranch(work, defaultBranch, LOCKFILE, exec)
    if (lock === null) throw new Error(`${fork}@${defaultBranch} has no ${LOCKFILE}; transitions are pnpm only`)
    const resolved = resolvedVersion(lock, packageDir, dependency)
    const from = option(args, "--from") ?? resolved?.version ?? null
    if (from === null) throw new Error(`${LOCKFILE} on ${defaultBranch} does not resolve ${dependency} for importer ${packageDir}; pass --from <version>`)
    plan = planTransition({
      slug, upstream, fork, defaultBranch, dependency, from, to, spec: option(args, "--spec") ?? undefined, packageDir,
      allowlistFile: allowlistFileIn(work, defaultBranch, exec), work, workExists, branch: option(args, "--branch"), draft: !flag(args, "--no-draft"), messages: messageOverrides(args),
    })
  } else {
    const explicitRecord = option(args, "--record")
    const declaredRecord = explicitRecord ?? requested
    if (declaredRecord === null && !onboarded) {
      throw new Error(`${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; onboard the fork first: replay setup ${slug} [--job <workflow-file>/<job>] — or pass --record inject to bundle a recorder into this replay`)
    }
    const pr = fetchUpstreamPr(upstream, upstreamPr, { exec })
    // Once the fork is onboarded the replay is pure; a declared record mode is
    // a pre-onboarding preference and no longer applies. An explicit flag wins.
    const record = explicitRecord ?? (onboarded ? "fork-workflow" : (requested ?? "fork-workflow"))
    const ecosystem = option(args, "--ecosystem", detectEcosystem(pr.paths))
    const baseBranch = option(args, "--base-branch")
    const explicitWorkflows = option(args, "--record-workflow")
    const syncFork = flag(args, "--sync-fork")
    const setupRepo = syncFork || baseBranch !== null ? upstream : fork
    const setupRef = syncFork || baseBranch !== null ? pr.baseSha : defaultBranch
    let instrument = null
    if (record === "instrument") {
      const workflowPath = `.github/workflows/${jobOption.file}`
      const workflowBody = exec("gh", ["api", `repos/${setupRepo}/contents/${workflowPath}?ref=${setupRef}`, "-H", "Accept: application/vnd.github.raw"], { encoding: "utf8" })
      let rewritten
      try {
        rewritten = instrumentWorkflow(workflowBody, {
          job: jobOption.job,
          runsOn: option(args, "--runs-on"),
          dropJobs: csv(option(args, "--drop-job")),
        })
      } catch (error) {
        if (error instanceof Error && error.message === "workflow does not run on pull_request") {
          throw new Error(`workflow ${jobOption.file} does not run on pull_request`)
        }
        throw error
      }
      instrument = { path: workflowPath, content: rewritten.content, changes: rewritten.changes, job: jobOption.job }
    }
    const baseRecording =
      baseBranch !== null && record === "fork-workflow" && explicitWorkflows === null
        ? recordingWorkflowsAt(upstream, pr.baseSha, { exec })
        : { present: false, workflows: [], name: null, paths: {}, labels: {} }
    const recordWorkflows = record === "instrument" ? [] : explicitWorkflows === null ? recorders.eligible : csv(explicitWorkflows)
    for (const workflow of recordWorkflows) {
      if (workflow in recorders.gated) throw new Error(`${workflow} runs only on pull requests labelled ${recorders.gated[workflow]}; pass --label ${recorders.gated[workflow]} or pick another recorder`)
    }
    if (record === "fork-workflow" && recording.present && recordWorkflows.length === 0 && !baseRecording.present) {
      const gated = Object.entries(recorders.gated).map(([workflow, needed]) => `${workflow} (label ${needed})`).join(", ")
      throw new Error(`${fork}@${defaultBranch} records only labelled pull requests: ${gated}; pass --label <name> to run one, or --record inject`)
    }
    const selected = baseRecording.present ? baseRecording : recording
    const selectedWorkflows = baseRecording.present ? baseRecording.workflows : recordWorkflows
    const instrumentFilter = record === "instrument" ? pullRequestPathFilter(instrument.content) : null
    const recordFilters = record === "fork-workflow"
      ? selectedPathFilters(selected.paths, selectedWorkflows)
      : record === "instrument" && instrumentFilter !== null
        ? { [instrument.path]: instrumentFilter }
        : null
    if (baseRecording.present) log(`the change's base already runs ${baseRecording.workflows.join(", ")} on pull requests; commit 1 carries no recording workflow`)
    const dependabotConfigured = record === "inject" || record === "instrument" ? hasDependabotConfig(setupRepo, setupRef, { exec }) : true
    if ((record === "inject" || record === "instrument") && !dependabotConfigured) {
      if (record === "instrument" && (typeof ecosystem !== "string" || !(ecosystem in DEPENDABOT_ECOSYSTEMS))) {
        log(`the replay base has no .github/dependabot.yml; ecosystem ${String(ecosystem)} has no Dependabot configuration, so commit 1 skips it`)
      } else {
        log(`the replay base has no .github/dependabot.yml; commit 1 adds one so the fork's own dependency pull requests get recorded`)
      }
    }
    const holdsBase = syncFork || baseBranch !== null ? null : forkHoldsBase({ upstream, baseSha: pr.baseSha, fork, ref: defaultBranch, changes: pr.changes }, { exec })
    const pure = onboarded && record === "fork-workflow" && (baseBranch !== null ? !baseRecording.present : (syncFork || holdsBase === true))
    if (pure) {
      log(baseBranch === null
        ? "the fork already holds the touched paths as the change found them and runs its own recorder; the replay is one commit"
        : `the fork's recorder is carried onto ${baseBranch}; the replay is one commit`)
      plan = planPureReplay({
        slug, upstream, fork, defaultBranch, upstreamPr, upstreamTitle: pr.title, baseSha: pr.baseSha, headSha: pr.headSha,
        changes: pr.changes, work, workExists,
        branch: option(args, "--branch"), baseBranch, syncFork,
        recordWorkflows, recordFilters,
        draft: !flag(args, "--no-draft"), label,
        messages: messageOverrides(args),
        allowBehind: flag(args, "--allow-behind"),
      })
    } else {
      plan = planReplay({
        slug, upstream, fork, defaultBranch, upstreamPr, upstreamTitle: pr.title, baseSha: pr.baseSha, headSha: pr.headSha,
        changes: pr.changes, firstPaths: csv(option(args, "--first")), work, workExists,
        record, ecosystem, branch: option(args, "--branch"), draft: !flag(args, "--no-draft"), messages: messageOverrides(args),
        syncFork,
        baseBranch,
        forkHoldsBase: holdsBase,
        recordWorkflows,
        recordFilters,
        baseRecords: baseRecording.workflows,
        instrument,
        allowBehind: flag(args, "--allow-behind"),
        label,
        dependabotConfigured,
      })
    }
  }
  const health = recorderHealth(fork, { exec })
  if (health !== null) log(health.line)
  if (flag(args, "--dry-run")) {
    log(renderPlan(plan))
    if (!recording.present && prepared === null) log(`note: ${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; ${plan.record === "inject" ? "one is added in commit 1" : plan.record === "instrument" ? "the selected project workflow is instrumented in commit 1" : "recording will not happen"}`)
    if (health !== null && (health.verdict === "stalled" || (health.verdict === "none" && plan.record !== "instrument" && plan.singleCommit !== true))) log(`note: without --allow-pending-recorder, the run stops here: the fork's recorder is ${health.verdict}`)
    return { plan, health, executed: false }
  }
  if (health !== null && (health.verdict === "stalled" || (health.verdict === "none" && plan.record !== "instrument" && plan.singleCommit !== true)) && !flag(args, "--allow-pending-recorder")) {
    throw new Error(`${health.line}\nthe run would wait for a record that is not arriving; fix the recorder first, or pass --allow-pending-recorder to open the pull request anyway`)
  }
  const waitMinutes = Number(option(args, "--wait-minutes", "45"))
  if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) throw new Error("--wait-minutes needs a positive number")
  const wait = flag(args, "--no-wait") ? { enabled: false } : { timeoutMs: waitMinutes * 60 * 1000 }
  beforeExecute(plan)
  const captured = await executePlan(plan, { exec, log, wait, ...(io === undefined ? {} : { io }) })
  const forkPr = captured.forkPr ?? null
  let state = "pending"
  if (forkPr !== null) {
    try {
      state = reconcileState(prComments(fork, forkPr, { exec }), captured.forkHeadSha ?? prHeadSha(fork, forkPr, { exec }))
    } catch {
      state = "pending"
    }
  }
  const row = {
    upstreamPr: plan.upstreamPr, forkPr, branch: plan.branch, scope: plan.scope, mode: plan.mode ?? "replay",
    baseSha: plan.baseSha ?? captured.firstSha ?? null, headSha: plan.headSha ?? captured.forkHeadSha ?? null,
    forkHeadSha: captured.forkHeadSha ?? null, firstSha: captured.firstSha ?? null, transition: plan.transition, record: plan.record, ecosystem: plan.ecosystem,
    state, openedAt: new Date().toISOString(),
  }
  save(upsertReplay(target, row))
  log(forkPr === null ? "fork pull request: not opened (see steps above)" : `fork pull request ${forkPr} on ${fork} · ${state}`)
  if (state === "pending") log(plan.singleCommit === true ? "the change commit is published; its finalized record is still pending" : "commit 2 publication is complete; its finalized record is still pending")
  log(`next: replay verify https://github.com/${fork}/pull/${forkPr ?? "<forkPr>"}   # after ${plan.singleCommit === true ? "the change commit" : "commit 2"} finalizes`)
  return { plan, health, captured, row, executed: true }
}

/**
 * Detect the single install ecosystem of a fork's default branch by its root
 * lockfiles. Throws when there is none or more than one.
 * @param {string} fork
 * @param {string} defaultBranch
 * @param {Function} exec
 * @returns {string}
 */
function detectForkEcosystem(fork, defaultBranch, exec) {
  const tree = ghJson(["api", `repos/${fork}/git/trees/${defaultBranch}`], { exec })
  const entries = Array.isArray(tree?.tree) ? tree.tree : []
  const ecosystems = new Set(
    entries
      .filter((entry) => entry !== null && typeof entry === "object" && entry.type === "blob" && typeof entry.path === "string" && entry.path in ECOSYSTEM_BY_LOCKFILE)
      .map((entry) => ECOSYSTEM_BY_LOCKFILE[entry.path]),
  )
  if (ecosystems.size === 1) return [...ecosystems][0]
  throw new Error(`could not detect a single ecosystem on ${fork}@${defaultBranch}; pass --ecosystem ${Object.keys(INSTALL_COMMANDS).join("|")}`)
}

/**
 * replay setup <slug> [--job <workflow-file>/<job>] [--runs-on label] [--drop-job a,b] [--ecosystem e] [--work dir] [--dry-run]
 *
 * One-time onboarding of the fork: a single commit adding Garnet execution
 * recording to the project's pull request CI, opened as a ready pull request
 * against the fork's default branch. Merge it, then `replay live --pr` replays
 * carry only the change.
 */
export async function setup(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  const upstream = target.upstream
  const fork = target.fork
  if (typeof fork !== "string" || fork === "") throw new Error(`target '${slug}' has no fork configured`)
  const defaultBranch = forkDefaultBranch(fork, { exec })
  const recording = forkHasRecordingWorkflow(fork, defaultBranch, { exec })
  if (recording.present) {
    log(`${fork}@${defaultBranch} already runs ${recording.workflows.join(", ")} on pull requests; nothing to onboard`)
    return { plan: null, executed: false }
  }
  const { mode: requested, job: jobFlag } = effectiveRecord(args, target)
  const jobOption = workflowJobOption(jobFlag)
  if (jobOption !== null && requested !== "instrument") throw new Error("--job requires --record instrument")
  if (requested === "instrument" && jobOption === null) throw new Error("--record instrument requires --job <workflow-file>/<job>")
  if (requested !== null && requested !== "instrument") throw new Error(`--record ${requested} does not apply to setup; it either instruments a project workflow (--record instrument --job <file>/<job>) or adds the recording workflow`)
  const work = option(args, "--work") ?? workDirFor(slug)
  const workExists = existsSync(work)
  let mode
  let files
  let message
  let body
  if (jobOption !== null) {
    mode = "instrument"
    const workflowPath = `.github/workflows/${jobOption.file}`
    const workflowBody = exec("gh", ["api", `repos/${fork}/contents/${workflowPath}?ref=${defaultBranch}`, "-H", "Accept: application/vnd.github.raw"], { encoding: "utf8" })
    let rewritten
    try {
      rewritten = instrumentWorkflow(workflowBody, { job: jobOption.job, runsOn: option(args, "--runs-on"), dropJobs: csv(option(args, "--drop-job")) })
    } catch (error) {
      if (error instanceof Error && error.message === "workflow does not run on pull_request") {
        throw new Error(`workflow ${jobOption.file} does not run on pull_request`)
      }
      throw error
    }
    files = { [workflowPath]: rewritten.content }
    message = [`ci: add Garnet execution recording to ${jobOption.job}`, "", ...Object.keys(files).map((path) => `- ${path}`)].join("\n")
    body = setupPrBodyText({ mode, files: Object.keys(files), job: jobOption.job, changes: rewritten.changes })
  } else {
    mode = "inject"
    const ecosystem = option(args, "--ecosystem") ?? detectForkEcosystem(fork, defaultBranch, exec)
    files = { [RECORD_WORKFLOW_PATH]: recordWorkflow(ecosystem) }
    if (!hasDependabotConfig(fork, defaultBranch, { exec }) && ecosystem in DEPENDABOT_ECOSYSTEMS) {
      files[DEPENDABOT_CONFIG_PATH] = dependabotConfig(ecosystem)
      log(`the fork has no ${DEPENDABOT_CONFIG_PATH}; the onboarding commit adds one so the fork's own dependency pull requests get recorded`)
    }
    message = ["ci: record pull request runs with Garnet", "", ...Object.keys(files).map((path) => `- ${path}`)].join("\n")
    body = setupPrBodyText({ mode, files: Object.keys(files), ecosystem })
  }
  const plan = planSetup({ slug, upstream, fork, defaultBranch, work, workExists, mode, files, message, body })
  if (flag(args, "--dry-run")) {
    log(renderSetupPlan(plan))
    return { plan, executed: false }
  }
  const captured = await executePlan(plan, { exec, log })
  const setupPr = captured.forkPr ?? null
  target.setupPr = setupPr
  save(target)
  log(setupPr === null ? "onboarding pull request: not opened (see steps above)" : `onboarding pull request ${setupPr} on ${fork}; merge it, then replay: replay live ${slug} --pr <N>`)
  return { plan, captured, executed: true }
}

/** replay fork <owner/repo> [--org garnet-labs] */
export async function fork(args, { exec = run, log = console.log, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const upstream = assertRepoSlug(args[0])
  const org = option(args, "--org", "garnet-labs")
  const name = upstream.split("/")[1]
  assertForkTarget(`https://github.com/${org}/${name}.git`, `garnet-labs/${name}`)
  const endpoint = `repos/garnet-labs/${name}`
  try {
    exec("gh", ["api", endpoint], { encoding: "utf8" })
    throw new Error(`garnet-labs/${name} already exists`)
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error
  }
  exec("gh", ["repo", "fork", upstream, "--org", "garnet-labs", "--clone=false", "--default-branch-only"], { encoding: "utf8" })
  let view = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      view = JSON.parse(exec("gh", ["api", endpoint], { encoding: "utf8" }))
      break
    } catch {
      if (attempt < 59) await sleep(1000)
    }
  }
  if (view === null) throw new Error(`timed out waiting for garnet-labs/${name} to exist`)
  const defaultBranch = typeof view.default_branch === "string" ? view.default_branch : null
  if (defaultBranch === null || defaultBranch === "") throw new Error(`garnet-labs/${name} has no default branch`)
  log(`forked ${upstream} as garnet-labs/${name} · default branch ${defaultBranch}`)
  return { upstream, fork: `garnet-labs/${name}`, defaultBranch }
}

/** replay refresh <slug> [--work dir] [--dry-run] */
export async function refresh(args, { exec = run, log = console.log, io = undefined } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  if (typeof target.fork !== "string" || typeof target.upstream !== "string") throw new Error(`target ${slug} needs fork and upstream; run find first`)
  const defaultBranch = forkDefaultBranch(target.fork, { exec })
  const work = option(args, "--work", workDirFor(slug))
  const plan = planRefresh({ upstream: target.upstream, fork: target.fork, defaultBranch, work, workExists: existsSync(work) })
  if (flag(args, "--dry-run")) {
    log(renderRefreshPlan(plan))
    return { plan, executed: false }
  }
  const captured = await executePlan(plan, { exec, log, ...(io === undefined ? {} : { io }), wait: { enabled: false } })
  return { plan, captured, executed: true }
}

/** replay repin <slug> [--work dir] [--dry-run]: move the fork's recording workflows to the harness action pin */
export async function repin(args, { exec = run, log = console.log, io = undefined } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  if (typeof target.fork !== "string") throw new Error(`target ${slug} needs a fork; run find first`)
  const defaultBranch = forkDefaultBranch(target.fork, { exec })
  const recording = recordingWorkflowsAt(target.fork, defaultBranch, { exec })
  if (!recording.present) throw new Error(`${target.fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; nothing to repin`)
  const work = option(args, "--work", workDirFor(slug))
  const plan = planRepin({ fork: target.fork, defaultBranch, workflows: recording.bodies, work, workExists: existsSync(work) })
  if (flag(args, "--dry-run") || plan.changes.length === 0) {
    log(renderRepinPlan(plan))
    return { plan, executed: false }
  }
  const captured = await executePlan(plan, { exec, log, ...(io === undefined ? {} : { io }), wait: { enabled: false } })
  log(`${target.fork}@${defaultBranch} now at ${String(captured.repinSha ?? "").slice(0, 12)} · ${plan.changes.map((change) => change.path).join(", ")} → garnet-org/action@${plan.pin} (${plan.label})`)
  return { plan, captured, executed: true }
}

/** replay card <slug> --pr <forkPr> | replay card <fork-pr-url> */
export async function card(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  let slug
  let forkPr
  const first = String(args[0] ?? "")
  const urlMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(first)
  if (urlMatch !== null) {
    forkPr = Number(urlMatch[2])
    const targets = loadAll().filter((t) => typeof t.fork === "string" && t.fork.toLowerCase() === urlMatch[1].toLowerCase())
    if (targets.length !== 1) throw new Error(`no single target writes to ${urlMatch[1]}; pass <slug> --pr ${forkPr}`)
    slug = targets[0].slug
  } else {
    slug = assertSlug(first)
    forkPr = Number(option(args, "--pr"))
    if (!Number.isInteger(forkPr) || forkPr <= 0) throw new Error("card requires --pr <fork pull request number> or a fork pull request url")
  }
  const target = loadTarget(slug)
  const result = await cardForPr(target, forkPr, { exec })
  upsertEvidence(target, result.row)
  const replay = (target.replays ?? []).find((row) => Number(row.forkPr) === forkPr)
  if (replay !== undefined && result.model.verdict !== "undeterminable") replay.state = "recorded"
  save(target)
  log(result.card)
  log(`wrote ${result.row.card} · ${result.row.verdict}${result.row.reason ? ` (${result.row.reason})` : ""}`)
  return result
}

/** replay cohort <slug> --prs 1,2,3 | --from-observations [--limit N] [--note "..."] */
export async function cohort(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  const limitOpt = option(args, "--limit")
  const result = await runCohort(target, {
    prs: csv(option(args, "--prs")),
    fromObservations: flag(args, "--from-observations"),
    limit: limitOpt === null ? null : Number(limitOpt),
    note: multi(args, "--note"),
    maxInflight: Number(option(args, "--max-inflight", "4")),
  }, { exec })
  save(target)
  log(result.report)
  log(`wrote ${result.cohortRow.report}`)
  return result
}

/** replay verify <pr-url> [--label real|constructed] */
export async function verify(args, { log = console.log, fetchImpl = fetch } = {}) {
  const url = args[0]
  if (typeof url !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) throw new Error("verify requires a pull request url")
  const token = option(args, "--token", process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null)
  const result = await verifyExhibit(url, { token, expectedLabel: option(args, "--label"), fetchImpl })
  log(renderVerifyReport(result))
  return result
}

/**
 * replay decide <fork-pr-url> [--json] [--token t]
 *
 * Merge-safety decision over the head-bound Garnet App receipt: merge | hold |
 * undeterminable. The rendered result is written next to the target's other
 * artifacts and logged; --json prints the machine result only.
 */
export async function decide(args, { log = console.log, fetchImpl = fetch } = {}) {
  const url = args[0]
  if (typeof url !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) throw new Error("decide requires a pull request url")
  const token = option(args, "--token", process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null)
  const parsed = parsePrUrl(url)
  const pr = await fetchPullRequest({ ...parsed, token, fetchImpl })
  const diff = buildExecutionDiff(pr)
  const result = decideMergeSafety(diff, {
    prMeta: { title: pr.title, user: { login: pr.author_login } },
    files: pr.files,
  })
  const targets = loadAll().filter((t) => typeof t.fork === "string" && t.fork.toLowerCase() === `${parsed.owner}/${parsed.repo}`.toLowerCase())
  const path = targets.length === 1
    ? outPath(targets[0].slug, `pr-${parsed.number}-decision.json`)
    : outPath("decide", `${parsed.owner}-${parsed.repo}-pr-${parsed.number}.json`)
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  if (flag(args, "--json")) {
    log(JSON.stringify(result, null, 2))
  } else {
    log(renderDecision(result, url))
    log(`wrote ${path}`)
  }
  return result
}

/** replay consume <pr-url> [--slug s] */
export function consume(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const url = args[0]
  if (typeof url !== "string") throw new Error("consume requires a fork pull request url")
  const explicit = option(args, "--slug")
  const targets = explicit !== null ? [loadTarget(explicit)] : loadAll().filter((t) => typeof t.fork === "string" && url.toLowerCase().startsWith(`https://github.com/${t.fork.toLowerCase()}/pull/`))
  const target = targets.length === 1 ? targets[0] : null
  const outcome = consumePr(url, { exec, write: target?.slug ?? null })
  if (target !== null) {
    target.consumption = upsertRow(target.consumption, consumptionRow(outcome), (r) => Number(r.forkPr)).rows
    save(target)
  }
  log(outcome.report)
  return outcome
}

/**
 * Ledger row for one consumption check. Receipts are kept in full (minus the
 * source bodies, which live in `out/<slug>/pr-<N>-consume.json`) so a later
 * reader can recover who touched the evidence even when nothing was consumed.
 * @param {ReturnType<typeof consumePr>} outcome
 */
export function consumptionRow(outcome) {
  const r = outcome.result
  return {
    forkPr: outcome.number, headSha: r.headSha, consumed: r.consumed, consumers: r.consumers,
    mirror: r.mirror, recordBound: r.recordBound, signals: r.signals, receipts: r.receipts,
    raw: outcome.rawRef, checkedAt: new Date().toISOString(),
  }
}

/** replay harvest <slug> [--limit N] [--state all|open|closed|merged] [--fork owner/repo --upstream owner/repo] */
export function harvest(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const slug = args[0]
  if (typeof slug !== "string" || slug.startsWith("--")) throw new Error("harvest requires a target slug")
  const fork = option(args, "--fork")
  const upstream = option(args, "--upstream")
  if (fork !== null && !/^garnet-labs\//i.test(fork)) throw new Error(`harvest reads fork pull requests only; ${fork} is not a garnet-labs fork`)
  const target = fork !== null || upstream !== null
    ? ensureTarget(assertSlug(slug), { upstream: upstream === null ? null : assertRepoSlug(upstream), fork: fork === null ? null : assertRepoSlug(fork) })
    : loadTarget(slug)
  if (typeof target.fork !== "string") throw new Error(`target '${slug}' has no fork; pass --fork owner/repo`)
  if (!/^garnet-labs\//i.test(target.fork)) throw new Error(`harvest reads fork pull requests only; ${target.fork} is not a garnet-labs fork`)
  const limit = Number(option(args, "--limit", "50"))
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")
  const state = option(args, "--state", "all")
  const candidates = harvestCandidates(target.fork, { limit, state, exec })
  const rows = []
  for (const candidate of candidates) {
    if (!candidate.recorded) {
      rows.push({ number: candidate.number, result: null, skipped: "no record comment" })
      continue
    }
    const outcome = consumePr(`https://github.com/${target.fork}/pull/${candidate.number}`, { exec, write: target.slug, comments: candidate.comments })
    target.consumption = upsertRow(target.consumption, consumptionRow(outcome), (r) => Number(r.forkPr)).rows
    rows.push({ number: candidate.number, result: outcome.result })
  }
  save(target)
  const report = renderHarvestReport(rows, { fork: target.fork })
  const path = outPath(target.slug, "consumption-harvest.md")
  writeFileSync(path, report)
  log(report)
  log(`written ${path}`)
  return { slug: target.slug, fork: target.fork, rows, report, path }
}

/** replay status [<slug>] */
export function status(args, { log = console.log } = {}) {
  const slug = typeof args[0] === "string" && !args[0].startsWith("--") ? assertSlug(args[0]) : null
  const targets = loadAll(slug === null ? undefined : [slug])
  log(renderBoardText(targets))
  if (slug === null && !flag(args, "--no-write")) log(`wrote ${writeBoard(targets)}`)
  return targets
}

/** replay stage2 <slug> [--ecosystem x] [--no-draft] [--dry-run] */
export async function stage2(args, { exec = run, log = console.log, save = saveTarget, io = undefined } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  const defaultBranch = forkDefaultBranch(target.fork, { exec })
  const recording = forkHasRecordingWorkflow(target.fork, defaultBranch, { exec })
  let harnessSha = null
  try {
    harnessSha = String(exec("git", ["-C", fileURLToPath(new URL("..", import.meta.url)), "rev-parse", "HEAD"], { encoding: "utf8" })).trim()
  } catch {
    harnessSha = null
  }
  const plan = planStage2({
    slug, upstream: target.upstream, fork: target.fork, defaultBranch, ecosystem: option(args, "--ecosystem"),
    recording: { ...recording, name: recording.name ?? null }, workExists: existsSync(workDirFor(slug)), draft: !flag(args, "--no-draft"),
    harnessSha,
  })
  if (flag(args, "--dry-run")) {
    log(renderStage2Plan(plan))
    return { plan, executed: false }
  }
  const captured = await executePlan(plan, { exec, log, ...(io === undefined ? {} : { io }) })
  target.stage2 = {
    state: "in-flight",
    branch: plan.branch,
    forkPr: captured.forkPr ?? null,
    note: captured.forkPr === undefined ? "mirror + gate branch pushed" : `mirror + gate in fork pull request ${captured.forkPr}; done once merged to ${defaultBranch} and garnet/evidence is required`,
    openedAt: new Date().toISOString(),
  }
  save(target)
  log(`stage 2 pull request ${captured.forkPr ?? "(not opened)"} on ${target.fork} · merge it to ${defaultBranch}, then set the job garnet/evidence as required`)
  return { plan, captured, executed: true }
}
