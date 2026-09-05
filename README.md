Static reviewers read the diff. Garnet Replay shows you the run.

# Garnet Replay

Garnet Replay packages recorded execution evidence beside a source diff.

## What you get

```json
{
  "schema_version": "execution-diff/v1",
  "mode": "known-evidence | live-replay",
  "label": "real | constructed",
  "repo": { "owner": "...", "name": "...", "url": "..." },
  "pull_request": { "number": 123, "url": "...", "title": "..." },
  "base": { "sha": "...", "profile_id": "...", "run_id": "..." },
  "head": { "sha": "...", "profile_id": "...", "run_id": "..." },
  "comparison": { "available": true, "scope": "..." },
  "execution_diff": {
    "network_added": [{ "destination": "...", "section": "workload" }],
    "network_removed": [],
    "processes_added": [{ "ancestry": ["...", "..."], "section": "workload" }],
    "processes_removed": [],
    "files_added": [],
    "files_removed": [],
    "totals": { "workload": { "added": 1, "removed": 0 }, "runner_background": { "added": 0, "removed": 0 } }
  },
  "receipt_urls": { "base": "...", "head": "...", "head_json": "...", "pr_comment": "..." }
}
```
Network and process observations identify workload versus runner background.

## Known Evidence

Resolve an exact-head App record:

```sh
node bin/replay.mjs known https://github.com/owner/repo/pull/123
```

Serve replay JSON and static artifacts locally:

```sh
node bin/replay.mjs serve --port 8787 --root public
```

## Live Replay

Live Replay creates a two-commit branch for a dependency transition:

```sh
node bin/replay.mjs live https://github.com/owner/repo \
  --dependency example --from 1.0.0 --to 1.1.0
```

Use `--dir sub/app` for a package subdirectory and `--from none` when adding a dependency absent from the baseline.

The v0 gate requires a public repository, a package.json, and a dependency pull request shape.
An npm, pnpm, or yarn lockfile selects the package manager; without one, npm is used.
Linux is the execution constraint.
Recording authenticates through GitHub OIDC with `id-token: write`; the hero run used no `GARNET_API_TOKEN`.
The generated workflow is pinned to `e546567a72e4fede11ec39d6e9f75b539adef22c`, unreleased before v2.3.0. Repin it at the v2.3.0 tag.
`GITHUB_TOKEN` is sufficient for the comment and JSON path, which then has no
execution record to compare.

Use `--dry-run` to print the branch plan without creating commits.

## Honesty and labels

Real corpus entries show `0` workload change. Their recorded differences are
runner background observations. Constructed cases are labelled separately and
exist to exercise specific profile shapes.

## Seeds

`seeds/seeds.json` lists the real corpus entries and constructed cases.
Replay JSON files live below `public/replays`.
The three constructed diffs compare against a clean constructed install from the same demo repository (`comparison.scope: constructed-pair`), not against the PR's own parent.
Regenerate constructed replay JSON with `node bin/replay.mjs seed-constructed seeds/seeds.json --out public/replays`.

## Hero pair

The hero is `garnet-labs/garnet-runtime-review-reference#31`.

It compares baseline `8703692eae2f094a41390b8af6c72d3f327afa46` with head
`b639b38a8562e6bc39e65d5754652494e9d30faf` in a single OIDC replay run,
`33937541982`. The scope is `immediate-parent-to-head`.

The workload delta is +4 −0 destinations:

- `api.ipify.org`, `httpbin.org`, and `ip-api.com` via `node → dash → node`
- `registry.npmjs.org` via `bash → bash → node`

Runner background is shown separately: +2 −2. This is a deliberately authored
demo beacon package in a garnet-labs demo repository. It is a real pull request
with a real kernel record, not a third-party incident.

## Benchmark

The no-publish benchmark compares source-only review with source plus the
Execution Diff block:

```sh
DRY_RUN=1 bash benchmark/run.sh
```

The default reviewer is Devin and the current run covers 25 seeds. The review
judgment changed on 7/25 seeds. Evidence-grounded findings changed from 0 to
25, with 3 source-only blind spots. See `benchmark/README.md` for the scoring
definitions and the legacy Claude path.

Profile Evidence Catalogue: https://garnet.ai/profiles

An execution chain means a root-to-action path. A destination is the recorded
location of an outbound connection.

Status: MVP in a public repository. Visibility is unchanged pending Farrukh's
decision. Nothing has been published.
