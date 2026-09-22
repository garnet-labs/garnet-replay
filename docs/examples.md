# Worked examples

## Current verification gate

The [five-prospect report](prospect-batch.md) supersedes older PASS examples as
evidence of the current gate. At 2026-09-11 18:00 UTC the new verifier reported:

```text
verify https://github.com/garnet-labs/OpenHands/pull/10 · FAIL
capture completeness: capture not declared; comparison undeterminable
public profile identity:
  repository garnet-labs/OpenHands
  run 34629397391 / profile 01a09193-d3d4-707f-823a-d137810394b9
  recorded f96d95f3028a76ff06ffd1e3e13fa6d0881aac84 (refs/pull/10/merge)
  expected cc0afe66eae24f448b0a3215354cd18eefcc7562
```

Both recording jobs succeeded. This output evaluates the evidence identity and
completeness, separately from workload success. A card preserves quoted job
sections for diagnosis but remains undeterminable until verification succeeds.
Historical results below describe the verifier used at their observation time.

Real output from the commands in this repository, unedited except for the shell
prompt. Captured 2026-09-10. Each example names the fork pull request it came
from so the output can be checked against the live state.

## 1. Plan a replay of a real upstream change (dry run)

The target is `garnet-labs/uv`, the change is upstream pull request 21570 (a
retry-on-Range-header change touching two manifests, three Rust files, and a test).
The fork's `main` has no recording workflow and no Dependabot configuration, so the
plan adds both in commit 1. The plan also compares the six touched paths on the
fork's `main` with the change's base before deciding what else commit 1 stages.

```sh
export GH_TOKEN=$(gh auth token)
node bin/replay.mjs live uv --pr 21570 --work ~/uv-fork --dry-run
```

