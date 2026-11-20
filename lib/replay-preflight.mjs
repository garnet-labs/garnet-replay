import { ghJson, run } from "./gh.mjs"

/** Create a machine-readable refusal without changing its human explanation. */
export function replayRefusal(reason, message) {
  return Object.assign(new Error(message), { reason })
}

/** Decide whether the REST budget permits admission, a short wait, or refusal. */
export function rateBudget(rate, now = Date.now()) {
  if (!Number.isSafeInteger(rate?.remaining) || rate.remaining < 0 || !Number.isSafeInteger(rate?.reset) || rate.reset <= 0 || rate.reset * 1000 > 8640000000000000) {
    throw replayRefusal("RATE_LIMIT_UNREADABLE", "GitHub REST rate-limit budget is unreadable; no replay was started.")
  }
  const reset = new Date(rate.reset * 1000).toISOString()
  if (rate.remaining >= 200) return { wait: 0, reset }
  const wait = rate.reset * 1000 - now
  if (wait > 0 && wait <= 60000) return { wait, reset }
  throw replayRefusal("RATE_LIMIT_LOW", `GitHub REST budget is ${rate.remaining}; at least 200 requests are required. Reset: ${reset}.`)
}

/** Read the budget before paginated admission reads; wait at most once and recheck. */
export async function checkReplayBudget({ exec = run, log = () => {}, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let budget
    try { budget = ghJson(["api", "rate_limit"], { exec }) } catch (error) {
      throw replayRefusal("RATE_LIMIT_UNREADABLE", `Could not read GitHub REST budget: ${error.message}`)
    }
    const decision = rateBudget(budget?.resources?.core, now())
    if (decision.wait === 0) return
    if (attempt === 1) throw replayRefusal("RATE_LIMIT_LOW", `GitHub REST budget is still too low after waiting. Reset: ${decision.reset}.`)
    log(`preflight: REST budget low; waiting ${decision.wait}ms until ${decision.reset}, then checking once more`)
    await sleep(decision.wait)
  }
}

/** Refuse a recorder with no established receipts, including single-commit starts. */
export function assertHostedRecorder(health) {
  if (health?.verdict === "none" || health?.verdict === "stalled") {
    throw replayRefusal("RECORDER_UNHEALTHY", `${health.line}; fix the recorder before starting a hosted replay.`)
  }
}

function treeEntry(repo, ref, path, exec, cache) {
  let tree = ref
  const parts = path.split("/")
  for (let index = 0; index < parts.length; index += 1) {
    const key = `${repo}:${tree}`
    if (!cache.has(key)) {
      const result = ghJson(["api", `repos/${repo}/git/trees/${encodeURIComponent(tree)}`], { exec })
      if (!Array.isArray(result?.tree) || result.truncated === true) throw new Error(`Incomplete git tree for ${repo}@${tree}`)
      cache.set(key, result.tree)
    }
    const entry = cache.get(key).find((item) => item.path === parts[index])
    if (entry === undefined) return null
    if (typeof entry.sha !== "string" || typeof entry.mode !== "string" || typeof entry.type !== "string") throw new Error("Malformed git tree entry")
    if (index === parts.length - 1) return `${entry.mode}:${entry.type}:${entry.sha}`
    if (entry.type !== "tree") return null
    tree = entry.sha
  }
  throw new Error("Empty change path")
}

/** Compare exactly the paths replayed, including removals/renames and file modes, before any base push. */
export function assertReplayChanges(plan, { exec = run, prs = [] } = {}) {
  const removed = (plan.steps ?? []).filter((step) => step.id === "change-remove").flatMap((step) => step.args.slice(step.args.indexOf("--") + 1))
  const paths = [...new Set([...(plan.paths ?? []), ...removed])]
  if (paths.length === 0) throw replayRefusal("CHANGE_UNREADABLE", "The replay has no change paths to preflight.")
  const forkBase = plan.singleCommit === true && plan.baseBranch === null && plan.syncFork !== true
  const repo = forkBase ? plan.fork : plan.upstream
  const ref = forkBase ? plan.forkDefaultSha : (plan.firstCommitSha ?? plan.baseSha)
  const cache = new Map()
  try {
    for (const path of paths) {
      if (treeEntry(repo, ref, path, exec, cache) !== treeEntry(plan.upstream, plan.headSha, path, exec, cache)) return
    }
  } catch (error) {
    throw replayRefusal("CHANGE_UNREADABLE", `Could not preflight the change without writing: ${error.message}`)
  }
  const existing = prs.find((pr) => pr.headRefName === plan.branch)
  const location = existing?.url ?? `https://github.com/${plan.fork}/tree/${encodeURIComponent(plan.branch)}`
  throw replayRefusal("CHANGE_ALREADY_PRESENT", `The change commit would be empty: change already present on the replay base. Planned fork branch ${plan.branch}; ${location}.`)
}
