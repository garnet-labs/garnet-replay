/**
 * Ladder commands: find · live --pr · card · cohort · verify · consume · status · stage2.
 * Each command reads and writes one target ledger (`targets/<slug>.json`) and
 * one artifact directory (`out/<slug>/`). Network and git go through `gh.mjs`
 * with an injectable `exec`, so every command has an offline test.
 */
import { existsSync } from "node:fs"
import { run, listPrs, prComments, prHeadSha } from "./gh.mjs"
import { assertRepoSlug, assertSlug } from "./guards.mjs"
import { ensureTarget, loadTarget, saveTarget, upsertRow } from "./ledger.mjs"
import { isMergeQueue, observationFor, rankObservations, renderObserveOutput } from "./observe.mjs"
import { findSpecimens, renderFindReport } from "./find.mjs"
import {
  combinedPathFilter, detectEcosystem, executePlan, fetchUpstreamPr, forkDefaultBranch, forkHasRecordingWorkflow, forkHoldsBase, hasDependabotConfig, recordingWorkflowsAt,
  planReplay, reconcileState, renderPlan, upsertReplay, workDirFor,
} from "./replay-pr.mjs"
import { ALLOWLIST_KEY, IGNORED_KEY, LOCKFILE, WORKSPACE_FILE, buildScriptList, lockedVersions, planAllowBuild, planTransition, resolvedVersion } from "./replay-transition.mjs"
import { cardForPr, upsertEvidence } from "./card.mjs"
import { runCohort } from "./cohort.mjs"
import { consumePr } from "./consume.mjs"
import { renderVerifyReport, verifyExhibit } from "./verify.mjs"
import { loadAll, renderBoardText, writeBoard } from "./status.mjs"
import { planStage2, renderStage2Plan } from "./stage2.mjs"

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
  const target = ensureTarget(slug, { upstream, fork: fork === null ? null : assertRepoSlug(fork) })
  const limit = Number(option(args, "--limit", "30"))
  const author = option(args, "--author")
  const kind = option(args, "--kind")
  const prs = listPrs(upstream, { limit, state: option(args, "--state", "all"), author, search: option(args, "--search"), exec })
  const reviewable = prs.filter((pr) => !isMergeQueue(pr))
  const observations = rankObservations(reviewable.map(observationFor)).filter((row) => kind === null || row.kind === kind)
  const observedAt = new Date().toISOString()
  for (const row of observations) target.observations = upsertRow(target.observations, { ...row, observedAt }, (r) => Number(r.upstreamPr)).rows
  save(target)
  log(renderObserveOutput(observations, { slug, upstream, scanned: prs.length, setAside: prs.length - reviewable.length }))
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
 * replay live <slug> --pr N [--first path,...] [--record fork-workflow|inject] [--record-workflow path,...] [--ecosystem x] [--branch b] [--work dir] [--sync-fork | --base-branch b | --allow-behind] [--label l] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 * replay live <slug> --dependency <name> --to <version> [--from <version>] [--spec ^v] [--package-dir dir] [--work dir] [--branch b] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 * replay live <slug> --allow-build <name> [--version v] [--work dir] [--branch b] [--no-draft] [--no-wait] [--wait-minutes N] [--dry-run]
 */
