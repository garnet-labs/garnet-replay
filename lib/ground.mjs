import { existsSync, readFileSync } from "node:fs"
import { run, ghJson } from "./gh.mjs"
import { assertForkTarget } from "./guards.mjs"
import { listTargets, loadTarget, saveTarget } from "./ledger.mjs"
import { executePlan, planSetup, workDirFor } from "./replay-pr.mjs"

const ROOT = new URL("../live/templates/reviewers/", import.meta.url)
export const KIT_SOURCE = JSON.parse(readFileSync(new URL("source.json", ROOT), "utf8"))
export const KIT_PATHS = Object.freeze([".coderabbit.yaml", ".pr_agent.toml", "greptile.json", "REVIEW.md", ".agents/skills/garnet-runtime-review/SKILL.md"])

/** Read the SHA-pinned, byte-for-byte reviewer kit. */
export function reviewerKit() {
  return Object.fromEntries(KIT_PATHS.map((path) => [path, readFileSync(new URL(path.endsWith("/SKILL.md") ? "SKILL.md" : path, ROOT), "utf8")]))
}

/** Classify default-branch files without overwriting operator or upstream policy. */
export function planGrounding(current, kit = reviewerKit()) {
  const rows = Object.entries(kit).map(([path, body]) => ({
    path, status: current[path] === undefined ? "add" : current[path] === body ? "identical" : "conflict",
  }))
  if (current[".greptile"] !== undefined) rows.push({ path: ".greptile", status: "conflict" })
  return {
    rows,
    grounded: rows.every((row) => row.status === "identical"),
    conflict: rows.some((row) => row.status === "conflict"),
    files: Object.fromEntries(rows.filter((row) => row.status === "add").map((row) => [row.path, kit[row.path]])),
  }
}

/** Read the root and kit subtrees, never a potentially truncated repository-wide tree. */
export function groundingAt(repo, ref = null, { exec = run } = {}) {
  if (typeof repo !== "string" || !/^garnet-labs\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("grounding is restricted to garnet-labs repositories")
  assertForkTarget(`https://github.com/${repo}.git`, repo)
  const meta = ghJson(["api", `repos/${repo}`], { exec })
  const branch = ref ?? meta.default_branch
  const tree = ghJson(["api", `repos/${repo}/git/trees/${encodeURIComponent(branch)}`], { exec })
  if (tree.truncated === true || !Array.isArray(tree.tree)) throw new Error(`incomplete repository tree: ${repo}`)
  const current = {}
  for (const path of [...KIT_PATHS, ".greptile"]) {
    let entry = tree.tree.find((row) => row.path === path)
    if (entry === undefined && path.includes("/")) {
      let entries = tree.tree
      const segments = path.split("/")
      for (const [index, segment] of segments.entries()) {
        entry = entries.find((row) => row.path === segment)
        if (entry === undefined || index === segments.length - 1) break
        if (entry.type !== "tree") { entry = { type: "blocked" }; break }
        const subtree = ghJson(["api", `repos/${repo}/git/trees/${entry.sha}`], { exec })
        if (subtree.truncated === true || !Array.isArray(subtree.tree)) throw new Error(`incomplete reviewer subtree: ${repo}/${path}`)
        entries = subtree.tree
      }
    }
    if (entry === undefined) continue
    if (entry.type !== "blob" || entry.mode === "120000") { current[path] = null; continue }
    const blob = ghJson(["api", `repos/${repo}/git/blobs/${entry.sha}`], { exec })
    if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new Error(`invalid blob: ${repo}/${path}`)
    current[path] = Buffer.from(blob.content, "base64").toString("utf8")
  }
  return { ...planGrounding(current), branch, sha: tree.sha, parent: meta.parent?.full_name ?? null }
}

/** All active organization repositories, not only forks with a ledger. */
export function instrumentedRepos({ exec = run } = {}) {
  const pages = ghJson(["api", "--paginate", "--slurp", "orgs/garnet-labs/repos?per_page=100"], { exec })
  const repos = pages.flat().filter((repo) => repo.archived !== true)
  return repos.filter((repo) => {
    let tree
    try {
      tree = ghJson(["api", `repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}:.github/workflows`], { exec })
    } catch (error) {
      if (String(error.stderr ?? error.message).includes("Git Repository is empty. (HTTP 409)")) return false
      if (String(error.stderr ?? error.message).includes("Not Found (HTTP 404)")) return false
      throw error
    }
    if (tree.truncated === true || !Array.isArray(tree.tree)) throw new Error(`incomplete repository tree: ${repo.full_name}`)
    return tree.tree.filter((row) => /^[^/]+\.ya?ml$/.test(row.path) && row.type === "blob").some((row) => {
      const blob = ghJson(["api", `repos/${repo.full_name}/git/blobs/${row.sha}`], { exec })
      return /^\s*-?\s*uses:\s*["']?garnet-org\/action@/m.test(Buffer.from(blob.content, "base64").toString("utf8"))
    })
  }).map((repo) => repo.full_name).sort()
}

/** Inventory, or propose one routine onboarding commit per ungrounded repository. */
export async function ground(args, { exec = run, log = console.log, save = saveTarget, execute = executePlan } = {}) {
  const all = args.includes("--all")
  const dry = args.includes("--dry-run")
  if (!all && (typeof args[0] !== "string" || args[0].startsWith("--"))) throw new Error("ground requires <slug> or --all")
  const targets = listTargets().map(loadTarget)
  const selected = all ? instrumentedRepos({ exec }) : [loadTarget(args[0]).fork]
  const results = []
  log("repository | add | identical | conflict")
  for (const repo of selected) {
    const state = groundingAt(repo, null, { exec })
    const target = targets.find((entry) => entry.fork === repo)
    const counts = ["add", "identical", "conflict"].map((status) => state.rows.filter((row) => row.status === status).length)
    log(`${repo} | ${counts.join(" | ")}`)
    for (const row of state.rows.filter((row) => row.status === "conflict")) log(`  conflict: ${row.path} — manual merge required; no files will be written`)
    let captured = null
    if (!dry && !state.grounded && !state.conflict) {
      const slug = target?.slug ?? repo.split("/")[1]
      const work = workDirFor(`${slug}-ground`)
      const plan = planSetup({
        slug, fork: repo, upstream: target?.upstream ?? state.parent ?? "unconfigured/source",
        defaultBranch: state.branch, work, workExists: existsSync(work), mode: "inject",
        branch: "onboarding/reviewer-guidance", files: state.files,
        reviewerSnapshot: state.sha,
        message: "ci: configure reviewer guidance",
        body: "Adds repository reviewer instructions and the repository review skill. Merge before opening changes.",
      })
      captured = await execute(plan, { exec, log })
    }
    if (!dry && target !== undefined) {
      target.grounding = { state: state.grounded ? "grounded" : state.conflict ? "conflict" : "pending", source: KIT_SOURCE.sha, defaultBranch: state.branch, checkedSha: state.sha, pr: captured?.forkPr ?? null }
      save(target)
    }
    results.push({ repo, ...state, captured })
  }
  return results
}
