# Stage 1: replay a change on the fork

Goal: one pull request on the `garnet-labs` fork whose Garnet comment shows what
the change ran, in a shape a maintainer reads as a routine contribution.

## 0. Pick the target and the candidate

One ledger per upstream repository: `targets/<slug>.json` holds `upstream`,
`fork`, observations, replays, and notes. `replay find` creates it.

```sh
node bin/replay.mjs find PostHog/posthog --slug posthog --fork garnet-labs/posthog \
  --author 'app/dependabot' --limit 40            # or --search 'bump', --kind dependency
```

What the score means: each point prints its reason (`dependency-only`, `major`,
`lockfile`, `install-surface`, `bot-author`, …) and the total equals the sum
you can see. Merge-queue batches (`trunk-merge/…`, `app/trunk-io`) are set
aside and counted, never ranked. The output is candidate evidence: it says a
change is worth recording, not what it ran.

Prefer, in this order:

1. a dependency bump that adds or changes an install script or a native binary;
2. a major bump of a dependency that downloads something at install time;
3. a lockfile-only change that moves a tarball URL or registry.

Skip batches, docs-only changes, and anything whose install path cannot run in
CI on Linux.

For local history instead of pull requests:
`replay find --history ~/repos/posthog --top 15`.

## 1a. Replay a real upstream pull request

```sh
node bin/replay.mjs live posthog --pr 56732 --work ~/repos/posthog --dry-run
node bin/replay.mjs live posthog --pr 56732 --work ~/repos/posthog
```

The plan, always printed before anything is written:

1. Verify `origin` is the fork; add `upstream` read-only with push disabled.
2. Fetch the upstream base and `refs/pull/N/head`; check the exact API head SHA
   exists with `git cat-file`. A nearby commit is never substituted.
3. Refuse a checkout with uncommitted changes; the harness never discards work.
4. Count how far the fork default branch is behind the change's base. Paths the
   change does not touch stay as the fork has them, so a change that depends on
   files or workspace members newer than the fork can fail to install. A count
   above zero stops the run before any write. `--sync-fork` fast-forwards the
   fork default branch to the base first (`git push origin
   <base>:refs/heads/<default>`, which git refuses unless it is a fast-forward).
   With the fork at the base, commit 1 carries only the recording workflow, and
   its message says so. When the fork default branch must stay where it is,
   `--base-branch <name>` sets a fork-only branch to the exact base instead and
   opens the pull request against it; commit 1 then carries the fork's
   recording workflow from the default branch, unless the base already runs a
   recording workflow of its own, in which case commit 1 carries nothing. A
   fork with several recording workflows needs `--record-workflow <path>` to
   name the one carried. `--allow-behind` turns the stop into a warning when
   the distance is known to be harmless.
   A recording workflow is any `pull_request` workflow that runs
   `garnet-org/action` itself or through a local reusable workflow
   (`uses: ./.github/workflows/…` or `$/.github/workflows/…`).
5. Branch `deps/<name>-<to>` (or `change/<slug>-<n>`) from the fork default branch.
6. Commit 1: the touched paths as the upstream base had them, plus the recording
   workflow if the fork has none (`--record inject`). The injected workflow runs
   on every pull request of the fork, Dependabot's included, so each dependency
   pull request Dependabot opens there is recorded like any other; when the
   fork has no `.github/dependabot.yml`, commit 1 adds a weekly one for the
   detected ecosystem and for GitHub Actions. Only paths that exist in that
   state are staged; paths the change adds appear first in commit 2, paths it
   removes disappear there. When the fork's recording workflow runs only on
   certain paths (`on.pull_request.paths`), commit 2 must touch at least one of
   them; otherwise the plan stops before any write, because the pull request
   would record nothing.
7. Commit 2: the upstream diff applied on top, with routine wording.
8. Verify `git rev-list --count` is exactly 2 and both commits are non-empty.
9. Push commit 1 alone to `origin`; open one draft pull request or reuse the
   existing open one (closed ones are left alone). `--label <name>` adds a
   label of the fork to the pull request, for forks whose workflows or reviewers
   key on one.
10. Wait until commit 1 is recorded (`--wait-minutes N`, default 45), then push
   commit 2. Pushed together, only the head is recorded and the comparison never
   exists. `--no-wait` skips the wait and forfeits the comparison; a failed
   Garnet check on commit 1 stops the run with commit 1 still on the fork.

Wording: the branch, commit messages, title, and body come from the transition
(`chore(deps): bump puppeteer from 24.40.0 to 25.9.0`), never from the upstream
pull request. Override with `--first-message`, `--change-message`, `--title`,
`--body`. Guards refuse any upstream URL, `owner/repo#N`, bare `#N`, or tool
residue.