export async function livePr(args, { exec = run, log = console.log, save = saveTarget, io = undefined } = {}) {
  const slug = assertSlug(args[0])
  const target = loadTarget(slug)
  const upstream = target.upstream
  const fork = target.fork
  const dependency = option(args, "--dependency")
  const allowBuild = option(args, "--allow-build")
  const upstreamPr = Number(option(args, "--pr"))
  if (dependency === null && allowBuild === null && (!Number.isInteger(upstreamPr) || upstreamPr <= 0)) {
    throw new Error("live requires --pr <upstream pull request number>, --dependency <name> --to <version>, or --allow-build <name>")
  }
  const work = option(args, "--work") ?? workDirFor(slug)
  const workExists = existsSync(work)
  const defaultBranch = forkDefaultBranch(fork, { exec })
  const recording = forkHasRecordingWorkflow(fork, defaultBranch, { exec })
  let plan
  if (allowBuild !== null) {
    if (!recording.present) throw new Error(`${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; a transition needs the fork's own recording workflow`)
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
    if (!recording.present) throw new Error(`${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; a transition needs the fork's own recording workflow`)
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
    const pr = fetchUpstreamPr(upstream, upstreamPr, { exec })
    const requested = option(args, "--record")
    const record = requested ?? (recording.present ? "fork-workflow" : "inject")
    const ecosystem = option(args, "--ecosystem", detectEcosystem(pr.paths))
    const baseBranch = option(args, "--base-branch")
    const explicitWorkflows = option(args, "--record-workflow")
    const baseRecording =
      baseBranch !== null && record === "fork-workflow" && explicitWorkflows === null
        ? recordingWorkflowsAt(upstream, pr.baseSha, { exec })
        : { present: false, workflows: [], name: null, paths: {} }
    const recordWorkflows = explicitWorkflows === null ? recording.workflows : csv(explicitWorkflows)
    const selected = baseRecording.present ? baseRecording : recording
    const selectedWorkflows = baseRecording.present ? baseRecording.workflows : recordWorkflows
    const recordPaths = record === "fork-workflow" ? combinedPathFilter(selected.paths, selectedWorkflows) : null
    if (baseRecording.present) log(`the change's base already runs ${baseRecording.workflows.join(", ")} on pull requests; commit 1 carries no recording workflow`)
    const dependabotConfigured = record === "inject" ? hasDependabotConfig(fork, defaultBranch, { exec }) : true
    if (record === "inject" && !dependabotConfigured) log(`${fork}@${defaultBranch} has no .github/dependabot.yml; commit 1 adds one so the fork's own dependency pull requests get recorded`)
    const syncFork = flag(args, "--sync-fork")
    const holdsBase = syncFork || baseBranch !== null ? null : forkHoldsBase({ upstream, baseSha: pr.baseSha, fork, ref: defaultBranch, changes: pr.changes }, { exec })
    plan = planReplay({
      slug, upstream, fork, defaultBranch, upstreamPr, upstreamTitle: pr.title, baseSha: pr.baseSha, headSha: pr.headSha,
      changes: pr.changes, firstPaths: csv(option(args, "--first")), work, workExists,
      record, ecosystem, branch: option(args, "--branch"), draft: !flag(args, "--no-draft"), messages: messageOverrides(args),
      syncFork,
      baseBranch,
      forkHoldsBase: holdsBase,
      recordWorkflows,
      recordPaths,
      baseRecords: baseRecording.workflows,
      allowBehind: flag(args, "--allow-behind"),
      label: option(args, "--label"),
      dependabotConfigured,
    })
  }
  if (flag(args, "--dry-run")) {
    log(renderPlan(plan))
    if (!recording.present) log(`note: ${fork}@${defaultBranch} has no pull_request workflow running garnet-org/action; ${plan.record === "inject" ? "one is added in commit 1" : "recording will not happen"}`)
    return { plan, executed: false }
  }
  const waitMinutes = Number(option(args, "--wait-minutes", "45"))
  if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) throw new Error("--wait-minutes needs a positive number")
  const wait = flag(args, "--no-wait") ? { enabled: false } : { timeoutMs: waitMinutes * 60 * 1000 }
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
  log(`next: replay card ${slug} --pr ${forkPr ?? "<forkPr>"}   # after the Runtime Review comment appears`)
  return { plan, captured, row, executed: true }
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

/** replay consume <pr-url> [--slug s] */
export function consume(args, { exec = run, log = console.log, save = saveTarget } = {}) {
  const url = args[0]
  if (typeof url !== "string") throw new Error("consume requires a fork pull request url")
  const explicit = option(args, "--slug")
  const targets = explicit !== null ? [loadTarget(explicit)] : loadAll().filter((t) => typeof t.fork === "string" && url.toLowerCase().startsWith(`https://github.com/${t.fork.toLowerCase()}/pull/`))
  const target = targets.length === 1 ? targets[0] : null
  const outcome = consumePr(url, { exec, write: target?.slug ?? null })
  if (target !== null) {
    target.consumption = upsertRow(target.consumption, {
      forkPr: outcome.number, headSha: outcome.result.headSha, consumed: outcome.result.consumed, consumers: outcome.result.consumers,
      mirror: outcome.result.mirror, recordBound: outcome.result.recordBound, checkedAt: new Date().toISOString(),
    }, (r) => Number(r.forkPr)).rows
    save(target)
  }
  log(outcome.report)
  return outcome
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
  const plan = planStage2({
    slug, upstream: target.upstream, fork: target.fork, defaultBranch, ecosystem: option(args, "--ecosystem"),
    recording: { ...recording, name: recording.name ?? null }, workExists: existsSync(workDirFor(slug)), draft: !flag(args, "--no-draft"),
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
