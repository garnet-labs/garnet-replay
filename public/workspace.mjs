import { composeCommand, escapeHtml as h, matchingCandidates, matchingRecords, renderCandidate, safeUrl } from "./workspace-model.mjs"
import { parseReplayInput, replayShareStatus } from "./pr-route.mjs"
import { renderLanding, renderPrLocation, renderReplayPending, renderReplayJob } from "./replay-page.mjs"

const $ = (selector) => document.querySelector(selector)
const content = $("#content")
let catalog = { records: [], targets: [], issues: [] }
let currentRecord = null
let currentTarget = null
let currentView = "replays"
let currentTab = "diff"
let layout = "split"
let attribution = "all"
let compact = false
let requestVersion = 0
let toastTimer
let command = ""
let currentPr = null
let jobTimer

function surface(name) {
  clearTimeout(jobTimer)
  document.body.dataset.surface = name
  if (name !== "pr") currentPr = null
}

function home(push = false) {
  ++requestVersion
  surface("home")
  if (push) history.pushState(null, "", "/")
  document.title = "Garnet Replay · From pull request to runtime evidence"
  content.innerHTML = renderLanding(catalog, location.origin)
}

async function openPr(pr, push = true, refresh = false) {
  const version = ++requestVersion
  surface("pr")
  currentRecord = null
  currentPr = { pr, state: "loading" }
  currentTab = "diff"
  if (push) history.pushState(null, "", pr.path)
  document.title = `${pr.repository} #${pr.number} · Replay`
  content.innerHTML = renderReplayPending(currentPr)
  try {
    const response = await fetch(`/api/replay?url=${encodeURIComponent(pr.url)}${refresh ? "&refresh=1" : ""}`)
    if (!response.ok) throw new Error("The Replay service could not resolve this URL.")
    const result = await response.json()
    let record = result.record ?? null
    if (record === null && result.recordId !== null && result.state === "record") {
      const detail = await fetch(`/api/record?id=${encodeURIComponent(result.recordId)}`)
      if (!detail.ok) throw new Error("The saved record could not be read.")
      record = await detail.json()
    }
    if (version !== requestVersion) return
    currentPr = result
    document.title = `${result.title} · Replay`
    if (record !== null && result.state === "record") {
      currentRecord = record
      renderRecord()
    } else {
      content.innerHTML = renderReplayPending(result)
      if (result.job !== undefined && ["preparing", "recording", "verifying"].includes(result.job.state)) {
        $("#prepare-pr").disabled = true
        void pollJob(result.job.id, version)
      }
    }
  } catch (error) {
    if (version !== requestVersion) return
    currentPr = { pr, state: "unavailable", target: null, canPrepare: false, lookupError: error.message }
    content.innerHTML = renderReplayPending(currentPr)
  }
}

