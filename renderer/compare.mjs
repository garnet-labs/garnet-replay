#!/usr/bin/env node
/**
 * Dependency-replay comparison comment: two Jibril profile JSON files (the
 * baseline install commit and the dependency update commit), one sticky PR
 * comment. Each side's tree is rendered by the vendored `review.mjs`
 * (garnet-ui `cmd/garnet-runtime-review`), byte-identical to the snapshot
 * surface; this file only adds the destination delta between the two
 * records and the replay identity line.
 *
 * Facts only: recorded destinations and the processes that reached them.
 * Nothing here decides anything about the dependency.
 *
 * Environment (all optional except the two profile paths):
 *   BASELINE_PROFILE_JSON_PATH   Jibril profile from the baseline commit job
 *   UPDATE_PROFILE_JSON_PATH     Jibril profile from the update commit job
 *   REPLAY_JSON_PATH             .github/garnet-replay/replay.json (dependency, from, to)
 *   BASELINE_SHA / HEAD_SHA      commits compared
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER   comment publication
 *   GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_STEP_SUMMARY
 *   FAIL_ON_ERROR                "false" to exit 0 on failure
 *
 * Usage: node compare.mjs            render + post (when GITHUB_TOKEN set)
 *        node compare.mjs --print    render to stdout only
 */

import { readFile, appendFile } from "node:fs/promises"
import { argv } from "node:process"
import { fileURLToPath } from "node:url"
import {
  COMMENT_MARKER,
  CONTRACT_VERSION,
  buildRunProfile,
  explainerLines,
  renderRunProfile,
  summarizeProfile,
} from "./review.mjs"

export const REPLAY_MARKER = "<!-- garnet-dependency-replay -->"

function readConfig() {
  return {
    baselinePath: process.env.BASELINE_PROFILE_JSON_PATH || "profiles/baseline/jibril.profile.json",
    updatePath: process.env.UPDATE_PROFILE_JSON_PATH || "profiles/update/jibril.profile.json",
    replayPath: process.env.REPLAY_JSON_PATH || ".github/garnet-replay/replay.json",
    baselineSha: process.env.BASELINE_SHA || "",
    headSha: process.env.HEAD_SHA || process.env.GITHUB_SHA || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    githubApiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    githubServerUrl: process.env.GITHUB_SERVER_URL || "https://github.com",
    repository: process.env.GITHUB_REPOSITORY || "",
    prNumber: process.env.PR_NUMBER || "",
    runId: process.env.GITHUB_RUN_ID || "",
    publicReportUrl: process.env.PUBLIC_REPORT_URL || "https://app.garnet.ai",
    permalinkUrl: "",
    failOnError: (process.env.FAIL_ON_ERROR || "true") !== "false",
  }
}

