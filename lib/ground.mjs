import { existsSync, readFileSync } from "node:fs"
import { run, ghJson } from "./gh.mjs"
import { assertForkTarget } from "./guards.mjs"
import { listTargets, loadTarget, saveTarget } from "./ledger.mjs"
import { actionWorkflowBodies, executePlan, planSetup, recordingWorkflowFiles, workDirFor } from "./replay-pr.mjs"

const ROOT = new URL("../live/templates/reviewers/", import.meta.url)
export const KIT_SOURCE = JSON.parse(readFileSync(new URL("source.json", ROOT), "utf8"))
export const KIT_PATHS = Object.freeze([".coderabbit.yaml", ".pr_agent.toml", "greptile.json", "REVIEW.md", ".agents/skills/garnet-runtime-review/SKILL.md"])
/** Greptile ignores greptile.json once a `.greptile/` directory exists; its rules file carries the paragraph instead. */
export const GREPTILE_RULES = ".greptile/rules.md"

/** Read the SHA-pinned, byte-for-byte reviewer kit. */
export function reviewerKit() {
  return Object.fromEntries(KIT_PATHS.map((path) => [path, readFileSync(new URL(path.endsWith("/SKILL.md") ? "SKILL.md" : path, ROOT), "utf8")]))
}

/** The paragraph is vendored with the reviewer kit, not independently maintained. */
export function canonicalParagraph() {
  const paragraph = reviewerKit()["REVIEW.md"].split("\n").find((line) => line.startsWith("The Runtime Review comment is the record"))
  if (paragraph === undefined) throw new Error("reviewer kit has no canonical paragraph")
  return paragraph
}

