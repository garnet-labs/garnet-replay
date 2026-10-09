# Walkthroughs

One page per audience, each pointing at the real commands, files and saved
output. Rules live in [AGENTS.md](../AGENTS.md); the operating procedure is
[SKILL.md](../SKILL.md); worked output is in [examples.md](examples.md).

| I want to… | Start here | Reference output |
| --- | --- | --- |
| Read what a replay recorded | [Read saved evidence](#read-saved-evidence) | [examples §2–4](examples.md#2-the-share-gate-on-a-recorded-fork-pull-request) |
| Replay a new upstream PR from the browser | [Hosted wizard](#replay-a-new-pr-from-the-hosted-wizard) | [examples §7](examples.md#7-public-viewer-entrypoint) |
| Replay a new upstream PR from a terminal | [Local CLI](#replay-a-new-pr-from-the-cli) | [examples §1](examples.md#1-plan-a-replay-of-a-real-upstream-change-dry-run) |
| Drive the harness as an agent | [Agents](#drive-the-harness-as-an-agent) | [agent-interface.md](agent-interface.md) |
| Measure reviewer or agent consumption | [Consumption](#measure-consumption) | [examples: consumption](examples.md#consumption-of-a-recorded-fork-pull-request) |
| Land harness changes | [Contributing](#contribute-to-the-harness) | [AGENTS.md § Verification](../AGENTS.md#verification-before-a-pull-request-here) |

## Read saved evidence

1. Open <https://garnet-replay.vercel.app> (or `node bin/replay.mjs serve`).
2. Paste a fork or upstream PR URL, or swap `github.com` for the viewer host.
3. Read the pair line first (head, compared commit, scope), then capture
   status, then the rows. Workload and runner background are separate tables.
4. `undeterminable`, "capture not declared" and "recorded jobs only" mean the
   record does not support a comparison. They are not a clean result.
5. Before showing any PR to anyone, run `node bin/replay.mjs verify <pr-url>`.
   Only a full PASS is shareable.

## Replay a new PR from the hosted wizard

The wizard is pull request → fork → plan → record → evidence
([architecture](workspace.md#create-replays-from-the-hosted-viewer)).

1. Paste the upstream PR URL. The viewer resolves the configured
   `garnet-labs` fork from `targets/<slug>.json`; an upstream with no target
   stops here.
2. Enter the operator key (kept in this browser tab only).
3. **Prepare replay** dispatches `.github/workflows/replay.yml`
   (`action: prepare`), which runs `live <slug> --pr <n> --dry-run` and stores
   the plan and its signature in the `replay-job` artifact. Read the plan:
   commits, base, pair, recorder health.
4. **Start replay on fork** dispatches `action: start` with the prepare run.
   The job recomputes the plan and refuses to write if the signature differs,
   pushes the branch, opens the draft fork PR, waits for the fork's own
   recording workflow, and runs the share gate.
5. The evidence step opens the fork PR's live receipt.

Writes are enabled only when `REPLAY_DISPATCH_TOKEN`, `REPLAY_OPERATOR_KEY`
and `REPLAY_ORIGIN` are set on Vercel and `REPLAY_FORK_TOKEN` is a repository
secret; otherwise the viewer is read-only and every mutation returns 405. The
fork token exists only inside GitHub Actions and should be scoped to the
configured forks. No credentialed hosted run has been recorded in
[examples.md](examples.md) yet; until one is, the local path below is the
reference.

## Replay a new PR from the CLI

```sh
export GH_TOKEN=$(gh auth token)
R="node bin/replay.mjs"
$R setup <slug> --dry-run                                  # fork onboarded?
$R live <slug> --pr <N> --work ~/repos/<fork> --dry-run    # read the plan
$R live <slug> --pr <N> --work ~/repos/<fork>              # push + draft PR on the fork
$R verify https://github.com/garnet-labs/<fork>/pull/<M>   # share gate
$R card   https://github.com/garnet-labs/<fork>/pull/<M>   # out/<slug>/pr-<M>-card.md
$R status <slug>                                           # next command
```

`node bin/replay.mjs serve --run-replays` runs the same wizard locally with
your own `gh` credentials. The full step list, including `--first-commit`,
`--sync-fork`, `--base-branch` and stalled-recorder handling, is
[SKILL.md § Procedure](../SKILL.md#procedure).

## Drive the harness as an agent

1. Fetch `main`, read [README.md](../README.md), [AGENTS.md](../AGENTS.md),
   [SKILL.md](../SKILL.md) and [stage1.md](stage1.md). Record the harness
   commit you used.
2. Follow SKILL.md steps 1–10 in order; every write command has a
   `--dry-run` to read first.
3. Treat `find` output as candidate evidence and `verify` as the only gate.
   Never rerun fork jobs, edit checks or comments, or write upstream.
4. Report the pair line, verdict and first reason, capture status, and the
   measured command; keep workload, capture, reviewer value and attribution
   separate.
5. Known gaps for agents (no `--json` everywhere, named exit codes, no
   `replay wait`): [agent-interface.md](agent-interface.md).

## Measure consumption

`replay consume <fork-pr-url>` reports whether a reviewer or agent cited the
head-bound record; `replay harvest <slug>` does it across a fork;
`replay stage2 <slug> --dry-run` plans the evidence mirror, the
`garnet/evidence` gate and `REVIEW.md` ([stage2.md](stage2.md)). For pnpm,
`replay upstream pnpm/pnpm --pr <N>` reads the upstream's own Garnet records
without writing anything. Agent A/B scoring lives in `benchmark/agent-ab/`.

## Contribute to the harness

```sh
npm test
node bin/replay.mjs --help
node bin/replay.mjs live <slug> --pr <N> --work <checkout> --dry-run
```

Rendered-output changes also update [examples.md](examples.md) with real
output read at desktop and phone width. Pull requests open as drafts on
`devin/*` branches; marking one ready for review is the approval, and the
`auto-merge` workflow squash-merges it once every check is green, no review
requests changes and no thread is unresolved (add the `hold` label to stop it).
