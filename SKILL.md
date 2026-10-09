---
name: garnet-replay
description: Produce, verify, and report a Garnet runtime-evidence exhibit on a garnet-labs fork with the replay command line. Use when asked to replay a pull request, find a candidate, build an evidence card, run a cohort, or wire Stage 2 on a target repository.
---

# Garnet Replay skill

Preconditions: Node 20+, `gh auth status` succeeds, `export GH_TOKEN=$(gh auth token)`,
a local checkout of the fork (`--work`). Read `AGENTS.md` for the rules.

## Procedure

0. **Upstream first.** If the upstream's CI already runs `garnet-org/action`, run `replay upstream <owner/repo> --pr <N>` for each candidate before any replay. Read the job table (a green job with "skipped: no authentication" recorded nothing) and the binding column: a merge-ref profile is an observation, never exact-head evidence, and a destination seen on a docs-only control PR is baseline, not the change. If that answers the review question, stop there; replay only for an exact-head before/after pair.
1. **Target.** `targets/<slug>.json` exists or `replay find … --slug <slug> --fork garnet-labs/<name>` creates it. Confirm the fork exists and belongs to `garnet-labs`; never create a new fork without an explicit decision. Declare how the target records once, at find time: `--record-mode instrument --record-job <workflow-file>/<job>` records inside the project's own CI job (later `live` runs need no `--record` flags), and `--workload-name <name> --workload-paths <glob,..>` names the behavior under test so candidates touching those paths rank up. `--paths <glob,..>` filters the ranked list to matching pull requests without persisting anything.
2. **Candidate.** `replay find <owner/repo> --slug <slug> --fork <fork> --author 'app/dependabot' --limit 40`. Read the reasons, not only the total. Name a review question the measured command can answer; install scripts and native binaries are useful leads. When the target declares a workload (`--workload-name/--workload-paths`), candidates touching those paths rank up with a `workload-surface` reason and the recommendation prefers them. A major version bump alone is insufficient, and installation cannot answer application compatibility. Skip merge-queue batches and anything that cannot install on Linux CI. State that this is candidate evidence.
3. **Onboard once, then plan.** Check the fork first: `replay setup <slug> --dry-run`. If it reports nothing to onboard, skip to the replay plan. Otherwise read the setup plan (one onboarding commit, a ready pull request against the default branch, routine CI wording, no upstream references), run it without `--dry-run`, and get the pull request merged. A merged onboarding PR is the normal case; later replays carry only the change. For an ordinary replay, use `replay live <slug> --pr <N> --work <checkout> --dry-run`; for a pnpm transition, use `replay live <slug> --dependency <dep> --to <v> --package-dir <dir> --work <checkout> --dry-run`; when the lockfile cannot change, use `replay live <slug> --allow-build <dep> --work <checkout> --dry-run`. On an already aligned, onboarded default-branch path, the ordinary plan has one commit (the change), fork as `origin`, exact head SHA, and routine wording. Other paths may plan two commits; read their sequence and pair. The run refuses when the fork has no pull-request recording workflow and points at `replay setup`; `--record inject` bundles a recorder into the replay as a two-commit sequence, and `--record instrument --job <workflow-file>/<job>` records inside the project's own CI job. Stop if the plan shows an unsupported ecosystem, and report that. The checkout must be clean; the run refuses uncommitted changes rather than discarding them. If the run says the fork default branch is behind the change's base, rerun with `--sync-fork` (fast-forward only), or with `--base-branch <name>` to open against a fork-only branch set to the base when the default branch must stay put; when that base already runs its own recorder, omit `--record-workflow`, otherwise a fork with several recording workflows needs `--record-workflow <path>`. If the plan stops because the change touches none of the recording workflow's trigger paths, pick another change (`targets/<slug>.json` keeps each candidate's paths) rather than forcing it; that pull request would record nothing. A workflow listed as `not counted as a recorder` runs only on labelled pull requests; use `--label <name>` to count it. Read the `recorder health` line: on `stalled` or `none` the run stops before writing, because the fork's recent pull requests show Runtime Review comments that never finalized; do not use `--allow-pending-recorder`, which opens a pull request that `verify` cannot complete until the comment finalizes. Pull requests younger than an hour without a finalized record are skipped, so a batch's own in-flight replays do not read as a stall.

