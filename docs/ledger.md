# Garnet Replay ship ledger

One row per requirement. A row is done only when its artifact exists and was
checked live; "implemented" is not done.

## September 24 batch checkpoint

Action v2.3.0 (`245ad6be`) through harness `821b1e0`: five fork PRs, five
recorded jobs on the exact pin, App-owned comments only, **zero strict
evidence passes** — the same undeclared-capture and merge-ref identity legs
as September 11 still fail under contract 6.10.0. Rows, wedge verdicts and the
Dependabot simulation are in [docs/batch-2026-09-24.md](batch-2026-09-24.md).

## September 11 batch checkpoint

The earlier table below is historical. The current evidence and remaining
obligations are in [the five-prospect batch report](prospect-batch.md):
five new two-commit fork PRs, ten successful recording jobs, five independent
cold reads, **zero strict evidence passes**. Undeclared capture and merge-ref
public identities invalidate the original acceptance results.

Harness corrections require complete capture and exact public identity,
retain recorded rows in cards, account for setup files, and check Dependabot
policy at the selected replay base. Recurring publication is inactive.
Consumer citations, Dependabot token delivery, and the pnpm candidate's
faithful workload remain open; see the report for ownership and next actions.

## Lock decisions (2026-09-09)

| Decision | State |
|---|---|
| `garnet-labs/garnet-replay` is the one harness; it absorbs the GTM harness (testbed PR 134: observe, two-commit replay, guards, card, cohort, ledger) and the pnpm fork-lane semantics (cells, variance, fail-closed verdict, verifier legs) | done in this repository |
| `rrkit` retires as an engine; its priors (local card shape, egress-masking caveat) stay in this ledger only | done |
| PostHog and pnpm forks are test targets, not harness repositories | done; `targets/posthog.json` |
| Stage 1 default is a real upstream pull request replayed on the existing fork; constructed transitions are the fallback | done; `replay live --pr`, `replay live --dependency` |
| Stage 2 (target workflow, evidence mirror, gate, reviewer consumption) ships opt-in | done; `replay stage2`, `replay consume` |
| Repository visibility, external publishing, Umar's posture call | Farrukh's decisions; unchanged, nothing published |

## Requirements

| # | Requirement | Artifact | State |
|---|---|---|---|
| 1 | Capture completeness as a field and a gate | `capture` block, `assessCapture`, schema, tests | done |
| 2 | Comparison pair everywhere, rebase supersession | `pair`, `supersession`, pair line in comments and cards, `verify` pair leg | done |
| 3 | Exhibit verifier before anything is shared | `replay verify`: comment, head-bound, finalized, determinable, pair, permalink, check, residue, label, open | done; PASS not yet seen on a live exhibit |
| 4 | Repin to the stable action tag | templates and `GARNET_ACTION_PIN` at `245ad6be` (v2.3.0); `replay repin` moves existing forks | done |
| 5 | Vocabulary: "new behavior" on rendered surfaces, banned-word gate | `contract/vocab.json`, `assertVocabClean`, `verdictPhrase` | done |
| 6 | Claim class on every statement | `claims`, `CLAIM_CLASSES`, card and comment render them | done |
| 7 | Specimen finder over real pull requests and history | `replay find`, `lib/observe.mjs`, `lib/find.mjs` | done |
| 8 | Real-PR replay: two commits, exact head, fork-only, no leaks | `lib/replay-pr.mjs`, `lib/guards.mjs` | done; dry-run on PostHog, no live run yet |
| 9 | Constructed pnpm transition: bump, then allow build scripts | `lib/replay-transition.mjs` | done; dry-run on PostHog `puppeteer 24.40.0 → 25.9.0`; a live bump is blocked there by `trustPolicy: no-downgrade` on `semver@6.3.1` (reproduced on upstream master too) |
| 9b | Constructed pnpm transition without a lockfile change: skip recorded, then build script allowed | `planAllowBuild`, `replay live --allow-build` | done; dry-run on PostHog `puppeteer 19.0.0, 24.40.0`; lockfile-diff guard |
| 10 | Ecosystems npm, pnpm, Yarn, Cargo, Ruby, uv, Go; honest unsupported fallback | `INSTALL_COMMANDS`, `detectEcosystem` | done |
| 11 | Evidence card, fail-closed on pending, stale, unbound | `replay card` | done |
| 12 | Cohort rates with count reconciliation | `replay cohort` | done |
| 13 | Status ladder 0–6, stage done only from its own artifact | `replay status` | done |
| 14 | Stage 2 mirror, gate, REVIEW.md, no fork code in privileged path | `live/templates/stage2/`, `replay stage2` | done; not merged on any fork |
| 15 | Reviewer/agent consumption evidence | `replay consume`, `replay harvest` | done; pnpm harvest 2026-09-22: 9 of 38 recorded pull requests consumed head-bound, 38 with receipts |
| 16 | Docs for team and agents | `README.md`, `AGENTS.md`, `SKILL.md`, `docs/` | done |
| 17 | Tests | `npm test`: 57 | done |
| 18 | Live proof on `garnet-labs/posthog` with cold read | `docs/examples.md` | in flight |

## Priors carried, not code

- `rrkit` (2026-08-27): local strace engine, output is a local card, sandbox
  proxy masks egress. Retired; the card shape informed `lib/card.mjs`.
- pnpm fork lane (`garnet-labs/pnpm` 31, 41, 43, 45, 49): cells, repetitions,
  variance fail-closed, verifier legs L2/L4/L5, placeholder read as record.
- GTM harness (testbed 134): `posthog` fork PR 191 read as a routine dependabot
  pull request by a third-party reviewer; that is the bar for wording.
- agent-install-kit: evidence mirror, consumer verdict table, `REVIEW.md`.
- Hero `garnet-runtime-review-reference` 31: `+4 −0` workload destinations,
  `immediate-parent-to-head`, `garnet/runtime-evidence` last seen pending.

## Known limits

- The recording template is pinned to a main-branch commit of
  `garnet-org/action`, not a release.
- Pull requests from other repositories receive neither secrets nor OIDC; a
  fork-origin run is a local record and reads as not recorded.
- Transitions are pnpm only. `--allow-build` needs a dependency already in the
  lockfile and not yet on either build-script list.
- `replay find` uses the GitHub search and list APIs; broad scans time out, so
  use `--author`, `--search`, `--limit`.
- The benchmark (`benchmark/`) is a single Devin-reviewer pass over 25 seeds.