```text
garnet-labs/uv@main has no .github/dependabot.yml; commit 1 adds one so the fork's own dependency pull requests get recorded
replay plan · uv · upstream change 21570 (number stays local)
fork (only write target): garnet-labs/uv
branch: chore/update-gn6 · base: main · scope: pr-base-to-head
compares: 0ebbd92 → 5dfaef5
record: recording workflow added in commit 1 (cargo); Dependabot pull requests on the fork run it too
dependabot: .github/dependabot.yml added in commit 1 (cargo, weekly)
paths (6): Cargo.lock, Cargo.toml, crates/uv-distribution/Cargo.toml, crates/uv-distribution/src/distribution_database.rs, crates/uv-distribution/src/error.rs, crates/uv/tests/it/network.rs
commit 1 stages: only what the plan adds (the touched paths on main match the change's base)

commands
  git -C /home/ubuntu/uv-fork fetch --prune origin   # reuse the fork checkout
  git -C /home/ubuntu/uv-fork remote add upstream https://github.com/astral-sh/uv.git   # add a read-only upstream remote
  git -C /home/ubuntu/uv-fork remote set-url --push upstream DISABLED-no-push   # disable pushing to upstream
  git -C /home/ubuntu/uv-fork fetch --no-tags upstream 0ebbd9274a55a8a53a13970be3b97e4209598e17 refs/pull/21570/head   # fetch the upstream base commit and the pull request head ref
  git -C /home/ubuntu/uv-fork cat-file -e 5dfaef57107facd8a1d6ef84616b5ef3d4f11ced^{commit}   # guard: the recorded head sha must be the fetched pull request head
  git -C /home/ubuntu/uv-fork remote get-url origin   # guard: origin must be the fork
  git -C /home/ubuntu/uv-fork status --porcelain --untracked-files=no   # guard: the checkout must have no uncommitted changes
  git -C /home/ubuntu/uv-fork rev-list --count 0ebbd9274a55a8a53a13970be3b97e4209598e17 ^origin/main   # guard: how far main on the fork is behind the change's base
  git -C /home/ubuntu/uv-fork checkout -B chore/update-gn6 origin/main   # create chore/update-gn6 from main
  git -C /home/ubuntu/uv-fork rm -q --ignore-unmatch -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: drop paths the change removes or renames
  git -C /home/ubuntu/uv-fork checkout 0ebbd9274a55a8a53a13970be3b97e4209598e17 -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: touched paths as the change found them
  write /home/ubuntu/uv-fork/.github/workflows/garnet-record.yml   # commit 1: add the recording workflow; Dependabot pull requests on the fork run it too
  git -C /home/ubuntu/uv-fork add -- .github/workflows/garnet-record.yml
  write /home/ubuntu/uv-fork/.github/dependabot.yml   # commit 1: add .github/dependabot.yml so the fork gets its own dependency pull requests, each recorded
  git -C /home/ubuntu/uv-fork add -- .github/dependabot.yml
  git -C /home/ubuntu/uv-fork add -A -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: stage the paths present after the reset
  git -C /home/ubuntu/uv-fork diff --cached --name-only   # guard: commit 1 must change something
  git -C /home/ubuntu/uv-fork commit -q -m <message below>   # commit 1
  git -C /home/ubuntu/uv-fork checkout 5dfaef57107facd8a1d6ef84616b5ef3d4f11ced -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 2: the change itself
  git -C /home/ubuntu/uv-fork add -A -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 2: stage the paths present at the head
  git -C /home/ubuntu/uv-fork diff --cached --name-only   # guard: commit 2 must change something
  git -C /home/ubuntu/uv-fork commit -q -m <message below>   # commit 2
  git -C /home/ubuntu/uv-fork rev-list --count origin/main..HEAD   # guard: exactly two new commits
  git -C /home/ubuntu/uv-fork rev-parse HEAD~1
  git -C /home/ubuntu/uv-fork rev-parse HEAD
  gh pr list --repo garnet-labs/uv --head chore/update-gn6 --state all --json number,state,isDraft,url   # reuse an existing fork pull request on this branch
  if a pull request exists: compare origin/chore/update-gn6 with HEAD~1 and HEAD by tree, then by patch   # match the fork branch against commit 1 and commit 2 by tree, then by patch; a closed pull request's branch is not reused
  git -C /home/ubuntu/uv-fork push --set-upstream origin HEAD~1:refs/heads/chore/update-gn6   # push commit 1 alone to chore/update-gn6 on the fork
  write /home/ubuntu/repos/garnet-replay/out/uv/replay-21570-body.md   # write the pull request body
  gh pr create --repo garnet-labs/uv --draft --base main --head chore/update-gn6 --title "Retry failed partial downloads with HTTP Range header when supported" --body-file /home/ubuntu/repos/garnet-replay/out/uv/replay-21570-body.md   # open a draft pull request on the fork (base main)
  wait for the record of commit 1 on garnet-labs/uv   # wait until commit 1 is recorded; the comparison on commit 2 needs it
  git -C /home/ubuntu/uv-fork push origin HEAD:refs/heads/chore/update-gn6   # push commit 2 to chore/update-gn6 on the fork

commit 1
  ci: record dependency installs on pull requests

  - .github/workflows/garnet-record.yml
  - .github/dependabot.yml

commit 2
  Retry failed partial downloads with HTTP Range header when supported

  - Cargo.lock
  - Cargo.toml
  - crates/uv-distribution/Cargo.toml
  - crates/uv-distribution/src/distribution_database.rs
  - crates/uv-distribution/src/error.rs
  - crates/uv/tests/it/network.rs

pull request (draft)
  title: Retry failed partial downloads with HTTP Range header when supported
  Two commits: the first prepares the branch, the second is the change itself.

  6 files:

  - Cargo.lock
  - Cargo.toml
  - crates/uv-distribution/Cargo.toml
  - crates/uv-distribution/src/distribution_database.rs
  - crates/uv-distribution/src/error.rs
  - crates/uv/tests/it/network.rs

dry run: nothing was executed.

note: garnet-labs/uv@main has no pull_request workflow running garnet-org/action; one is added in commit 1
```

How to read it:

- `commit 1 stages:` is decided before the checkout. The plan compares each
  touched path's blob on the fork's `main` with the same path at the change's
  base. Here they all match, so commit 1 stages only the two `.github/` files and
  its message names them. When at least one path differs, commit 1 stages the
  touched paths as the change found them and the subject reads
  `chore: sync touched files before update` (or `sync dependency manifests` when
  every touched path is a manifest or lockfile). When the comparison cannot be
  made (more than 40 paths, or an API error), the line says so and both messages
  are shown; the executed message then follows `git diff --cached --name-only`.