async function replayAction(action, id) {
  const version = requestVersion
  const container = $("#replay-job")
  if (container === null) return
  container.innerHTML = renderReplayJob({ state: "preparing", message: "Reading the upstream pair and the fork recorder." })
  $("#prepare-pr").disabled = true
  try {
    const response = await fetch(`/api/replay/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Replay-Intent": "same-origin" },
      body: JSON.stringify(action === "prepare" ? { url: currentPr.pr.url } : { id }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "The runner could not accept this replay.")
    if (version !== requestVersion) return
    await pollJob(result.id, version)
  } catch (error) {
    if (version !== requestVersion) return
    container.innerHTML = renderReplayJob({ state: "blocked", message: error.message })
    $("#prepare-pr").disabled = false
  }
}

async function pollJob(id, version) {
  try {
    const response = await fetch(`/api/replay/job?id=${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error("The runner is unavailable. Refresh this PR to recover its saved state.")
    const job = await response.json()
    if (version !== requestVersion) return
    $("#replay-job").innerHTML = renderReplayJob(job, currentPr.runnerEnabled)
    if (job.state === "complete") {
      await openPr(currentPr.pr, false, true)
      return
    }
    if (["preparing", "recording", "verifying"].includes(job.state)) jobTimer = setTimeout(() => void pollJob(id, version), 1500)
    else $("#prepare-pr").disabled = false
  } catch (error) {
    if (version !== requestVersion) return
    $("#replay-job").innerHTML = renderReplayJob({ state: "blocked", message: error.message })
    $("#prepare-pr").disabled = false
  }
}

function preference(key, value) {
  try {
    if (value !== undefined) localStorage.setItem(key, value)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function notify(text) {
  if ($("#planner").open) {
    $("#plan-error").textContent = text
    return
  }
  $("#toast").textContent = text
  $("#toast").classList.add("visible")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3500)
}

function short(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : "unavailable"
}

function link(url, text, className = "") {
  const safe = safeUrl(url)
  return safe === null ? `<span class="muted">${h(text)} unavailable</span>`
    : `<a href="${h(safe)}" class="${h(className)}" target="_blank" rel="noreferrer">${h(text)} ↗</a>`
}

function badge(record) {
  return `<span class="pill verdict ${h(record.verdict)}">${h(record.verdict === "unchanged" ? "workload unchanged" : record.verdict.replaceAll("-", " "))}</span>`
}

function empty(title, text) {
  content.innerHTML = `<div class="empty"><span class="eyebrow">REPLAY WORKSPACE</span><h1>${h(title)}</h1><p>${h(text)}</p><button data-open-plan>Plan a replay ↗</button></div>`
}

function navigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.view === currentView) button.setAttribute("aria-current", "page")
    else button.removeAttribute("aria-current")
  })
  const query = $("#search").value
  if (currentView === "targets") {
    const targets = catalog.targets.filter((target) => `${target.slug} ${target.upstream} ${target.fork}`.toLowerCase().includes(query.toLowerCase()))
    $("#navigation").innerHTML = `<div class="nav-label">TARGETS <span>${targets.length}</span></div>${targets.map((target) =>
      `<button class="target-nav ${currentTarget?.slug === target.slug ? "selected" : ""}" data-target="${h(target.slug)}">${h(target.slug)}<small>Next: ${h(target.view.nextName)}</small></button>`).join("") || '<p class="nav-empty">No matching targets.</p>'}`
    return
  }
  const records = matchingRecords(catalog.records, query)
  const repos = [...new Set(records.map((record) => record.repository))]
  $("#navigation").innerHTML = `<div class="nav-label">SAVED REPLAYS <span>${records.length}</span></div>${repos.map((repo) => {
    const rows = records.filter((record) => record.repository === repo)
    return `<details class="nav-repo" open><summary>${h(repo.split("/")[1])}<span class="muted">${rows.length}</span></summary>${rows.map((record) =>
      `<button class="nav-record ${currentRecord?.id === record.id ? "selected" : ""}" data-record="${h(record.id)}" aria-label="${h(record.repository)} PR ${record.number}: ${h(record.title)}"><span class="status-dot ${h(record.verdict)}"></span><span><span class="title">${h(record.title)}</span><span class="muted">#${record.number} · ${h(record.verdict.replaceAll("-", " "))}</span></span></button>`).join("")}</details>`
  }).join("") || '<p class="nav-empty">No saved replay matches.<br>Press Enter to plan the next one.</p>'}`
}

function setRoute(type, id = "") {
  const hash = type === "targets" ? "#targets" : `#${type}=${encodeURIComponent(id)}`
  if (location.pathname !== "/workspace" || location.hash !== hash) history.pushState(null, "", `/workspace${hash}`)
}

