# Garnet Replay plan

## Product

`PR → base execution + head execution → Execution Diff → JSON`

Static reviewers read the diff. Garnet Replay shows the run.

The repository contains Known Evidence, Live Replay, a dependency-free result
page, schema-validated JSON, constructed fixtures, real replay seeds, and a
local reviewer benchmark.

## Current hero

The hero is
`garnet-labs/garnet-runtime-review-reference#31`.

The exact pair is:

```text
baseline 8703692eae2f094a41390b8af6c72d3f327afa46
head     b639b38a8562e6bc39e65d5754652494e9d30faf
run      33937541982
scope    immediate-parent-to-head
```

Both profiles came from that single OIDC replay run. The workload delta is
+4 −0 destinations:

- `api.ipify.org`, `httpbin.org`, and `ip-api.com` via `node → dash → node`
- `registry.npmjs.org` via `bash → bash → node`

Runner background is kept separate at +2 −2. This is a deliberately authored
demo beacon package in a garnet-labs demo repository. It is a real pull request
with a real kernel record, not a third-party incident.

The generated workflow uses `id-token: write`, no `GARNET_API_TOKEN`, and pins
`garnet-org/action@e546567a72e4fede11ec39d6e9f75b539adef22c`. That pin is
unreleased before v2.3.0 and should be repinned at the tag.

## Benchmark

The Devin reviewer path is the default. It runs one pass per seed, not a human
study, over 25 seeds: 21 real and 4 constructed.

```text
judgment changed: 7/25
highest issue severity changed: 4/25
evidence-grounded findings: 0 → 25
source-only blind spots: 3
```

The one real escalation is `real-reference-31`:
`comment` / `consider` → `request_changes` / `must_fix`. The 20 PostHog seeds
only de-escalate open questions.

The legacy Claude path remains available with `REVIEWER=claude` and
`ANTHROPIC_API_KEY`. `DRY_RUN=1` writes local blocks and a not-run table.

## Repo layout (`garnet-replay/`)
```
README.md                      static reviewers read the diff; this shows you the run
schema/execution-diff.schema.json   the contract (rename of build_block.py's block)
lib/execution-diff.mjs         build_block.py port: comment → Execution Diff JSON
lib/receipt.mjs                fetch_corpus.py port: PR → App comment, exact-head gate, markers
lib/known-evidence.mjs         PR URL → Execution Diff (default mode)
lib/gate.mjs                   Live Replay v0 support gate (public, npm/pnpm/yarn, dep PR, Linux)
bin/replay.mjs                 CLI: known <pr-url> | live <repo> [--dependency] | serve | seed
renderer/review.mjs, demo.mjs  vendored verbatim from garnet-ui (6.9.8)
renderer/compare.mjs           two-profile comparison comment (delta-first, reuses review.mjs trees)
renderer/result-page.mjs       delta-first HTML result view: [Full evidence] [JSON] [Share]
live/replay-branch.mjs         two-commit baseline→update branch + workflow injection
live/templates/                garnet-dependency-replay.yml (SHA-pinned), install.sh, compare wiring
public/replays/github/{owner}/{repo}/{n}.json   static GET shape
public/replays/github/{owner}/{repo}/{n}/index.html
seeds/seeds.json               20–30 entries, source + label (real-clean | constructed)
benchmark/README.md, run.sh    Devin default; Claude legacy path; local result table
docs/launch-draft.md           Show HN draft (unpublished)
test/*.test.mjs                node:test; renderer --assert; schema validation; fixtures from corpus
```

## Honesty rules

- Keep workload and runner background separate.
- An execution chain is a root-to-action path.
- Every rendered count must equal the adjacent list.
- Label constructed examples as constructed.
- Do not present the authored hero beacon as a third-party incident.
- Runtime evidence is unavailable or stale unless it is bound to the reviewed
  head.
- Keep launch copy unpublished until the remaining checks and decisions are
  complete.

## Remaining decisions

- Decide whether to keep the repository PUBLIC. The original ask was private.
- Make no HN post yet.
- Deploy no result permalinks yet.
- Website PR #141 is closed unmerged.
- The last observed `garnet/runtime-evidence` status for PR #31 was pending,
  not green.
- Repin the action when the v2.3.0 tag exists.
- Do not modify protected `garnet-org` repositories.
