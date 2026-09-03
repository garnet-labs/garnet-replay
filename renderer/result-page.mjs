#!/usr/bin/env node
// Delta-first result page for one Execution Diff. Dependency-free; reads the
// JSON the static GET layout serves and writes index.html beside it.
//
//   node renderer/result-page.mjs public/replays            # render every <n>.json
//   node renderer/result-page.mjs path/to/139.json          # render one

import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs"
import { dirname, join, basename, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
export function safeHref(value) {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null
}

function short(sha) {
  return typeof sha === "string" && sha.length >= 7 ? sha.slice(0, 7) : "—"
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/**
 * Group one kind's added/removed entries by section so every number shown
 * next to a list is the length of that list (adjacency rule).
 */
export function kindGroups(diff, kind) {
  const added = diff.execution_diff[`${kind}_added`]
  const removed = diff.execution_diff[`${kind}_removed`]
  const sections = ["workload", "runner background"]
  return sections.map((section) => ({
    section,
    added: added.filter((e) => e.section === section),
    removed: removed.filter((e) => e.section === section),
  }))
}

function entryText(kind, entry) {
  if (kind === "network") return entry.destination
  if (kind === "files") return entry.path
  return entry.ancestry.join(" → ")
}

function renderEntries(kind, entries, sign) {
  if (entries.length === 0) return ""
  return `<ul class="entries ${sign === "+" ? "added" : "removed"}">${entries
    .map((e) => {
      const who = e.process ? `<span class="who">${escapeHtml(e.process)}</span>` : ""
      return `<li><span class="sign">${sign}</span><code>${escapeHtml(entryText(kind, e))}</code>${who}</li>`
    })
    .join("")}</ul>`
}

function renderKind(diff, kind, title) {
  const recorded = diff.execution_diff.kinds_recorded.includes(kind === "processes" ? "process" : kind === "files" ? "file" : "network")
  const groups = kindGroups(diff, kind)
  const workload = groups[0]
  const background = groups[1]
  const total = workload.added.length + workload.removed.length
  const lineageOnly = kind === "processes" && !recorded && (diff.execution_diff.totals.execution_chains ?? 0) > 0
  const headline = lineageOnly
    ? `<span class="muted">${plural(diff.execution_diff.totals.execution_chains, "execution chain")} on this head · per-item delta not carried on this receipt</span>`
    : !recorded
    ? `<span class="muted">no ${kind === "files" ? "file" : kind} observations on this record</span>`
    : total === 0
      ? `<span class="zero">+0 −0</span> <span class="muted">in your workflow</span>`
      : `<span class="delta">+${workload.added.length} −${workload.removed.length}</span> <span class="muted">in your workflow</span>`
  const bg = background.added.length + background.removed.length
  const bgLine = recorded && bg === 0
    ? `<p class="bg-line">runner background: +0 −0</p>`
    : ""
  return `<section class="kind ${total > 0 ? "changed" : ""}">
  <h2>${title} <span class="count">${headline}</span></h2>
  ${renderEntries(kind, workload.added, "+")}${renderEntries(kind, workload.removed, "−")}
  ${bgLine}
  ${bg > 0 ? `<details><summary>runner background · +${background.added.length} −${background.removed.length} · no recorded workflow step</summary>${renderEntries(kind, background.added, "+")}${renderEntries(kind, background.removed, "−")}</details>` : ""}
</section>`
}

/**
 * @param {Record<string, any>} diff Execution Diff (schema execution-diff/v1)
 * @param {{jsonHref: string, pageUrl?: string}} links
 */
export function renderResultPage(diff, { jsonHref, pageUrl = "" }) {
  const pr = diff.pull_request
  const repoName = `${diff.repo.owner}/${diff.repo.name}`
  const totals = diff.execution_diff.totals
  const workloadChange = (totals.workload.added ?? 0) + (totals.workload.removed ?? 0)
  const constructed = diff.label === "constructed"
  const scopeText = {
    "previous-recorded-head-to-head": "previous recorded head → this head",
    "immediate-parent-to-head": "baseline commit (immediate parent) → update commit",
    "constructed-pair": "clean constructed install of the same demo repository → this head (not this PR's own parent)",
    unavailable: "no previous record to compare with",
  }[diff.comparison.scope] ?? diff.comparison.scope
  const fullEvidence = safeHref(diff.receipt_urls.head)
  const baseEvidence = safeHref(diff.receipt_urls.base)
  const prLink = safeHref(pr.url)
  const dep = pr.dependency
    ? `${escapeHtml(pr.dependency.name)} ${pr.dependency.from ? escapeHtml(pr.dependency.from) + " → " : ""}${escapeHtml(pr.dependency.to ?? "")}`
    : null

  const summaryLine = !diff.comparison.available
    ? `One side recorded (${short(diff.head.sha)}). ${scopeText}.`
    : workloadChange === 0
      ? `Nothing your workflow ran changed between ${short(diff.base.sha)} and ${short(diff.head.sha)}. Recorded change is runner background only.`
      : `Your workflow's execution changed between ${short(diff.base.sha)} and ${short(diff.head.sha)}: +${totals.workload.added} −${totals.workload.removed} destinations.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution Diff · ${escapeHtml(repoName)} #${pr.number}</title>
<style>
:root{--fg:#1b1b1f;--muted:#6b6f76;--line:#e4e5e8;--add:#0f6b3a;--rem:#9b2c2c;--brand:#C8504A;--bg:#fff;--card:#fafafa}
@media (prefers-color-scheme:dark){:root{--fg:#ececef;--muted:#9a9ea6;--line:#2c2e33;--add:#5fcf8f;--rem:#ff8a80;--bg:#111214;--card:#181a1e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
header h1{font-size:22px;margin:0 0 4px}
header .repo{color:var(--muted);font-size:14px}
.label{display:inline-block;font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;margin-left:6px;vertical-align:middle}
.label.constructed{border-color:var(--brand);color:var(--brand)}
.pair{margin:16px 0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:8px;font-size:14px}
.pair div+div{margin-top:4px}
.summary{font-size:18px;margin:18px 0}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 28px}
.actions a,.actions button{font:inherit;font-size:14px;padding:8px 14px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);text-decoration:none;cursor:pointer}
.actions a.primary{border-color:var(--brand);color:var(--brand)}
.actions .disabled{opacity:.5;pointer-events:none}
.kind{border-top:1px solid var(--line);padding:18px 0}
.kind h2{font-size:16px;margin:0 0 8px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.count .delta{color:var(--add);font-weight:600}
.count .zero{color:var(--muted)}
.muted{color:var(--muted);font-weight:400}
.entries{list-style:none;margin:6px 0;padding:0}
.entries li{display:flex;gap:8px;align-items:baseline;padding:3px 0}
.entries .sign{width:1em;font-weight:700}
.added .sign{color:var(--add)}.removed .sign{color:var(--rem)}
.who{color:var(--muted);font-size:13px}
.bg-line{color:var(--muted);font-size:14px;margin:6px 0 0}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted);font-size:14px}
footer{margin-top:32px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:14px}
footer p{margin:6px 0}
.note{border-left:3px solid var(--brand);padding:8px 12px;margin:0 0 16px;font-size:14px;background:var(--card)}
</style>
</head>
<body>
<main>
<header>
  <div class="repo">${escapeHtml(repoName)} · pull request #${pr.number}${dep ? ` · ${dep}` : ""}</div>
  <h1>${escapeHtml(pr.title)}<span class="label ${constructed ? "constructed" : ""}">${constructed ? "constructed test case" : "real pull request"}</span></h1>
</header>
${constructed ? `<p class="note">This pull request was authored to exercise a specific execution shape. It is a test case, not something found in a routine dependency update.</p>` : ""}
<p class="summary">${summaryLine}</p>
<div class="actions">
  ${fullEvidence ? `<a class="primary" href="${fullEvidence}">Full evidence ↗</a>` : `<span class="actions disabled"><a>Full evidence (no public record)</a></span>`}
  <a href="${escapeHtml(jsonHref)}">JSON</a>
  <button type="button" data-share="${escapeHtml(pageUrl)}">Share</button>
  ${prLink ? `<a href="${prLink}">Pull request ↗</a>` : ""}
</div>
<div class="pair">
  <div><strong>this head</strong> <code>${escapeHtml(diff.head.sha ?? "—")}</code>${fullEvidence ? ` · <a href="${fullEvidence}">Execution Profile ↗</a>` : ""}</div>
  <div><strong>compared with</strong> <code>${escapeHtml(diff.base.sha ?? "—")}</code>${baseEvidence ? ` · <a href="${baseEvidence}">Execution Profile ↗</a>` : diff.comparison.available ? " · profile link not carried on this record" : ""}</div>
  <div><strong>scope</strong> ${escapeHtml(scopeText)} · <strong>mode</strong> ${escapeHtml(diff.mode)}</div>
</div>
${renderKind(diff, "processes", "Processes")}
${renderKind(diff, "network", "Network destinations")}
${renderKind(diff, "files", "Files")}
<footer>
  <p>Recorded ${escapeHtml(diff.recorded.at ?? "—")} · contract ${escapeHtml(diff.recorded.contract ?? "—")} · source ${escapeHtml(diff.recorded.source)}${totals.execution_chains !== null ? ` · ${plural(totals.execution_chains, "execution chain")} and ${plural(totals.destinations ?? 0, "destination")} on this head` : ""}</p>
  <p>Workload = execution under a recorded workflow step or a <code>Runner.Worker</code> descent. Runner background = the runner's own agents, systemd-rooted with no recorded step. An execution chain is a root-to-action path.</p>
</footer>
</main>
<script>
document.querySelector("[data-share]").addEventListener("click",async(e)=>{const u=e.currentTarget.dataset.share||location.href;try{await navigator.clipboard.writeText(u);e.currentTarget.textContent="Copied"}catch{prompt("Copy this link",u)}});
</script>
</body>
</html>
`
}

function renderFile(jsonPath, { publicRoot }) {
  const diff = JSON.parse(readFileSync(jsonPath, "utf8"))
  const number = basename(jsonPath, ".json")
  const dir = join(dirname(jsonPath), number)
  const rel = "/" + jsonPath.slice(publicRoot.length + 1).split("\\").join("/")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "index.html"), renderResultPage(diff, { jsonHref: rel, pageUrl: rel.replace(/\.json$/, "") }))
  return join(dir, "index.html")
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (extname(p) === ".json" && /^\d+\.json$/.test(name)) acc.push(p)
  }
  return acc
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = resolve(process.argv[2] ?? join(ROOT, "public", "replays"))
  const publicRoot = target.includes(`${join("public", "replays")}`) ? target.slice(0, target.indexOf(join("public", "replays")) + "public".length) : dirname(target)
  const files = statSync(target).isDirectory() ? walk(target) : [target]
  for (const f of files) console.log(renderFile(f, { publicRoot }))
}