- When everything matches and nothing else would go into commit 1 (no recording
  workflow to add, no Dependabot file, no `--first` path), the plan refuses
  instead of producing an empty commit and says to pass `--first <path>`.
- Nothing names the upstream repository, its pull request number, or Garnet in the
  branch, commits, title, or body.

## 2. The share gate on a recorded fork pull request

The same change ran earlier as `garnet-labs/uv` pull request 4 (branch
`chore/range-retry`, head `2ef2522`, commit 1 `976ae59` carrying only the
recording workflow).

```sh
node bin/replay.mjs verify https://github.com/garnet-labs/uv/pull/4; echo "exit $?"
```

```text
PASS https://github.com/garnet-labs/uv/pull/4 (head 2ef2522)
  [ok] comment present: 1 Garnet comment
  [ok] head-bound: record bound to 2ef2522
  [ok] comment finalized: record is final; its contract does not declare capture completeness
  [ok] verdict determinable: App summary present
  [ok] pair line: pair 976ae59 (previous) → 2ef2522 (this commit) from the record summary
  [ok] public permalink: GET https://app.garnet.ai/public/runs/34534049128?profile=01a08d4e-d651-741b-9c0a-3666ff4ee271&amp;utm_source=github&amp;utm_medium=pr_comment → 200
  [ok] check settled: Dependency install (recorded) completed
  [ok] no session residue: PR body and other comments carry no harness or session traces
  [ok] label: label real
  [ok] pull request open: state open
exit 0
```

## 3. The evidence card for the same pull request

```sh
node bin/replay.mjs card https://github.com/garnet-labs/uv/pull/4   # writes out/uv/pr-4-card.md
```

````markdown
<!-- garnet:card slug=uv pr=4 state=unchanged -->
### What ran, and what changed · pull request 4

