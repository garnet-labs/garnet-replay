import { fetchPullRequest, parsePrUrl, parseReceipt } from "./receipt.mjs"
import { buildExecutionDiff } from "./execution-diff.mjs"
import { run } from "./gh.mjs"
import { detectEcosystem } from "./replay-pr.mjs"
import { workspaceRecord } from "./workspace.mjs"

/** Use the harness process's GitHub authentication without sending it to clients. */
export function replayGithubToken(exec = run) {
  let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token === undefined) {
    try { token = exec("gh", ["auth", "token"]).trim() } catch {}
  }
  return token
}

/** Resolve a live PR with the canonical receipt reader and execution-diff model. */
export async function readReplayRequest(url, { read = fetchPullRequest, exec = run } = {}) {
  const token = replayGithubToken(exec)
  const pr = await read({ ...parsePrUrl(url), token })
  const receipt = parseReceipt(pr.garnet_comment_body ?? "")
  const diff = buildExecutionDiff(pr)
  const record = diff === null ? null : workspaceRecord(diff, null)
  const state = !pr.garnet_comment_present ? "no-record"
    : !pr.garnet_exact_head ? "stale-record"
      : receipt.pending || !receipt.final ? "pending"
        : record === null ? "no-record" : "record"
  return {
    state,
    record,
    checkedAt: new Date().toISOString(),
    metadata: {
      title: pr.title, state: pr.state, base: pr.base_sha, head: pr.head_sha,
      ecosystem: detectEcosystem(pr.files.map((file) => file.filename)),
      paths: pr.files.map((file) => file.filename),
    },
  }
}
