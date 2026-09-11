# From PR URL to replay

Run from the harness checkout with Node 20 or later:

```sh
node bin/replay.mjs serve --port 8787
```

Open `http://localhost:8787`. No build, dependency install, or database is needed.
The first screen accepts a GitHub PR URL, a replacement-host URL, a PR path, or
`owner/repo#number`. A PR opens at `/owner/repo/pull/number`, including on a direct
visit, refresh, or browser back/forward.

Replace `github.com` with the running Replay host. Keep the owner, repository,
and PR path. For a local HTTP server, also change `https://` to `http://`. The
landing page shows the actual host and provides a copy action.

The resolver first reads saved artifacts and explicit upstream/fork mappings in
the target ledger. Saved evidence is labeled historical. It never matches PR
numbers across repositories without a ledger mapping. With no saved record,
Replay reads the PR and its Runtime Review receipt from GitHub. **Refresh from
GitHub** repeats that lookup. Authentication uses `GH_TOKEN`, `GITHUB_TOKEN`, or
the existing `gh` login, all server-side; public reads can work without a token.
Missing/private PRs and failed lookups show an unavailable state.

## Prepare and start a replay

For a configured upstream repository, **Prepare replay** runs the existing
`live <slug> --pr <number> --dry-run` command in a worker thread. It displays
the exact pair, fork, scope, recorder, changed paths, and canonical output.
Unsupported changes, missing workflows, and unhealthy recorders show their
canonical failure reason. Preparing does not create a PR or push a commit.

Recording is opt-in on the local server:

```sh
node bin/replay.mjs serve --run-replays
```

Review the plan, then click **Start replay on fork**. The runner calls the same
`livePr` orchestration as the CLI, checks the entire plan again before writes,
waits for the base and head records, runs `verifyExhibit`, and saves execution-diff
JSON only after verification passes for the same head. A moved plan requires
preparation again. A failed or timed-out job stays blocked, with its output.

The runner permits one active job and one server per checkout. It stores job
state under `out/workspace/` and recovers unfinished jobs as **interrupted**.
It does not automatically retry fork writes after a crash: inspect the fork
before preparing again, because remote workflows may still be running. Do not
run a separate replay CLI mutation concurrently against the same checkout.

For a private reverse proxy, declare its exact origin, without a trailing slash:

```sh
node bin/replay.mjs serve --origin https://your-private-replay-host
```

Runner requests require a configured origin, a JSON body, and an explicit request
header. There is no public/multi-user authentication layer. Keep this service
local or behind an authenticated private preview. A hosted service also needs
per-user authorization and isolated durable workers.

## Host the public evidence viewer

`node server.mjs` starts the deployment entrypoint on port 3000 (`PORT` overrides
it). Vercel detects this Node HTTP server; `vercel.json` includes the saved
evidence, target ledgers, and validation schema in the function. No build or
dependency installation is required.

This entrypoint supports saved evidence, direct PR URLs, and anonymous public
GitHub receipt lookups. It ignores ambient GitHub credentials. GitHub rate limits,
private PRs, and unavailable receipts remain explicit lookup failures. The page
directs preparation to the local harness; all mutations return HTTP 405.

There is no worker or writable job store in this entrypoint. Recording and durable
artifact updates still use the local harness. New checked-in evidence reaches the
viewer through a deployment. A team recording service requires authenticated
authorization, isolated workers and durable job/artifact storage.

Deploy to a separate Vercel project, verify its generated URL first, then attach a
free subdomain such as `replay.ci.run`. Inspect existing domain assignments before
changing them. Keep the project preview protected until its public-read behavior,
direct routes, evidence provenance and static assets have been verified.

## Inspect saved evidence

Open `/workspace` to search by repository, title, PR number, or SHA. Select a
record to load its detailed observations. Submitting a PR URL opens its PR route.
The URL hash preserves the selection, including on browser back/forward.