async function openRecord(id, push = true) {
  surface("workspace")
  const version = ++requestVersion
  currentView = "replays"
  currentTarget = null
  currentRecord = catalog.records.find((record) => record.id === id) ?? { id }
  currentTab = "diff"
  if (push) setRoute("record", id)
  navigation()
  empty("Opening saved evidence", "Loading the exact pair and its observations.")
  try {
    const response = await fetch(`/api/record?id=${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(response.status === 404 ? "This saved record is missing." : "This record could not be read or does not meet the execution-diff contract.")
    const record = await response.json()
    if (version !== requestVersion) return
    currentRecord = record
    renderRecord()
    navigation()
  } catch (error) {
    if (version !== requestVersion) return
    currentRecord = null
    empty("Evidence unavailable", `${error.message} No comparison result can be shown. Refresh the workspace after repairing or regenerating the artifact.`)
  }
}

function entry(kind, item, sign) {
  const ancestry = item.ancestry ?? []
  const label = kind.key === "network" ? item.destination : kind.key === "files" ? item.path : ancestry.join(" → ")
  return `<li class="entry"><div class="entry-line"><span class="sign">${sign}</span><code>${h(label)}</code></div>
    ${typeof item.process === "string" ? `<span class="process">${h(item.process)}</span>` : ""}
    ${ancestry.length > 0 ? `<details><summary>Execution ancestry · ${ancestry.length} steps</summary><ol class="ancestry">${ancestry.map((step) => `<li><code>${h(step)}</code></li>`).join("")}</ol></details>`
    : '<span class="process">Execution ancestry not carried by this record</span>'}</li>`
}

function renderKind(kind) {
  const emptyText = currentRecord.verdict === "undeterminable" ? "No entries carried here. The comparison is undeterminable." : "No entries in the saved delta."
  return `<section class="kind"><div class="kind-header"><span class="kind-symbol" aria-hidden="true">${kind.key === "network" ? "↗" : kind.key === "processes" ? ">_" : "≡"}</span><h3>${h(kind.title)}</h3><span class="muted">${kind.recorded ? "RECORDED KIND" : "NOT RECORDED"}</span></div>
    ${kind.recorded || kind.added.length + kind.removed.length > 0 ? `<div class="split">${["removed", "added"].map((direction) => `<div class="${direction}"><div class="column-head"><span>${direction === "removed" ? "BASE · removed observations" : "HEAD · added observations"}</span><span class="count">${direction === "added" ? "+" : "−"}${kind[direction].length}</span></div>
      ${kind[direction].length === 0 ? `<p class="empty-column">${emptyText}</p>` : `<ul class="entries">${kind[direction].map((item) => entry(kind, item, direction === "added" ? "+" : "−")).join("")}</ul>`}</div>`).join("")}</div>`
    : `<p class="unrecorded">This record carries no ${kind.key === "network" ? "outbound connection" : kind.key === "processes" ? "process" : "file"} delta. No change claim is available for this kind.</p>`}</section>`
}

function renderDiff() {
  return `<div class="toolbar"><p>Independent removed and added observations.<br>Row position does not imply a matching execution.</p><div class="toolbar-controls">
    <select id="attribution" aria-label="Filter attribution"><option value="all">All attribution</option><option value="workload">Workload</option><option value="runner background">Runner background</option></select>
    <button id="layout" aria-pressed="${layout === "stacked"}">${layout === "split" ? "⇄ Split" : "☰ Stacked"}</button><button id="density" aria-pressed="${compact}">Compact</button></div></div>
    <div class="${layout === "stacked" ? "stacked" : ""} ${compact ? "compact" : ""}">${currentRecord.groups.filter((group) => attribution === "all" || group.section === attribution).map((group) =>
      `<h2 class="group-title">${h(group.section)}</h2>${group.kinds.map(renderKind).join("")}`).join("")}</div>
    <p class="footnote">Each execution chain is a root-to-action path. Today’s recorded action class is the outbound connection. The comparison covers only the saved record’s scope.</p>`
}

function facts(rows) {
  return `<dl>${rows.map(([key, value]) => `<div><dt>${h(key)}</dt><dd>${h(value === null || value === undefined ? "not declared" : typeof value === "boolean" ? value ? "yes" : "no" : value)}</dd></div>`).join("")}</dl>`
}

function evidence() {
  const diff = currentRecord.artifact
  return `<div class="evidence-grid"><section class="evidence-card"><h2>Exact comparison pair</h2>${facts([
    ["Base SHA", diff.base.sha], ["Head SHA", diff.head.sha], ["Pair base SHA", diff.pair.base_sha], ["Pair head SHA", diff.pair.head_sha],
    ["Scope", diff.comparison.scope], ["Pair label", diff.pair.label], ["Transition", diff.pair.transition],
  ])}</section><section class="evidence-card"><h2>Capture accounting</h2>${facts([
    ["Status", diff.capture.status], ["Expected cells", diff.capture.expected_cells], ["Recorded cells", diff.capture.recorded_cells], ["Executed SHA verified", diff.capture.executed_sha_verified],
    ["Lineage missing", diff.capture.lineage_missing], ["Final record", diff.capture.final_record],
  ])}<ul class="reason-list">${diff.capture.reasons.map((reason) => `<li>${h(reason)}</li>`).join("")}</ul></section>
    <section class="evidence-card"><h2>Record provenance</h2>${facts([
      ["Recorded at", diff.recorded.at], ["Source", diff.recorded.source], ["Contract", diff.recorded.contract],
      ["Base profile", diff.base.profile_id], ["Head profile", diff.head.profile_id], ["Base run", diff.base.run_id], ["Head run", diff.head.run_id],
      ["Artifact", currentRecord.id ?? "GitHub receipt"], ["Share gate", replayShareStatus(currentRecord, currentPr?.job)],
    ])}</section><section class="evidence-card"><h2>Verdict and supersession</h2>${facts([
      ["Effective verdict", currentRecord.verdict], ["Verdict in artifact", diff.verdict.value], ["Saved superseded state", diff.supersession.superseded],
      ["Saved record head", diff.supersession.record_head], ["Head when saved", diff.supersession.current_head],
    ])}<ul class="reason-list">${currentRecord.reasons.map((reason) => `<li>${h(reason)}</li>`).join("")}</ul><details><summary>Original verdict reasons</summary><ul class="reason-list">${diff.verdict.reasons.map((reason) => `<li>${h(reason)}</li>`).join("")}</ul></details></section></div>
    <section class="evidence-card claims"><h2>Claim classes in the saved artifact</h2><p class="footnote" style="padding:0 14px">Historical source text. Claims below do not override the effective verdict or constitute a fresh verification.</p><ul class="claim-list">${diff.claims.map((claim) => `<li><small>${h(claim.class)}</small>${h(claim.text)}</li>`).join("")}</ul></section>
    <p class="footnote">${link(diff.receipt_urls.pr_comment, "Original evidence comment")} · Run <code>replay verify &lt;fork-pr-url&gt;</code> before sharing this exhibit.</p>`
}

function renderRecord() {
  const record = currentRecord
  const diff = record.artifact
  document.title = `${record.repository} #${record.number} · Garnet Replay`
  content.innerHTML = `${currentPr === null ? "" : renderPrLocation(currentPr.pr)}
    <div class="page-head"><div class="breadcrumb"><span>${currentPr === null ? "Saved replays" : "Replay"}</span><span>/</span><strong>${h(currentPr?.pr.repository ?? record.repository)}</strong><span>/</span><span>#${currentPr?.pr.number ?? record.number}</span></div>
    <div class="title-row"><h1>${h(record.title)}</h1><div class="header-links">${link(record.url, currentPr?.pr.url !== record.url && currentPr !== null ? "Fork PR" : "Pull request")}${record.id === null ? "" : `<a href="/${h(record.id)}" target="_blank">JSON ↗</a>`}</div></div>
    <div class="meta-row">${badge(record)}<span class="pill">${h(record.label)} pair</span><span>Recorded ${h(record.recordedAt ?? "at an unknown time")}</span><span>·</span><span>${h(diff.recorded.source)}</span></div>
    ${currentPr === null ? "" : `<div class="provenance-strip"><span>${currentPr.source === "github" ? `Receipt fetched from GitHub at ${h(currentPr.checkedAt)}` : "Historical record · current GitHub head not checked"}</span><button id="refresh-pr">Refresh from GitHub ↻</button></div>`}
    ${currentPr?.lookupError === undefined ? "" : `<p class="notice">${h(currentPr.lookupError)}</p>`}
    ${record.capture === "not-declared" ? '<p class="notice">Scope: recorded jobs only. The receipt does not declare capture completeness.</p>' : ""}
    <div class="review-state"><span class="state-icon" aria-hidden="true">◎</span><div><strong>${h(record.reasons[0] ?? "Inspect the runtime evidence.")}</strong><p>Scope: ${h(diff.comparison.scope)} · Capture: ${h(record.capture)} · ${h(replayShareStatus(record, currentPr?.job))}</p></div><span class="pill ${record.verdict === "undeterminable" ? "undeterminable" : ""}">${currentPr?.source === "github" ? "GITHUB RECEIPT" : "SAVED EVIDENCE"}</span></div>
    <div class="pair"><div><span>BASE</span><code title="${h(record.base)}">${short(record.base)}</code>${link(diff.receipt_urls.base, "Profile")}</div><span class="pair-arrow">→</span><div><span>HEAD</span><code title="${h(record.head)}">${short(record.head)}</code>${link(diff.receipt_urls.head, "Profile")}</div></div>
    <nav class="tabs" aria-label="Replay details"><button data-tab="diff" aria-pressed="${currentTab === "diff"}">Execution diff</button><button data-tab="evidence" aria-pressed="${currentTab === "evidence"}">Evidence & provenance</button><button data-tab="raw" aria-pressed="${currentTab === "raw"}">Raw JSON</button></nav></div>
    <div class="view-content">${currentTab === "diff" ? renderDiff() : currentTab === "evidence" ? evidence() : `<div class="toolbar"><p>${record.id === null ? "Execution diff from GitHub receipt" : `Original saved artifact · ${h(record.id)}`}</p><button id="copy-json">Copy JSON</button></div><pre class="raw">${h(JSON.stringify(diff, null, 2))}</pre>`}</div>`
  if ($("#attribution") !== null) $("#attribution").value = attribution
}

function targetBoard(push = true) {
  surface("workspace")
  ++requestVersion
  currentView = "targets"
  currentTarget = null
  currentRecord = null
  if (push) setRoute("targets")
  navigation()
  document.title = "Target ledgers · Garnet Replay"
  content.innerHTML = `<div class="page-head"><div class="breadcrumb">Workspace / Target ledgers</div><span class="eyebrow">FROM CANDIDATE TO CONSUMPTION</span><h1 style="margin-top:12px">One next step for every target.</h1><p class="muted" style="margin-top:12px;font-size:12px">Saved ladder state from the canonical harness. Each stage needs its own artifact.</p></div>
    <div class="view-content"><div class="nav-label">TARGET LEDGERS <span>${catalog.targets.length}</span></div><div class="ledger-grid">${catalog.targets.map((target) =>
      `<section class="ledger-card"><span class="eyebrow">${h(target.fork)}</span><h2>${h(target.slug)}</h2><p>Next: ${h(target.view.nextName)}</p><p>${h(target.view.question)}</p><button data-target="${h(target.slug)}">Open target →</button></section>`).join("") || '<p class="muted">No targets saved yet. Use replay find to start a ledger.</p>'}</div>
    ${catalog.issues.length > 0 ? `<details class="ledger-rows" open><summary>Unreadable artifacts · ${catalog.issues.length}</summary>${catalog.issues.map((issue) => `<p class="notice">${h(issue.file)}: ${h(issue.message)}</p>`).join("")}</details>` : ""}</div>`
}

function renderCandidates() {
  const observations = matchingCandidates(currentTarget.observations, $("#candidate-search").value)
  $("#candidates").innerHTML = `<h2 class="group-title">Candidate observations · ${observations.length}</h2>
    ${observations.map(renderCandidate).join("") || '<p class="notice">No matching candidates. Clear the filter or run replay find.</p>'}`
}

function openTarget(slug, push = true) {
  surface("workspace")
  ++requestVersion
  currentTarget = catalog.targets.find((target) => target.slug === slug)
  currentRecord = null
  currentView = "targets"
  if (push) setRoute("target", slug)
  navigation()
  if (currentTarget === undefined) {
    empty("Target unavailable", "This ledger is missing or malformed. Check unreadable artifacts on the target board.")
    return
  }
  const target = currentTarget
  document.title = `${target.slug} · Garnet Replay`
  content.innerHTML = `<div class="page-head"><div class="breadcrumb">Target ledgers / <strong>${h(target.slug)}</strong></div><div class="title-row"><h1>${h(target.slug)}</h1><button data-open-plan>Plan replay ↗</button></div><div class="meta-row"><span>Upstream: ${h(target.upstream)}</span><span>→</span><span>Fork: ${h(target.fork)}</span><span class="pill">SAVED LEDGER</span></div></div>
    <div class="view-content"><div class="ladder">${target.view.rows.map((row) => `<div class="stage ${h(row.state)}"><span>0${row.n}</span><strong>${h(row.name)}</strong>${h(row.state)}</div>`).join("")}</div>
    <div class="review-state"><div><span class="eyebrow">NEXT · ${h(target.view.nextName)}</span><p>${h(target.view.question)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${h(target.view.command)}</pre></div></div>
    <details class="stage-detail"><summary>Stage evidence</summary>${facts(target.view.rows.map((row) => [`${row.n} ${row.name}`, row.detail]))}</details>
    <p class="footnote">Finder output identifies a review gap. Candidate scores and PR states come from the saved ledger.</p>
    <div class="toolbar"><label for="candidate-search">Search candidates</label><input id="candidate-search" type="search" placeholder="Title, path, PR, or reason…" /></div>
    <div id="candidates"></div>
    ${["replays", "evidence", "cohorts", "consumption"].map((key) => `<details class="ledger-rows"><summary>Saved ${key} · ${(target[key] ?? []).length}</summary><pre class="raw">${h(JSON.stringify(target[key] ?? [], null, 2))}</pre></details>`).join("")}
    <details class="ledger-rows"><summary>Original target ledger, including notes</summary><pre class="raw">${h(JSON.stringify(Object.fromEntries(Object.entries(target).filter(([key]) => key !== "view")), null, 2))}</pre></details>
    <p class="footnote">Ledger states describe local artifacts. They do not establish current upstream, fork, or deployment state.</p></div>`
  renderCandidates()
}

function route() {
  const hash = location.hash.slice(1)
  try {
    if (hash.startsWith("record=")) return openRecord(decodeURIComponent(hash.slice(7)), false)
    if (hash.startsWith("target=")) return openTarget(decodeURIComponent(hash.slice(7)), false)
    if (hash === "targets") return targetBoard(false)
    const pr = parseReplayInput(location.href, location.origin)
    if (pr !== null) return openPr(pr, false)
    if (location.pathname === "/workspace") return catalog.records.length === 0 ? targetBoard(false) : openRecord(catalog.records[0].id, false)
    return home()
  } catch {
    empty("Invalid workspace link", "Choose a saved record or target from the navigation.")
  }
}

async function load() {
  $("#refresh").disabled = true
  try {
    const response = await fetch("/api/workspace")
    if (!response.ok) throw new Error("Unable to read the local catalog.")
    catalog = await response.json()
    $("#revision").textContent = `Harness ${short(catalog.revision)} · ${catalog.issues.length} unreadable artifacts`
    $("#revision").title = `Read at ${catalog.loadedAt}`
    $("#plan-target").innerHTML = catalog.targets.map((target) => `<option value="${h(target.slug)}">${h(target.slug)}</option>`).join("")
    await route()
  } catch (error) {
    empty("Workspace unavailable", `${error.message} Start the workspace with node bin/replay.mjs serve, then refresh.`)
  } finally {
    $("#refresh").disabled = false
  }
}

function updatePlan() {
  const input = Object.fromEntries(new FormData($("#plan-form")))
  document.querySelectorAll("[data-mode]").forEach((label) => {
    label.hidden = !label.dataset.mode.split(" ").includes(input.mode)
  })
  const hints = {
    pr: "The harness inspects the real change, then writes only to the configured fork.",
    prepared: "The JSON declares both file states and the pinned recording workflow. A new branch and two non-empty commits are required.",
    dependency: "pnpm only. The current lockfile supplies the baseline; the requested version becomes commit two.",
    "allow-build": "pnpm only. The dependency must already be in the lockfile. Record its script skipped, then explicitly allowed.",
  }
  $("#plan-hint").textContent = hints[input.mode]
  try {
    command = composeCommand(input)
    $("#command-output").textContent = command
    $("#copy-command").disabled = false
    $("#plan-error").textContent = "Dry run only. Nothing runs in the browser."
  } catch (error) {
    command = ""
    $("#command-output").textContent = "Fill in the fields to compose a command."
    $("#copy-command").disabled = true
    $("#plan-error").textContent = error.message
  }
}

function openPlanner(pr) {
  const inferred = currentTarget ?? catalog.targets.find((target) => target.fork === currentRecord?.repository)
  if (inferred !== undefined && inferred !== null) $("#plan-target").value = inferred.slug
  if (pr !== undefined) {
    $("#plan-mode").value = "pr"
    $("#plan-form").elements.pr.value = pr
  }
  updatePlan()
  $("#planner").showModal()
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    notify("Copied to clipboard")
  } catch {
    notify("Clipboard unavailable. Select and copy the displayed text.")
  }
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("[data-pr-link], [data-home]")
  if (anchor !== null && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    if (anchor.hasAttribute("data-home")) home(true)
    else void openPr(parseReplayInput(anchor.href, location.origin))
    return
  }
  const button = event.target.closest("button")
  if (button === null) return
  if (button.hasAttribute("data-copy-host")) void copy(button.dataset.copyHost)
  else if (button.id === "copy-pr-link") void copy(`${location.origin}${currentPr.pr.path}`)
  else if (button.id === "refresh-pr") void openPr(currentPr.pr, false, true)
  else if (button.id === "open-historical") void openRecord(currentPr.recordId)
  else if (button.id === "prepare-pr") void replayAction("prepare")
  else if (button.id === "start-pr") void replayAction("start", button.dataset.job)
  else if (button.dataset.record !== undefined) void openRecord(button.dataset.record)
  else if (button.dataset.target !== undefined) openTarget(button.dataset.target)
  else if (button.dataset.view === "targets") targetBoard()
  else if (button.dataset.view === "replays") {
    currentView = "replays"
    if (catalog.records.length > 0) void openRecord(catalog.records[0].id)
    else {
      ++requestVersion
      navigation()
      empty("No saved replays yet", "Plan a replay, then generate its execution-diff JSON with the canonical harness. Refresh to load saved evidence.")
    }
  } else if (button.dataset.tab !== undefined) {
    currentTab = button.dataset.tab
    renderRecord()
    document.querySelector(`[data-tab="${currentTab}"]`).focus()
  } else if (button.dataset.candidate !== undefined) openPlanner(button.dataset.candidate)
  else if (button.hasAttribute("data-open-plan") || button.id === "plan") openPlanner()
  else if (button.id === "close-plan") $("#planner").close()
  else if (button.id === "refresh") void load()
  else if (button.id === "layout") {
    layout = layout === "split" ? "stacked" : "split"
    renderRecord()
    $("#layout").focus()
  } else if (button.id === "density") {
    compact = !compact
    renderRecord()
    $("#density").focus()
  } else if (button.id === "copy-json") void copy(JSON.stringify(currentRecord.artifact, null, 2))
  else if (button.id === "theme") {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = theme
    preference("replay-theme", theme)
  }
})