Ecosystem is detected from the touched manifests: npm, pnpm, Yarn, Cargo, Ruby,
uv, Go. An unsupported ecosystem stops the run before any write and says so.

## 1b. Author a transition on the fork (pnpm)

When no real pull request carries the transition you want to show:

```sh
node bin/replay.mjs live posthog --dependency puppeteer --to 25.9.0 \
  --package-dir nodejs --work ~/repos/posthog [--from 24.40.0] [--dry-run]
```

- `--from` defaults to what the fork default branch's lockfile resolves.
- Commit 1 bumps the manifest and resolves the lockfile with the repository's
  own pnpm (`corepack pnpm install --lockfile-only`). No scripts run.
- Commit 2 adds the dependency to `onlyBuiltDependencies` (in
  `pnpm-workspace.yaml` or `package.json`, whichever the fork uses).
- Scope is `immediate-parent-to-head`: the record on commit 2 is compared with
  the record on commit 1, so the difference is exactly "the install script now
  runs".

The fork must already have a `pull_request` workflow that uses
`garnet-org/action` and records the install. The command fails closed when it
does not; it never injects a workflow into a transition branch because that
would make commit 1 a setup commit instead of a state.

### Allow a build script the lockfile already skips

When the lockfile cannot be regenerated (trust policy, minimum release age, a
broken workspace), or when the dependency is already installed and only its
build script is blocked:

```sh
node bin/replay.mjs live posthog --allow-build puppeteer --work ~/repos/posthog [--dry-run]
```

- The dependency must already be in the fork's lockfile and not yet listed
  under `onlyBuiltDependencies` or `ignoredBuiltDependencies`. The command
  reads every locked version and checks with `corepack pnpm view` that at least
  one declares an install script; otherwise there is nothing to allow.
- Commit 1 lists it under `ignoredBuiltDependencies`, pnpm's list of build
  scripts you have decided not to run. The install is identical to the default
  branch; the skip is now explicit.
- Commit 2 moves it to `onlyBuiltDependencies`. The install script runs.
- Neither commit touches `pnpm-lock.yaml`; a guard fails the run if it changed.
- Wording is the routine decision (`chore(deps): allow <dep> build script`).

Other ecosystems do not have an equivalent "blocked, then allowed" state, so
transitions are pnpm only. Use 1a for them.

## 2. Wait for the record

`live` returns once commit 2 is pushed; commit 1 is already recorded by then.
The fork's workflow records commit 2 as a second head, and Garnet's comment on
it compares the head with commit 1. Check with:

```sh
gh run list -R garnet-labs/posthog --branch deps/puppeteer-25.9.0
node bin/replay.mjs verify https://github.com/garnet-labs/posthog/pull/<N>
```

`verify` legs: comment present, head-bound, finalized (no placeholder text),
determinable, pair line names the current head, public permalink loads, Garnet
check settled, no residue, real/constructed label, pull request open. Any FAIL
means do not share.

What "recorded" needs: the fork workflow must have a token. Pull requests from
another repository get neither secrets nor OIDC, so a fork-origin run degrades to
a local, best-effort record. A branch pushed to the fork itself is not
fork-origin; its workflow runs with the fork's own token. Dependabot's pull
requests run with Dependabot's secret store, not the repository's Actions
secrets: a workflow that passes `api_token` records nothing on them unless the
same token is also set as a Dependabot secret (organisation-wide or per fork),
while the injected OIDC workflow needs no secret. If the comment says the
capture is partial or the record is a placeholder, the verdict is
`undeterminable`, not `unchanged`.

## 3. Card

```sh
node bin/replay.mjs card https://github.com/garnet-labs/posthog/pull/<N>
```

Writes `out/posthog/pr-<N>-card.md`: finding, verdict and reasons, exact head
and compared SHA, version transition, scope, quoted execution chains (workload
first, runner background after), Garnet permalink, and the question the card
answers: would this have helped the review? Pending, stale, or head-unbound
records fail closed with the reason printed.

## Cold read before sharing

Open the fork pull request and read it as a maintainer who has never heard of
Garnet: title, both commits, body, bot comments, the Garnet comment. It passes
when the finding sits in the workload section for commit 2, the counts match the
visible rows, the pair header names commit 1 and commit 2, and nothing hints at
a demo or a tool. Render the card and the comment through GitHub Markdown at
desktop and phone width. If the finding is buried, contradicted, or attributed to
runner background, the exhibit is not ready.
