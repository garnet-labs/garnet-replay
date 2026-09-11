/** Escape all artifact content before inserting it into markup. */
export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

/** Accept only navigable HTTP(S) evidence links. */
export function safeUrl(value) {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Match saved record metadata, including exact GitHub PR URLs. */
export function matchingRecords(records, query, repository = "") {
  const text = query.trim().toLowerCase().replace(/\/$/, "")
  return records.filter((record) => (repository === "" || record.repository === repository)
    && [record.repository, record.title, record.number, record.url, record.verdict, record.head, record.base]
      .some((value) => String(value ?? "").toLowerCase().includes(text)))
}

/** Search the saved candidate fields, including reasons, paths, and transitions. */
export function matchingCandidates(observations, query) {
  const text = query.trim().toLowerCase()
  return observations.filter((row) => JSON.stringify(row).toLowerCase().includes(text))
}

/** Render the ledger's candidate score and evidence without flattening its gap. */
export function renderCandidate(row) {
  const details = { gap: row.gap, reasons: row.reasons, transition: row.transition, paths: row.paths }
  return `<article class="candidate"><span class="score" title="Candidate score">${escapeHtml(row.gap?.total ?? row.score ?? "—")}</span>
    <div><h3>${escapeHtml(row.title)}</h3><p>Upstream #${escapeHtml(row.upstreamPr)} · ${escapeHtml(row.kind)} · ${escapeHtml(row.state)}</p>
    <details><summary>Candidate reasons and paths</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(details, null, 2))}</pre></details></div>
    <button data-candidate="${escapeHtml(row.upstreamPr)}">Plan ↗</button></article>`
}

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Compose a POSIX-shell dry run only; no browser action executes commands. */
export function composeCommand(input) {
  for (const field of ["slug", "work", ...(input.mode === "prepared" ? ["prepared", "branch"]
    : input.mode === "pr" ? ["pr"] : input.mode === "dependency" ? ["dependency", "to"] : ["dependency"])]) {
    if (typeof input[field] !== "string" || input[field].trim() === "") throw new Error(`Enter ${field}.`)
    if (/[\x00-\x1f\x7f]/.test(input[field])) throw new Error(`${field} must be a single line.`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) throw new Error("Use a saved target slug.")
  const args = ["node", "bin/replay.mjs", "live", quote(input.slug)]
  if (input.mode === "pr") {
    if (!/^[1-9]\d*$/.test(input.pr)) throw new Error("Enter a positive PR number.")
    args.push("--pr", input.pr)
  } else if (input.mode === "prepared") {
    args.push("--prepared", quote(input.prepared), "--branch", quote(input.branch))
  } else if (input.mode === "dependency") {
    args.push("--dependency", quote(input.dependency), "--to", quote(input.to))
  } else if (input.mode === "allow-build") {
    args.push("--allow-build", quote(input.dependency))
  } else throw new Error("Choose a supported replay mode.")
  for (const [field, flag] of [["label", "--label"], ...(input.mode === "dependency" ? [["packageDir", "--package-dir"]] : [])]) {
    if (typeof input[field] !== "string" || input[field].trim() === "") continue
    if (/[\x00-\x1f\x7f]/.test(input[field])) throw new Error(`${field} must be a single line.`)
    args.push(flag, quote(input[field]))
  }
  args.push("--work", quote(input.work), "--dry-run")
  return args.join(" ")
}
