/**
 * Specimen finder. The honest yield of the harness on most historical PRs
 * is "nothing new", so the scarce input is a transition worth replaying.
 * This ranks a repository's history for the shapes that changed runtime
 * behavior in past exhibits: dependency bumps, lifecycle scripts, prebuilt
 * or native binaries, lockfile URL moves, resolver and registry changes.
 *
 * Everything here is static candidate evidence. Nothing in a finder result
 * is runtime evidence; only a recorded replay can say what ran.
 */

import { run } from "./gh.mjs"

export const MANIFESTS = Object.freeze({
  npm: ["package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc"],
  pnpm: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"],
  yarn: ["package.json", "yarn.lock", ".yarnrc", ".yarnrc.yml"],
  cargo: ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", ".cargo/config"],
  uv: ["pyproject.toml", "uv.lock", "uv.toml", "requirements.txt"],
  go: ["go.mod", "go.sum"],
  ruby: ["Gemfile", "Gemfile.lock", ".bundle/config"],
})

const SIGNALS = Object.freeze([
  {
    id: "lifecycle-script",
    weight: 40,
    files: /(^|\/)package\.json$/,
    patch: /^\+\s*"(pre|post)?install"\s*:|^\+\s*"prepare"\s*:/m,
    why: "an npm lifecycle script was added or changed; it runs on install",
  },
  {
    id: "prebuilt-binary",
    weight: 35,
    files: /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|Gemfile\.lock)$/,
    patch: /^\+.*\b(prebuild-install|node-pre-gyp|node-gyp-build|napi-rs|@napi-rs\/|binary-mirror|prebuild|esbuild|sharp|@swc\/core|bufferutil|bindings|ffi-napi|libc-bin|-musl|-gnu|-darwin-|-win32-|linux-x64|linux-arm64|build\.rs|cc\s*=|maturin|cffi|native-ext|extconf\.rb)/mi,
    why: "a prebuilt or native binary dependency moved; its install path can download or compile",
  },
  {
    id: "lockfile-url",
    weight: 30,
    files: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|uv\.lock|go\.sum|Gemfile\.lock)$/,
    patch: /^\+.*(resolved|tarball|url|source|remote)\s*[:=]?\s*"?https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com|crates\.io|index\.crates\.io|pypi\.org|files\.pythonhosted\.org|proxy\.golang\.org|rubygems\.org)/mi,
    why: "a lockfile entry now resolves outside the default registry",
  },
  {
    id: "registry-change",
    weight: 30,
    files: /(^|\/)(\.npmrc|\.yarnrc(\.yml)?|\.cargo\/config(\.toml)?|uv\.toml|pyproject\.toml|pip\.conf|\.bundle\/config|go\.mod|go\.env)$/,
    patch: /^\+.*(registry\s*=|npmRegistryServer|\[source\.|replace-with|index-url|extra-index-url|GOPROXY|GOSUMDB|GOFLAGS|BUNDLE_MIRROR|mirror\.)/mi,
    why: "the registry, mirror, or proxy that installs resolve against changed",
  },
  {
    id: "resolver-override",
    weight: 20,
    files: /(^|\/)(package\.json|pnpm-workspace\.yaml|\.yarnrc\.yml|Cargo\.toml|go\.mod|pyproject\.toml|Gemfile)$/,
    patch: /^\+\s*("overrides"|"resolutions"|"pnpm"\s*:|overrides:|\[patch\.|^\+\s*replace\s|\[tool\.uv\.sources\]|git\s*[:=]|github:|gem\s+.*(git|github):)/mi,
    why: "a resolver override or git source now decides what version installs",
  },
  {
    id: "dependency-bump",
    weight: 10,
    files: /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|requirements\.txt)$/,
    patch: /^-\s*"?[\w@\/.-]+"?\s*[:=]?\s*"?[~^>=<]*\d+\.\d+[^\n]*\n\+\s*"?[\w@\/.-]+"?\s*[:=]?\s*"?[~^>=<]*\d+\.\d+/m,
    why: "a dependency version moved",
  },
])

