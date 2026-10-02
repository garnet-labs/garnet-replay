/**
 * Read the Execution Profiles an upstream repository already records on its own
 * pull requests (the Garnet action in its CI), without a replay. Read-only: no
 * fork, no ledger write, no comment. Every row keeps its run, job, attempt,
 * profile, action SHA and the ref the profile is bound to.
 */
import { run } from "./gh.mjs"

const PROFILE_LINK_RE = /https:\/\/app\.garnet\.ai\/public\/runs\/(\d+)\?profile=([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/gi
const ACTION_SHA_RE = /Download action repository 'garnet-org\/action@([0-9a-f]{40})'/
const AUTH_SKIP_RE = /Garnet skipped this Runtime Review because no authentication mechanism was available/
const GARNET_STEP_RE = /garnet/i
const BACKGROUND_STEP_RE = /^\s*\d*\.?\s*Runner Processes\s*$/i
const SHARD_RE = /(^|\.)(blob\.core\.windows(\.net)?|store\.core\.windows(\.net)?|trafficmanager\.net|actions\.githubusercontent(\.com)?)$|^glb-[0-9a-f]+\.github\.com$|^productionresultssa\d+\./i
const ADDRESS_RE = /^[0-9.]+$|:/

/**
 * Unique public profile links printed in one job log.
 * @param {string} log
 * @returns {{runId: string, profileId: string, url: string}[]}
 */
export function profileLinks(log) {
  const seen = new Map()
  for (const match of String(log ?? "").matchAll(PROFILE_LINK_RE)) {
    const url = `https://app.garnet.ai/public/runs/${match[1]}?profile=${match[2].toLowerCase()}`
    if (!seen.has(url)) seen.set(url, { runId: match[1], profileId: match[2].toLowerCase(), url })
  }
  return [...seen.values()]
}

/**
 * What one job log says about the Garnet step.
 * @param {string} log
 * @returns {{actionSha: string|null, authSkipped: boolean, links: {runId: string, profileId: string, url: string}[]}}
 */
export function readJobLog(log) {
  const text = String(log ?? "")
  return { actionSha: ACTION_SHA_RE.exec(text)?.[1] ?? null, authSkipped: AUTH_SKIP_RE.test(text), links: profileLinks(text) }
}

/**
 * Runner/CDN shards and bare addresses churn between any two runs; they are
 * background, never a finding.
 * @param {string} destination
 * @returns {boolean}
 */
export function isShard(destination) {
  return SHARD_RE.test(destination) || ADDRESS_RE.test(destination)
}

function lineageTail(ancestry) {
  const names = (Array.isArray(ancestry) ? ancestry : []).filter((name) => typeof name === "string" && name !== "")
  const worker = names.lastIndexOf("Runner.Worker")
  return (worker === -1 ? names.slice(-4) : names.slice(worker + 1)).join(" → ")
}

/**
 * One public profile as destinations with the process lineage that reached them.
 * A workload row has a real step and descends from Runner.Worker; everything
 * else, and every shard, is background.
 * @param {Record<string, any>} profile public `profile` object (runtime-review-public/v3)
 * @param {{headSha?: string|null}} [options]
 */
export function summarizeUpstreamProfile(profile, { headSha = null } = {}) {
  const runInfo = profile?.run ?? {}
  const ref = String(runInfo.ref ?? "")
  const commitSha = String(runInfo.commit_sha ?? "")
  const binding = headSha !== null && commitSha === headSha ? "exact-head" : /^refs\/pull\/\d+\/merge$/.test(ref) ? "merge-ref" : "unbound"
  const workload = new Map()
  const background = new Set()
  for (const association of Array.isArray(profile?.associations) ? profile.associations : []) {
    const ancestry = Array.isArray(association?.ancestry) ? association.ancestry : []
    const step = String(association?.github_step ?? "")
    const names = Array.isArray(association?.remote_names) && association.remote_names.length > 0
      ? association.remote_names
      : [String(association?.remote_address ?? "")]
    for (const destination of names.filter((name) => name !== "")) {
      if (isShard(destination) || BACKGROUND_STEP_RE.test(step) || !ancestry.includes("Runner.Worker")) {
        background.add(destination)
        continue
      }
      const row = workload.get(destination) ?? { destination, lineages: new Set(), steps: new Set(), ports: new Set() }
      row.lineages.add(lineageTail(ancestry))
      row.steps.add(step.replace(/^\d+\.\s*/, ""))
      for (const port of Array.isArray(association?.remote_ports) ? association.remote_ports : []) row.ports.add(String(port))
      workload.set(destination, row)
    }
  }
  return {
    runId: String(runInfo.run_id ?? ""),
    profileId: String(runInfo.profile_id ?? ""),
    repository: String(runInfo.repository ?? ""),
    workflow: String(runInfo.workflow ?? ""),
    job: String(runInfo.job ?? ""),
    commitSha,
    ref,
    binding,
    capture: "undeclared",
    assertions: (Array.isArray(profile?.assertions) ? profile.assertions : []).map((entry) => ({ id: String(entry?.id ?? ""), result: String(entry?.result ?? "") })),
    workload: [...workload.values()]
      .map((row) => ({ destination: row.destination, lineages: [...row.lineages].sort(), steps: [...row.steps].sort(), ports: [...row.ports].sort() }))
      .sort((left, right) => left.destination.localeCompare(right.destination)),
    background: [...background].sort(),
  }
}

/**
 * Workload destinations seen in every profile versus only some. Profiles of
 * one pull request across pushes; a destination in only some of them is a
 * lead to read, not a change the push caused (the test scope, caches and the
 * merge base can differ between pushes).
 * @param {ReturnType<typeof summarizeUpstreamProfile>[]} summaries
 */
export function acrossProfiles(summaries) {
  const counts = new Map()
  for (const summary of summaries) {
    for (const row of summary.workload) {
      const entry = counts.get(row.destination) ?? { destination: row.destination, runs: [], lineages: new Set() }
      entry.runs.push(summary.runId)
      for (const lineage of row.lineages) entry.lineages.add(lineage)
      counts.set(row.destination, entry)
    }
  }
  const rows = [...counts.values()]
    .map((entry) => ({ destination: entry.destination, runs: entry.runs, lineages: [...entry.lineages].sort() }))
    .sort((left, right) => left.destination.localeCompare(right.destination))
  return {
    profiles: summaries.length,
    always: rows.filter((row) => row.runs.length === summaries.length),
    sometimes: rows.filter((row) => row.runs.length < summaries.length),
  }
}

/**
 * Markdown report for one upstream pull request.
 * @param {Record<string, any>} report
 * @returns {string}
 */
export function renderUpstreamReport(report) {
  const lines = [
    `# ${report.repository}#${report.pr} — recorded Execution Profiles`,
    "",
    `${report.title}`,
    "",
    `Read ${report.observedAt} · head ${report.headSha.slice(0, 12)} · ${report.crossRepository ? "contributor fork (the action cannot authenticate; expect no profile)" : "same-repository branch"}`,
    "",
    "Claim class: observation of recorded jobs. Capture completeness is not declared, so absence of a destination is not evidence of absence; nothing here is causal.",
    "",
    "## Jobs",
    "",
    "| run · attempt | job | commit | bound to | action | profile |",
    "|---|---|---|---|---|---|",
  ]
  for (const job of report.jobs) {
    const profile = job.profiles.length === 0 ? (job.authSkipped ? "skipped: no authentication" : "none in log") : job.profiles.map((entry) => `[${entry.profileId.slice(0, 8)}](${entry.url})`).join(" ")
    const commit = job.summary === null ? "—" : job.summary.commitSha.slice(0, 9)
    const bound = job.summary === null ? "—" : job.summary.binding === "merge-ref" ? `merge ref \`${job.summary.ref}\`` : job.summary.binding
    lines.push(`| [${job.runId} · ${job.attempt}](${job.jobUrl}) | ${job.name} | ${commit} | ${bound} | ${job.actionSha === null ? "—" : job.actionSha.slice(0, 8)} | ${profile} |`)
  }
  const across = report.across
  lines.push("", `## Workload destinations across ${across.profiles} profile(s)`, "")
  if (across.profiles === 0) {
    lines.push(report.jobs.length === 0 ? "No job ran a Garnet step on this pull request's pushes: nothing recorded." : "No readable profile: undeterminable.")
    return `${lines.join("\n")}\n`
  }
  lines.push("| destination | seen in | process lineage (after Runner.Worker) |", "|---|---|---|")
  for (const row of [...across.sometimes, ...across.always]) {
    lines.push(`| \`${row.destination}\` | ${row.runs.length}/${across.profiles} | ${row.lineages.slice(0, 3).map((lineage) => `\`${lineage}\``).join("<br>")}${row.lineages.length > 3 ? `<br>+${row.lineages.length - 3} more` : ""} |`)
  }
  const assertions = new Map()
  for (const job of report.jobs) for (const entry of job.summary?.assertions ?? []) assertions.set(`${entry.id}=${entry.result}`, (assertions.get(`${entry.id}=${entry.result}`) ?? 0) + 1)
  if (assertions.size > 0) {
    lines.push("", "Assertions: " + [...assertions.entries()].map(([key, count]) => `\`${key}\` ×${count}`).join(" · "))
  }
  lines.push("", "Runner/CDN shards, bare addresses and runner-process rows are background and omitted.")
  return `${lines.join("\n")}\n`
}

