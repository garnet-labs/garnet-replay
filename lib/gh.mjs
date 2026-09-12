/**
 * `gh` and `git` plumbing. execFile only, never shell interpolation. Every
 * function takes an injectable `exec` so command modules run offline in tests.
 */
import { execFileSync } from "node:child_process"

/**
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @returns {string}
 */
export function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options })
}

export function ghJson(args, { exec = run } = {}) {
  return JSON.parse(exec("gh", args))
}

/** Read the anonymous JSON for one exact public run/profile selector. */
export async function publicProfile(permalink, { fetchImpl = fetch } = {}) {
  const url = new URL(permalink)
  if (url.origin !== "https://app.garnet.ai" || !/^\/public\/runs\/\d+$/.test(url.pathname)) {
    throw new Error("unsupported public profile URL")
  }
  const profile = url.searchParams.get("profile")
  if (profile === null || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(profile)
    || url.searchParams.getAll("profile").length !== 1) throw new Error("missing exact profile selector")
  const endpoint = new URL(`/api${url.pathname}`, url.origin)
  endpoint.searchParams.set("profile", profile)
  const response = await fetchImpl(endpoint.href, { redirect: "error", signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`public profile HTTP ${response.status}`)
  const body = await response.json()
  return body?.profile ?? null
}

export function listPrs(repo, { limit = 30, state = "all", author = null, search = null, exec = run } = {}) {
  const args = ["pr", "list", "--repo", repo, "--state", state, "--limit", String(limit)]
  if (typeof author === "string" && author !== "") args.push("--author", author)
  if (typeof search === "string" && search !== "") args.push("--search", search)
  args.push("--json", "number,title,author,createdAt,state,labels,files,headRefName,baseRefName,isDraft")
  return ghJson(args, { exec })
}

export function viewPr(repo, number, { exec = run } = {}) {
  return ghJson(["pr", "view", String(number), "--repo", repo,
    "--json", "number,title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,files,commits,createdAt,url,reviews,statusCheckRollup"], { exec })
}

export function prComments(repo, number, { exec = run } = {}) {
  return ghJson(["api", `repos/${repo}/issues/${number}/comments`, "--paginate"], { exec })
}

export function prReviews(repo, number, { exec = run } = {}) {
  return ghJson(["api", `repos/${repo}/pulls/${number}/reviews`, "--paginate"], { exec })
}

export function prReviewComments(repo, number, { exec = run } = {}) {
  return ghJson(["api", `repos/${repo}/pulls/${number}/comments`, "--paginate"], { exec })
}

export function prHeadSha(repo, number, { exec = run } = {}) {
  return ghJson(["pr", "view", String(number), "--repo", repo, "--json", "headRefOid"], { exec }).headRefOid
}

export function checkRuns(repo, sha, { exec = run } = {}) {
  const result = ghJson(["api", "--paginate", "--slurp", `repos/${repo}/commits/${sha}/check-runs?per_page=100`], { exec })
  return Array.isArray(result)
    ? result.flatMap((page) => Array.isArray(page?.check_runs) ? page.check_runs : [])
    : Array.isArray(result?.check_runs) ? result.check_runs : []
}

export function repoView(repo, { exec = run } = {}) {
  return ghJson(["repo", "view", repo, "--json", "defaultBranchRef,isFork,parent,visibility,nameWithOwner"], { exec })
}

export function forkDefaultBranch(fork, { exec = run } = {}) {
  const view = repoView(fork, { exec })
  const name = view?.defaultBranchRef?.name
  if (typeof name !== "string" || name === "") throw new Error(`could not resolve the default branch of ${fork}`)
  return name
}

export function upstreamPr(upstream, number, { exec = run } = {}) {
  const pr = ghJson(["api", `repos/${upstream}/pulls/${number}`], { exec })
  const files = ghJson(["api", `repos/${upstream}/pulls/${number}/files`, "--paginate"], { exec })
  const changes = (Array.isArray(files) ? files : [])
    .filter((file) => typeof file?.filename === "string" && file.filename !== "")
    .map((file) => ({
      path: file.filename,
      status: typeof file.status === "string" ? file.status : "modified",
      previous: typeof file.previous_filename === "string" ? file.previous_filename : null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    title: typeof pr?.title === "string" ? pr.title : "",
    baseSha: typeof pr?.base?.sha === "string" ? pr.base.sha : null,
    headSha: typeof pr?.head?.sha === "string" ? pr.head.sha : null,
    author: pr?.user?.login ?? null,
    state: typeof pr?.state === "string" ? pr.state : null,
    merged: pr?.merged === true,
    changes,
    paths: changes.map((change) => change.path),
  }
}

/** Machine markers shared by the App comment and the replay workflow comment. */
export const RR_MARKER = "<!-- garnet-runtime-review -->"
export const REPLAY_MARKER = "<!-- garnet-dependency-replay -->"
const REPLAY_SUMMARY_RE = /<!--\s*garnet:replay\s+({[\s\S]*?})\s*-->/

export function isRuntimeReviewComment(comment) {
  return typeof comment?.body === "string" && (comment.body.includes(RR_MARKER) || comment.body.includes(REPLAY_MARKER))
}

export function latestRuntimeReviewComment(comments) {
  const matching = (Array.isArray(comments) ? comments : []).filter(isRuntimeReviewComment)
  return matching.length > 0 ? matching[matching.length - 1] : null
}

/**
 * The replay workflow's own marker (`garnet:replay`), when present.
 * @param {string} body
 * @returns {Record<string, unknown>|null}
 */
export function parseReplayMarker(body) {
  const match = String(body ?? "").match(REPLAY_SUMMARY_RE)
  if (match === null) return null
  try {
    const parsed = JSON.parse(match[1].replace(/-\\u002d/g, "--"))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
