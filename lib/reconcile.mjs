import { ghJson, githubReadFetch, run } from "./gh.mjs"
import { assertForkTarget } from "./guards.mjs"
import { isGarnetComment, parseReceipt, receiptFingerprint } from "./receipt.mjs"
import { STAGE2_FILES } from "./stage2.mjs"
import { evaluateExhibit, verifyExhibit } from "./verify.mjs"
import { existingPaths } from "./replay-pr.mjs"

/** Read complete fork inventory without executing or modifying fork code. */
export function observeTarget(target, { exec = run } = {}) {
  assertForkTarget(target.fork, target.fork)
  const repo = ghJson(["api", `repos/${target.fork}`], { exec })
  const branch = ghJson(["api", `repos/${target.fork}/branches/${encodeURIComponent(repo.default_branch)}`], { exec })
  const sha = branch.commit.sha
  const paths = existingPaths(target.fork, sha, Object.values(STAGE2_FILES), { exec })
  const pulls = ghJson(["api", "--paginate", "--slurp", `repos/${target.fork}/pulls?state=all&per_page=100`], { exec }).flat()
  const comments = ghJson(["api", "--paginate", "--slurp", `repos/${target.fork}/issues/comments?per_page=100`], { exec }).flat()
  const byPr = new Map()
  for (const comment of comments) {
    const number = Number(comment.issue_url.split("/").at(-1))
    if (!byPr.has(number)) byPr.set(number, [])
    byPr.get(number).push(comment)
  }
  const known = new Set((target.replays ?? []).map((row) => Number(row.forkPr)))
  const prs = pulls.filter((pr) => pr.state === "open" || pr.merged_at !== null)
    .filter((pr) => known.has(pr.number) || /<!--\s*garnet:(?:replay|dependency-replay)\b/.test(pr.body ?? "")
      || (byPr.get(pr.number) ?? []).some(isGarnetComment))
    .map((pr) => ({ number: pr.number, url: pr.html_url, head: pr.head.sha, branch: pr.head.ref,
      state: pr.merged_at !== null ? "merged" : "open", comments: byPr.get(pr.number) ?? [] }))
  return { defaultBranch: repo.default_branch, defaultSha: sha, paths, prs, inspectedPrs: pulls.length }
}

/** Merge observed installation and exact-head verification, without inferring ancestry or value. */
export function reconcileTarget(target, snapshot, checkedAt) {
  const files = Object.values(STAGE2_FILES).filter((path) => snapshot.paths.includes(path))
  const missing = Object.values(STAGE2_FILES).filter((path) => !snapshot.paths.includes(path))
  const next = { ...target, replays: (target.replays ?? []).map((row) => ({ ...row })) }
  next.stage2 = { ...target.stage2, state: files.some((path) => path !== STAGE2_FILES.review) ? "in-flight" : "unstarted",
    defaultBranch: snapshot.defaultBranch, checkedSha: snapshot.defaultSha, checkedAt,
    files, missing, note: `${files.length}/${Object.keys(STAGE2_FILES).length} stage 2 files on ${snapshot.defaultBranch}; runtime integration and required-check policy not verified` }
  const observations = []
  for (const pr of snapshot.prs) {
    const comment = pr.comments.filter(isGarnetComment).at(-1)
    const receipt = parseReceipt(comment?.body ?? "")
    const capture = evaluateExhibit({ pr: { head_sha: pr.head, base_sha: receipt.summary?.previous ?? null, state: pr.state },
      comments: comment === undefined ? [] : [{ body: comment.body, user: comment.user?.login ?? comment.user }],
      checks: [], permalinkStatus: null, requireCompleteCapture: true })
    const accepted = capture.legs.filter((leg) => ["capture completeness", "comment finalized"].includes(leg.name)).every((leg) => leg.ok)
    const bound = receipt.markerCommit === pr.head && receipt.final && accepted
    const verification = pr.verification
    const sameHead = verification?.head === pr.head
    const fingerprint = comment === undefined ? null : receiptFingerprint(comment.body)
    const sameReceipt = sameHead && fingerprint !== null && verification.receipt_fingerprint === fingerprint
    const status = sameReceipt && ["PASS", "FAIL"].includes(verification.status) ? verification.status : "undeterminable"
    const result = { status, head: pr.head, checkedAt,
      reasons: status === "undeterminable" ? [pr.error ?? "verification did not return the observed head and receipt"] : verification.reasons,
      receiptFingerprint: sameReceipt ? fingerprint : null }
    const index = next.replays.findIndex((row) => Number(row.forkPr) === pr.number)
    const old = index === -1 ? {} : next.replays[index]
    const row = { ...old, upstreamPr: old.upstreamPr ?? null, forkPr: pr.number, branch: pr.branch,
      forkHeadSha: pr.head, state: bound ? "recorded" : receipt.markerCommit === pr.head && receipt.pending ? "pending" : "undeterminable",
      verification: result, observedAt: checkedAt, source: "github-reconciliation" }
    if (index === -1) next.replays.push(row)
    else next.replays[index] = row
    observations.push({ forkPr: pr.number, url: pr.url, prState: pr.state, head: pr.head,
      previous: receipt.summary?.previous ?? null, scope: receipt.summary?.scope ?? null,
      state: row.state, receiptFingerprint: comment === undefined ? null : receiptFingerprint(comment.body), verification: result })
  }
  next.reconciliation = { checkedAt, defaultBranch: snapshot.defaultBranch, defaultSha: snapshot.defaultSha,
    inspectedPrs: snapshot.inspectedPrs, selection: "open or merged PRs with a ledger replay, replay marker, or Runtime Review comment; upstream ancestry not inferred",
    prs: observations }
  return next
}

/** Collect and verify every observed replay candidate; errors remain explicitly undeterminable. */
export async function collectReconciliation(target, { exec = run, verify = verifyExhibit, token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, log = () => {} } = {}) {
  const cache = new Map()
  const execute = (command, args, options) => {
    const key = JSON.stringify([command, args, options])
    if (!cache.has(key)) cache.set(key, exec(command, args, options))
    return cache.get(key)
  }
  const snapshot = observeTarget(target, { exec: execute })
  const fetchImpl = githubReadFetch({ exec: execute })
  log(`${target.slug}: inspected ${snapshot.inspectedPrs} PRs; ${snapshot.prs.length} open/merged replay or recording candidates`)
  for (let index = 0; index < snapshot.prs.length; index += 4) {
    await Promise.all(snapshot.prs.slice(index, index + 4).map(async (pr) => {
      try {
        pr.verification = await verify(pr.url, { token, exec: execute, fetchImpl })
      } catch (error) {
        pr.error = error.message
      }
      log(`${target.slug}#${pr.number}: ${pr.verification?.status ?? "undeterminable"}`)
    }))
  }
  return snapshot
}
