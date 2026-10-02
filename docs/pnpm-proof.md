# pnpm proof: pnpm already records; the App puts it on the pull request

Observed 2026-10-02 (17:52–18:00 UTC) with `replay upstream pnpm/pnpm --pr <N>`
on harness main `8d3789e` plus this change. Read-only: no fork, no replay, no comment.

## The finding in one paragraph

`pnpm/pnpm` already runs `garnet-org/action@245ad6be` (v2.3.0) in one TS CI cell
(`ubuntu (24.0.0, 2) / Node 24 / chunk 2/3`) on same-repository pull requests
(not all: #16493's TS CI runs had no Garnet step that ran). Every one of those jobs we read has a public Execution Profile with
the process lineage behind each outbound connection. None of these pull requests
has a Runtime Review comment, because the Runtime Review App is not installed on
`pnpm/pnpm`. The profiles exist; maintainers do not see them.

## What the profiles show today

The test processes (`bash → MainThread → pn → dash → node → pn → node`, after
`Runner.Worker`) reach live public services on every recorded PR, including a
docs-only one:

| destination | process lineage (example) | seen on |
|---|---|---|
| `registry.npmjs.org` | `pn → dash → node → pn → node` and `pnpm → sh → MainThread` | every profile |
| `nodejs.org`, `unofficial-builds.nodejs.org` | `pn → dash → node → pn → node`; `pnpm → sh → … → node-gyp` | every profile (16499: 3/4 for unofficial-builds) |
| `codeload.github.com`, `github.com` (`git → git-remote-http`) | `pn → … → node`, `pnpm → git → … → git-remote-http` | every profile (16499: 3/4) |
| `pnpm.io` | `pn → dash → node → node → node` | 16516, 16499 |
| `npm.jsr.io` | `pn → dash → node → pn → node` | 16522 4/4, 16482 2/2; not 16516 or 16499 |
| `static.rust-lang.org`, `*.crates.io` | `bash → rustup` | most profiles (setup, not tests) |

So the value a maintainer can use today is: **which processes in pnpm's own test
run talk to which live registries and download hosts**, per job, with links. That
is the "your tests hit the real npm/JSR/Node registries from these processes"
fact, not a per-PR behavior change.

## Three candidates

Chosen from a fresh list of same-repository PRs updated since 2026-09-24, keeping
only PRs whose own jobs recorded a profile and whose review question is about
network or install behavior. #16516 (docs-only, 710 files) is kept as the
control: it shows the same baseline, which is why no PR-specific claim is made.

| PR | review question the record speaks to | recorded jobs (run · attempt → profile) |
|---|---|---|
| [#16522](https://github.com/pnpm/pnpm/pull/16522) fix: warn when an optional dependency cannot be fetched (merged) | Reviewers discussed failed optional fetches, redaction of credentials and signed query tokens in URLs. The record shows the test chunk talking to live `registry.npmjs.org` and `npm.jsr.io` from `pn → node` test processes. | [37037721753 · 1](https://app.garnet.ai/public/runs/37037721753?profile=01a0fd9d-b192-7179-8dda-ee86f53c8aa9), [37035071901 · 1](https://app.garnet.ai/public/runs/37035071901?profile=01a0fd87-2696-718e-97e2-9a4b1db94866) (+2) |
| [#16482](https://github.com/pnpm/pnpm/pull/16482) feat(esm-loader): load Node.js modules directly from store blobs (open) | A loader that reads from the store should not need the network. Its recorded jobs show no workload destination beyond the docs-only control plus `npm.jsr.io`. That is an observation over undeclared capture, not proof of absence. Open, so an App comment would land on a PR under review. | [36922891384 · 1](https://app.garnet.ai/public/runs/36922891384?profile=01a0f93e-395b-7350-81c0-8829478efd85), [36915267983 · 1](https://app.garnet.ai/public/runs/36915267983?profile=01a0f905-632a-7f21-9aee-10a8dff1500f) |
| [#16499](https://github.com/pnpm/pnpm/pull/16499) feat: support pnpm in StackBlitz WebContainers (merged) | Executable relinking and runtime fetches. The record shows `nodejs.org` and `unofficial-builds.nodejs.org` reached by `pn` test processes (Node runtime downloads) with lineage. | [36982608709 · 1](https://app.garnet.ai/public/runs/36982608709?profile=01a0fbb7-d94f-7f2e-b642-8cca9a3029bc), [36981995215 · 1](https://app.garnet.ai/public/runs/36981995215?profile=01a0fbab-6538-741f-82bb-33732fbf5db7) (+2) |
| control: [#16516](https://github.com/pnpm/pnpm/pull/16516) docs principles (open) | Same baseline as above with no code change. | [37014299431 · 1](https://app.garnet.ai/public/runs/37014299431?profile=01a0fce2-ff50-7407-95ac-93f3c7c08238) (+4) |

All rows: action `245ad6be82de3200c205109c8ca7ac816dc692ea`, workflow `TS CI`, job
`Test / ubuntu (24.0.0, 2) / Node 24 / chunk 2/3`, profile bound to
`refs/pull/<N>/merge` (the merge commit, not the PR head). Full per-run tables:
`node bin/replay.mjs upstream pnpm/pnpm --pr <N>` → `out/pnpm/upstream-pr-<N>.md`.

## What is not shown (keep these out of outreach)

- **Not causal.** The docs-only control has the same destinations. The test
  scope is affected-only, so a destination present on one PR and not another
  (`npm.jsr.io`, `pnpm.io`) reflects which tests were selected as much as the code.
- **Not exact-head.** Every profile names `refs/pull/N/merge`. `replay verify`
  would fail these on the identity leg.
- **Not complete.** Capture completeness is not declared; absence of a destination
  is not evidence of absence. One cell of one OS is recorded.
- **No timing, CPU, filesystem, or per-origin flow counts**; the record has none.
- **`no_bad_egress_domain` is ATTENTION on every profile**, including the docs-only
  control. Shown to a maintainer as-is it is noise; calibrate before the App comments.
- **Contributor-fork PRs record nothing.** They get neither `GARNET_API_TOKEN` nor
  OIDC; the action logs "skipped … no authentication" and the job stays green
  (e.g. [#15860](https://github.com/pnpm/pnpm/pull/15860)).
- **Dependabot.** The live Dependabot PR [#16517](https://github.com/pnpm/pnpm/pull/16517)
  (github-actions group bump) ran TS CI, but no Garnet step ran in it, so
  nothing was recorded. The fork simulation
  (garnet-labs/pnpm#69, `docs/batch-2026-09-24.md`) drew comments from four review
  bots, none citing the record.
- **No reviewer or agent cites a profile** on any upstream PR. The reviewer loop is
  not shown; only the human comment path is in reach, and only after the App is installed.

## The ask

> You already record this: one TS CI cell on every same-repo PR uploads an
> Execution Profile showing which test processes reach the npm, JSR and Node
> registries (links above). Installing the Garnet Runtime Review App on
> pnpm/pnpm puts that on the pull request as one comment, with no workflow change.

Closure evidence: a `garnet-runtime-review[bot]` comment on a new pnpm/pnpm
same-repo PR carrying `<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->`.

## Before sending

1. Calibrate `no_bad_egress_domain` so the docs-only control does not raise
   ATTENTION (owner: control-plane; gated, protected repo; closes when a fresh
   pnpm profile shows it passing or absent).
2. Decide whether the outreach shows the egress baseline (supportable today) or
   waits for head-bound, complete records so a per-PR diff can be claimed
   (owner: Farrukh).