async function readJson(path) {
  if (typeof path !== "string" || path === "") return null
  try {
    const raw = await readFile(path, "utf8")
    return raw.trim() === "" ? null : JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function escapeCode(value) {
  return String(value ?? "").replace(/`/g, "ʼ").replace(/[\r\n]+/g, " ").trim()
}

function defang(value) {
  const text = escapeCode(value)
  if (!text.includes(".") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return text
  const index = text.lastIndexOf(".")
  return `${text.slice(0, index)}[.]${text.slice(index + 1)}`
}

function countPhrase(count, noun) {
  return `${count}&nbsp;${noun}${count === 1 ? "" : "s"}`
}

/**
 * Destination → sorted list of processes that reached it (last ancestry
 * element), from one summarized record.
 * @param {ReturnType<typeof summarizeProfile>} rec
 * @returns {Map<string, string[]>}
 */
export function destinationIndex(rec) {
  const index = new Map()
  const egress = rec !== null && Array.isArray(rec.egress) ? rec.egress : []
  for (const association of egress) {
    const destination = association.name || association.address
    if (typeof destination !== "string" || destination === "") continue
    const actor = association.ancestry.length > 0
      ? String(association.ancestry[association.ancestry.length - 1]).replace(/\d{4,}$/, "")
      : "unknown (not recorded)"
    const actors = index.get(destination) || new Set()
    actors.add(actor)
    index.set(destination, actors)
  }
  return new Map(
    [...index.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([destination, actors]) => [destination, [...actors].sort((a, b) => a.localeCompare(b))]),
  )
}

/**
 * @param {ReturnType<typeof summarizeProfile>} baseline
 * @param {ReturnType<typeof summarizeProfile>} update
 */
export function diffDestinations(baseline, update) {
  const before = destinationIndex(baseline)
  const after = destinationIndex(update)
  const added = [...after.keys()].filter((d) => !before.has(d))
  const removed = [...before.keys()].filter((d) => !after.has(d))
  const shared = [...after.keys()].filter((d) => before.has(d))
  return { before, after, added, removed, shared }
}

function destinationLines(destinations, index) {
  return destinations.map((destination) => {
    const actors = index.get(destination) || []
    return `○ ${defang(destination)} <em>(${actors.map(escapeCode).join(", ")})</em>`
  })
}

/** Body of a snapshot render without its markers or trailing explainer. */
function sideBody(rp) {
  const lines = renderRunProfile(rp).split("\n")
  const cut = lines.indexOf("---")
  return lines
    .slice(0, cut === -1 ? lines.length : cut)
    .filter((line) => !line.startsWith("<!--"))
    .join("\n")
    .trim()
}

function machineMarker({ replay, baselineSha, headSha, diff }) {
  const summary = {
    contract: CONTRACT_VERSION,
    surface: "dependency-replay",
    dependency: replay.dependency || null,
    from: replay.from || null,
    to: replay.to || null,
    baseline: baselineSha,
    commit: headSha,
    scope: "immediate-parent-to-head",
    added: diff.added.length,
    removed: diff.removed.length,
    shared: diff.shared.length,
    kinds: ["network"],
  }
  return `<!-- garnet:replay ${JSON.stringify(summary).replace(/--/g, "-\\u002d")} -->`
}

/**
 * @param {{baseline: any, update: any, replay: Record<string, string>, cfg: ReturnType<typeof readConfig>}} input
 */
export function renderComparison({ baseline, update, replay, cfg }) {
  const baseRec = summarizeProfile(baseline)
  const headRec = summarizeProfile(update)
  const baselineSha = String(baseRec?.github?.sha || cfg.baselineSha || "")
  const headSha = String(headRec?.github?.sha || cfg.headSha || "")
  const diff = diffDestinations(baseRec, headRec)

  const commitLink = (sha) => {
    const short = sha.slice(0, 7) || "unknown"
    const repository = headRec?.github?.repository || cfg.repository
    return repository !== "" && sha !== ""
      ? `[\`${escapeCode(short)}\`](${cfg.githubServerUrl}/${repository}/commit/${sha})`
      : `\`${escapeCode(short)}\``
  }

  const transition = replay.dependency
    ? `\`${escapeCode(replay.dependency)}\` ${escapeCode(replay.from || "?")} → ${escapeCode(replay.to || "?")}`
    : "dependency update"

  const lines = [
    COMMENT_MARKER,
    REPLAY_MARKER,
    ...(headSha !== "" ? [`<!-- garnet:commit ${escapeCode(headSha)} -->`] : []),
    machineMarker({ replay, baselineSha, headSha, diff }),
    `**Dependency replay: ${transition}**`,
    "",
    `> *+${diff.added.length} −${diff.removed.length} destinations · ${countPhrase(diff.after.size, "destination")} after the update*`,
    `> <sub>baseline ${commitLink(baselineSha)} → update ${commitLink(headSha)} · immediate parent to head · recorded at the kernel by Garnet</sub>`,
    "",
  ]

  if (diff.added.length > 0) {
    lines.push(`<details open><summary>only in the update · ${countPhrase(diff.added.length, "destination")}</summary>`, "")
    lines.push("<pre>", ...destinationLines(diff.added, diff.after), "</pre>", "", "</details>", "")
  }
  if (diff.removed.length > 0) {
    lines.push(`<details><summary>only in the baseline · ${countPhrase(diff.removed.length, "destination")}</summary>`, "")
    lines.push("<pre>", ...destinationLines(diff.removed, diff.before), "</pre>", "", "</details>", "")
  }
  if (diff.shared.length > 0) {
    lines.push(`<details><summary>in both · ${countPhrase(diff.shared.length, "destination")}</summary>`, "")
    lines.push("<pre>", ...destinationLines(diff.shared, diff.after), "</pre>", "", "</details>", "")
  }
  if (diff.added.length + diff.removed.length + diff.shared.length === 0) {
    lines.push("<sub>no outbound destinations recorded on either commit.</sub>", "")
  }

  const sides = [
    ["update", headRec, headSha],
    ["baseline", baseRec, baselineSha],
  ]
  for (const [label, rec, sha] of sides) {
    lines.push(`<details><summary>${label} ${commitLink(sha)} · full Execution Profile</summary>`, "")
    if (rec === null) {
      lines.push("<sub>no execution record found for this commit.</sub>", "")
    } else {
      lines.push(sideBody(buildRunProfile(rec, { ...cfg, headSha: sha })), "")
    }
    lines.push("</details>", "")
  }

  lines.push("<sub><i>○ = destination · (…) = process that reached it · each side's tree is the recorded execution chain per action</i></sub>", "")
  lines.push("---", "", ...explainerLines())
  return lines.join("\n")
}

async function repostPrComment(cfg, body) {
  if (cfg.githubToken === "" || cfg.repository === "" || cfg.prNumber === "") {
    console.warn("Skipping PR comment: missing GITHUB_TOKEN, GITHUB_REPOSITORY, or PR_NUMBER.")
    return
  }
  const base = `${cfg.githubApiUrl}/repos/${cfg.repository}/issues/${cfg.prNumber}/comments`
  const headers = {
    authorization: `Bearer ${cfg.githubToken}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  }
  const staleIds = []
  for (let page = 1; page <= 10; page += 1) {
    const listRes = await fetch(`${base}?per_page=100&page=${page}`, { headers })
    if (!listRes.ok) break
    const comments = await listRes.json()
    if (!Array.isArray(comments) || comments.length === 0) break
    for (const c of comments) {
      if (typeof c?.body === "string" && c.body.includes(REPLAY_MARKER)) staleIds.push(c.id)
    }
    if (comments.length < 100) break
  }
  for (const id of staleIds) {
    await fetch(`${cfg.githubApiUrl}/repos/${cfg.repository}/issues/comments/${id}`, { method: "DELETE", headers })
  }
  const postRes = await fetch(base, { method: "POST", headers, body: JSON.stringify({ body }) })
  if (!postRes.ok) {
    throw new Error(`Failed to create PR comment (${postRes.status}): ${await postRes.text()}`)
  }
  console.log("Posted dependency replay comment.")
}

async function main() {
  const cfg = readConfig()
  const [baseline, update, replay] = await Promise.all([
    readJson(cfg.baselinePath),
    readJson(cfg.updatePath),
    readJson(cfg.replayPath),
  ])
  if (baseline === null) console.warn(`No baseline execution record at ${cfg.baselinePath}.`)
  if (update === null) console.warn(`No update execution record at ${cfg.updatePath}.`)
  const body = renderComparison({ baseline, update, replay: replay || {}, cfg })
  if (argv.includes("--print")) {
    process.stdout.write(`${body}\n`)
    return
  }
  await repostPrComment(cfg, body)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
    } catch (_) {
      // step summary is best effort
    }
  }
}

const isDirectRun = argv[1] && fileURLToPath(import.meta.url) === argv[1]
if (isDirectRun) {
  main().catch((err) => {
    console.error(`Dependency replay comparison failed: ${err.message}`)
    if (readConfig().failOnError) process.exitCode = 1
  })
}