> *1&nbsp;job unchanged · compared with [`976ae59`](https://github.com/garnet-labs/uv/commit/976ae594edcb68fb2d46d0ce096befa2c41d2973)*

Result: **no new behavior recorded** · comparison-result

**Comparison pair**

- head: `2ef2522` · `2ef25221633f68fd67add73e757b73e0d9533e14`
- record bound to: `2ef2522`
- compared with: `976ae59` · `976ae594edcb68fb2d46d0ce096befa2c41d2973`
- version transition: not derivable from the record
- scope: pull request base → head

**Execution chains** · quoted from the record · observed-runtime-behavior

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ sudo
+ │  │  └─ provjobd
+ │  │     └─ ○ hosted-compute-watchdog-prod-iad-01[.]githubapp (github infra)
```

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ ○ 140.82.114.24
```

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ ○ glb-2a3c35-public-internal.githubapp[.]com (140.82.113.23) (github infra)
```

**Would this have helped the review?**

[View this run in Garnet →](https://app.garnet.ai/public/runs/34534049128?profile=01a08d4e-d651-741b-9c0a-3666ff4ee271&utm_source=github&utm_medium=pr_comment)
````

How to read it: the record is final and head-bound, so the card is shareable, and
its verdict is `unchanged`. The only movement is in the runner background
(GitHub's own hosted-compute processes), which the record separates from the
workload. The workload itself reads the same on both commits. This is a
cohort row, not a showcase: it says the change added no install-time behavior.

## 4. A pull request the gate refuses

`garnet-labs/posthog` pull request 198 has both commits (`9cba733`, `acd3f38`),
but its Garnet comment is still the pending placeholder.

```sh
node bin/replay.mjs verify https://github.com/garnet-labs/posthog/pull/198; echo "exit $?"
```

```text
FAIL https://github.com/garnet-labs/posthog/pull/198 (head acd3f38)
  [ok] comment present: 1 Garnet comment
  [ok] head-bound: record bound to acd3f38
  [no] comment finalized: placeholder text present: "<!-- garnet-control-plane-pending-pr-comment:"
  [no] verdict determinable: no machine summary on the record
  [no] pair line: no pair line on the comment
  [no] public permalink: no public profile link on the comment
  [no] check settled: no Garnet check on the head commit
  [ok] no session residue: PR body and other comments carry no harness or session traces
  [no] label: the record carries no real/constructed label
  [ok] pull request open: state open
not shareable until every leg reads ok
exit 1
```

A pending placeholder is not a record. `card` on this pull request renders
`undeterminable`, and `verify` exits 1 so a script or agent stops here.

## 5. A plan that stops before the write because the fork's recorder is stalled

`garnet-labs/pnpm` has four `pull_request` workflows that run `garnet-org/action`.
One of them runs only on labelled pull requests, and the fork's two newest
recorded pull requests still carry the pending placeholder. Real output, dry run:

```sh
node bin/replay.mjs live pnpm --pr 14819 --work /home/ubuntu/pnpm-fork --dry-run
```

```text
not counted as a recorder: .github/workflows/garnet-jibril-release-gate.yml runs only on pull requests labelled garnet-release-testing
recorder health: stalled · last finalized record on pull request 50 (2026-09-09); pending placeholder on 52 (since 2026-09-10), 51 (since 2026-09-10) · 8 recent pull requests read
replay plan · pnpm · upstream change 14819 (number stays local)
fork (only write target): garnet-labs/pnpm
branch: chore/update-bfn · base: main · scope: pr-base-to-head
compares: cfd4a73 → 14a66d6
record: fork's own recording workflow (every pull request)
paths (8): .changeset/accept-pnpm12-task-settings.md, .github/actions/pipeline-cache/action.yml, .github/workflows/ci.yml, .github/workflows/pacquet-ci.yml, pnpm-workspace.yaml, pnpm11/config/reader/src/getOptionsFromRootManifest.ts, pnpm11/config/reader/test/getOptionsFromRootManifest.test.ts, pnpm11/core/types/src/package.ts
commit 1 stages: the touched paths as the change found them (main on the fork differs on at least one)
…
dry run: nothing was executed.

note: without --allow-pending-recorder, the run stops here: the fork's recorder is stalled
```

Without `--dry-run` the same command stops with exit 1 before any write. The
plan itself is sound; the fork's recorder is not finalizing comments, so a pull
request opened now would wait for a record that is not arriving.

## 6. Local replay workspace

```sh
node bin/replay.mjs serve --port 8787
```

The URL-first entry accepts
`https://github.com/garnet-labs/garnet-runtime-review-reference/pull/31`
and opens `/garnet-labs/garnet-runtime-review-reference/pull/31`. Reloading
that route keeps the same comparison. The landing page renders the running
host as a URL replacement:

```diff
- github.com/garnet-labs/garnet-runtime-review-reference/pull/31
+ localhost:8787/garnet-labs/garnet-runtime-review-reference/pull/31
```

Use `http://` for the local server. The focused result labels this saved
artifact **Historical record · current GitHub head not checked** and keeps
the comparison's scope, base and head beside its observations.

The upstream route `/astral-sh/uv/pull/21570` resolves its ledger-mapped fork
[PR #4](https://github.com/garnet-labs/uv/pull/4). Its focused finding reads:

```text
Recorded observations · workload: +0 / −0 · runner background: +3 / −1
Scope: recorded jobs only. The receipt does not declare capture completeness.
```

Browser verification on 2026-09-11 covered direct PR navigation, history,
canonical dry-run preparation with recording disabled, and an isolated synthetic
recording/verification lifecycle. GitHub-rendered documentation and the
interface were read at desktop and 390px. No real replay was executed.

The workspace was cold-read in Chrome at desktop and 390px widths on
2026-09-11. With the checked-in artifact
`public/replays/github/garnet-labs/garnet-runtime-review-reference/31.json`,
its comparison showed:

```text
Dependency replay: chart-helpers #31
saved evidence · real pair · capture complete
base 8703692 → head b639b38 · immediate-parent-to-head

Workload
  Outbound connections: removed −0 | added +4
    api.ipify.org
    httpbin.org
    ip-api.com
    registry.npmjs.org
  Process observations: removed −0 | added +2
  File observations: not recorded

Runner background
  Outbound connections: removed −2 | added +2
  Process observations: removed −1 | added +0
  File observations: not recorded
```

The saved artifact supplies the label and verdict. This local rendering does not
establish a current share-gate result. Every observation and its available
ancestry is accessible in the viewer; the original artifact remains in Raw JSON.
See [workspace.md](workspace.md) for the planner and HTTP interface.

## Preserving the selected base's Dependabot policy

Read-only CLI probe on 2026-09-11, after the five-prospect corrections:

```sh
node bin/replay.mjs live openai-node --pr 2684 \
  --base-branch rb/2684 --record inject --ecosystem pnpm --dry-run
```

The selected source base already has a Dependabot config. The plan preserves
it and lists the additional recorder separately from the upstream change:

```text
commit 1
  ci: record dependency installs on pull requests
  - .github/workflows/garnet-record.yml

commit 2
  chore(deps): bump express and @types/express
  - examples/package.json
  - pnpm-lock.yaml

dry run: nothing was executed.
```

The fresh cards for Vite #5, PostHog #203, Dub #37, OpenHands #10 and
openai-node #43 all report `undeterminable` with capture `not declared`.
They retain the recorded job sections and show immediate-parent-to-head
scope from the ledger's commit 1. The [batch report](prospect-batch.md)
records the public identity failures and independent reads. These examples
do not establish an accepted new-behavior showcase.

## Instrumented recording (dry run)

```text
recorder health: ok · last finalized record on pull request 10 (2026-09-11) · 8 recent pull requests read
replay plan · openhands · upstream change 17270 (number stays local)
fork (only write target): garnet-labs/OpenHands
branch: chore/update-dbq · base: main · scope: pr-base-to-head
compares: 0a5a65c → 3b68461
record: .github/workflows/ci.yml job test-and-build runs under the Garnet sensor from commit 1 (dropped job live-e2e; test-and-build: permissions contents: read, id-token: write; test-and-build: garnet-org/action step after checkout)
paths (5): __tests__/components/features/markdown/markdown-renderer.test.tsx, .github/pr-assets/pr-17270-latex-rendering.png, package-lock.json, package.json, src/components/features/markdown/markdown-renderer.tsx
commit 1 stages: the touched paths as the change found them (main on the fork differs on at least one)

commands
  git clone https://github.com/garnet-labs/OpenHands.git /home/ubuntu/ctx/work/openhands   # clone the fork (never the upstream)
  git -C /home/ubuntu/ctx/work/openhands remote add upstream https://github.com/OpenHands/OpenHands.git   # add a read-only upstream remote
  git -C /home/ubuntu/ctx/work/openhands remote set-url --push upstream DISABLED-no-push   # disable pushing to upstream
  git -C /home/ubuntu/ctx/work/openhands fetch --no-tags upstream 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 refs/pull/17270/head   # fetch the upstream base commit and the pull request head ref
  git -C /home/ubuntu/ctx/work/openhands cat-file -e 3b684610006f94958daccbb738f543215c89a1a3^{commit}   # guard: the recorded head sha must be the fetched pull request head
  git -C /home/ubuntu/ctx/work/openhands remote get-url origin   # guard: origin must be the fork
  git -C /home/ubuntu/ctx/work/openhands status --porcelain --untracked-files=no   # guard: the checkout must have no uncommitted changes
  git -C /home/ubuntu/ctx/work/openhands rev-list --count 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 ^origin/main   # guard: how far main on the fork is behind the change's base
  git -C /home/ubuntu/ctx/work/openhands checkout -B chore/update-dbq origin/main   # create chore/update-dbq from main
  git -C /home/ubuntu/ctx/work/openhands rm -q --ignore-unmatch -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: drop paths the change removes or renames
  git -C /home/ubuntu/ctx/work/openhands checkout 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 -- __tests__/components/features/markdown/markdown-renderer.test.tsx package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: touched paths as the change found them
  write /home/ubuntu/ctx/work/openhands/.github/workflows/ci.yml   # commit 1: update .github/workflows/ci.yml
  git -C /home/ubuntu/ctx/work/openhands add -- .github/workflows/ci.yml
  git -C /home/ubuntu/ctx/work/openhands add -A -- __tests__/components/features/markdown/markdown-renderer.test.tsx package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: stage the paths present after the reset
  git -C /home/ubuntu/ctx/work/openhands diff --cached --name-only   # guard: commit 1 must change something
  git -C /home/ubuntu/ctx/work/openhands commit -q -m <message below>   # commit 1
  git -C /home/ubuntu/ctx/work/openhands checkout 3b684610006f94958daccbb738f543215c89a1a3 -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 2: the change itself
  git -C /home/ubuntu/ctx/work/openhands add -A -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 2: stage the paths present at the head
  git -C /home/ubuntu/ctx/work/openhands diff --cached --name-only   # guard: commit 2 must change something
  git -C /home/ubuntu/ctx/work/openhands commit -q -m <message below>   # commit 2
  git -C /home/ubuntu/ctx/work/openhands rev-list --count origin/main..HEAD   # guard: exactly two new commits
  git -C /home/ubuntu/ctx/work/openhands rev-parse HEAD~1
  git -C /home/ubuntu/ctx/work/openhands rev-parse HEAD
  gh pr list --repo garnet-labs/OpenHands --head chore/update-dbq --state all --json number,state,isDraft,url   # reuse an existing fork pull request on this branch
  if a pull request exists: compare origin/chore/update-dbq with HEAD~1 and HEAD by tree, then by patch   # match the fork branch against commit 1 and commit 2 by tree, then by patch; a closed pull request's branch is not reused
  git -C /home/ubuntu/ctx/work/openhands push --set-upstream origin HEAD~1:refs/heads/chore/update-dbq   # push commit 1 alone to chore/update-dbq on the fork
  write /home/ubuntu/repos/garnet-replay/out/openhands/replay-17270-body.md   # write the pull request body
  gh pr create --repo garnet-labs/OpenHands --draft --base main --head chore/update-dbq --title "feat(markdown): render LaTeX math with KaTeX" --body-file /home/ubuntu/repos/garnet-replay/out/openhands/replay-17270-body.md   # open a draft pull request on the fork (base main)
  wait for the record of commit 1 on garnet-labs/OpenHands   # wait until commit 1 is recorded; the comparison on commit 2 needs it
  git -C /home/ubuntu/ctx/work/openhands push origin HEAD:refs/heads/chore/update-dbq   # push commit 2 to chore/update-dbq on the fork

commit 1
  chore: sync touched files before update

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

commit 2
  feat(markdown): render LaTeX math with KaTeX

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

pull request (draft)
  title: feat(markdown): render LaTeX math with KaTeX
  Two commits: the first prepares the branch, the second is the change itself.

  5 files:

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

  Commit 1 also prepares 1 additional file:

  - .github/workflows/ci.yml

dry run: nothing was executed.

note: garnet-labs/OpenHands@main has no pull_request workflow running garnet-org/action; the selected project workflow is instrumented in commit 1
```

## Refreshing a fork (dry run)

```text
refresh before: 189 behind, 8 ahead
refresh after: 0 behind, 9 ahead
dry run: nothing was executed.
```

## Consumption of a recorded fork pull request

`replay consume https://github.com/garnet-labs/pnpm/pull/66` (run 2026-09-22). The first receipt row is a negative statement about the head ("No runtime evidence for this head"): it is kept, but it is not head-bound and does not count as consumption. The second row is the head-bound citation that does.

<!-- garnet:consume pr=https://github.com/garnet-labs/pnpm/pull/66 head=ae2920fc99dbaa9069d8c258225b1c6a8df56904 consumed=true -->
### Consumption · https://github.com/garnet-labs/pnpm/pull/66

head: `ae2920f` · `ae2920fc99dbaa9069d8c258225b1c6a8df56904`

**consumed** · 1 reviewer(s) or agent(s) cited the head-bound record · reviewer-consumption-evidence

| check | state | detail | claim class |
|---|---|---|---|
| record | yes | record bound to head ae2920f | comparison-result |
| mirror | yes | evidence mirror in the body names the head commit | reviewer-consumption-evidence |
| consumers | yes | head-bound citation by devin-ai-integration[bot] (comment) | reviewer-consumption-evidence |
| receipts | yes | 3 receipt(s): 2 citation, 1 mention · devin-ai-integration[bot], qodo-code-review[bot] | reviewer-consumption-evidence |
| check | yes | Garnet Jibril Release Gate / reproduce / Verify profile, App comment and permalink: failure · Garnet Jibril Release Gate / reproduce / Same workload without the sensor: success · Garnet Jibril Release Gate / reproduce / Simulation — credential-less run skips cleanly: success · Garnet Jibril Release Gate / reproduce / Reproduce self-repo reference on Blacksmith: success · Mirror Garnet evidence for AI reviewers: success · Garnet Jibril Release Gate / reproduce: skipped | required-check-state |

funnel: delivered yes · visible yes · rereviewRequested no · attention yes · grounded yes · observation no · consumed-how: devin-ai-integration[bot] (citation, review-comment, after-record) · cold-read not yet rated · decision-impact unknown · attribution unknown · value-hypothesis unknown

#### Receipts · 3 receipt(s): 2 citation, 1 mention

Kept so weaker signals are not lost behind the consumed line; only head-bound utterance and citation rows count as consumption.

| tier | who | where | commit | matched | excerpt |
|---|---|---|---|---|---|
| citation | devin-ai-integration[bot] | [review-comment](https://github.com/garnet-labs/pnpm/pull/66#discussion_r4074133485) | `ae2920f` (head) | head ae2920f, reports no evidence | 🔍 **No runtime evidence for this head** |
| citation (head-bound) | devin-ai-integration[bot] | [review-comment](https://github.com/garnet-labs/pnpm/pull/66#discussion_r4074198082) | `ae2920f` (head) | head ae2920f | Timing: the review ran before the TS CI Node 24 leg finished. Head-bound record for `ae2920f` now exists (job 106845400061): `Download action repository 'garnet-org/action@2609a287b43720d73e26304558b2ead0fafd369b'`, `Jibril Version: v2.1... |
| mention | qodo-code-review[bot] | [comment](https://github.com/garnet-labs/pnpm/pull/66#issuecomment-5780431967) | — | — | TEST["Test workflow"] --> ACTION{{"Garnet action"}} <-- RELEASE["Release workflow"] |


The funnel line places the result: the record was delivered and mirrored, no re-review was requested for this head (the fork predates the re-review step), the citation arrived after the record without a re-request, and nobody has read the review for cold-read, decision impact or value yet.

## Scoring a checked pull request by hand

`replay uat pnpm --pr 66 --cold-read 3 --note "..."` (run 2026-09-22). Only the fields passed change; the observed stages are recomputed by the next `replay consume`, which keeps these manual values while the head stays the same.

```text
pnpm · pull request 66 · head ae2920f · delivered yes · visible yes · rereviewRequested no · attention yes · grounded yes · observation no · consumed-how: devin-ai-integration[bot] (citation, review-comment, after-record) · cold-read 3 of 5 · decision-impact unknown · attribution unknown · value-hypothesis unknown
```

## Consumption harvest across a fork

`replay harvest pnpm --limit 60` (run 2026-09-22), first rows of `out/pnpm/consumption-harvest.md`. Each row also writes `out/pnpm/pr-<N>-consume.json` with the source comments; the ledger stores that path relative to the repository.

### Consumption harvest · garnet-labs/pnpm

57 pull request(s) with a record checked · 9 consumed (head-bound) · 33 with at least one receipt · 3 skipped (no record)

| pull request | head | record | mirror | consumed | receipts |
|---|---|---|---|---|---|
| 66 | `ae2920f` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 3 receipt(s): 2 citation, 1 mention |
| 65 | `da56d8e` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 4 receipt(s): 1 citation, 3 mention |
| 64 | `d858adb` | head-bound | yes | no | no receipts |
| 63 | `afc58c1` | head-bound | yes | no | no receipts |
| 62 | `d0511cd` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 1 receipt(s): 1 utterance |
| 61 | `e9bbfe9` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 3 receipt(s): 1 utterance, 2 mention |
| 60 | `035e026` | head-bound | yes | no | no receipts |
| 59 | `664b018` | head-bound | yes | no | no receipts |
| 58 | `5d80a00` | head-bound | yes | no | no receipts |
| 57 | — | no | — | — | skipped: no record comment |
| … | | | | | |
