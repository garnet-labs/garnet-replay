import { buildExecutionDiff } from "./execution-diff.mjs"
import { fetchPullRequest, parsePrUrl } from "./receipt.mjs"

/**
 * Resolve a PR's exact-head App receipt into an Execution Diff.
 * @param {string} prUrl
 * @param {{token?: string}} [options]
 * @returns {Promise<{status: "ok", diff: Record<string, any>}|{status: "no-record", reason: string}|{status: "stale-record", reason: string}>}
 */
export async function knownEvidence(prUrl, { token } = {}) {
  const parsed = parsePrUrl(prUrl)
  const pr = await fetchPullRequest({ ...parsed, token })
  if (pr.garnet_comment_present !== true) {
    return { status: "no-record", reason: "no Garnet Runtime Review comment found" }
  }
  if (pr.garnet_exact_head !== true) {
    return { status: "stale-record", reason: "the Garnet receipt does not match the current pull request head" }
  }
  const diff = buildExecutionDiff(pr)
  if (diff === null) {
    return { status: "no-record", reason: "the Garnet receipt has no usable summary" }
  }
  return { status: "ok", diff }
}
