# Stage 2: the target's own workflow and reviewers

Stage 1 shows that a record exists and what it says. Stage 2 asks whether a
review changes when the record is present. It is opt-in and lands as one pull
request on the fork's default branch.

```sh
node bin/replay.mjs stage2 posthog --dry-run                      # print the plan and the files
node bin/replay.mjs stage2 posthog                                # branch ci/garnet-evidence, draft PR on the fork
node bin/replay.mjs stage2 posthog --reviewers devin,greptile     # choose the review tools to re-request
node bin/replay.mjs stage2 posthog --replace-adapters             # overwrite adapter files the fork already has
```

## What the pull request adds

| File | Role |
|---|---|
| `.github/workflows/garnet-evidence-mirror.yml` | `workflow_run` after the recording workflow. Runs default-branch code with `pull-requests: write` and `checks: read`, never the pull request's code. Copies the head-bound Garnet comment into the pull request description between `<!-- garnet:evidence:begin -->` and `<!-- garnet:evidence:end -->`, then runs the re-review step for the tools listed in `GARNET_REVIEWERS`. |
| `.github/scripts/garnet-evidence-mirror.mjs` | The mirror. Accepts only comments from the Garnet App, only with a `garnet:commit` marker equal to the pull request head. Anything else writes a "pending" section, never an empty one. |
| `.github/scripts/garnet-rereview.mjs` | The re-review step. Requests each configured review tool again once per head, only after a finalized record bound to the exact head exists and `garnet/evidence` has passed for that head (it waits up to eight minutes for the check). Comment-triggered tools get one comment carrying every mention plus a `<!-- garnet:rereview <sha40> -->` lock; API-triggered tools (Copilot via requested reviewers, Devin via its review API and a repository secret) are called first so a failed call leaves no lock. A moved head, an absent or failed check, or a pending record request nothing. |
| Reviewer adapters | Thin per-tool files that point the tool at `REVIEW.md`: `.agents/skills/garnet-runtime-review/SKILL.md` (Devin), `.coderabbit.yaml`, `.greptile/config.json` + `.greptile/rules.md`, `.cursor/BUGBOT.md`, `.github/copilot-instructions.md` + `.github/skills/garnet-runtime-review/SKILL.md`, `.pr_agent.toml` (Qodo). Codex has no file adapter; it is mention-only. Files the fork already has are kept unless `--replace-adapters` is passed. |
| `.github/workflows/garnet-evidence-gate.yml` | Check `garnet/evidence`. Passes only when a Garnet comment is bound to the exact head SHA. Missing or stale evidence fails. Mark it required in branch protection after this pull request merges. |
| `REVIEW.md` | Grounding rules for reviewers and review agents: use the record only when its `garnet:commit` equals the head, prefix runtime-grounded statements with `Runtime evidence (Garnet, head <sha7>):`, never repeat Garnet's own judgments. |
| `.github/workflows/garnet-record.yml` | Only when the fork has no recording workflow. Pass `--ecosystem <npm|pnpm|yarn|cargo|ruby|uv|go>`. OIDC shape: `contents: read`, `id-token: write`, no `api_token`. |

Privileged workflows take effect only after the pull request merges to the
default branch. Until then `replay consume` reports the mirror as absent.

### Which reviewers, and why

Default `--reviewers devin,coderabbit,greptile`: the three tools with observed
head-bound receipts or exact contract utterances in the garnet-labs inventory
(2026-09-22). `bugbot`, `copilot`, `qodo` and `codex` are available by name;
their trigger paths are documented by the vendors but had no head-bound receipt
in the inventory when this was written, so they are opt-in until a fork proof
shows one. Reviewer output is telemetry, never enforcement: `garnet/evidence`
is the only gate.

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

### The funnel row and reviewer UAT

Every consumption row also carries a `funnel` with one observed flag per stage,
so a miss can be placed:

| stage | observed when |
|---|---|
| `delivered` | a finalized record is bound to the head |
| `visible` | the description mirror names the head |
| `rereviewRequested` | a `<!-- garnet:rereview <head> -->` comment exists for this head |
| `attention` | any receipt was written after the record |
| `grounded` | a head-bound utterance or citation exists (the same condition as `consumed`, minus the record check) |
| `observation` | a reviewer repeated a destination from the record |
| `consumedHow` | one entry per strong receipt: who, where, tier, and whether it came `before-record`, `after-record` or `after-rereview` |

Four fields are manual and only `replay uat` writes them; a re-check keeps them
for the same head and clears them for a new one:

```sh
node bin/replay.mjs uat pnpm --pr 66 --cold-read 4 \
  --decision-impact not-supported --attribution supported \
  --value-hypothesis supported --note "named the storage destination the diff does not show"
```

- `coldRead` 0..5: could a reader who has never seen Garnet tell what ran and
  what changed from the review line and the check alone;
- `decisionImpact`: did the reviewer approve, block or ask differently because
  of the record (`supported` needs a `--note` naming the decision);
- `attribution`: does the review name Garnet or the record as its source;
- `valueHypothesis`: did the grounded line add something a diff-only review
  would miss (`supported` needs a `--note` naming it).

A citation is not proof of judgment; `grounded yes` with `decision-impact
unknown` is the honest default until someone reads the review.

## Stage 5 and 6

Stage 5 is a judgment over consumption evidence: did approve/escalate change
with the record present, over a cohort with and without it. Stage 6 is the
target running base→head records and the `garnet/evidence` policy without an
operator. Neither has a command; both are ledger notes with links to the
pull requests that show them.