function mcpEnabled(body) {
  try {
    return JSON.parse(body).knowledge_base?.mcp?.usage === "enabled"
  } catch {
    const roots = [...body.matchAll(/^(?:knowledge_base|"knowledge_base"|'knowledge_base'):[^\n]*$/gm)]
    if (roots.length !== 1 || !/^knowledge_base:[ \t]*(?:#.*)?$/.test(roots[0][0])) return false
    const block = body.slice(roots[0].index + roots[0][0].length).split(/\n(?=[^\s#])/)[0]
    const lines = block.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    if (lines.length === 0 || lines.some((line) => line.includes("\t"))) return false
    const indent = (line) => line.length - line.trimStart().length
    const childIndent = Math.min(...lines.map(indent))
    const positions = lines.flatMap((line, index) => indent(line) === childIndent && /^ +(?:mcp|"mcp"|'mcp'):/.test(line) ? [index] : [])
    if (positions.length !== 1 || !/^ +mcp:[ \t]*(?:#.*)?$/.test(lines[positions[0]])) return false
    const children = []
    for (const line of lines.slice(positions[0] + 1)) {
      if (indent(line) <= childIndent) break
      children.push(line)
    }
    if (children.length === 0) return false
    const usageIndent = Math.min(...children.map(indent))
    const usage = children.filter((line) => indent(line) === usageIndent && /^ +(?:usage|"usage"|'usage'):/.test(line))
    return usage.length === 1 && /^ +usage: *(?:enabled|"enabled"|'enabled') *(?:#.*)?$/.test(usage[0])
  }
}

/** Accept canonical bytes or a paragraph-preserving repository-owned configuration. */
export function reviewerGrounded(path, body, kit = reviewerKit()) {
  return typeof body === "string" && (body === kit[path] || (body.includes(canonicalParagraph()) && (path !== ".coderabbit.yaml" || mcpEnabled(body))))
}

/** Only merge formats that can be parsed and preserved with built-in APIs. */
export function mergeReviewer(path, body) {
  if (typeof body !== "string") return null
  if (path.endsWith(".md")) return `${body}\n\n## Runtime Review\n\n${canonicalParagraph()}\n`
  if (path !== "greptile.json") return null
  try {
    const config = JSON.parse(body)
    if (config === null || typeof config !== "object" || Array.isArray(config)) return null
    const context = config.customContext ?? {}
    if (context === null || typeof context !== "object" || Array.isArray(context) || (context.other !== undefined && !Array.isArray(context.other))) return null
    config.customContext = { ...context, other: [...(context.other ?? []), { scope: ["**"], content: canonicalParagraph() }] }
    const merged = `${JSON.stringify(config, null, 2)}\n`
    JSON.parse(merged)
    return merged
  } catch { return null }
}

function greptileRulesRow(current) {
  const rules = current[GREPTILE_RULES]
  if (current[".greptile"] !== null || rules === null) return { path: ".greptile", status: "conflict-manual" }
  if (rules === undefined) return { path: GREPTILE_RULES, status: "add", content: `## Runtime Review\n\n${canonicalParagraph()}\n` }
  if (rules.includes(canonicalParagraph())) return { path: GREPTILE_RULES, status: "grounded", content: null }
  return { path: GREPTILE_RULES, status: "merge", content: mergeReviewer(GREPTILE_RULES, rules) }
}

/** Classify default-branch files without overwriting operator or upstream policy. */
export function planGrounding(current, kit = reviewerKit()) {
  const rows = Object.entries(kit).map(([path, body]) => {
    const merged = current[path] === undefined || reviewerGrounded(path, current[path], kit) ? null : mergeReviewer(path, current[path])
    return { path, status: current[path] === undefined ? "add" : current[path] === body ? "identical" : reviewerGrounded(path, current[path], kit) ? "grounded" : merged !== null ? "merge" : "conflict-manual", content: current[path] === undefined ? body : merged }
  })
  if (current[".greptile"] !== undefined) rows.push(greptileRulesRow(current))
  return {
    rows,
    grounded: rows.every((row) => ["identical", "grounded"].includes(row.status)),
    conflict: rows.some((row) => row.status === "conflict-manual"),
    files: Object.fromEntries(rows.filter((row) => ["add", "merge"].includes(row.status)).map((row) => [row.path, row.content])),
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
  for (const path of [...KIT_PATHS, ".greptile", GREPTILE_RULES]) {
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
  return { ...planGrounding(current), current, branch, sha: tree.sha, parent: meta.parent?.full_name ?? null }
}

/** All active organization repositories, not only forks with a ledger. */
export function groundingInventory({ exec = run } = {}) {
  const pages = ghJson(["api", "--paginate", "--slurp", "orgs/garnet-labs/repos?per_page=100"], { exec })
  const repos = pages.flat().filter((repo) => repo.archived !== true)
  return repos.flatMap((repo) => {
    let tree
    try {
      tree = ghJson(["api", `repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}:.github/workflows`], { exec })
    } catch (error) {
      if (String(error.stderr ?? error.message).includes("Git Repository is empty. (HTTP 409)")) return []
      if (String(error.stderr ?? error.message).includes("Not Found (HTTP 404)")) return []
      throw error
    }
    if (tree.truncated === true || !Array.isArray(tree.tree)) throw new Error(`incomplete repository tree: ${repo.full_name}`)
    const bodies = Object.fromEntries(tree.tree.filter((row) => /^[^/]+\.ya?ml$/.test(row.path) && row.type === "blob").map((row) => {
      const blob = ghJson(["api", `repos/${repo.full_name}/git/blobs/${row.sha}`], { exec })
      if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new Error(`invalid workflow blob: ${repo.full_name}/${row.path}`)
      return [row.path, Buffer.from(blob.content, "base64").toString("utf8")]
    }))
    if (Object.keys(actionWorkflowBodies(bodies)).length === 0) return []
    const workflows = recordingWorkflowFiles(bodies)
    return [{ repo: repo.full_name, private: repo.private === true, fork: repo.fork === true, workflows }]
  }).sort((a, b) => a.repo.localeCompare(b.repo))
}

/** Default-branch PR recorders, including local reusable workflow callers. */
export function instrumentedRepos(options = {}) {
  return groundingInventory(options).filter((row) => row.workflows.length > 0).map((row) => row.repo)
}

/** Shared admission for slug, URL and local-checkout entrypoints. */
export function requireGrounding(repo, { exec = run, log = console.log, allowUngrounded = false, hint = "<slug>" } = {}) {
  const state = groundingAt(repo, null, { exec })
  log(`reviewer grounding: ${state.grounded ? "grounded" : "missing or conflicting"} · replay ground ${hint}`)
  if (!state.grounded && !allowUngrounded) throw new Error(`reviewers are not grounded; run replay ground ${hint} and merge it first, or explicitly pass --allow-ungrounded`)
  return state
}

/** Inventory, or propose one routine onboarding commit per ungrounded repository. */
export async function ground(args, { exec = run, log = console.log, save = saveTarget, execute = executePlan } = {}) {
  const all = args.includes("--all")
  const dry = args.includes("--dry-run")
  if (!all && (typeof args[0] !== "string" || args[0].startsWith("--"))) throw new Error("ground requires <slug> or --all")
  const targets = listTargets().map(loadTarget)
  const inventory = all ? groundingInventory({ exec }) : []
  const selected = all ? inventory.filter((row) => row.workflows.length > 0).map((row) => row.repo) : [loadTarget(args[0]).fork]
  if (all) {
    log(`inventory: ${inventory.length} action repositories; ${selected.length} PR recorders (${inventory.filter((row) => row.workflows.length > 0 && row.fork).length} forks)`)
    log(`private action repositories: ${inventory.filter((row) => row.private).map((row) => row.repo).join(", ") || "none"}`)
    log(`excluded (no pull_request recorder): ${inventory.filter((row) => row.workflows.length === 0).map((row) => row.repo).join(", ") || "none"}`)
  }
  const results = []
  const statuses = ["add", "identical", "grounded", "merge", "conflict-manual"]
  log(`repository | ${statuses.join(" | ")}`)
  for (const repo of selected) {
    const state = groundingAt(repo, null, { exec })
    const target = targets.find((entry) => entry.fork === repo)
    const counts = statuses.map((status) => state.rows.filter((row) => row.status === status).length)
    log(`${repo} | ${counts.join(" | ")}`)
    for (const row of state.rows.filter((row) => row.status === "conflict-manual")) log(`  conflict-manual: ${row.path} — manual merge required; no files will be written`)
    let captured = null
    if (!dry && !state.grounded && !state.conflict) {
      const slug = target?.slug ?? repo.split("/")[1]
      const work = workDirFor(`${slug}-ground`)
      const plan = planSetup({
        slug, fork: repo, upstream: target?.upstream ?? state.parent ?? "unconfigured/source",
        defaultBranch: state.branch, work, workExists: existsSync(work), mode: "inject",
        branch: "onboarding/reviewer-guidance", files: state.files,
        reviewerSnapshot: state.sha,
        message: "ci: configure reviewer guidance [skip ci]",
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
  log(`summary: ${results.length} repositories; ${statuses.map((status) => `${status}=${results.reduce((sum, result) => sum + result.rows.filter((row) => row.status === status).length, 0)}`).join("; ")}`)
  return results
}
