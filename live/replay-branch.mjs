import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKFLOW = join(ROOT, "live", "templates", "garnet-dependency-replay.yml")

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function branchPart(value) {
  return String(value).replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
}

function installScript(packageManager) {
  const command = packageManager === "pnpm"
    ? "pnpm install --no-frozen-lockfile"
    : packageManager === "yarn"
      ? "yarn install"
      : "npm install"
  return `#!/usr/bin/env bash\nset -euo pipefail\n${command}\n`
}

/**
 * Plan the files and commits for a two-commit dependency replay.
 * @param {{repoDir: string, dependency: string, from: string, to: string, packageManager: "npm"|"pnpm"|"yarn"}} input
 * @returns {{branch: string, repoDir: string, dependency: string, from: string, to: string, packageManager: string, files: string[]}}
 */
export function planReplay({ repoDir, dependency, from, to, packageManager }) {
  if (typeof repoDir !== "string" || repoDir === "") throw new Error("repoDir is required")
  if (typeof dependency !== "string" || dependency === "") throw new Error("dependency is required")
  if (typeof from !== "string" || from === "") throw new Error("from is required")
  if (typeof to !== "string" || to === "") throw new Error("to is required")
  if (!["npm", "pnpm", "yarn"].includes(packageManager)) throw new Error("unsupported package manager")
  const branch = `garnet-replay/${branchPart(dependency)}-${branchPart(to)}-${Date.now().toString(36).slice(-8)}`
  return {
    branch,
    repoDir,
    dependency,
    from,
    to,
    packageManager,
    files: [
      ".github/DEPENDENCY_REPLAY.md",
      ".github/workflows/garnet-dependency-replay.yml",
      ".github/garnet-replay/install.sh",
      ".github/garnet-replay/compare.mjs",
      ".github/garnet-replay/review.mjs",
      ".github/garnet-replay/replay.json",
    ],
  }
}

function replayInstructions(plan) {
  return `# Dependency replay\n\nThis branch records a dependency installation at two commits.\n\n- Dependency: \`${plan.dependency}\`\n- Baseline: \`${plan.from}\`\n- Update: \`${plan.to}\`\n- Scope: \`immediate-parent-to-head\`\n- This is a constructed replay of a historical bump; not a routine contribution.\n`
}

function replaceDependencyVersion(repoDir, dependency, from, to) {
  const path = join(repoDir, "package.json")
  const source = readFileSync(path, "utf8")
  const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const exact = new RegExp(`(["'])${escaped}\\1(\\s*:\\s*)(${JSON.stringify(from).replace(/"/g, '\\"')})`)
  if (!exact.test(source)) {
    throw new Error(`package.json does not contain ${dependency}@${from}`)
  }
  const updated = source.replace(exact, `$1${dependency}$1$2${JSON.stringify(to)}`)
  writeFileSync(path, updated)
}

/**
 * Create the baseline and update commits in a provided checkout.
 * @param {{repoDir: string, dependency: string, from: string, to: string, packageManager: "npm"|"pnpm"|"yarn", branch?: string}} input
 * @returns {{branch: string, baselineCommit: string, updateCommit: string, repoDir: string, ghCommand: string}}
 */
export function createReplayBranch(input) {
  const plan = planReplay(input)
  const branch = input.branch ?? plan.branch
  git(plan.repoDir, ["switch", "-c", branch])
  const replayDir = join(plan.repoDir, ".github", "garnet-replay")
  mkdirSync(join(plan.repoDir, ".github", "workflows"), { recursive: true })
  mkdirSync(replayDir, { recursive: true })
  writeFileSync(join(plan.repoDir, ".github", "DEPENDENCY_REPLAY.md"), replayInstructions(plan))
  copyFileSync(WORKFLOW, join(plan.repoDir, ".github", "workflows", "garnet-dependency-replay.yml"))
  writeFileSync(join(replayDir, "install.sh"), installScript(plan.packageManager), { mode: 0o755 })
  copyFileSync(join(ROOT, "renderer", "compare.mjs"), join(replayDir, "compare.mjs"))
  copyFileSync(join(ROOT, "renderer", "review.mjs"), join(replayDir, "review.mjs"))
  writeFileSync(join(replayDir, "replay.json"), `${JSON.stringify({
    dependency: plan.dependency,
    from: plan.from,
    to: plan.to,
    label: input.label === "constructed" ? "constructed" : "real",
  }, null, 2)}\n`)
  git(plan.repoDir, ["add", ...plan.files])
  git(plan.repoDir, ["commit", "-m", `chore(replay): baseline install for ${plan.dependency}@${plan.from}`])
  const baselineCommit = git(plan.repoDir, ["rev-parse", "HEAD"])
  replaceDependencyVersion(plan.repoDir, plan.dependency, plan.from, plan.to)
  git(plan.repoDir, ["add", "package.json"])
  git(plan.repoDir, ["commit", "-m", `chore(deps): update ${plan.dependency} to ${plan.to}`])
  const updateCommit = git(plan.repoDir, ["rev-parse", "HEAD"])
  const ghCommand = `gh pr create --head ${branch} --title "Dependency replay: ${plan.dependency} ${plan.from} to ${plan.to}" --body "Constructed dependency replay for ${plan.dependency}."`
  return { branch, baselineCommit, updateCommit, repoDir: plan.repoDir, ghCommand }
}

/**
 * Find the newest history commit that changes one dependency version pair.
 * @param {string} repoDir
 * @returns {{dependency: string, from: string, to: string}|null}
 */
export function pickDependencyFromHistory(repoDir) {
  const log = git(repoDir, ["log", "-p", "--follow", "--format=@@@%H", "--", "package.json"])
  for (const chunk of log.split("@@@").slice(1)) {
    const removed = [...chunk.matchAll(/^-\\s*"([^"]+)"\\s*:\\s*"([^"]+)"/gm)]
    const added = [...chunk.matchAll(/^\+\\s*"([^"]+)"\\s*:\\s*"([^"]+)"/gm)]
    const pairs = removed.flatMap((old) => added
      .filter((next) => next[1] === old[1] && next[2] !== old[2])
      .map((next) => ({ dependency: old[1], from: old[2], to: next[2] })))
    if (pairs.length === 1) return pairs[0]
  }
  return null
}