/**
 * Collect one upstream pull request's recorded profiles.
 * @param {string} repository owner/name
 * @param {number} pr
 * `limit` counts workflow runs with a Garnet step that ran.
 * @param {{limit?: number, exec?: typeof run, fetchImpl?: typeof fetch, now?: () => Date}} [options]
 */
export async function collectUpstream(repository, pr, { limit = 20, exec = run, fetchImpl = fetch, now = () => new Date() } = {}) {
  const view = JSON.parse(exec("gh", ["api", `repos/${repository}/pulls/${pr}`]))
  const headRepo = String(view?.head?.repo?.full_name ?? "")
  const headSha = String(view?.head?.sha ?? "")
  const branch = String(view?.head?.ref ?? "")
  const commits = JSON.parse(exec("gh", ["api", `repos/${repository}/pulls/${pr}/commits?per_page=100`]))
  const pushed = new Set((Array.isArray(commits) ? commits : []).map((commit) => String(commit?.sha ?? "")))
  const runs = JSON.parse(exec("gh", ["api", `repos/${repository}/actions/runs?event=pull_request&branch=${encodeURIComponent(branch)}&per_page=100`]))
  const mine = (Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [])
    .filter((entry) => entry?.head_repository?.full_name === headRepo && pushed.has(String(entry?.head_sha ?? "")))
  const jobs = []
  let recordedRuns = 0
  for (const entry of mine) {
    if (recordedRuns >= limit) break
    let recordedHere = false
    const listed = JSON.parse(exec("gh", ["api", `repos/${repository}/actions/runs/${entry.id}/jobs?per_page=100`]))
    for (const job of Array.isArray(listed?.jobs) ? listed.jobs : []) {
      if (!(job?.steps ?? []).some((step) => GARNET_STEP_RE.test(String(step?.name ?? "")) && step?.conclusion !== "skipped")) continue
      recordedHere = true
      let log = ""
      try { log = exec("gh", ["api", `repos/${repository}/actions/jobs/${job.id}/logs`]) } catch { log = "" }
      const read = readJobLog(log)
      let summary = null
      for (const link of read.links) {
        const response = await fetchImpl(`https://app.garnet.ai/api/public/runs/${link.runId}?profile=${link.profileId}`, { redirect: "error", signal: AbortSignal.timeout(15000) })
        if (!response.ok) continue
        const body = await response.json()
        if (body?.profile) summary = summarizeUpstreamProfile(body.profile, { headSha })
      }
      jobs.push({ runId: String(entry.id), attempt: Number(job.run_attempt ?? entry.run_attempt ?? 1), workflow: String(entry.name ?? ""), name: String(job.name ?? ""), jobUrl: String(job.html_url ?? ""), headSha: String(entry.head_sha ?? ""), conclusion: String(job.conclusion ?? ""), actionSha: read.actionSha, authSkipped: read.authSkipped, profiles: read.links, summary })
    }
    if (recordedHere) recordedRuns += 1
  }
  const summaries = jobs.map((job) => job.summary).filter((summary) => summary !== null)
  return {
    schema_version: "upstream-profiles/v1",
    repository,
    pr,
    title: String(view?.title ?? ""),
    headSha,
    crossRepository: headRepo !== repository,
    observedAt: now().toISOString(),
    jobs,
    across: acrossProfiles(summaries),
  }
}
