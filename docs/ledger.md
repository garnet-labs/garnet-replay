# Garnet Replay ship ledger

| # | Work item | Artifact | State |
|---|---|---|---|
| 1 | Create the Garnet Replay repository | `garnet-labs/garnet-replay` | done; repository is currently public |
| 2 | Known Evidence and Execution Diff contract | `schema/`, `lib/`, `public/replays/` | done |
| 3 | Live Replay branch generation | `live/`, `renderer/compare.mjs` | done |
| 4 | OIDC recording workflow | `live/templates/garnet-dependency-replay.yml` | done; `id-token: write`, no `GARNET_API_TOKEN` |
| 5 | Result page and adjacency checks | `renderer/result-page.mjs`, `test/` | done |
| 6 | Real and constructed seed set | `seeds/seeds.json`, `public/replays/` | done; 21 real and 4 constructed |
| 7 | Hero demo and seed wiring | PR #31, `real-reference-31` | done |
| 8 | Devin benchmark over 25 seeds | `benchmark/runs/devin/`, `benchmark/results.md` | done |
| 9 | Launch draft | `docs/launch-draft.md` | done; unpublished |

## Hero demo

The hero is
`garnet-labs/garnet-runtime-review-reference#31`.

It compares baseline
`8703692eae2f094a41390b8af6c72d3f327afa46` to head
`b639b38a8562e6bc39e65d5754652494e9d30faf`. Both profiles came from the
single OIDC replay run `33937541982`, with scope
`immediate-parent-to-head`.

The workload delta is +4 −0 destinations:

- `api.ipify.org`, `httpbin.org`, and `ip-api.com` via `node → dash → node`
- `registry.npmjs.org` via `bash → bash → node`

Runner background remains separate at +2 −2. The action is pinned to
`e546567a72e4fede11ec39d6e9f75b539adef22c`, unreleased before v2.3.0. The
workflow grants `id-token: write` and does not use `GARNET_API_TOKEN`.

This is a deliberately authored demo beacon package in a garnet-labs demo
repository. It is a real pull request with a real kernel record, not a
third-party incident.

## Benchmark

The benchmark uses Devin as reviewer, one pass per seed, not a human study.
Across 25 seeds, 21 real and 4 constructed:

- judgment changed: 7/25
- highest issue severity changed: 4/25
- evidence-grounded findings: 0 → 25
- source-only blind spots: 3

The one real escalation is `real-reference-31`, from
`comment` / `consider` to `request_changes` / `must_fix`. The 20 PostHog seeds
only de-escalate open questions.

## Learnings

- The two matrix record jobs use distinct `GARNET_PROFILE_JOB` values because
  the control-plane agent dedupe index includes the job name.
- The workflow waits 30 seconds at `Let sensor settle` before export so
  short-lived install flows reach the sensor's flush cadence.
- Compare comments use the recorded artifact SHAs rather than profile-stamped
  merge refs.

## Still undone

- Repository visibility is currently PUBLIC. The original ask was private;
  visibility is unchanged pending Farrukh's decision.
- No HN post has been made.
- No result permalinks are deployed.
- Website PR #141 is closed unmerged.
- `garnet/runtime-evidence` on PR #31 was last seen pending, not green.
- The action should be repinned to the v2.3.0 tag SHA when that tag exists.
- No protected `garnet-org` repository has been changed.
