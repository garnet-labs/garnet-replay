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

/**
 * Rewrite the pin constants or the AGENTS.md pin sentence.
 * @param {string} text
 * @param {{sha:string, tag:string}} input
 * @returns {string}
 */
export function rewritePinSource(text, { sha, tag }) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("pin SHA must be 40 hexadecimal characters")
  if (typeof tag !== "string" || tag.trim() === "") throw new Error("pin tag must be non-empty")
  if (typeof text !== "string") throw new Error("pin source must be text")

  const pinLine = /^export const GARNET_ACTION_PIN = "[0-9a-f]{40}"$/im
  const labelLine = /^export const GARNET_ACTION_PIN_LABEL = "[^"\r\n]+"$/m
  const pinMatches = [...text.matchAll(/^export const GARNET_ACTION_PIN = "[0-9a-f]{40}"$/gim)]
  const labelMatches = [...text.matchAll(/^export const GARNET_ACTION_PIN_LABEL = "[^"\r\n]+"$/gm)]
  if (pinMatches.length === 1 && labelMatches.length === 1) {
    return text.replace(pinLine, `export const GARNET_ACTION_PIN = ${JSON.stringify(sha)}`)
      .replace(labelLine, `export const GARNET_ACTION_PIN_LABEL = ${JSON.stringify(tag)}`)
  }
  if (pinMatches.length !== 0 || labelMatches.length !== 0) throw new Error("expected action pin constants were not found exactly once")

  const releaseLine = /^  release `[^`\r\n]+` \(`GARNET_ACTION_PIN` in `lib\/replay-pr\.mjs`\)\. Move existing$/m
  const releaseMatches = [...text.matchAll(/^  release `[^`\r\n]+` \(`GARNET_ACTION_PIN` in `lib\/replay-pr\.mjs`\)\. Move existing$/gm)]
  if (releaseMatches.length !== 1) throw new Error("expected AGENTS.md action pin sentence was not found exactly once")
  return text.replace(releaseLine, `  release \`${tag}\` (\`GARNET_ACTION_PIN\` in \`lib/replay-pr.mjs\`). Move existing`)
}
