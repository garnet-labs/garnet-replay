import { escapeHtml as h, safeUrl } from "./workspace-model.mjs"
import { parseReplayInput } from "./pr-route.mjs"

function prForm(value = "", compact = false) {
  return `<form class="pr-form ${compact ? "compact-form" : ""}" data-pr-form>
    <label class="sr-only" for="pr-url">GitHub pull request URL</label>
    <span class="input-icon" aria-hidden="true">↳</span>
    <input id="pr-url" name="url" autocomplete="off" spellcheck="false" required
      placeholder="github.com/owner/repo/pull/123" value="${h(value)}" aria-describedby="url-error" />
    <button type="submit" class="primary">${compact ? "Open" : "Open replay"} <span aria-hidden="true">→</span></button>
  </form><p id="url-error" class="url-error" role="status"></p>`
}

/** Render the URL-first landing page using actual saved examples. */
export function renderLanding(catalog, origin) {
  const examples = catalog.records.filter((row) => row.label === "real" && parseReplayInput(row.url) !== null).slice(0, 3)
  const example = examples[0] === undefined ? "/owner/repo/pull/123" : parseReplayInput(examples[0].url).path
  return `<div class="landing">
    <section class="hero">
      <div class="hero-kicker"><span class="mini-mark" aria-hidden="true">↳</span> A DIFFERENT VIEW OF YOUR PULL REQUEST</div>
      <h1>From pull request<br>to <span>runtime evidence.</span></h1>
      <p class="hero-copy">See what changed when the code ran.<br>${catalog.runnerAvailable === false ? "Open a GitHub PR to inspect its recorded runtime evidence." : "Open a GitHub PR to inspect its replay or prepare a new one."}</p>
      ${prForm()}
      <div class="input-hint"><span>GitHub URL, PR path, or <code>owner/repo#123</code></span><kbd>/</kbd></div>
    </section>
    <section class="shortcut" id="shortcut" aria-labelledby="shortcut-title">
      <div class="section-label"><span>THE URL IS THE INTERFACE</span><span>01 / 02</span></div>
      <div class="shortcut-layout"><div><h2 id="shortcut-title">Change the host.<br> Keep the pull request.</h2><p>Replace <code>github.com</code> with this Replay host in your address bar.</p></div>
        <div class="url-swap">
          <div class="url-line before"><span aria-hidden="true">−</span><code><del>github.com</del>${h(example)}</code></div>
          <div class="url-line after"><span aria-hidden="true">+</span><code><mark>${h(new URL(origin).host)}</mark>${h(example)}</code></div>
          <button data-copy-host="${h(new URL(origin).host)}">Copy Replay host <span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </section>
    <section class="examples" aria-labelledby="examples-title"><div class="section-label"><h2 id="examples-title">OPEN A SAVED REPLAY</h2><span>HISTORICAL EVIDENCE</span></div>
      ${examples.map((row) => `<a class="example-row" href="${h(parseReplayInput(row.url).path)}" data-pr-link>
        <span class="example-icon" aria-hidden="true">↳</span><span class="example-text"><span class="example-repo">${h(row.repository)} <span>#${row.number}</span></span><strong>${h(row.title)}</strong></span>
        <span class="example-verdict ${h(row.verdict)}">${h(row.verdict.replaceAll("-", " "))}</span><span aria-hidden="true">↗</span>
      </a>`).join("") || '<p class="muted">Paste a PR to look for evidence on GitHub.</p>'}
    </section>
    <footer class="replay-footer"><span>GARNET / REPLAY</span><span>${catalog.runnerAvailable === false ? "Public evidence viewer · recording runs in the local harness." : "Exact commits. Recorded actions. Traceable evidence."}</span><a href="/workspace">Open workspace ↗</a></footer>
  </div>`
}

/** Render the direct PR location bar without an artifact-browser sidebar. */
export function renderPrLocation(pr) {
  return `<div class="pr-location"><a href="/" data-home aria-label="Open another pull request">←</a>${prForm(pr.url, true)}<button id="copy-pr-link" title="Copy this Replay URL">Copy link</button></div>`
}

