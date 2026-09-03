Static reviewers read the diff. Garnet Replay shows you the run.

# Garnet Replay

Garnet Replay packages recorded execution evidence beside a source diff.

## What you get

Each replay is an Execution Diff JSON document.
It names the repository, pull request, and exact comparison pair.
It records base and head commit SHAs.
It carries profile and run identifiers for each side.
It separates network, process, and file observations.
Each observation keeps its workload or runner background section.
Network observations include destinations and available ancestry.
Process observations use distinct execution chains.
Totals describe the recorded jobs, chains, and destinations.
The comparison scope is explicit.
Known Evidence and Live Replay use the same JSON shape.

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
`GARNET_API_TOKEN` is required for recording with action v2.2.0.
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
