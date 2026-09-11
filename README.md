# Garnet Replay

Static reviewers read the diff. Garnet Replay shows what the change ran.

One command line takes a real repository from "is there a review gap here?" to a
fork pull request whose Garnet comment shows the new behavior, an evidence card a
reviewer reads in thirty seconds, and the rates over a cohort. Every artifact is
bound to an exact head commit, names its comparison pair, and fails closed when the
record is missing, partial, or stale.

Requirements: Node 20+, `gh` logged in (`gh auth status`), Linux for live runs.
No dependencies to install.

```sh
git clone https://github.com/garnet-labs/garnet-replay && cd garnet-replay
npm test                      # offline regression suite
node bin/replay.mjs --help
```

## The ladder

Each stage answers one question and leaves one artifact in the target ledger
(`targets/<slug>.json`). A stage is done only when its own artifact exists.

| # | Stage | Command | Exit question |
|---|---|---|---|
| 0 | find | `replay find <owner/repo>` | Is there a review gap worth recording on a real change? |
| 1 | replay | `replay live <slug> …` | Does the record show new behavior on the fork? |
| 2 | card | `replay card <fork-pr-url>` | Would this have helped the review? |
| 3 | cohort | `replay cohort <slug> …` | What are the rates over 10–50 pull requests? |
| 4 | pilot | `replay consume <fork-pr-url>` | Did a reviewer or agent cite the head-bound record? |
| 5 | integration | `replay stage2 <slug>` | Does approve/escalate behavior change with the record present? |
| 6 | production | ledger-tracked | Do base→head records and policy run without an operator? |

`replay verify <pr-url>` is the evidence gate at any stage. It requires declared
complete capture and an anonymous public report naming the exact repository,
run, profile, and PR head. A final comment or HTTP 200 alone is insufficient.
After the gate accepts the evidence, an independent cold read establishes whether the result helps a
reviewer. `replay status` shows local artifacts and the next command; it does
not certify either gate.

## Runbook

```sh
export GH_TOKEN=$(gh auth token)
R="node bin/replay.mjs"

# 0. rank real pull requests on the upstream; candidate evidence only
$R find PostHog/posthog --slug posthog --fork garnet-labs/posthog --author 'app/dependabot' --limit 40

# 1a. replay a real upstream pull request onto the fork (default)
$R live posthog --pr 56732 --work ~/repos/posthog --dry-run     # read the plan first
$R live posthog --pr 56732 --work ~/repos/posthog

# 1b. or author a transition on the fork when no real pull request carries it (pnpm)
$R live posthog --dependency puppeteer --to 25.9.0 --package-dir nodejs --work ~/repos/posthog
$R live posthog --allow-build puppeteer --work ~/repos/posthog   # lockfile untouched: skip recorded, then allowed

# wait for the fork's workflow, then:
$R verify https://github.com/garnet-labs/posthog/pull/<N>       # share gate; run before anyone sees it
$R card   https://github.com/garnet-labs/posthog/pull/<N>       # out/posthog/pr-<N>-card.md
$R cohort posthog --from-observations --limit 20                # out/posthog/cohort-<k>.md
$R consume https://github.com/garnet-labs/posthog/pull/<N>      # reviewer/agent citation, check state
$R stage2 posthog --dry-run                                     # evidence mirror + garnet/evidence gate
$R status posthog
```

Every replay is two commits on the fork, in routine wording:

- commit 1 sets up the state the change is judged against (manifest and lockfile as
  the change found them, or the bump with install scripts still blocked);
- commit 2 is the change the pull request is about (the upstream diff, or the
  allowlist decision that lets the new install script run).

The Garnet comment on commit 2 compares it with commit 1, so "what changed" in the
record mirrors what the pull request itself changed. To make that comparison
exist, `live` pushes commit 1 alone, opens the pull request, waits until commit 1
is recorded (45 min by default, `--wait-minutes N`), and only then pushes commit 2.
The harness never posts comments; the fork's own recording workflow does.

A fork that has no recording workflow gets one in commit 1. It runs on every pull
request of the fork, Dependabot's included, and needs no secret (OIDC). A fork
without `.github/dependabot.yml` gets a weekly one in the same commit, so the
fork's own dependency pull requests are recorded from then on.

## Rules the code enforces

- Writes go to the fork only. The upstream is a read-only remote with push disabled.
- No upstream URL, `owner/repo#N`, or bare `#N` in branch names, commits, titles,
  bodies, or rendered artifacts. No session or tool residue either.
- Exactly two new commits, both non-empty, counted with `git rev-list --count`.
- The exact upstream head is fetched by `refs/pull/N/head` and checked with
  `git cat-file`; a nearby commit is never substituted.
- One draft pull request per branch; an existing one is reused, never duplicated.
- Every artifact names its pair: head SHA, compared SHA, version transition, and
  scope (`pr-base-to-head`, `immediate-parent-to-head`, `previous-recorded-head-to-head`).
