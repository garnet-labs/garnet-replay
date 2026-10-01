/**
 * Guards for everything the harness writes outside its own repository.
 *
 * Rules (see docs/harness.md):
 *   - writes go to the configured fork only, never to the upstream repository;
 *   - no outbound text names the upstream repository, links to GitHub, or
 *     carries an `owner/repo#N` / `#N` reference;
 *   - renderer-owned copy on consumer surfaces uses the Runtime Review
 *     contract vocabulary (contract/vocab.json) and carries no session residue;
 *   - a replay branch is exactly two commits ahead of the fork base, or exactly
 *     one commit ahead for a pure replay on an onboarded fork.
 *
 * Every guard throws on doubt. Nothing here is advisory.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VOCAB = JSON.parse(readFileSync(join(ROOT, "contract", "vocab.json"), "utf8"))

export const BANNED_VOCABULARY = Object.freeze([...VOCAB.bannedVocabulary])
export const RESIDUE_TERMS = Object.freeze([...VOCAB.residue])

const CROSS_REPO_REF_RE = /\b[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+\b/
const ISSUE_REF_RE = /(^|[^&\w])#\d+\b/
const GITHUB_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*github\.com\/\S+/i
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * @param {string} upstream owner/repo
 * @returns {RegExp}
 */
export function upstreamRefRe(upstream) {
  const [owner, repo] = String(upstream).split("/")
  if (typeof owner !== "string" || owner === "" || typeof repo !== "string" || repo === "") {
    throw new Error(`invalid upstream '${upstream}' (want owner/repo)`)
  }
  return new RegExp(`${escapeRegExp(owner)}\\s*/\\s*${escapeRegExp(repo)}\\b`, "i")
}

/**
 * Throw when outbound text would reveal the upstream repository.
 * @param {unknown} text
 * @param {string} upstream owner/repo
 * @returns {string}
 */
export function assertNoUpstreamLeak(text, upstream) {
  const value = String(text ?? "")
  const hits = []
  if (upstreamRefRe(upstream).test(value)) hits.push(`upstream repository reference '${upstream}'`)
  if (GITHUB_URL_RE.test(value)) hits.push("github url")
  if (CROSS_REPO_REF_RE.test(value)) hits.push("cross-repository 'owner/repo#N' reference")
  else if (ISSUE_REF_RE.test(value)) hits.push("issue or pull request reference '#N'")
  if (hits.length > 0) {
    throw new Error(`upstream leak in outbound text (${hits.join("; ")}): ${JSON.stringify(value.slice(0, 120))}`)
  }
  return value
}

/**
 * Remove the shapes assertNoUpstreamLeak refuses so an upstream title can be
 * rewritten into routine wording instead of copied.
 * @param {unknown} text
 * @param {string} upstream
 * @returns {string}
 */
export function stripUpstreamLeak(text, upstream) {
  let value = String(text ?? "")
  value = value.replace(new RegExp(GITHUB_URL_RE.source, "gi"), "")
  value = value.replace(new RegExp(upstreamRefRe(upstream).source, "gi"), "")
  value = value.replace(new RegExp(CROSS_REPO_REF_RE.source, "g"), "")
  value = value.replace(/\(\s*#\d+\s*\)/g, "")
  value = value.replace(/#\d+/g, "")
  return value.replace(/[ \t]{2,}/g, " ").replace(/\s+$/gm, "").trim()
}

/**
 * Visible text only: HTML comments (machine markers) are not user-facing.
 * @param {unknown} text
 * @returns {string}
 */
export function visibleText(text) {
  return String(text ?? "").replace(HTML_COMMENT_RE, "")
}

/**
 * Throw when renderer-owned copy uses a banned contract term.
 * @param {unknown} text
 * @param {readonly string[]} banned
 * @returns {string}
 */
export function assertVocabClean(text, banned = BANNED_VOCABULARY) {
  const value = String(text ?? "")
  const lower = visibleText(value).toLowerCase()
  const hit = banned.find((term) => lower.includes(String(term).toLowerCase()))
  if (hit !== undefined) {
    throw new Error(`banned vocabulary '${hit}' in renderer-owned copy: ${JSON.stringify(value.slice(0, 120))}`)
  }
  return value
}

/**
 * Throw when text carries session or scaffold residue a cold reader would notice.
 * @param {unknown} text
 * @returns {string}
 */
export function assertNoResidue(text) {
  const value = String(text ?? "")
  const lower = value.toLowerCase()
  const hit = RESIDUE_TERMS.find((term) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(term.toLowerCase())}`, "i").test(lower))
  if (hit !== undefined) {
    throw new Error(`session residue '${hit}' in outbound text: ${JSON.stringify(value.slice(0, 120))}`)
  }
  return value
}

/**
 * Every string that leaves the harness towards a fork passes here.
 * @param {unknown} text
 * @param {string} upstream
 * @returns {string}
 */
export function assertOutbound(text, upstream) {
  assertNoUpstreamLeak(text, upstream)
  assertVocabClean(text)
  assertNoResidue(text)
  return String(text ?? "")
}

/**
 * @param {unknown} url
 * @returns {string|null} owner/repo
 */
export function repoFromUrl(url) {
  const value = String(url ?? "").trim().replace(/\.git$/, "")
  const match = value.match(/^(?:https?:\/\/[^/]+\/(?:[A-Za-z0-9._-]+\/)*?|git@[^:]+:|ssh:\/\/git@[^/]+\/)?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/)
  return match === null ? null : match[1]
}

/**
 * Refuse any push or pull request target that is not the configured fork.
 * @param {unknown} target
 * @param {string} fork owner/repo
 * @returns {string}
 */
export function assertForkTarget(target, fork) {
  const repo = repoFromUrl(target)
  if (repo === null || repo.toLowerCase() !== String(fork).toLowerCase()) {
    throw new Error(`refusing write target ${JSON.stringify(String(target))}: only the fork ${fork} may be written`)
  }
  return repo
}

/**
 * @param {unknown} revListCount output of `git rev-list --count base..HEAD`
 * @returns {number}
 */
export function assertTwoCommits(revListCount) {
  const count = Number(String(revListCount).trim())
  if (count !== 2) {
    throw new Error(`two-commit structure required: found ${Number.isFinite(count) ? count : "unknown"} new commit(s) ahead of the fork base`)
  }
  return count
}

/**
 * @param {unknown} revListCount output of `git rev-list --count base..HEAD`
 * @returns {number}
 */
export function assertOneCommit(revListCount) {
  const count = Number(String(revListCount).trim())
  if (count !== 1) {
    throw new Error(`single-commit replay required: found ${Number.isFinite(count) ? count : "unknown"} new commit(s) ahead of the fork base`)
  }
  return count
}

/**
 * @param {unknown} slug
 * @returns {string}
 */
export function assertSlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`invalid target slug: ${slug}`)
  return slug
}

/**
 * @param {unknown} value
 * @returns {string} owner/repo
 */
export function assertRepoSlug(value) {
  if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error(`expected owner/repo, got '${value}'`)
  return value
}
