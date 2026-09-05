import { DEPENDENCY_RE } from "./execution-diff.mjs"

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]
const DEPENDENCY_AUTHOR_RE = /^(?:dependabot|renovate)(?:\[bot\])?$/

function fileName(file) {
  return typeof file === "string" ? file : file?.filename
}

function packageManagerFromFiles(files) {
  const names = new Set((Array.isArray(files) ? files : []).map(fileName))
  for (const [lockfile, packageManager] of LOCKFILES) {
    if ([...names].some((name) => name === lockfile || name.endsWith(`/${lockfile}`))) return packageManager
  }
  return [...names].some((name) => name === "package.json" || name.endsWith("/package.json"))
    ? "npm"
    : null
}

function dependencyPullRequest(prMeta, files) {
  const author = prMeta?.user?.login ?? prMeta?.author?.login
  const title = typeof prMeta?.title === "string" ? prMeta.title : ""
  if (typeof author === "string" && DEPENDENCY_AUTHOR_RE.test(author)) return true
  if (DEPENDENCY_RE.test(title)) return true
  return (Array.isArray(files) ? files : []).every((file) => {
    const name = fileName(file)
    return name === "package.json" || LOCKFILES.some(([lockfile]) => name === lockfile)
  })
}

/**
 * Assess whether a repository and pull request meet the v0 live replay gate.
 * @param {{repoMeta?: Record<string, any>, prMeta?: Record<string, any>, files?: Array<Record<string, any>|string>}} input
 * @returns {{supported: boolean, reasons: string[]}}
 */
export function assessLiveReplaySupport({ repoMeta, prMeta, files } = {}) {
  const blockingReasons = []
  if (repoMeta?.private !== false) {
    blockingReasons.push("repository is not public")
  }
  const packageManager = packageManagerFromFiles(files)
  if (packageManager === null) {
    blockingReasons.push("no package.json")
  }
  if (!dependencyPullRequest(prMeta, files)) {
    blockingReasons.push("pull request is not a dependency change")
  }
  return { supported: blockingReasons.length === 0, reasons: [...blockingReasons, "Linux is required"] }
}

/**
 * Detect the supported package manager from repository or pull request files.
 * @param {Array<Record<string, any>|string>} files
 * @returns {"npm"|"pnpm"|"yarn"|null}
 */
export function detectPackageManager(files) {
  return packageManagerFromFiles(files)
}