/**
 * Score one commit from its changed files and patch text.
 * @param {{sha: string, subject: string, files: string[], patch: string}} commit
 * @returns {{sha: string, subject: string, score: number, signals: {id: string, why: string}[], ecosystems: string[], files: string[]}|null}
 */
export function scoreCommit(commit) {
  const files = Array.isArray(commit.files) ? commit.files : []
  const patch = typeof commit.patch === "string" ? commit.patch : ""
  const signals = []
  for (const signal of SIGNALS) {
    if (files.some((file) => signal.files.test(file)) && signal.patch.test(patch)) {
      signals.push({ id: signal.id, why: signal.why })
    }
  }
  if (signals.length === 0) return null
  const ecosystems = Object.entries(MANIFESTS)
    .filter(([, names]) => files.some((file) => names.some((name) => file === name || file.endsWith(`/${name}`))))
    .map(([name]) => name)
  const score = signals.reduce((total, signal) => total + SIGNALS.find((entry) => entry.id === signal.id).weight, 0)
  return { sha: commit.sha, subject: commit.subject, score, signals, ecosystems, files }
}

function gitOutput(repoDir, args, exec) {
  return String(exec("git", ["-C", repoDir, ...args], { encoding: "utf8" }) ?? "")
}

/**
 * Read the manifest-touching commits of a local checkout.
 * @param {string} repoDir
 * @param {{limit?: number, exec?: typeof run}} [options]
 * @returns {{sha: string, subject: string, files: string[], patch: string}[]}
 */
export function readCandidateCommits(repoDir, { limit = 200, exec = run } = {}) {
  const manifestNames = [...new Set(Object.values(MANIFESTS).flat())]
  const pathspecs = manifestNames.flatMap((name) => [name, `**/${name}`])
  const log = gitOutput(repoDir, ["log", `--max-count=${limit}`, "--format=%H%x00%s", "--", ...pathspecs], exec)
  const commits = []
  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, subject] = line.split("\u0000")
    const files = gitOutput(repoDir, ["show", "--format=", "--name-only", sha, "--", ...pathspecs], exec).split("\n").filter(Boolean)
    const patch = gitOutput(repoDir, ["show", "--format=", "--unified=0", sha, "--", ...pathspecs], exec)
    commits.push({ sha, subject: subject ?? "", files, patch })
  }
  return commits
}

/**
 * Rank a checkout's history. Results are candidates to replay, not records.
 * @param {string} repoDir
 * @param {{limit?: number, top?: number, exec?: typeof run}} [options]
 * @returns {{evidence_class: "candidate-evidence", repo_dir: string, scanned: number, candidates: ReturnType<typeof scoreCommit>[]}}
 */
export function findSpecimens(repoDir, { limit = 200, top = 15, exec = run } = {}) {
  const commits = readCandidateCommits(repoDir, { limit, exec })
  const candidates = commits.map(scoreCommit).filter((entry) => entry !== null)
  candidates.sort((left, right) => right.score - left.score)
  return { evidence_class: "candidate-evidence", repo_dir: repoDir, scanned: commits.length, candidates: candidates.slice(0, top) }
}

/**
 * Terminal report for a finder result.
 * @param {ReturnType<typeof findSpecimens>} result
 * @returns {string}
 */
export function renderFindReport(result) {
  const lines = [
    `candidate evidence only: ${result.candidates.length} of ${result.scanned} manifest commits ranked; nothing here is a runtime record`,
  ]
  for (const candidate of result.candidates) {
    lines.push(`${candidate.sha.slice(0, 7)}  ${String(candidate.score).padStart(3)}  ${candidate.ecosystems.join(",") || "?"}  ${candidate.subject}`)
    for (const signal of candidate.signals) lines.push(`         ${signal.id}: ${signal.why}`)
  }
  if (result.candidates.length === 0) lines.push("no dependency, lifecycle, binary, lockfile, resolver, or registry transitions found in the scanned range")
  lines.push("next: replay live <repo> --dependency <name> --from <a> --to <b> --ecosystem <npm|pnpm|yarn|cargo|uv|go|ruby>")
  return lines.join("\n")
}
