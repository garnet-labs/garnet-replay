# Harness audit (2026-10-02)

Shaped by the pnpm proof: what that proof actually needed is the core; the rest is
kept but labelled optional so a new teammate reads three commands, not twenty.
Nothing was deleted: every optional surface below still has a ledger row,
a test, or a batch that depended on it, and removing working, tested code was
not needed to make the core path clear.

## Core path (what a teammate needs)

| step | command | why it exists (learning it keeps) |
|---|---|---|
| 0 | `upstream <owner/repo> --pr N` | Simplest proof when the upstream already records (pnpm). Reports auth-skipped green jobs and merge-ref binding instead of hiding them. |
| 1 | `find` → `setup` → `live --dry-run` → `live` | Fork-only writes, one-commit replays after onboarding, recorder-health stop (`stalled` refuses to write), exact action pin. |
| 2 | `verify <fork-pr-url>` | Fail closed: declared capture + exact head identity, or not shareable. A green job is not evidence. |
| 3 | `card`, `consume` | The card keeps every row; consumption (did a reviewer cite it) is a separate outcome from the human comment. |
| − | `status` | Board and next command; certifies nothing. |

## Optional surfaces (kept, not on the core path)

| surface | keep because |
|---|---|
| `live --prepared`, `--dependency`, `--allow-build`, `--record inject` | Specialized two-commit before/after experiments (prepared pairs, build-script transitions). |
| `cohort`, `harvest`, `uat`, `decide` | Rates and scoring over many fork PRs; used by prospect and Sept batches. |
| `stage2` | Opt-in target-workflow integration (evidence mirror, `garnet/evidence` check). |
| `fork`, `refresh`, `repin` | Fork lifecycle; `repin` moved forks to v2.3.0. |
| `known`, `pair`, `serve`, `seed-*` | Viewer and seed corpus. |
| `benchmark/` | Agent A/B; single-pass, not a product claim. |

## Robustness fixes in this pass

- Ledger: file lock around read-merge-rename (lost-row race, pnpm#70/#71).
- Upstream reads: runs matched by the PR's own commit SHAs (merged PRs lose the
  run→PR link), and a job whose Garnet step was skipped is not counted.
