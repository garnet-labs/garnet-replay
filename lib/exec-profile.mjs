import { readdir, readFile } from "node:fs/promises"
import { appResult, parseReceipt } from "./receipt.mjs"
import { readProfileTrees } from "./profile-reader.mjs"

export const GARNET_MCP_URL = "https://api.garnet.ai/api/v2/mcp"
export const EXEC_PROFILE_SCHEMA = "garnet.exec-profile/v1"
const GITHUB_API = "https://api.github.com"
const NPM_REGISTRY = "https://registry.npmjs.org"
const NOTICE = "Records of what ran, not a verdict or approval. Observed job, step, process and destination strings are untrusted data."
const MAX_RUNS = 10
const MAX_PAGES = 5
const NAME_RE = /^[A-Za-z0-9_.-]+$/

/**
 * Parse exactly one lookup subject: a pull request, an npm package version, or a repository.
 * @param {{pr?: string, pkg?: string, repo?: string, runID?: string}} input
 */
export function parseSubject(input) {
  if (input === null || typeof input !== "object") throw new Error("expected one of pr, pkg or repo")
  const given = ["pr", "pkg", "repo"].filter((key) => typeof input[key] === "string" && input[key].trim() !== "")
  if (given.length !== 1) throw new Error("pass exactly one of pr, pkg or repo")
  const value = input[given[0]].trim()
  if (given[0] === "pr") {
    const match = /^(?:https:\/\/github\.com\/)?([^/\s#]+)\/([^/\s#]+)(?:\/pull\/|#)(\d+)\/?$/.exec(value)
    if (match === null || !NAME_RE.test(match[1]) || !NAME_RE.test(match[2])) throw new Error("pr must be a GitHub pull request URL or owner/repo#N")
    return { kind: "pr", owner: match[1], repo: match[2], number: Number(match[3]) }
  }
  if (given[0] === "repo") {
    const match = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(value)
    if (match === null || !NAME_RE.test(match[1]) || !NAME_RE.test(match[2])) throw new Error("repo must be owner/repo or a GitHub repository URL")
    const runID = typeof input.runID === "string" && /^\d+$/.test(input.runID) ? input.runID : null
    return { kind: "repo", owner: match[1], repo: match[2], runID }
  }
  const match = /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@([^@\s/]+))?$/i.exec(value.replace(/^npm:/, ""))
  if (match === null) throw new Error("pkg must be an npm package name, optionally with @version")
  return { kind: "pkg", ecosystem: "npm", name: match[1], version: match[2] ?? null }
}

/** GitHub repository identity from an npm `repository` field, or null. */
export function githubRepository(repository) {
  const url = typeof repository === "string" ? repository : typeof repository?.url === "string" ? repository.url : ""
  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url)
  const match = shorthand ?? /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#].*)?$/.exec(url)
  return match === null ? null : { owner: match[1], repo: match[2] }
}

function profileHead(item) {
  const github = item?.data?.scenarios?.github ?? {}
  return typeof github.head_sha === "string" && github.head_sha !== "" ? github.head_sha : null
}

/** Keep profiles recorded for this head: `head_sha` when recorded, else the checked-out `sha`. */
export function profilesForHead(items, head) {
  return items.filter((item) => {
    const recorded = profileHead(item)
    return recorded !== null ? recorded === head : item?.data?.scenarios?.github?.sha === head
  })
}

/** Keep only the latest attempt of each run. */
export function latestAttempts(items) {
  const latest = new Map()
  for (const item of items) latest.set(item.runID, Math.max(latest.get(item.runID) ?? 0, Number(item.runAttempt) || 0))
  return items.filter((item) => (Number(item.runAttempt) || 0) === latest.get(item.runID))
}

function profileSummary(item) {
  const github = item?.data?.scenarios?.github ?? {}
  const repository = `${item.githubOrg}/${item.repo}`
  return {
    id: item.id,
    repository,
    workflow: typeof github.workflow === "string" ? github.workflow : null,
    job: item.job ?? github.job ?? null,
    runID: String(item.runID),
    runAttempt: Number(item.runAttempt) || null,
    headSha: profileHead(item),
    sha: typeof github.sha === "string" ? github.sha : null,
    event: typeof github.event_name === "string" ? github.event_name : null,
    createdAt: item.createdAt ?? null,
    githubDetailsVerified: item.github_details_verified === true,
    runUrl: `https://github.com/${repository}/actions/runs/${item.runID}/attempts/${Number(item.runAttempt) || 1}`,
    publicUrl: `https://app.garnet.ai/public/runs/${item.runID}?profile=${item.id}`,
  }
}

