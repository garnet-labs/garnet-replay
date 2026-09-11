---
name: garnet-replay-workspace-testing
description: Test Garnet Replay URL-first navigation, dry-run preparation, isolated synthetic lifecycle, evidence fixtures, and rendered documentation without real replay writes.
---

# Read-only workspace testing

## Setup

- Use Node 20+; no dependency installation is needed for the workspace.
- From the checkout, run `node bin/replay.mjs serve --port 8787`.
- Open `http://localhost:8787`. No app login is required. Restart the server after harness revision changes and refresh after frontend changes.
- `/` is URL-first; `/workspace` is the legacy artifact browser. For private-preview POSTs, add `--origin <exact-preview-origin>` without a trailing slash. A preview login wall means preview-authenticated POST coverage is untested, not equivalent to localhost coverage.
- Never enable `--run-replays` on the real test server. Real preparation is a dry run but still needs explicit permission and GitHub read access.
- Keep generated fixtures, scripts, and evidence under a persistent directory outside the checkout.

## URL-first and lifecycle checks

- Exercise GitHub URLs, same-origin replacement URLs, PR paths, shorthand, invalid hosts, direct visits, reload, history, and the `/` shortcut from an unfocused page.
- Check requested upstream identity separately from explicitly mapped fork evidence. Saved artifacts are historical; a fresh receipt lookup alone does not establish a share gate.
- Confirm summary counts match the displayed observation arrays and separate workload from runner background. `not-declared` capture allows only recorded-jobs-scoped workload conclusions and needs an explicit completeness notice; partial/none evidence remains undeterminable.
- For start/record/verify UI tests, use an isolated `createWorkspaceServer` with injected `readReplay` and a fake `createReplayRunner` launch seam. Never let synthetic Start reach the real worker or GitHub.
- Exercise preparing, prepared, recording, verifying, complete, blocked, unsupported, and recovered interrupted states. Verify the completed share claim appears only for PASS plus exact matching head and fork URL.
- Navigate away during delayed lookup and preparation; late lookup/job responses must not replace the newly selected PR. Test failure of refresh while historical evidence remains visible.

## Evidence fixtures

- Import `createWorkspaceServer` from `lib/workspace-server.mjs` in a temporary ES-module script. Pass a separate public `root`, copied `targetsDir`, parsed `schema/execution-diff.schema.json`, and a clearly isolated `revision`; listen on a different port.
- Copy the current frontend assets into that public root. Start from schema-valid saved records, then create partial and superseded variants plus a malformed JSON file.
- Retain a healthy record alongside malformed evidence. Confirm healthy navigation still works, unreadable artifacts are counted, incomplete records have effective `undeterminable`, and provenance/Raw JSON preserve the original verdict.
- Copy a target ledger and inject a distinctive note only in the isolated copy. Verify the original-ledger fold retains it.
- Test malformed encoded hashes, unknown IDs, and traversal-like IDs in the browser. Do not modify checked-in replay JSON or ledgers.

## UI checks

- Compare candidate scores and reason points with `gap.total` and `gap.reasons`; check paths and transitions without treating candidate evidence as runtime evidence.
- Exercise saved-field candidate filtering, adjacent counts, reset, and planner prefill.
- Copy planner commands only; never execute them. Verify visible clipboard feedback is inside the open dialog.
- Use native keyboard traversal for search, planner controls, Escape, and return focus. Distinguish background-page focus leakage from browser-chrome focus behavior.
- Verify ancestry summary counts equal ordered-list entries without an appended duplicate action.
- Cold-read at desktop and 390px. Check document overflow independently from intentional local code-block scrolling.
- If clearing CDP phone emulation leaves the viewport narrow, resize and re-maximize the browser to restore its desktop viewport before capturing final evidence.

## Rendered documentation

- Render changed Markdown via `gh api markdown --input -` with mode `gfm` and repository context. Serve returned HTML locally with readable responsive Markdown styling.
- Inspect desktop and 390px output; distinguish GitHub-rendered HTML from the local stylesheet used for presentation.
- Preserve the actual source-relative links. Verify their source destinations exist without requiring browser navigation to GitHub.

## Devin Secrets Needed

None for the local workspace or isolated fixtures. GitHub Markdown rendering requires an already authenticated `gh` session; request GitHub access if unavailable rather than inventing credentials.