document.addEventListener("change", (event) => {
  if (event.target.id === "attribution") {
    attribution = event.target.value
    renderRecord()
    $("#attribution").focus()
  }
})
$("#search").addEventListener("input", navigation)
document.addEventListener("input", (event) => {
  if (event.target.id === "candidate-search") renderCandidates()
})
$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const pr = parseReplayInput($("#search").value, location.origin)
  if (pr !== null) return void openPr(pr)
  if (currentView === "targets") {
    const query = $("#search").value.toLowerCase()
    const target = catalog.targets.find((entry) => `${entry.slug} ${entry.upstream} ${entry.fork}`.toLowerCase().includes(query))
    if (target !== undefined) return openTarget(target.slug)
    ++requestVersion
    empty("No target matches", "Search a saved target slug, upstream repository, or fork repository.")
    return
  }
  const records = matchingRecords(catalog.records, $("#search").value)
  if (records.length > 0) void openRecord(records[0].id)
  else {
    ++requestVersion
    empty("No saved replay matches", "Search a repository, title, SHA, PR number, or exact PR URL. URLs resolve only against saved evidence. Plan and verify a replay to add another record.")
  }
})
document.addEventListener("submit", (event) => {
  if (!event.target.hasAttribute("data-pr-form")) return
  event.preventDefault()
  const input = event.target.elements.url
  const pr = parseReplayInput(input.value, location.origin)
  if (pr === null) {
    $("#url-error").textContent = "Use a GitHub pull request, such as github.com/owner/repo/pull/123."
    input.setAttribute("aria-invalid", "true")
    input.focus()
    return
  }
  void openPr(pr)
})
$("#plan-form").addEventListener("input", updatePlan)
$("#plan-form").addEventListener("change", updatePlan)
$("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault()
  if (command !== "") void copy(command)
})
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !$("#planner").open) {
    event.preventDefault()
    const input = $("#pr-url") ?? $("#search")
    input.focus()
  }
})
window.addEventListener("popstate", route)
document.documentElement.dataset.theme = preference("replay-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
void load()