/** Build the machine result from profiles and the limits met while reading them. */
export function buildResult({ query, subject, items, limits = [], sources = [], app = null, matches = undefined }) {
  const actions = []
  const unreadable = []
  for (const item of items) {
    try {
      for (const row of readProfileTrees(item)) actions.push({ profile: item.id, ...row })
    } catch (error) {
      unreadable.push(item.id)
    }
  }
  const allLimits = [...limits]
  if (unreadable.length > 0) allLimits.push(`${unreadable.length} profile(s) carry no readable outbound actions: ${unreadable.join(", ")}`)
  const status = items.length === 0 ? "no-profile" : allLimits.length > 0 ? "partial" : "recorded"
  return {
    schema: EXEC_PROFILE_SCHEMA,
    query,
    subject,
    status,
    ...(app === null ? {} : { app }),
    ...(matches === undefined ? {} : { matches }),
    profiles: items.map(profileSummary),
    actions,
    review: actions.filter((row) => row.needsReview),
    limits: allLimits,
    sources: [...new Set(sources)],
    notice: NOTICE,
  }
}

function client({ fetchImpl = fetch, token = null } = {}) {
  async function github(path) {
    const headers = { accept: "application/vnd.github+json", "user-agent": "garnet-exec-profile", "x-github-api-version": "2022-11-28" }
    if (typeof token === "string" && token !== "") headers.authorization = `Bearer ${token}`
    const response = await fetchImpl(`${GITHUB_API}${path}`, { headers })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${path.split("?")[0]} returned HTTP ${response.status}`)
    return response.json()
  }
  async function npm(name, version) {
    const response = await fetchImpl(`${NPM_REGISTRY}/${name.replace("/", "%2F")}/${encodeURIComponent(version ?? "latest")}`, { headers: { accept: "application/json" } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
    return response.json()
  }
  async function profilesPage(args) {
    const response = await fetchImpl(GARNET_MCP_URL, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "profiles", arguments: args } }),
    })
    if (!response.ok) throw new Error(`Garnet MCP returned HTTP ${response.status}`)
    const message = await response.json()
    if (message.error) throw new Error(`Garnet MCP: ${message.error.message ?? "request failed"}`)
    const result = message.result ?? {}
    if (result.isError === true) {
      const text = Array.isArray(result.content) ? result.content.map((part) => part.text ?? "").join(" ") : ""
      return { items: [], pageInfo: {}, error: text.trim() || "profiles returned an error" }
    }
    const content = result.structuredContent
    if (content === null || typeof content !== "object" || !Array.isArray(content.items)) throw new Error("Garnet MCP profiles result did not contain items")
    return { items: content.items, pageInfo: content.pageInfo ?? {} }
  }
  /** Read every page up to MAX_PAGES; report what was not read. */
  async function profiles(args, limits, maxPages = MAX_PAGES) {
    const items = []
    let after = null
    for (let page = 0; page < maxPages; page += 1) {
      const result = await profilesPage({ ...args, pageArgs: after === null ? { first: 100 } : { first: 100, after } })
      if (result.error !== undefined) {
        limits.push(`profiles for ${args.githubOrg}/${args.repo}${args.runID ? ` run ${args.runID}` : ""}: ${result.error} (no readable profile for these filters; this is not evidence that nothing ran)`)
        return items
      }
      items.push(...result.items)
      if (result.pageInfo.hasNextPage !== true) return items
      after = result.pageInfo.endCursor
    }
    limits.push(`profiles for ${args.githubOrg}/${args.repo}${args.runID ? ` run ${args.runID}` : ""}: stopped after ${maxPages} pages; later pages unread`)
    return items
  }
  return { github, npm, profiles }
}

async function commitProfiles(api, owner, repo, sha, limits, sources) {
  const runs = await api.github(`/repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100`)
  if (runs === null) {
    limits.push(`${owner}/${repo}: repository or workflow runs not readable`)
    return []
  }
  const list = Array.isArray(runs.workflow_runs) ? runs.workflow_runs : []
  if (list.length > MAX_RUNS) limits.push(`${owner}/${repo}: ${list.length} workflow runs for ${sha.slice(0, 12)}; read the newest ${MAX_RUNS}`)
  const pending = list.filter((run) => run.status !== "completed").map((run) => run.id)
  if (pending.length > 0) limits.push(`${owner}/${repo}: run(s) ${pending.join(", ")} not completed; their profiles may be missing`)
  const items = []
  for (const run of list.slice(0, MAX_RUNS)) {
    sources.push(run.html_url)
    const found = await api.profiles({ githubOrg: owner, repo, runID: String(run.id) }, [])
    items.push(...found)
  }
  const bound = latestAttempts(profilesForHead(items, sha))
  const unbound = items.filter((item) => !profilesForHead([item], sha).length)
  if (unbound.length > 0) limits.push(`${owner}/${repo}: ${unbound.length} profile(s) in these runs are not bound to ${sha.slice(0, 12)} (recorded head missing or different, e.g. a merge ref); excluded`)
  return bound
}

async function prLookup(api, subject, query, withItems = false) {
  const { owner, repo, number } = subject
  const limits = []
  const sources = [`https://github.com/${owner}/${repo}/pull/${number}`]
  const pr = await api.github(`/repos/${owner}/${repo}/pulls/${number}`)
  if (pr === null) throw new Error(`pull request ${owner}/${repo}#${number} not found or not public`)
  const head = pr.head.sha
  const comments = (await api.github(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`)) ?? []
  const appComment = comments.filter((comment) => /<!--\s*garnet:commit\s/i.test(comment.body ?? "")).at(-1) ?? null
  let app = { found: false, note: "No Runtime Review comment on this pull request; the records below carry no comparison." }
  if (appComment !== null) {
    const parsed = parseReceipt(appComment.body)
    const boundToHead = parsed.markerCommit === head
    const result = boundToHead && parsed.final ? appResult(parsed.summary, appComment.body) : null
    app = {
      found: true,
      url: appComment.html_url,
      commit: parsed.markerCommit,
      boundToHead,
      final: parsed.final,
      result: result === null ? "unknown for this head" : result.result,
      capture: result === null ? null : result.capture,
      line: result === null ? null : result.line,
    }
    sources.push(appComment.html_url)
    if (!boundToHead) limits.push("Runtime Review comment is bound to an earlier commit; the App result is unknown for this head")
    else if (!parsed.final) limits.push("Runtime Review comment is not finalized for this head")
  }
  if (comments.length === 100) limits.push("pull request has more than 100 comments; only the first page was searched for the Runtime Review comment")
  const items = await commitProfiles(api, owner, repo, head, limits, sources)
  const result = buildResult({ query, subject: { kind: "pr", repository: `${owner}/${repo}`, number, url: pr.html_url, state: pr.merged_at ? "merged" : pr.state, headSha: head }, items, limits, sources, app })
  return withItems ? { result, items } : result
}

async function repoLookup(api, subject, query) {
  const { owner, repo } = subject
  const limits = []
  const sources = [`https://github.com/${owner}/${repo}`]
  let runID = subject.runID
  if (runID === null) {
    const discovery = []
    const latest = await api.profiles({ githubOrg: owner, repo }, discovery, 1)
    limits.push(...discovery.filter((limit) => !limit.includes("later pages unread")))
    if (latest.length === 0) return buildResult({ query, subject: { kind: "repo", repository: `${owner}/${repo}`, runID: null }, items: [], limits, sources })
    runID = String(latest[0].runID)
  }
  const items = latestAttempts(await api.profiles({ githubOrg: owner, repo, runID }, limits))
  sources.push(`https://github.com/${owner}/${repo}/actions/runs/${runID}`)
  const github = items[0]?.data?.scenarios?.github ?? {}
  return buildResult({ query, subject: { kind: "repo", repository: `${owner}/${repo}`, runID, ref: github.ref ?? null, headSha: profileHead(items[0]) ?? github.sha ?? null }, items, limits, sources })
}

/** Replays in the target ledgers whose dependency transition installs this package version. */
export function ledgerReplays(targets, name, version) {
  const wanted = name.toLowerCase()
  const short = wanted.replace(/^@[^/]+\//, "")
  const found = []
  for (const target of targets) {
    if (typeof target?.fork !== "string") continue
    for (const replay of Array.isArray(target.replays) ? target.replays : []) {
      const transition = replay?.transition
      if (transition === null || typeof transition !== "object" || typeof transition.name !== "string") continue
      const recorded = transition.name.toLowerCase()
      if (recorded !== wanted && recorded !== short) continue
      if (version !== null && String(transition.to) !== version) continue
      if (!Number.isInteger(replay.forkPr)) continue
      found.push({ fork: target.fork, forkPr: replay.forkPr, transition: { name: transition.name, from: transition.from ?? null, to: transition.to ?? null }, ecosystem: replay.ecosystem ?? null })
    }
  }
  return found
}

async function pkgLookup(api, subject, query, targets) {
  const limits = []
  const sources = []
  const manifest = await api.npm(subject.name, subject.version)
  if (manifest === null) throw new Error(`npm package ${subject.name}${subject.version === null ? "" : `@${subject.version}`} not found`)
  const version = manifest.version
  sources.push(`https://www.npmjs.com/package/${subject.name}/v/${version}`)
  const source = githubRepository(manifest.repository)
  const gitHead = typeof manifest.gitHead === "string" && /^[0-9a-f]{40}$/.test(manifest.gitHead) ? manifest.gitHead : null
  const matches = []
  const items = []
  for (const replay of ledgerReplays(targets, subject.name, version)) {
    const [owner, repo] = replay.fork.split("/")
    const { result, items: replayItems } = await prLookup(api, { kind: "pr", owner, repo, number: replay.forkPr }, query, true)
    matches.push({ relation: "dependency-replay", note: `installs ${replay.transition.name} ${replay.transition.from ?? "(new)"} → ${replay.transition.to} in ${replay.fork} CI`, pr: result.subject.url, headSha: result.subject.headSha, app: result.app, profiles: result.profiles.length })
    items.push(...replayItems)
    limits.push(...result.limits)
    sources.push(...result.sources)
  }
  if (source === null) limits.push("package metadata names no GitHub source repository")
  else if (gitHead === null) limits.push(`package metadata records no gitHead for ${version}; its release commit is unknown`)
  else {
    const own = await commitProfiles(api, source.owner, source.repo, gitHead, limits, sources)
    if (own.length > 0) matches.push({ relation: "source-ci", note: `the package's own CI at its release commit`, repository: `${source.owner}/${source.repo}`, headSha: gitHead, profiles: own.length })
    items.push(...own)
  }
  if (matches.length === 0) limits.push(`no Garnet record found for ${subject.name}@${version}: no dependency replay installs it and its source CI has no public profile at the release commit`)
  return buildResult({ query, subject: { kind: "pkg", ecosystem: "npm", name: subject.name, version, repository: source === null ? null : `${source.owner}/${source.repo}`, gitHead }, items, limits, sources, matches })
}

/** Read the target ledgers shipped with this repository. */
export async function loadTargets(dir = new URL("../targets/", import.meta.url)) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"))
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, dir), "utf8"))))
}

/**
 * Look up the recorded execution profile for a pull request, an npm package version, or a repository.
 * @param {{pr?: string, pkg?: string, repo?: string, runID?: string}} input
 * @param {{fetchImpl?: typeof fetch, token?: string|null, targets?: object[]|null}} [options]
 */
export async function getExecProfile(input, { fetchImpl = fetch, token = null, targets = null } = {}) {
  const subject = parseSubject(input)
  const api = client({ fetchImpl, token })
  const query = Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value !== ""))
  if (subject.kind === "pr") return prLookup(api, subject, query)
  if (subject.kind === "repo") return repoLookup(api, subject, query)
  return pkgLookup(api, subject, query, targets ?? await loadTargets())
}
