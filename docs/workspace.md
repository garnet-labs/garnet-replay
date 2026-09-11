# Replay workspace

Run from the harness checkout with Node 20 or later:

```sh
node bin/replay.mjs serve --port 8787
```

Open `http://localhost:8787`. No build, dependency install, token, or database is
needed. The workspace reads `public/replays/**/*.json` and `targets/*.json`.
Refresh in the sidebar to reread local artifacts.

## Inspect saved evidence

Search by repository, title, PR number, SHA, or exact PR URL. URLs resolve only
against the local catalog. Select a record to load its detailed observations.
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

Everything is saved evidence. This workspace does not poll GitHub, establish the
current PR head, or run the share gate. Run `replay verify <fork-pr-url>` before
sharing an exhibit. A previously saved verdict is scoped to that artifact;
partial, stale, contradictory, and unbound pairs render `undeterminable`.
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

The server has no mutation or shell-execution endpoint. Keep it on your
development machine or behind a private preview. It does not add authentication
for a public or multi-user deployment.

## Verification

```sh
npm test
node --check lib/workspace.mjs
node --check lib/workspace-server.mjs
node --check public/workspace.mjs
node --check public/workspace-model.mjs
node bin/replay.mjs --help
```

Tests cover catalog isolation, lazy detail responses, filesystem confinement,
legacy routes, search, shell quoting, canonical target stages and fail-closed
evidence projection. Browser verification should cover desktop and phone widths,
keyboard controls, all planner modes, missing records and theme persistence.
