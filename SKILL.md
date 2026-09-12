---
name: garnet-replay
description: Produce, verify, and report a Garnet runtime-evidence exhibit on a garnet-labs fork with the replay command line. Use when asked to replay a pull request, find a candidate, build an evidence card, run a cohort, or wire Stage 2 on a target repository.
---

# Garnet Replay skill

Preconditions: Node 20+, `gh auth status` succeeds, `export GH_TOKEN=$(gh auth token)`,
a local checkout of the fork (`--work`). Read `AGENTS.md` for the rules.

## Procedure

1. **Target.** `targets/<slug>.json` exists or `replay find … --slug <slug> --fork garnet-labs/<name>` creates it. Confirm the fork exists and belongs to `garnet-labs`; never create a new fork without an explicit decision.
2. **Candidate.** `replay find <owner/repo> --slug <slug> --fork <fork> --author 'app/dependabot' --limit 40`. Read the reasons, not only the total. Name a review question the measured command can answer; install scripts and native binaries are useful leads. A major version bump alone is insufficient, and installation cannot answer application compatibility. Skip merge-queue batches and anything that cannot install on Linux CI. State that this is candidate evidence.
3. **Plan.** `replay live <slug> --pr <N> --work <checkout> --dry-run`, or for a pnpm transition `replay live <slug> --dependency <dep> --to <v> --package-dir <dir> --work <checkout> --dry-run`, or when the lockfile cannot change `replay live <slug> --allow-build <dep> --work <checkout> --dry-run`. Read the plan: two commits, fork as `origin`, exact head SHA, routine wording. Stop if the plan shows an unsupported ecosystem or a missing recording workflow, and report that. The checkout must be clean; the run refuses uncommitted changes rather than discarding them. If the run warns that the fork default branch is behind the change's base, rerun with `--sync-fork` (fast-forward only), or with `--base-branch <name>` to open against a fork-only branch set to the base when the default branch must stay put; a fork with several recording workflows also needs `--record-workflow <path>`. When the plan says commit 1 adds the recording workflow, it also says whether `.github/dependabot.yml` is added; leave both in, they are what makes the fork's own Dependabot pull requests recorded afterwards. If the plan stops because commit 2 touches none of the recording workflow's trigger paths, pick another change (`targets/<slug>.json` keeps each candidate's paths) rather than forcing it; that pull request would record nothing. A workflow listed as `not counted as a recorder` runs only on labelled pull requests; pass `--label <name>` to count it. Read the `recorder health` line: on `stalled` or `none` the run stops before writing, because the fork's recent pull requests show Runtime Review comments that never finalized; fix or wait for the recorder rather than passing `--allow-pending-recorder`, which opens a pull request that `verify` will fail until the comment finalizes.
4. **Run.** Same command without `--dry-run`. It pushes commit 1, opens the pull request, waits for commit 1's record (up to 45 min; `--wait-minutes N`), then pushes commit 2. Keep it running. If it stops because commit 1 is unrecorded or its check failed, report that; do not pass `--no-wait` to force commit 2 without a comparison. Record the pull request URL in your notes. Do not post any comment.
5. **Wait.** `live` waits for commit 1; its return after publishing commit 2 does not mean that record finalized. Inspect the head recording job and run `replay verify <pr-url>`. Every leg must PASS, including declared complete capture and exact repository/run/profile/head identity on the public report. Report a failed gate with its evidence; do not automatically rerun jobs or open replacement PRs. Never edit the check or comment by hand.
6. **Card.** After PASS, run `replay card <pr-url>`. Read every job and row in `out/<slug>/pr-<N>-card.md`, including unchanged workload and background rows. The card preserves the source record; its quoted headline is not independent validation. An added destination under an install step establishes placement, not which dependency caused it. Record the measured command, omitted workloads, reviewer outcome, and attribution limits separately.
7. **Cold read.** Open the fork pull request as a maintainer who has never heard of Garnet. Title, both commits, body, bot comments, the Garnet comment: headline matches the diff, counts match visible rows, pair header names commit 1 and commit 2, no tool or demo residue. Render at desktop and phone width. If the finding is buried, contradicted, or attributed to runner background, report the exhibit as failed.
8. **Cohort (optional).** `replay cohort <slug> --from-observations --limit 20`. Aggregates must equal the row counts; the report says so.
9. **Stage 2 (opt-in only).** `replay stage2 <slug> --dry-run`, then without. After merge on the fork, `replay consume <pr-url>` reports check state and reviewer citations.
10. **Status.** `replay status <slug>`. Report the board and the next command.

## Reporting

For a released-version comparison with a controlled workload, use
`live <slug> --prepared <json> --work <checkout> --dry-run`, then the same command
without `--dry-run`. See `docs/prepared.md` for the input. Do not use
`--dependency` for a version-only comparison: that mode changes build-script
permission. Prepared mode retains the recording workflow across both commits
and refuses `--no-wait`. After a publication interruption, use the same input
and branch with `--resume`; it checks the two committed states before resuming.

Report with the pair line, the verdict and its first reason, the capture status,
and the pull request URL. Label every statement with its claim class from
`docs/contract.md`. If the run is pending, say pending; if evidence is partial,
say undeterminable. Do not say "unchanged", "clean", or "no issues" over
incomplete evidence.

Use `replay fork owner/repo` when starting a new target and `replay refresh slug`
when its fork is stale. Use `--record instrument --job workflow.yml/job` to
record inside an existing project CI job; use injected recording when a separate
workflow is safer or the project has no suitable pull-request job.