/** Render a resolvable PR with its current evidence state and next action. */
export function renderReplayPending(result) {
  const { pr, target, metadata, job } = result
  const states = {
    loading: ["Opening pull request", "Looking for saved evidence and a current GitHub receipt."],
    "no-record": ["Ready for its first replay.", "The GitHub lookup found no usable runtime evidence for this pull request."],
    pending: ["Waiting for the record.", "The GitHub receipt is still being written. Refresh to check for the final record."],
    "stale-record": ["This record needs a refresh.", "The available record belongs to an earlier head. Its comparison is undeterminable for this pull request."],
    unavailable: ["We couldn’t read this PR.", "Check the URL and GitHub access, then try again."],
  }
  const [heading, description] = states[result.state] ?? states["no-record"]
  return `${renderPrLocation(pr)}<section class="request-head">
    <div class="breadcrumb">${h(pr.repository)} <span>/</span> Pull request #${pr.number}</div>
    <h1>${h(result.title ?? `Pull request #${pr.number}`)}</h1>
    <div class="request-meta"><a href="${h(pr.url)}" target="_blank" rel="noreferrer">View on GitHub ↗</a>
      ${metadata === undefined ? "" : `<span>${h(metadata.state)}</span><span>${result.evidenceUrl !== pr.url ? "Fork head" : "Head"} <code title="${h(metadata.head)}">${h(metadata.head.slice(0, 7))}</code></span>`}
      <span>${result.checkedAt === null || result.checkedAt === undefined ? "GitHub lookup not verified" : `GitHub ${result.evidenceUrl !== pr.url ? "fork receipt " : ""}checked ${h(new Date(result.checkedAt).toLocaleTimeString())}`}</span></div>
  </section>
  <section class="request-state">
    <div class="state-visual ${result.state === "loading" ? "loading" : ""}" aria-hidden="true"><span>↳</span><i></i><span>◎</span></div>
    <div class="state-copy" role="status"><span class="eyebrow">PULL REQUEST → REPLAY</span><h2>${h(heading)}</h2><p>${h(result.lookupError ?? description)}</p></div>
    ${result.state === "loading" ? "" : `<div class="request-actions"><button id="refresh-pr">Check GitHub again ↻</button>${result.recordId !== null && result.recordId !== undefined ? '<button id="open-historical">Inspect historical record →</button>' : ""}</div>`}
  </section>
  ${result.state === "loading" ? "" : `<section class="prepare-panel">
    <div class="section-label"><span>NEXT REPLAY</span><span>${target === null ? "SETUP REQUIRED" : h(target.slug.toUpperCase())}</span></div>
    <div class="prepare-copy"><div><h2>${result.canPrepare ? "Replay this change on your fork." : result.runnerAvailable === false ? "Prepare a replay in the local harness." : "Bring runtime evidence to this PR."}</h2>
      <p>${result.canPrepare ? `The harness checks the change and recorder, then prepares a two-commit replay on ${h(target.fork)}.` : result.runnerAvailable === false ? "This viewer reads public evidence. Use the local harness to prepare and record a new replay on your fork." : target !== null ? "Open the upstream PR to prepare a replay, or refresh this fork’s existing recording." : "Connect this repository to the harness with a configured fork, or add Garnet to its workflow to record future runs."}</p></div>
      ${result.canPrepare ? '<button id="prepare-pr" class="primary">Prepare replay <span aria-hidden="true">→</span></button>' : '<a class="button-link" href="https://github.com/garnet-labs/garnet-replay#runbook" target="_blank" rel="noreferrer">Setup guide ↗</a>'}
    </div><div id="replay-job">${job === undefined ? "" : renderReplayJob(job, result.runnerEnabled)}</div>
  </section>`}`
}

/** Present only states reported by the canonical runner. */
export function renderReplayJob(job, enabled = true) {
  const labels = {
    preparing: "Checking the replay",
    prepared: "Your replay is ready to start",
    recording: "Recording the base and head",
    verifying: "Verifying the recorded pair",
    complete: "Replay verified",
    blocked: "Replay needs attention",
    interrupted: "Runner stopped before completion",
  }
  return `<div class="job-panel" role="status"><h3>${h(labels[job.state] ?? job.state)}</h3>
    ${job.plan === undefined ? "" : `<dl class="plan-facts"><div><dt>Fork</dt><dd>${h(job.plan.fork)}</dd></div><div><dt>Base → head</dt><dd><code>${h(job.plan.baseSha)} → ${h(job.plan.headSha)}</code></dd></div><div><dt>Recording</dt><dd>${h(job.plan.record)} · ${h(job.plan.ecosystem)}</dd></div><div><dt>Scope</dt><dd>${h(job.plan.scope)}</dd></div></dl>`}
    ${job.message === undefined ? "" : `<p>${h(job.message)}</p>`}
    ${job.plan?.paths === undefined ? "" : `<details><summary>Changed paths · ${job.plan.paths.length}</summary><ul>${job.plan.paths.map((path) => `<li><code>${h(path)}</code></li>`).join("")}</ul></details>`}
    ${job.state === "prepared" ? `<p>Starting creates a draft pull request on <strong>${h(job.plan.fork)}</strong> and runs its recording workflow.</p>
      ${enabled ? `<button class="primary" id="start-pr" data-job="${h(job.id)}">Start replay on fork →</button>` : '<p>Recording is disabled on this server. Enable it with <code>node bin/replay.mjs serve --run-replays</code>, then reopen this PR.</p>'}` : ""}
    ${safeUrl(job.forkUrl) === null ? "" : `<a href="${h(safeUrl(job.forkUrl))}" target="_blank" rel="noreferrer">Inspect fork progress ↗</a>`}
    ${job.lines?.length > 0 ? `<details><summary>Harness output</summary><pre class="raw">${h(job.lines.join("\n"))}</pre></details>` : ""}
  </div>`
}