The execution diff keeps workload and runner background separate. Each side
lists independent removed or added observations; adjacent counts come from those
arrays. Expand an observation to inspect its execution ancestry. Display controls
switch attribution, split/stacked layout, density, and persistent color theme.
Phone layouts stack the comparison columns.

Evidence & provenance carries the exact pair, scope, capture accounting,
supersession, timestamp, source, and historical claim classes. Raw JSON preserves
the original artifact. Execution Profile links open the recorded base/head
profiles where available.

The artifact browser reads `public/replays/**/*.json` and `targets/*.json`.
It does not establish current GitHub heads. The PR route distinguishes a saved
artifact from a fresh receipt lookup; a receipt lookup alone is not the share
gate. Run `replay verify <fork-pr-url>` before sharing an exhibit, or use the
runner's completed verification. A previously saved verdict is scoped to that artifact;
partial, stale, contradictory, and unbound pairs render `undeterminable`.
For legacy receipts with `not-declared` capture, the canonical workload verdict
is limited to the recorded jobs. The page makes undeclared completeness explicit
and counts workload and runner-background observations separately. Original
verdict wording remains available in provenance and raw JSON.
Unrecorded observation kinds remain explicit. Malformed files are isolated in
the target board's unreadable-artifact list.

## Take the next harness step

Target ledgers use the same stage calculation as `replay status`. Candidate
observations retain their scores, reasons, paths and saved PR state. Select Plan
on a candidate to prefill its target and upstream PR number. Search candidates
by any saved field; the count updates with the displayed rows. Expand the
original target ledger to read notes and remaining metadata.

Plan replay composes a POSIX-shell command for a real PR, prepared two-state
input, pnpm dependency transition, or pnpm build-script allow decision. It always
includes `--dry-run`. Copy it into a terminal in the harness checkout, review the
plan, and then use the CLI to execute it. Fork, recorder, authentication and
two-commit guards remain in that CLI. Optional recording labels support fork
workflows gated by a label.

## HTTP interface

- `GET /api/workspace`: record summaries, target ledgers, isolated file issues,
  harness revision, and read timestamp.
- `GET /api/record?id=replays/github/<owner>/<repo>/<number>.json`: one
  schema-validated record projected for the workspace, plus its original JSON.
- Existing `/replays/github/<owner>/<repo>/<number>` JSON routes and generated
  `/replays/github/<owner>/<repo>/<number>/` result pages remain available.
- `--root` selects the public artifact directory; that directory must also
  contain the workspace assets to serve the interface.

- `GET /api/replay?url=<GitHub PR URL>[&refresh=1]`: PR identity, target mapping,
  saved-record ID or fresh receipt, lookup provenance, and local job state.
- `POST /api/replay/prepare` with `{"url":"<GitHub PR URL>"}`: start a dry-run
  preparation for a configured upstream target.
- `POST /api/replay/start` with `{"id":"<job ID>"}`: explicitly execute a prepared
  plan, only with `--run-replays`.
- `GET /api/replay/job?id=<job ID>`: local phase, output, plan, and verification.
- Both POST routes require `Origin`, `Content-Type: application/json`, and
  `X-Replay-Intent: same-origin`. Other routes remain GET/HEAD only.

## Verification

```sh
npm test
node --check lib/workspace.mjs
node --check lib/workspace-server.mjs
node --check public/workspace.mjs
node --check public/workspace-model.mjs
node --check public/pr-route.mjs
node --check public/replay-page.mjs
node --check lib/replay-request.mjs
node --check lib/replay-runner.mjs
node --check lib/replay-runner-worker.mjs
node bin/replay.mjs --help
```

Tests cover catalog isolation, lazy detail responses, filesystem confinement,
legacy routes, search, shell quoting, canonical target stages and fail-closed
evidence projection. Browser verification should cover desktop and phone widths,
keyboard controls, URL replacement, direct PR navigation, missing/stale/pending
records, preparation, runner recovery, all planner modes and theme persistence.
Use injected receipt/runner seams for recording tests; do not create external
fork PRs as part of a UI regression run.
