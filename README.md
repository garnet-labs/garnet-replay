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

The v0 gate requires a public repository, an npm, pnpm, or yarn lockfile, and
a dependency pull request shape. Linux is the execution constraint.
Recording uses GitHub OIDC by default through `id-token: write`; no Garnet secret is needed.
`GARNET_API_TOKEN` is an optional fallback, and fork pull requests cannot use OIDC.
The generated workflow is pinned to unreleased main SHA `e546567` (v2.3.0 is not cut yet); repin to the v2.3.0 SHA at release.
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

## Benchmark

The no-publish benchmark compares source-only review with source plus the
Execution Diff block:

```sh
DRY_RUN=1 bash benchmark/run.sh
```

Model runs require `ANTHROPIC_API_KEY`. See `benchmark/README.md`.

Profile Evidence Catalogue: https://garnet.ai/profiles

An execution chain means a root-to-action path. A destination is the recorded
location of an outbound connection.

Status: private MVP; not published
