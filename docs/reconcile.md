# Reconcile the target ledgers

```sh
export GH_TOKEN="$GARNET_LABS_GITHUB_PAT"
node bin/replay.mjs reconcile --all             # dry-run; GitHub reads only
node bin/replay.mjs reconcile e2b --apply       # local ledger write via saveTarget
node bin/replay.mjs status                     # also writes out/STATUS.md
```

The command reads each fork's default-branch SHA and Stage 2 files, paginates
all PRs and issue comments, and selects open or merged PRs already in the replay
ledger or carrying a replay marker or Runtime Review comment. It calls the
existing `verify` implementation for every selected PR, routing GitHub GETs
through authenticated `gh` and public profile reads through HTTP. It never writes to
GitHub or checks out fork code. `--dry-run` is the default; only `--apply` saves.

Imported rows have no inferred upstream PR or dependency transition. An App
record is not proof that the harness authored the PR. Existing replay metadata,
cards, cohorts, consumption, and operator notes are preserved. Cohort rows are
not synthesized from a list of PRs: use `replay cohort` to generate a real report.

The `reconciliation` observation retains the exact head, compared commit, scope,
receipt fingerprint, PR state, check time and verification reasons. The board's
`live check` summary reports dated shareability independently of recording or
ladder completion. A head-bound finalized receipt can be `recorded` while its
share gate is `FAIL`. Only `verify` returning `PASS` for the observed head makes
that observation shareable. Exceptions and moved heads are undeterminable.
Merged PRs are inspected too; the existing share gate requires an open PR.
Reverify before sharing: a saved observation is not permanent approval.

Stage 2 file presence is installation evidence only. Partial or full integration
files are `in-flight`, with the exact default SHA and missing paths listed;
`REVIEW.md` alone is not integration. The command does not prove that workflows
execute correctly, secrets are configured, branch protection requires the check,
or reviewer value exists, so it does not mark integration `done`.

An inventory error is saved as undeterminable without replacing prior replay or
installation rows. Read that error before relying on older ladder progress.
Closed, unmerged PRs and PRs without a ledger entry, marker or App comment are
outside the candidate set; counts are not a census of all upstream changes.
