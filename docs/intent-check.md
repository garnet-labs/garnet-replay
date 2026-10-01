# Intent check: base record → head record → does the runtime delta support the pull request's claim?

Status: plan. Grounded in harness commit `a67ce46` and the evidence gathered on
2026-09-26 (UTC) from `garnet-labs/sentry-javascript#3`, `posthog`, `pnpm`,
`deepsec`, `dub`, `uv`, `dotenv`, `dagger`, and the prospect batch. Facts carry
their source; everything else is marked as a decision.

## 1. The gap, in one record

`garnet-labs/sentry-javascript#3` (fork of getsentry/sentry-javascript#24708,
"remove the mock.shop Storefront queries that made the Hydrogen E2E tests
flaky") recorded fine: 1 job, 63 chains, 24 destinations, steps `12. Build E2E
app`, `13. Install Playwright`, `14. Run E2E test`, `99. Runner Processes`
(public profile `01a0d654-…`, run `36084510497`). `mock.shop` is absent from
the head record. But the comment carries `previous: null`, so the record can
only say "here is what ran", not "the Storefront dependency the PR set out to
remove was present before and is absent now". `/merge-gate` then judged the
same PR as an allowlist audit (`cdn.playwright.dev`, `o1.ingest.sentry.io`,
Shopify hosts as unknown) — the wrong question for a flaky-test fix.

Three things are missing, in order of cost:

1. A **base record for the same job** when `previous` is null.
2. A **workload delta scoped to the affected step(s)**, not the whole runner.
3. A **typed statement of what the PR claims** to change at runtime, checked
   against the scoped delta, with fail-closed outcomes.

Everything else (sensor, receipt, comment, `pair`, `verify`, card) exists.

## 2. What the harvest established (facts)

| Fact | Source |
|---|---|
| No harness command records the base branch SHA. `--base-branch` only pushes a fork branch; records happen only on `pull_request` events for a changing head. | `lib/replay-pr.mjs:415,1583-1604`; docs/stage2.md |
| The base record today is always commit 1 of the two-commit shape, or the App's `previous` (the previously recorded head on the same PR). Every ledger evidence row has a `previousSha`; failures were `capture-not-declared` / `public-head-mismatch`, never a missing base. | `targets/*.json`; docs/prospect-batch.md:58-73 |
| Live null rate: of 22 recent commented PRs across 7 forks, 15 carry `previous`, 5 are first snapshots (`previous: null`), 2 lack a summary. uv/dotenv/dagger (dispatch-only recorders) had 0/15 comments. | `gh api` probes, learnings §6 |
| One-commit replays on onboarded forks (PR #28) inherit the `previous: null` problem by construction: the first PR on a fresh branch has no prior recorded head. | `lib/replay-pr.mjs:1152`; sentry#3 |
| Sentry's E2E matrix is selected by `nx affected` over the PR diff. The onboarding PR (#1/#2) touched only `.github/`, so `E2E remix-hydrogen Test` was **skipped** there — a base record for that job cannot come from a commit that does not touch the same paths. | `.github/workflows/build.yml:104,159-189,1001-1019`; run `36068930209` jobs |
| Public report `run.commit_sha` is the `refs/pull/N/merge` SHA, not the head. | sentry#3 public profile; prospect-batch.md:58-73 |
| Per-step attribution exists in the profile (`github_step` per peer / `step` per association) but is unused downstream; the card splits only workload vs runner background. | `lib/profile-diff.mjs:29,66-73`; `lib/execution-diff.mjs` |
| `replay pair` already builds a schema-valid diff from two local profile files; scope `pr-base-to-head` already exists. | `bin/replay.mjs:144-203`; `lib/evidence.mjs:46-52` |
| `vanished` is a machine field in `garnet:summary` with no documented semantics. | `renderer/review.mjs:532-558` |
| docs/plan.md:44-48 warns that whole-job base→head deltas on install-only changes are "noise or nothing". | docs/plan.md |
| Banned on rendered surfaces: `baseline`, `verdict`, `gone`, `detected`, `safe`, `clean`, `execution diff` (residue). | `contract/vocab.json` |
| Most review tools consume the PR body, not comments/artifacts; the mirror already puts the head-bound record there. | docs/consumption-roadmap.md; docs/stage2.md |

Learnings per target:

- **Sentry**: the canonical positive case; job selection is path-dependent, so
  the base record must be produced by a commit with the same affected set.
- **pnpm / posthog / deepsec**: always-on `pull_request` recorders; `previous`
  is usually present and `added/removed` are non-zero on real changes
  (pnpm#76 1/7/5, deepsec#7 1/4/2, posthog#205 1/3/0) — the raw delta the check
  needs already exists upstream for these forks; the missing piece is scoping
  and the claim.
- **dub / dotenv / dagger / uv**: dispatch-only dependabot lanes; no
  `pull_request` recorder → no base record from any mechanism. The feature
  must state `undeterminable / no base record` there rather than invent one.
- **prospect batch (vite, dub, openai-node, openhands, posthog)**: 10/10 jobs
  recorded, 5/5 verify FAIL on capture declaration and merge-ref identity — the
  intent check inherits those gates unchanged; it never softens them.

## 3. Decisions

### D1 — Base record: same-path sequencing on the replay PR (two commits)

When the target job's inclusion depends on the diff (Sentry) or when no prior
recorded head exists on the branch, `live … --pr N --base same-path` produces
the base record as **commit 1 = a behaviour-neutral touch of exactly the files
the PR changes** (a trailing comment line per file, comment syntax chosen by
extension; refuse and report when a touched file has no known comment syntax
or when the PR touches only non-code files), pushed alone and waited for, then
**commit 2 = the change**. This reuses the existing `publishSteps` two-commit
path (`push-first` → `wait-first-record` → push second), the 45-minute wait,
recorder-health gate and guards untouched; it selects the same jobs because it
changes the same paths; it costs exactly one extra CI run of the same job.
Scope label: `immediate-parent-to-head`; the artifact names commit 1 as
`same-path touch` so nobody reads it as the source base. Commit wording stays
routine (`chore: tidy comments in …`).

Touch set, by change type: **modified** and **deleted** files are touched in
commit 1 (a deleted file gets its comment in commit 1 and disappears in commit
2); an **added** file cannot be touched, so commit 1 touches the nearest
existing code file in the same directory (walking up to the nearest ancestor
with one) — job selection in every observed target is per project/path
prefix, not per file; a **rename** is a deletion plus an addition. The plan
prints the computed touch set in `--dry-run` and refuses when any added file
has no existing code sibling under the same top-level project directory.

Rejected: `workflow_dispatch` of the job at the base SHA (job selection differs
per repo; Sentry's matrix would be empty), recording the base branch on push
(records only on head changes), and comparing against an arbitrary earlier
`previous` (different affected set → not comparable).

When the App's `previous` already exists **and** its recorded steps match the
head's step names (§D2), no sequencing is needed; the check reads both public
profiles instead. Existing `pull_request` forks (pnpm, posthog, deepsec) go
this route.

### D2 — Scope: step-level workload delta

`lib/profile-diff.mjs` gains a `steps` filter: entries keep their `step`; the
diff is computed per step name after stripping the ordinal (`14. Run E2E test`
→ `Run E2E test`). A step present on one side only is reported as
`step-missing` and makes any claim scoped to it `undeterminable`. Runner
background is preserved (cards keep every row) but never counts toward a claim.

Affected steps are declared, not guessed (`--steps "Run E2E test"`); a
future finder heuristic can propose them from the PR's touched paths.

### D3 — Claims: a typed intent file, checked deterministically

`out/<slug>/pr-<N>/intent.json` (also accepted inline via CLI flags):

```json
{
  "pr": "garnet-labs/sentry-javascript#3",
  "claims": [
    { "id": "storefront-removed", "kind": "network", "match": { "destination": "mock.shop" },
      "expect": "present-before-absent-after", "steps": ["Run E2E test"], "source": "pr-body" },
    { "id": "sentry-ingest-kept", "kind": "network", "match": { "destination": "o1.ingest.sentry.io" },
      "expect": "present-both", "steps": ["Run E2E test"], "source": "pr-body" },
    { "id": "no-new-outbound", "kind": "network", "expect": "no-added", "steps": ["Run E2E test"],
      "source": "default" }
  ]
}
```

`kind` ∈ `network | process`, `match.destination` exact name or `*.suffix`,
`match.ancestry` substring for processes. `expect` ∈
`present-before-absent-after | absent-before-present-after | present-both |
absent-both | no-added | no-removed`. Each claim resolves to:

| outcome | when |
|---|---|
| `supported` | both sides recorded, complete capture, steps present, predicate holds |
| `contradicted` | same preconditions, predicate false |
| `unobservable` | preconditions hold but the matched behaviour appears on neither side, so removal/addition cannot be distinguished from "never exercised" (e.g. `mock.shop` absent in the base too) |
| `undeterminable` | no base record, partial/undeclared capture, step missing, public identity unbound |

Aggregate (`intent.outcome`): `supported` if every claim is `supported` and
the scoped delta has no added/removed workload destination outside the claims;
`contradicted` if any claim is; `needs-explanation` if all claims are
`supported` but the scoped delta contains rows no claim covers (the "new
outbound destination during the same test" case); otherwise `undeterminable`.
No aggregate ever says "safe", "verified", "clean" or "unchanged".

Claim authoring: v1 is manual (`replay intent <pr-url> --claim
"network:mock.shop:present-before-absent-after:Run E2E test"`) or by an agent.
An optional `--propose` step may draft claims from title/body/diff with a model
call, written to `intent.json` for review — proposals are never evaluated
without a human or the calling agent confirming them, and the file records
`source: proposed`. Cost: zero model calls in the deterministic path, at most
one when proposing.

### D4 — Output

- JSON: an `intent` block on the existing diff schema (`schema/execution-diff.schema.json`):
  `{ outcome, steps, claims[]: { id, kind, match, expect, outcome, before[], after[] }, uncovered: { added[], removed[] } }`.
- Claim class: `intent-check-result` added to `CLAIM_CLASSES`; `verify` treats
  a rendered `supported`/`contradicted` without a matching JSON block as FAIL.
- Card section "Intended behaviour", one line per claim, then uncovered rows,
  then the existing workload/background tables unchanged. Rendered copy:
  "Expected behaviour change is present in the record", "Record contradicts
  the stated change", "Record shows a change the pull request does not
  describe", "Not determinable: <reason>". Vocabulary test extended.
- Delivery: the App comment is what the stage-2 mirror copies into the PR body
  (`live/templates/stage2/garnet-evidence-mirror.mjs`), and the App cannot carry
  an intent block the harness computed. Lane A therefore only writes
  `out/<slug>/pr-<N>-card.md` and the JSON; delivering the intent section to
  reviewers/agents needs a publisher and is a separate lane E: a fork-side
  workflow step that runs the deterministic check (`pair --intent`) against
  the two public profiles and writes the section into the PR body between
  `garnet:intent:begin/end` markers, fail-closed like the mirror. Not in A–D.
- No gate. `merge-gate` may later consume `intent.outcome`; not in this slice.

### D5 — Cohort measurement (the PMF test)

`replay find` gains a `--claims` mode that surfaces upstream PRs whose
title/body make a falsifiable runtime statement (removes/adds a request,
dependency, download, spawn, telemetry, retries, network call) — candidate
evidence only. Target 20–30 PRs across sentry, pnpm, posthog, deepsec. Ledger
gains per-PR rows: `intentOutcome`, `claimsSupported/contradicted/unobservable`,
`reviewerAction` (free text, filled by hand). The single metric: share of PRs
where the outcome was `supported` or `contradicted` **with** a non-empty
scoped delta — i.e. the record said something the diff+tests did not.

## 4. Non-goals (this slice)

Allowlists or security judgement; file-kind claims (records are network-only
today); attributing a destination to a dependency; proving absence in
unrecorded jobs; inferring intent without a declared claim; touching
`garnet-org/*`.

## 5. Implementation lanes

| lane | deliverable | files | verification | depends on |
|---|---|---|---|---|
| A — check core | `lib/intent.mjs` (pure: `parseClaim`, `evaluateClaims`, `aggregateIntent`), step filter in `profile-diff.mjs`, `intent` schema block, `intent-check-result` claim class, `replay intent` + `pair --steps --intent`, card section, `docs/examples.md`, tests incl. Sentry fixture (base fixture constructed, labelled) | `lib/intent.mjs`, `lib/profile-diff.mjs`, `lib/evidence.mjs`, `lib/card.mjs`, `schema/`, `bin/replay.mjs`, `test/intent.test.mjs`, `docs/contract.md` | `npm test`, `node bin/replay.mjs --help`, vocabulary test, rendered card read at desktop+phone | — |
| B — base record | `live --base same-path` two-commit sequencing on onboarded forks: touch generator by extension, guards (refuse unknown syntax / non-code-only PRs / already-open sequence), dry-run plan text, `docs/stage1.md` §1c | `lib/replay-pr.mjs`, `lib/guards.mjs`, `lib/commands.mjs`, `test/replay.test.mjs`, `docs/stage1.md` | `npm test`, `live sentry --pr 3 --dry-run` shows both commits | — |
| C — Sentry proof | run B on a fresh fork PR for #24708 (branch from `replay-base/hydrogen-recorded`, steps `Run E2E test`), then A with the three claims above; `replay verify`; card | fork `garnet-labs/sentry-javascript` only | expected `storefront-removed: supported` if base shows `mock.shop`, else `unobservable` — reported as found. Known limit: public reports carry the merge-ref SHA, so `verify` will fail on `public-head-mismatch` unless executed-source linkage exists (`pair --base-executed-sha/--head-executed-sha` from a recorder attestation); until the recorder attests the checkout SHA (a `garnet-org/action` change, outside this repo), the proof ships as a card marked `undeterminable / public-head-mismatch` on the identity leg while the intent block stands on the two profiles' own `run.commit_sha` pair | A + B merged |
| D — cohort | `find --claims`, ledger columns, first 10 candidates listed with the claim sentence quoted | `lib/find.mjs`, `lib/ledger.mjs`, `docs/ledger.md` | `npm test`, finder output labelled candidate evidence | A |

A and B touch disjoint core files; both add a flag to `bin/replay.mjs`/`lib/commands.mjs`
(trivial merge). C is the only lane that writes to a fork and spends CI
(two runs of one E2E job, ≈2×20 min).

## 6. Open decisions for the owner

1. Approve D1 (same-path touch as commit 1) as an accepted "specialized
   experiment" two-commit shape under AGENTS.md, or require a different
   base-record mechanism.
2. Approve lane C spending two CI runs on `garnet-labs/sentry-javascript`.
3. Whether `--propose` (one model call) is in v1 or deferred.
4. Whether to ask `garnet-org/action` for a checkout-SHA attestation so lane C
   (and every prospect-batch card) can pass the identity leg of `verify`.
