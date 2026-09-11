/** Normalize a GitHub PR, a replacement-host URL, or an owner/repo#number. */
export function parseReplayInput(input, origin = "https://github.com") {
  if (typeof input !== "string" || /[\x00-\x1f\x7f\\%]/.test(input)) return null
  let value = input.trim()
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value.split(/[?#]/, 1)[0])) return null
  const shorthand = /^([a-z0-9-]+\/[a-z0-9_.-]+)#([1-9]\d*)$/i.exec(value)
  if (shorthand !== null) value = `/${shorthand[1]}/pull/${shorthand[2]}`
  if (/^github\.com\//i.test(value)) value = `https://${value}`
  if (/^[a-z0-9-]+\/[a-z0-9_.-]+\/pull\//i.test(value)) value = `/${value}`
  try {
    const url = new URL(value, origin)
    if (url.username !== "" || url.password !== "" || !["http:", "https:"].includes(url.protocol)) return null
    if (url.origin !== new URL(origin).origin && url.origin !== "https://github.com") return null
    const match = /^\/([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9_.-]{1,100})\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/i.exec(url.pathname)
    if (match === null || [".", ".."].includes(match[2]) || !Number.isSafeInteger(Number(match[3]))) return null
    const repository = `${match[1]}/${match[2]}`
    const number = Number(match[3])
    const path = `/${repository}/pull/${number}`
    return { repository, number, path, url: `https://github.com${path}` }
  } catch {
    return null
  }
}

/** Bind upstream and fork identities only through an explicit ledger row. */
export function replayContext(pr, { targets, records }) {
  const repository = pr.repository.toLowerCase()
  const target = targets.find((entry) => entry.upstream.toLowerCase() === repository || entry.fork.toLowerCase() === repository) ?? null
  const upstream = target !== null && target.upstream.toLowerCase() === repository
  const replay = target?.replays.find((row) => upstream ? row.upstreamPr === pr.number : row.forkPr === pr.number) ?? null
  const evidenceUrl = upstream && Number.isSafeInteger(replay?.forkPr)
    ? `https://github.com/${target.fork}/pull/${replay.forkPr}`
    : pr.url
  const matches = records.filter((row) => row.url.toLowerCase() === evidenceUrl.toLowerCase())
  const record = matches.find((row) => replay === null || typeof replay.forkHeadSha !== "string" || row.head === replay.forkHeadSha) ?? matches[0] ?? null
  const stale = record !== null && replay !== null && typeof replay.forkHeadSha === "string" && record.head !== replay.forkHeadSha
  const candidate = upstream ? target.observations.find((row) => row.upstreamPr === pr.number) ?? null : null
  return { pr, target, replay, record, stale, candidate, evidenceUrl, canPrepare: upstream }
}

/** Scope a completed share gate to the exact fork and head it verified. */
export function replayShareStatus(record, job) {
  return job?.state === "complete" && job.verification?.status === "PASS"
    && job.verification.head === record.head && job.forkUrl === record.url
    ? `Share gate passed for this head${typeof job.updatedAt === "string" ? ` · ${job.updatedAt}` : ""}`
    : "Share verification not checked"
}
