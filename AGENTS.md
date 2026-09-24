# AGENTS.md

## What this repository is

Garnet Replay: the one command line for producing, verifying, and reporting
runtime-evidence exhibits on `garnet-labs` forks. Read `README.md` first, then
`docs/stage1.md`. `SKILL.md` is the operating procedure; this file is the rules.

## Operating rules (enforced by `lib/guards.mjs`; do not relax them)

- The fork is the only write target. Never push, comment, label, or open a pull
  request on the upstream repository. Never add a link to the upstream
  repository, its pull requests, or `owner/repo#N` on the fork.
- Exactly two commits per replay, both non-empty, routine wording. No mention of
  Garnet, demos, tests, tools, or sessions in branch names, commits, titles,
  bodies, or cards.
- The harness never posts Garnet comments. The fork's recording workflow does.
- Every artifact names its pair (head, compared commit, transition, scope).
- Missing, partial, stale, or unbound evidence is `undeterminable`. Never write
  "unchanged", "no change", or "clean" over incomplete evidence.
- Require declared complete capture and exact public repository/run/profile/head
  identity. A merge-ref SHA cannot stand in for the replay head without verified
  executed-source linkage. Keep workload success, capture, hypothesis, reviewer
  value, agent consumption, and attribution separate in batch reports.
- Cards preserve every recorded job, workload row, background row, and job link.
  State the measured command and omitted workloads in the evidence manifest.
  Destination equality does not prove execution-chain or application equivalence.
- Finder output is candidate evidence. Only a recorded run says what ran.
- Run `replay verify <pr-url>` before any pull request or card is shown to anyone.
  FAIL means not shareable.
- Do not change `garnet-org/action`, `garnet-org/control-plane`, or
  `garnet-org/jibril`. Do not publish anything outside `garnet-labs`.

## Coding rules

- ES modules, Node 20+, built-in APIs only. No dependencies without an explicit
  decision.
- Imports at the top. Function declarations at module scope. JSDoc on exports.
- Explicit checks (`typeof x === "string"`, `x !== null`), no truthiness on data.
- Network and git go through `lib/gh.mjs` so commands can run with an injected
  `exec` in tests. Everything in `lib/*.mjs` that decides something is a pure
  function with a test in `test/`.
- `contract/vocab.json` is vendored from the Runtime Review testbed. Do not edit
  it here; re-vendor it.
- `targets/*.json` are ledgers written by the commands. Do not hand-edit them
  except to add a `notes` entry.
- `out/` is generated and not committed.

## Verification before a pull request here

```sh
npm test                                  # node --test test/*.test.mjs
node bin/replay.mjs --help                # the CLI loads
node bin/replay.mjs live <slug> --pr N --work <checkout> --dry-run   # plan reads correctly
```

When a change alters rendered output (card, comment fields, README examples),
render it through GitHub Markdown and read it at desktop and phone width before
opening the pull request, and update `docs/examples.md` with the real output.
Pull request descriptions must match the branch; rewrite them when the shape
changes.

## Knowledge this repo depends on

- Garnet action auth: OIDC jobs need `contents: read` and `id-token: write` and
  no `api_token`; explicit-token jobs need `api_token` and no `id-token`. Pull
  requests from other repositories receive neither and degrade to a local
  record.
- The action pin in `live/templates/garnet-record.yml` is the commit covered by
  release `v2.3.0` (`GARNET_ACTION_PIN` in `lib/replay-pr.mjs`). Move existing
  forks with `replay repin <slug>`; never edit their workflows by hand. Since
  v2.3.0 the companion GitHub App owns the Runtime Review comment; the action
  posts none.
- An execution chain is one root-to-action path. Today's action class is an
  outbound connection. A destination is the leaf of the action, not the chain.
