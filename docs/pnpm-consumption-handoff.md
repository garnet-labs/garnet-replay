# pnpm fork: reviewer consumption handoff (2026-10-02)

Status: the live demo is **blocked upstream** on the public-profile identity leg
(owner decision 4, recorder attestation in `garnet-org/action`). No new replay
was run. Harness commit `8d3789e` (main, PR #39 merge). All writes were to
`garnet-labs/*` forks only.

## The journey and where it breaks

1. A pnpm PR runs `TS CI`; the Garnet App posts a head-bound Runtime Review comment.
2. The fork's mirror copies the record into the PR description; the gate
   publishes `garnet/evidence`; the re-review step asks reviewers to look again.
3. A reviewer cites the head-bound record; `replay consume` scores the receipt.
4. `replay verify` clears every leg, so the result is shareable.

It breaks at step 1→4 before reviewers matter: no recent record clears
`verify`, and the gate in step 2 fails closed on every current record (below),
so step 2 never reaches the re-review request.

## Identity leg (step 3 of the brief): blocked

`GH_TOKEN="$(gh auth token)" node bin/replay.mjs verify <pr>`, 2026-10-02 ~17:45 UTC:

| fork PR | head | record | public profile identity | capture completeness |
|---|---|---|---|---|
| [#84](https://github.com/garnet-labs/pnpm/pull/84) | `194646d` | head-bound, no machine summary (still being written) | no exact selector on the record | not declared |
| [#82](https://github.com/garnet-labs/pnpm/pull/82) | `4736537` | pending placeholder | no exact selector on the record | not declared |
| [#71](https://github.com/garnet-labs/pnpm/pull/71) | `6723627` | final, pair `0df40d1 → 6723627` | records `fd90a96` (`refs/pull/71/merge`), expected head `6723627` | not declared |
| [#65](https://github.com/garnet-labs/pnpm/pull/65) | `68303b0` | final | merge-ref, not head | not declared (also a session-residue leg) |

The newest finalized record (#71) still reads `public-head-mismatch`, which is
the condition in `docs/intent-check.md` lane C. Per the brief, `refresh → find →
live → verify → re-trigger → consume` was not started. The candidate to run
once identity clears is unchanged from issue #44: upstream pnpm/pnpm#16522
(optional-dependency fetch warning), whose question is about which process
reaches which destination, not flow counts.

## Consumption results (existing records, `replay consume`, 2026-10-02 17:58 UTC)

Receipt tiers are in `targets/pnpm.json` → `consumption`.

| fork PR | consumed | receipts | note |
|---|---|---|---|
| #84 | no | 2 `mention` (qodo-code-review[bot]) | record not final; Qodo talks about the action, nothing head-bound |
| #82 | no | none | record pending |
| #71 | no | none | record final and mirrored; no reviewer was re-requested |
| #11, #28, #31, #43, #53, #61, #62 | yes | `utterance`/`citation` | all `devin-ai-integration[bot]`, from 2026-09-22 harvest |

Head-bound consumption on pnpm is still Devin-only (7 PRs). CodeRabbit, Qodo and
Greptile have `mention` receipts only.

## Measurement: reuse `benchmark/agent-ab`, no bespoke retrospective

The record→review effect is measured by `benchmark/agent-ab` (PR #40). Its
prospect cohort already contains this fork as task `pr-pnpm-71`
(`expected_verdict: new-behavior`, `capture: not-declared`). Two facts limit
what can be said today:

- No model episodes exist yet: the run stopped on AI Gateway
  `402 insufficient_funds` (PR #40). There is no prospect result to report.
- Under the answer key, `pr-pnpm-71` is `undeterminable` unless
  `score.mjs --admit-undeclared` is passed, because capture is not declared.
  The prospect cohort is exploratory and never pooled into the headline.

Next measurement is a funded `run.mjs --cohort prospect` plus
`score.mjs --cohort prospect`, not a new study.

## Workflow changes on the fork (brief items 1 and 2)

Shipped as https://github.com/garnet-labs/pnpm/pull/86 (draft; `.github/scripts/garnet-rereview.mjs`,
`garnet-evidence-gate.mjs`, both evidence workflows):

- `GARNET_REVIEW_TRIGGER_TOKEN` (user PAT secret, re-review step only) posts the
  request comment, so `@coderabbitai review` and `/review` come from a user
  identity. Without it the workflow token posts and the log says CodeRabbit and
  Qodo ignore bot-authored commands. The Devin REST path (`DEVIN_API_TOKEN`) is
  unchanged.
- `GARNET_GATE_MODE=comment` for tokens without `checks: write`: the gate emits
  an annotation and one per-head PR comment instead of the check run; the
  re-review step polls the PR comments for a finalized trusted record and
  computes the same reading the gate would publish (capture completeness and
  recorder settledness still required). `check-run` stays the default.

## Honest gaps

| gap | what it blocks | owner | closes when |
|---|---|---|---|
| Merge-ref identity: public profiles record `refs/pull/N/merge`, not the head | every `verify` → not shareable; lane C; this demo | `garnet-org/action` (decision 4). No open action PR as of 2026-10-02; the contract plan proposes propagating `GITHUB_HEAD_SHA` | `verify` on a fresh fork PR reads `[ok] public profile identity` |
| `capture_quality` not declared by contract 6.10 | the gate fails closed on every record, so check-run mode never re-requests reviews; agent-ab answers are `undeterminable` | control-plane contract | a record summary carries `capture_quality: complete` and the gate reads `success` |
| Qodo consumption unproven | Qodo has only `mention` receipts; bot-authored `/review` is ignored | this fork (PAT path now exists) | a PAT-posted `/review` on a gated head yields a head-bound `citation` |
| `DEVIN_API_TOKEN` | the Devin REST re-review; presence on the fork is unknown (secret listing is not readable with this token) and no mirror run has reached the re-review step since PR #85 (every run `skipped`) | Farrukh (repo secret) | a re-review step log shows `requested Devin review` |
| `GARNET_REVIEW_TRIGGER_TOKEN` | user-authored mentions | Farrukh (repo secret, fine-grained PAT, issues/pull requests write on `garnet-labs/pnpm` only) | a request comment authored by the PAT user on a gated head |

## What next

1. Decision 4 in `garnet-org/action` (owner: action maintainers; gated, outside this repo). Closes the identity leg.
2. Add `GARNET_REVIEW_TRIGGER_TOKEN` (and confirm `DEVIN_API_TOKEN`) on `garnet-labs/pnpm` (owner: Farrukh).
3. After 1: run the brief's step 4 on pnpm/pnpm#16522 with `--dry-run` first, then `verify`, PAT re-trigger, `consume` (owner: Devin; authorized).
4. Fund AI Gateway and run the agent-ab prospect cohort (owner: Farrukh for credits, then Devin).
