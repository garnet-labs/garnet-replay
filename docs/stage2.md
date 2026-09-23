# Stage 2: the target's own workflow and reviewers

Stage 1 shows that a record exists and what it says. Stage 2 asks whether a
review changes when the record is present. It is opt-in and lands as one pull
request on the fork's default branch.

```sh
node bin/replay.mjs stage2 posthog --dry-run                      # print the plan and the files
node bin/replay.mjs stage2 posthog                                # branch ci/garnet-evidence, draft PR on the fork
node bin/replay.mjs stage2 posthog --reviewers devin,greptile     # choose the review tools to re-request
node bin/replay.mjs stage2 posthog --replace-adapters             # overwrite adapter files (and REVIEW.md) the fork already has
node bin/replay.mjs stage2 dub --record-workflow .github/workflows/garnet.yml   # listen to one recorder only
node bin/replay.mjs stage2 browser-use --add-record --ecosystem uv  # add the harness recorder next to the fork's own
node bin/replay.mjs stage2 pnpm --replace-mirror                  # overwrite mirror/gate files the fork already carries
```

### Which recording workflows the mirror listens to

The plan reads every workflow on the fork's default branch. A recorder is a
`pull_request` workflow that runs `garnet-org/action` (directly or through a
called workflow). The mirror and gate list every recorder whose
`pull_request.paths` filter can match a dependency change; one whose filter
covers only `.github/workflows/**` never runs on a replay and is left out, with
the reason printed in the plan. Both workflows read the same head-bound comment,
so an extra recorder that ran and did not record is harmless: the block says
"no runtime evidence yet" until a trusted record for the head exists.

The plan stops, and says why, when:

- no recorder can run on a dependency change (pass `--record-workflow <path>`
  to listen to one anyway, or `--add-record --ecosystem <x>` to add the
  harness recorder, which the replay's `--record inject` also uses);
- the fork already carries a file at one of the stage 2 paths
  (`garnet-evidence-mirror.yml`, `garnet-evidence-mirror.mjs`,
  `garnet-rereview.mjs`, `garnet-evidence-gate.yml`,
  `garnet-evidence-gate.mjs`). Read it first: it may be an earlier copy of
  this mirror, or an unrelated workflow that happens to use the same name (the
  browser-use fork had a `workflow_dispatch` gate there). Either is overwritten
  only with `--replace-mirror`;
- another fork workflow with `pull-requests: write` already has a
  `workflow_run` trigger on one of the listened recorders. Two mirrors on one
  recorder edit the same description block and request reviews twice, so that
  one is reconciled on the fork first; there is no flag. Read-only listeners
  (benchmark uploads, receipts) are not conflicts.

Adapter files and `REVIEW.md` the fork already has are kept unless
`--replace-adapters` is passed; the plan lists them.

## What the pull request adds

| File | Role |
|---|---|
| `.github/workflows/garnet-evidence-mirror.yml` | Runs when a recording workflow completes and again on every `issue_comment` the Garnet App creates or edits (other authors are filtered out before any step runs). Runs default-branch code with `pull-requests: write` and `checks: write`, never the pull request's code. Copies the head-bound Garnet comment into the pull request description between `<!-- garnet:evidence:begin -->` and `<!-- garnet:evidence:end -->`, publishes `garnet/evidence` on the head from that same reading (so the re-review step never waits on a second workflow), then runs the re-review step for the tools listed in `GARNET_REVIEWERS`. |
| `.github/scripts/garnet-evidence-mirror.mjs` | The mirror. Accepts only comments from the Garnet App, only with a `garnet:commit` marker equal to the pull request head. The App appends jobs to one comment as they finish, so the copy names the recorded time and job count it holds and is refreshed on each edit; `replay consume` reports a copy whose register differs from the live comment as stale, not visible. Anything else writes a "pending" section, never an empty one. |
| `.github/scripts/garnet-rereview.mjs` | The re-review step. Requests each configured review tool again once per head, only after a finalized record bound to the exact head exists and `garnet/evidence` has passed for that head (it waits up to eight minutes for the check). Comment-triggered tools get one comment carrying every mention plus a `<!-- garnet:rereview <sha40> -->` lock; API-triggered tools (Copilot via requested reviewers, Devin via its review API and a repository secret) are called first so a failed call leaves no lock; the lock comment names no tool (tool names on the pull request are residue); which API requests were sent or skipped for a missing secret is in the job log only. The lock is re-read right before any request, and the mirror workflow runs one job at a time (`concurrency`), so overlapping recorder/comment events cannot request twice. The comment also carries the grounding ask inline: prefix runtime statements with `Runtime evidence (Garnet, head <sha7>):` and name the job and destination the record shows. A moved head, an absent or failed check, or a pending record request nothing. |
| Reviewer adapters | Thin per-tool files that point the tool at `REVIEW.md`: `.agents/skills/garnet-runtime-review/SKILL.md` (Devin), `.coderabbit.yaml`, `.greptile/config.json` + `.greptile/rules.md`, `.cursor/BUGBOT.md`, `.github/copilot-instructions.md` + `.github/skills/garnet-runtime-review/SKILL.md`, `.pr_agent.toml` (Qodo). Codex has no file adapter; it is mention-only. Files the fork already has are kept unless `--replace-adapters` is passed. |
| `.github/workflows/garnet-evidence-gate.yml` + `.github/scripts/garnet-evidence-gate.mjs` | Publishes the check run `garnet/evidence` on the pull request head with `checks: write` (a `workflow_run` job's own check lands on the default-branch commit, where the pull request never shows it). Success only with a finalized Garnet App comment whose `garnet:commit` equals the head, whose `garnet:summary`, when it declares `capture_quality`/`capture`, says `complete` (a declared partial capture fails; a record with no declaration passes and the check summary states that its contract does not declare capture completeness), and no listened recorder workflow run (`GARNET_RECORD_WORKFLOWS`, needs `actions: read`) still running on that head; `in_progress` while the App's pending placeholder is up or a recorder is still running (one recorder's finalized record says nothing about the others); failure otherwise. Runs on the same events as the mirror. Mark `garnet/evidence` required in branch protection after this pull request merges. |
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
- The mirror, the re-review step and the gate accept a comment as evidence only
  from the Garnet App logins (`garnet-runtime-review[bot]`,
  `garnet-runtime-review-dev[bot]`, `garnet-ai[bot]`), never
  `github-actions[bot]`, only with a finalized (non-pending) Garnet marker, and
  only when its `garnet:commit` equals the current head. A pending placeholder
  for the head renders the "no runtime evidence yet" block, not the record.
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
