# Reviewer readiness and golden path

Maintained ranking of the review tools Garnet evidence is delivered to, by how
ready each one is to consume a head-bound Runtime Review record today. Every
row cites what was observed, when, and where; a row without a proof column
entry is unproven, not ready. Update this file after every fork proof round
(`docs/stage2.md`, `.devin/skills/prospect-replays/SKILL.md`).

Readiness is scored on five questions, each answered from evidence rather than
vendor claims:

| # | Question | Evidence that answers it |
|---|---|---|
| R1 | Channel: does the tool read the PR-description mirror? | vendor docs (documented / inferred / undocumented) plus an observed receipt whose detail exists only in the mirror |
| R2 | Trigger: can it be re-requested once per head after `garnet/evidence` succeeds? | a documented comment command or API path that a workflow token can call |
| R3 | Adapter: does a repository file steer its output? | the adapter listed in `docs/stage2.md` and a review that follows it |
| R4 | Observed tier: what did it actually emit on garnet-labs forks? | `replay consume` / `replay harvest` receipts (utterance, citation, observation, mention) |
| R5 | Value: did the evidence change or add anything a diff-only review would miss? | `replay uat` decision-impact and value-hypothesis rows with notes |

## Ranking (observations through 2026-09-22 UTC)

| Rank | Reviewer | R1 channel | R2 trigger | R3 adapter | R4 observed on forks | R5 value | Readiness |
|---|---|---|---|---|---|---|---|
| 1 | Devin | undocumented for automatic review; reads skills and `AGENTS.md` | `/devin review` from a human comment; REST API with `DEVIN_API_TOKEN` | `.agents/skills/garnet-runtime-review/SKILL.md` | 12 exact contract utterances (pnpm, posthog, runtime-review-reference); 7 head-bound consumers on pnpm, 3 on posthog | no data | ready to prove: only tool with repeated exact utterances |
| 2 | Greptile | documented | `@greptileai` mention; programmatic review trigger | `.greptile/config.json`, `.greptile/rules.md` | head-bound citations on posthog 107 and 115, both after a session told it to read the record; otherwise mentions without binding | no data | conditionally ready: binds when steered, not by default |
| 3 | CodeRabbit | documented | incremental review on push; `@coderabbitai review` | `.coderabbit.yaml` | hundreds of mentions on pnpm, zero head-bound receipts even with the fork's `.coderabbit.yaml` asking for a prefix | no data | delivery ready, grounding unproven |
| 4 | GitHub Copilot | inferred | re-request the `copilot-pull-request-reviewer` via the requested-reviewers API | `.github/copilot-instructions.md`, `.github/skills/garnet-runtime-review/SKILL.md` | none in the inventory (not installed on the proof forks) | no data | untested |
| 5 | Cursor Bugbot | documented | comment or API re-trigger depending on configuration | `.cursor/BUGBOT.md` | none in the inventory | no data | untested |
| 6 | Codex | unknown | `@codex review` mention; no check-completion subscription found | none (mention path only) | `chatgpt-codex-connector` present on the codex fork; no receipt with runtime detail | no data | untested, no adapter |
| 7 | Qodo | documented | no documented re-trigger after a successful check; bot-authored mentions may be filtered | `.pr_agent.toml` | generic "review updated until commit" stamps; no evidence-specific wording | no data | not a target: output is boilerplate |

Sources: inventory sweep of 120 garnet-labs repositories / 958 fork PRs
(2026-09-22, `replay harvest` on pnpm and posthog, `docs/examples.md`), the
seven reviewer research reports summarised in `docs/consumption-roadmap.md`.

## Golden path (current)

1. Recorder on the fork posts the head-bound record (`live/templates/garnet-record.yml`
   or the fork's own recorder that `replay stage2 --dry-run` lists).
2. `replay stage2` lands the mirror, the `garnet/evidence` gate, one `REVIEW.md`
   and the adapters for the selected reviewers (default `devin,coderabbit,greptile`).
3. The reviewer's first review says "no runtime evidence for this head"; that is
   correct, not a defect.
4. After the finalized exact-head record and a successful `garnet/evidence`
   check, the re-review job requests each configured reviewer once for that head.
5. `replay consume <slug> --pr N` records the funnel; `replay uat` records the
   cold read, how the reviewer consumed the record, and whether it changed the
   decision.

## What the first proof round taught (2026-09-22, harness 9cd6eb1 → c9feabe)

- No reviewer was reached: all five producer lanes stopped before recording
  because the Stage 2 planner assumed one recorder and a bare fork. Real forks
  have several recorders with path filters, injected recorders that only exist
  on replay branches, existing mirror or gate files, and competing
  `workflow_run` listeners. The planner now lists recorders, stops on
  conflicts, and takes `--record-workflow`, `--add-record`, `--replace-mirror`.
- The generated mirror trusted `github-actions[bot]` and pending markers; it
  now trusts only the Garnet App logins and finalized markers. The same
  correction is proposed for `agent-install-kit`.
- Landing stage2 needs a merge into the fork default branch, which the
  automation account cannot perform; that is a permissions decision, not a
  harness defect. Resolved 2026-09-22: fork-only fast-forward pushes of the
  stage2 branch to each fork default branch are authorized.

## What the second proof round taught (2026-09-22, harness dc640f5)

Stage 2 landed on posthog (garnet-labs/posthog#204 → replay #205), codex
(#26 → #27) and dub (#38 → #39); pnpm stopped on four `workflow_run` listeners
on "TS CI" and browser-use on an unrelated `workflow_dispatch` gate at the
template path. Still no reviewer reached, this time for reasons inside the
generated files, each observed on the replay PRs and fixed in the harness:

- `gh api --paginate --slurp --jq` is rejected on the runner, so the gate job
  failed before reading a comment. The gate is now a script with explicit
  pagination.
- A `workflow_run` job's own check lands on the default-branch commit, not the
  pull request head, so `garnet/evidence` never appeared on the replay and the
  re-review step waited for a check that could not arrive. The gate now
  publishes a `garnet/evidence` check run on the head with `checks: write`.
- The App appends jobs to one comment as recorders finish; a mirror taken after
  the first recorder (codex: 3 of 4 jobs; dub: 1 of 2) carried the right head
  and an older record. The mirror now re-runs on every App comment edit and
  names the recorded time and job count it copied; `replay consume` reports a
  copy behind the live comment as stale.
- `<Execution Profile URL>` outside code was dropped by GitHub Markdown, so the
  rendered citation example read `— ` with nothing after it. Now in backticks.
- Independent cold reads of the three replay PRs rated 2 of 5: the record was
  present but the description block, the missing check and the malformed
  citation example made the pull request harder to read than one without it.
- Read-only `workflow_run` listeners (pnpm's benchmark upload, receipt and
  workload views) no longer stop the plan; listeners with `pull-requests:
  write` still do.

Reviewer value (`R5`) remains unmeasured: zero receipts of any tier on the
three replay PRs, because no re-review request was ever sent.

## Rules for editing this file

- Rank only from observed receipts and documented tool behaviour; cite the
  fork, PR and date for every claim.
- A grounding line or a head SHA alone never counts as reading the record; an
  observation needs a destination or execution-chain detail that exists only
  in the record.
- Keep `R5` empty until a `replay uat` row with notes exists; do not infer
  value from tier.