For an earlier push in the same upstream pull request, use `replay live <slug> --pr <N> --first-commit <sha> --work <checkout> --dry-run`. The SHA must name a commit in that pull request, as a full SHA or unique prefix of at least seven characters; it becomes commit 1, with the pull request head in commit 2 and scope `previous-recorded-head-to-head`. Do not combine it with `--first`, transition plans, allow-build plans, or `--record instrument`. If the replay base already runs its own recorder, omit `--record-workflow` so the base's workflow stays in use. On pnpm, TS CI chunk 2/3 is the only recorded leg; changes limited to `pnpm/` or `pnpr/` do not run TypeScript tests.

4. **Run.** Run the reviewed command without `--dry-run`. It pushes the plan's commits and opens the pull request; the fork's own recording workflow records them. Keep the run going, record the pull request URL in your notes, and do not post any comment.
5. **Wait.** The run's return does not mean the record finalized. Inspect the head recording job and run `replay verify <pr-url>`. Every leg must PASS, including declared complete capture, exact repository/run/profile/head identity on the public report, and sensor coverage: a job whose sensor did not start is absent from the record, so a record of 1 job can silently stand for 2. Report a failed gate with its evidence; do not automatically rerun jobs or open replacement PRs. Never edit the check or comment by hand.
6. **Card.** After PASS, run `replay card <pr-url>`. Read every job and row in `out/<slug>/pr-<N>-card.md`, including unchanged workload and background rows. The card preserves the source record; its quoted headline is not independent validation. An added destination under an install step establishes placement, not which dependency caused it. Record the measured command, omitted workloads, reviewer outcome, and attribution limits separately.
7. **Cold read.** Open the fork pull request as a maintainer who has never heard of Garnet. Title, the commit, body, bot comments, the Garnet comment: headline matches the diff, counts match visible rows, no tool or demo residue. Render at desktop and phone width. If the finding is buried, contradicted, or attributed to runner background, report the exhibit as failed.
8. **Cohort (optional).** `replay cohort <slug> --from-observations --limit 20`. Aggregates must equal the row counts; the report says so.
9. **Stage 2 (opt-in only).** `replay stage2 <slug> --dry-run`, then without. After merge on the fork, `replay consume <pr-url>` reports check state and reviewer citations.
10. **Status.** `replay status <slug>`. Report the board and the next command.

## Agent evaluation

To measure whether the record changes an agent's review, use `benchmark/agent-ab/` (README there): record each prepared pair once, freeze `tasks.json` from finalized records only, run the four arms with one model, score with `score.mjs`. Never label a task from the corpus hypothesis.

## Reporting

For a released-version comparison with a controlled workload, use
`live <slug> --prepared <json> --work <checkout> --dry-run`, then the same command
without `--dry-run`. See `docs/prepared.md` for the input. Do not use
`--dependency` for a version-only comparison: that mode changes build-script
permission. Prepared mode publishes the explicit before/after pair and refuses `--no-wait`. After a publication interruption, use the same input
and branch with `--resume`; it checks the two committed states before resuming.

Report with the pair line, the verdict and its first reason, the capture status,
and the pull request URL. Label every statement with its claim class from
`docs/contract.md`. If the run is pending, say pending; if evidence is partial,
say undeterminable. Do not say "unchanged", "clean", or "no issues" over
incomplete evidence.

A head-only record (`previous: null`) never establishes that a destination is
new. Before calling a destination introduced by a change, record the parent on
the same workflow path and compare destination sets, not chain counts: chain
counts vary between recordings of one change while destination sets stay
stable. Runner and CDN shards (blob stores, edge caches, mirrors) churn between
any two runs; name them as background, not as the change.

Use `replay fork owner/repo` when starting a new target and `replay refresh slug`
when its fork is stale. Onboarding is `replay setup <slug>`; replays afterwards
need no `--record` flags. Use `--record instrument --job workflow.yml/job` only
to record inside an existing project CI job, and `--record inject` only when
bundling a recorder into a replay is the explicit experiment.
