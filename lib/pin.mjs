/**
 * @typedef {object} PinComparison
 * @property {"current"|"behind"} status
 * @property {string} latestTag
 * @property {string} latestSha
 * @property {string} pin
 * @property {string} label
 */

/**
 * Compare the harness pin with a release commit.
 * @param {{latestTag:string, latestSha:string, pin:string, label:string}} input
 * @returns {PinComparison}
 */
export function comparePin({ latestTag, latestSha, pin, label }) {
  if (typeof latestTag !== "string" || latestTag.trim() === "") throw new Error("latest tag must be non-empty")
  if (typeof latestSha !== "string" || !/^[0-9a-f]{40}$/i.test(latestSha)) throw new Error("latest SHA must be 40 hexadecimal characters")
  if (typeof pin !== "string" || !/^[0-9a-f]{40}$/i.test(pin)) throw new Error("pin must be 40 hexadecimal characters")
  if (typeof label !== "string" || label.trim() === "") throw new Error("pin label must be non-empty")
  return { status: latestSha === pin ? "current" : "behind", latestTag, latestSha, pin, label }
}

/** Source files that carry the current action pin or its release label. */
export const PIN_SOURCE_FILES = Object.freeze([
  "lib/replay-pr.mjs",
  "AGENTS.md",
  "README.md",
  "docs/plan.md",
  "live/templates/garnet-record.yml",
  "live/templates/garnet-dependency-replay.yml",
])

/**
 * Rewrite the current action pin and its adjacent release label in one source file.
 * @param {string} text
 * @param {{fromSha:string, fromLabel:string, sha:string, tag:string, path:string}} input
 * @returns {string}
 */
export function rewritePinSource(text, { fromSha, fromLabel, sha, tag, path }) {
  if (typeof fromSha !== "string" || !/^[0-9a-f]{40}$/i.test(fromSha)) throw new Error("current pin SHA must be 40 hexadecimal characters")
  if (typeof fromLabel !== "string" || fromLabel.trim() === "") throw new Error("current pin label must be non-empty")
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("pin SHA must be 40 hexadecimal characters")
  if (typeof tag !== "string" || tag.trim() === "") throw new Error("pin tag must be non-empty")
  if (typeof path !== "string" || !PIN_SOURCE_FILES.includes(path)) throw new Error("pin source path is not configured")
  if (typeof text !== "string") throw new Error("pin source must be text")

  if (path === "AGENTS.md") {
    const releaseSentence = `release \`${fromLabel}\` (\`GARNET_ACTION_PIN\` in \`lib/replay-pr.mjs\`). Move existing`
    const matches = text.split(releaseSentence).length - 1
    if (matches !== 1) throw new Error(`${path}: expected the current action pin release sentence exactly once`)
    return text.replace(releaseSentence, `release \`${tag}\` (\`GARNET_ACTION_PIN\` in \`lib/replay-pr.mjs\`). Move existing`)
  }

  if (!text.includes(fromSha)) throw new Error(`${path}: current action pin SHA ${fromSha} was not found`)
  const lines = text.split("\n")
  let pinLabelLines = 0
  const updatedLines = lines.map((line) => {
    if (path === "lib/replay-pr.mjs" && line.startsWith("export const GARNET_ACTION_PIN_LABEL = ")) {
      pinLabelLines += 1
      if (line !== `export const GARNET_ACTION_PIN_LABEL = ${JSON.stringify(fromLabel)}`) {
        throw new Error(`${path}: current action pin label was not found`)
      }
      return `export const GARNET_ACTION_PIN_LABEL = ${JSON.stringify(tag)}`
    }
    if (!line.includes(fromSha)) return line
    let updated = line
    if (line.includes(`garnet-org/action@${fromSha}`)) updated = updated.replaceAll(`# ${fromLabel}`, `# ${tag}`)
    return updated.split(fromSha).join(sha)
  })
  const relabeledLines = updatedLines.map((line) => {
    if ((path === "README.md" || path === "docs/plan.md") && line.includes(`release ${fromLabel}`)) {
      return line.replaceAll(`release ${fromLabel}`, `release ${tag}`)
    }
    return line
  })
  if (path === "lib/replay-pr.mjs" && pinLabelLines !== 1) {
    throw new Error(`${path}: expected the action pin label constant exactly once`)
  }
  return relabeledLines.join("\n")
}
