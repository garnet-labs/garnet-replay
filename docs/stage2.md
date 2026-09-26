# Stage 2: the target's own workflow and reviewers

Stage 1 shows that a record exists and what it says. Stage 2 asks whether a
review changes when the record is present. It is opt-in and lands as one pull
request on the fork's default branch.

```sh
node bin/replay.mjs stage2 posthog --dry-run        # print the plan and the files
node bin/replay.mjs stage2 posthog                  # branch ci/garnet-evidence, draft PR on the fork
```

## What the pull request adds

| File | Role |
|---|---|
| `.github/workflows/garnet-evidence-mirror.yml` | `workflow_run` after the recording workflow. Runs default-branch code with `pull-requests: write`, never the pull request's code. Copies the head-bound Garnet comment into the pull request description between `<!-- garnet:evidence:begin -->` and `<!-- garnet:evidence:end -->`. |
| `.github/scripts/garnet-evidence-mirror.mjs` | The mirror. Accepts only comments from the Garnet App, only with a `garnet:commit` marker equal to the pull request head. Anything else writes a "pending" section, never an empty one. |
| `.github/workflows/garnet-evidence-gate.yml` | Check `garnet/evidence`. Passes only when a Garnet comment is bound to the exact head SHA. Missing or stale evidence fails. Mark it required in branch protection after this pull request merges. |
| `.github/workflows/garnet-merge-safety.yml` | Check `garnet/merge-safety`. Runs `replay decide` over the head-bound record when the Garnet App writes or edits its comment, or on manual dispatch with a pull request number. Merge passes; hold and undeterminable fail closed. Checks out only the pinned replay tooling, never pull request code. |
| `REVIEW.md` | Grounding rules for reviewers and review agents: use the record only when its `garnet:commit` equals the head, prefix runtime-grounded statements with `Runtime evidence (Garnet, head <sha7>):`, never repeat Garnet's own judgments. |
| `.github/workflows/garnet-record.yml` | Only when the fork has no recording workflow. Pass `--ecosystem <npm|pnpm|yarn|cargo|ruby|uv|go>`. OIDC shape: `contents: read`, `id-token: write`, no `api_token`. |

Privileged workflows take effect only after the pull request merges to the
default branch. Until then `replay consume` reports the mirror as absent.

## Trust boundaries

- The mirror and the gate run from the default branch. They read the pull
  request head SHA from the event and never check out or execute it.
- The mirror accepts a comment as evidence only from the Garnet App login and
  only when its marker equals the current head. Author and SHA are both checked.
- Pull requests from other repositories receive neither secrets nor OIDC
  tokens. Their recording job degrades to a local record and the gate fails,
  which is the intended reading: no record is not a clean run.

## Consumption evidence

```sh
node bin/replay.mjs consume https://github.com/garnet-labs/posthog/pull/<N>
```

Reports, each tagged with its claim class:

- `required-check-state`: `garnet/evidence` and the recording job, settled or not;
- `reviewer-consumption-evidence`: whether the evidence mirror on the
  description cites the current head, and whether any reviewer or review agent
  other than Garnet quoted `head <sha7>` or the record's permalink;
- the verdict of the head-bound record itself.

Consumption is true only when a non-Garnet reviewer cited the head-bound record
and the Garnet checks are settled. A review agent that read the diff alone, or a
citation of a superseded head, does not count. The result is written to the
target ledger so `replay status` can mark stage 4.

## Stage 5 and 6

Stage 5 is a judgment over consumption evidence: did approve/escalate change
with the record present, over a cohort with and without it. Stage 6 is the
target running base→head records and the `garnet/evidence` policy without an
operator. Neither has a command; both are ledger notes with links to the
pull requests that show them.
