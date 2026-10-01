/**
 * Path glob matching for workload scoping (which repository paths a target's
 * recorded workload covers). Supports `*` (within one segment), `**` (across
 * segments, matching zero or more), and `?` (one character). Pure.
 */

const SEGMENTS = "\u0001"
const ANY = "\u0002"

/**
 * @param {string} path repository-relative path with `/` separators
 * @param {string} pattern glob pattern
 * @returns {boolean} true when the path matches the pattern
 */
export function matchGlob(path, pattern) {
  const candidate = String(path ?? "")
  // `**/` matches zero or more whole segments; a bare `**` matches anything.
  const staged = String(pattern ?? "")
    .replace(/\*\*\//g, SEGMENTS)
    .replace(/\*\*/g, ANY)
  let source = ""
  for (const char of staged) {
    if (char === SEGMENTS) source += "(?:.*/)?"
    else if (char === ANY) source += ".*"
    else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`).test(candidate)
}

/**
 * @param {string[]} paths repository-relative paths
 * @param {string[]} patterns glob patterns
 * @returns {boolean} true when any path matches any pattern
 */
export function anyPathMatches(paths, patterns) {
  const list = Array.isArray(paths) ? paths : []
  const globs = Array.isArray(patterns) ? patterns : []
  return list.some((path) => typeof path === "string" && globs.some((pattern) => typeof pattern === "string" && matchGlob(path, pattern)))
}

/**
 * Normalized workload declaration `{name, paths}`, or null. A workload names
 * the behavior a target records (for example `e2e`) and the path globs that
 * select the pull requests exercising it.
 * @param {unknown} workload
 * @returns {{name: string, paths: string[]}|null}
 */
export function normalizeWorkload(workload) {
  if (workload === null || workload === undefined) return null
  if (typeof workload !== "object" || Array.isArray(workload)) throw new Error("workload must be {name, paths}")
  const record = /** @type {Record<string, unknown>} */ (workload)
  if (typeof record.name !== "string" || record.name === "") throw new Error("workload needs a non-empty name")
  const paths = Array.isArray(record.paths) ? record.paths.filter((entry) => typeof entry === "string" && entry !== "") : []
  if (paths.length === 0) throw new Error("workload needs at least one path glob")
  return { name: record.name, paths }
}

/**
 * @param {{name: string, paths: string[]}|null} current
 * @param {unknown} incoming
 * @returns {{name: string, paths: string[]}|null} merged declaration; throws on conflict
 */
export function mergeWorkload(current, incoming) {
  const next = normalizeWorkload(incoming)
  if (next === null) return current
  if (current === null || current === undefined) return next
  const same = current.name === next.name
    && current.paths.length === next.paths.length
    && [...current.paths].sort().every((entry, index) => entry === [...next.paths].sort()[index])
  if (!same) throw new Error(`target already declares workload '${current.name}' (${current.paths.join(", ")}); refusing '${next.name}' (${next.paths.join(", ")})`)
  return current
}