- Missing, partial, stale, unbound, or varying evidence is `undeterminable`. It is
  never rendered as "unchanged".
- Finder output is candidate evidence. Only a recorded run says what ran.

## Evidence contract

Every replay JSON carries `capture` (expected and recorded cells, executed SHA
verification, lineage gaps, final-record flag), `verdict` with reasons
(`new-behavior | unchanged | recorded | undeterminable`), `pair` (base, head, scope,
label, one printable line), `supersession` (head/base movement since the record),
and `claims`, each tagged `observed-runtime-behavior`, `comparison-result`,
`required-check-state`, `reviewer-consumption-evidence`, or `unsupported-claim`.
See [docs/contract.md](docs/contract.md).

## Supported ecosystems

Three layers, and only one of them is tied to a package manager:

| Layer | Scope | Where |
|---|---|---|
| Harness (`find`, `live --pr`, `card`, `verify`, `consume`, `status`, guards, evidence contract) | any language; reads commits, comments, and check runs | `lib/` |
| Injected recording workflow | npm, pnpm, Yarn, Cargo, Ruby (Bundler), uv, Go; one install command each | `INSTALL_COMMANDS` in `lib/replay-pr.mjs`, `live/templates/garnet-record.yml` |
| Constructed transitions (`--dependency … --to …`, `--allow-build …`) | pnpm only | `lib/replay-transition.mjs` |

The transitions are pnpm only because they encode pnpm 10's build-script trust
decision (`ignoredBuiltDependencies` → `onlyBuiltDependencies`), which is what
makes the two commits two real states; other package managers have no equivalent
switch. `--allow-build` works on a dependency already in the lockfile and leaves
the lockfile as it is, so it also fits repositories whose trust policy or
release-age rule blocks a bump. When a fork already has its own recording
workflow, `live` uses it and records whatever that workflow runs; that workflow
belongs to the target, not to the harness. Anything outside the table is reported
as unsupported and the run stops before writing. See [docs/stage1.md](docs/stage1.md).

## Stage 2: the target's own workflow

`replay stage2 <slug>` opens one pull request on the fork with an evidence mirror
(`workflow_run`, resident on the default branch, never runs pull request code),
an acceptance gate `garnet/evidence` that requires a record bound to the exact head,
and `REVIEW.md` grounding instructions for reviewers and review agents.
`replay consume` then reports whether anyone cited the head-bound record.
See [docs/stage2.md](docs/stage2.md).

## Layout

```
bin/replay.mjs            command line
lib/commands.mjs          ladder commands: find, live, card, cohort, verify, consume, status, stage2
lib/observe.mjs           gap scoring for real pull requests (every point prints its reason)
lib/find.mjs              history-based transition finder
lib/replay-pr.mjs         real-PR replay planner and executor
lib/replay-transition.mjs pnpm transition planner (bump, then allow build scripts)
lib/evidence.mjs          capture, verdict, pair, supersession, claims
lib/guards.mjs            fork-only, no-leak, vocabulary, residue, two-commit guards
lib/card.mjs · cohort.mjs · status.mjs · consume.mjs · verify.mjs · stage2.mjs
live/templates/           recording workflow and Stage 2 workflows
contract/vocab.json       banned vocabulary and residue terms (vendored from the testbed)
schema/                   execution-diff JSON schema
targets/                  one ledger per upstream repository
out/<slug>/               cards, cohort reports, bodies (generated, not committed)
```

Older surfaces stay: `known <pr-url>` turns an App comment into replay JSON,
`pair` builds a diff from two profiles, `serve` hosts the result pages,
`seed-from-corpus` and `seed-constructed` maintain `seeds/`.

## Docs

- [docs/stage1.md](docs/stage1.md) — replay guide: choosing a candidate, both `live` modes, guards, waiting for the record
- [docs/stage2.md](docs/stage2.md) — target workflow integration and consumption evidence
- [docs/contract.md](docs/contract.md) — evidence fields and their semantics
- [docs/examples.md](docs/examples.md) — worked examples with real output
- [docs/ledger.md](docs/ledger.md) — ship ledger: what is done, what is not
- [docs/agent-interface.md](docs/agent-interface.md) — what agents driving the CLI can rely on, and the gap list to an agent-grade tool
- [docs/prospect-batch.md](docs/prospect-batch.md) — five-fork validation, exact evidence, limitations, and remaining work
- [.devin/skills/prospect-replays/SKILL.md](.devin/skills/prospect-replays/SKILL.md) — bounded batch orchestration
- [AGENTS.md](AGENTS.md) and [SKILL.md](SKILL.md) — how coding agents run this

## Status

The recording workflow template pins `garnet-org/action` to commit
`e546567a72e4fede11ec39d6e9f75b539adef22c` (main, 2026-09-04). No stable tag
covers it yet; repin when one does. Pull requests from other repositories receive
neither secrets nor OIDC tokens, so a fork-origin run degrades to a local,
best-effort record; the harness reports that as not recorded, not as unchanged.
Repository visibility and external publishing are decisions outside this code.
