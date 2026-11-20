# Infisical shadow queue — preparation only

Status: blocked on fork creation and App admission. No fork was created, no
fork PR was opened, and no hosted replay was dispatched in this handoff.
The ten requested replays remain unrecorded. This is candidate/preparation
evidence, not a runtime result or verified exhibit.

Branch: `devin/1795144182-infisical-target`.
Intended fork: `garnet-labs/infisical` (not yet accessible when checked).
The harness dry run stopped before planning:

```text
Fork garnet-labs/infisical is missing or inaccessible
GraphQL: Could not resolve to a Repository with the name 'garnet-labs/infisical'. (repository)
```

The target ledger was created through `replay find`, with the workload declared
as backend and frontend dependency install and paths limited to their package
manifests/lockfiles. The finder scanned 50 candidates; it did not record them.
Exact staged files, provenance, credential requirements, and installation
groups are in [the onboarding bundle](infisical-onboarding/README.md).

## Revised selection — nine candidates, one unresolved slot

The requested ten qualifying selections are **not complete**: no replacement
for 9694 was found that both belongs to the merged group and forward-applies
to frozen main. The other three substitutions below passed the unchanged
pure planner, without custom messages, exceptions, or guard changes.

| Slot / upstream PR | Group | One-line offline status |
|---|---|---|
| 9436 | merged | Retained; planner passes with `base_branch=baseline/9436`; frozen-main conflict avoided by explicit own-base replay. |
| 9730 | merged | Retained; planner passes with `base_branch=baseline/9730`; frozen-main conflict avoided by explicit own-base replay. |
| 9694 replacement | merged | **Unfilled**: original misses recorder filters; all ten screened merged dependency patches conflict with frozen main. |
| 9230 | merged | Retained; planner passes with `base_branch=baseline/9230`; frozen-main conflict avoided, but install does not exercise Go/BDD behavior. |
| 9157 ← 9293 | merged | Selected; dependency manifests/lockfiles in both packages, seven files; own-base planner passes despite frozen-main conflict. |
| 9158 | open | Retained Snyk change; frozen-main apply succeeds; own-base planner passes. |
| 8984 | open | Retained Snyk change; frozen-main conflict avoided with `base_branch=baseline/8984`; planner passes. |
| 9599 ← 8357 | open | Selected; adds `@date-fns/utc` with frontend manifest/lockfile changes; frozen-main apply and own-base planner pass. |
| 9406 | open | Retained; frozen-main apply and own-base planner pass; recorder still fixes Node 26. |
| 9598 ← 8740 | open | Selected; adds `jsdom` and `@types/jsdom` with frontend manifest/lockfile changes; frozen-main apply and own-base planner pass. |

The replacements are dependency-bearing changes, not dependency-only changes:
9599 also changes date formatting and 9598 changes sharing-list pagination.
The measured install cannot validate those application changes. A search for
open PRs with Snyk in the title found exactly 8984 and 9158, already selected;
the `author:snyk-bot` search found zero, so no additional Snyk alternative was
available from those searches. This is not a claim to exhaust all bot aliases.

### Exact default-wording refusals

- **9293:** its generated full file list contains `tests/harness/infisical/infisical.go`, whose case-insensitive `infisical/infisical` substring trips the upstream owner/repo-reference guard.
- **8357:** its generated full file list contains `backend/src/db/schemas/certificate-cleanup-configs.ts`; vocabulary matching is substring-based, so `cleanup` trips the banned term `clean`.
- **8740:** its generated full file list contains the same `tests/harness/infisical/infisical.go` path, tripping the same upstream-reference guard.

The library accepts explicit message overrides, which are not themselves a
guard bypass, but the current hosted workflow/worker exposes no message/body
inputs. Thus these three cannot pass the present hosted interface's default
wording. They were replaced, not silently sanitized through a different path.

### What the hosted workflow actually bases on

It does **not automatically choose the PR's own base**. The workflow's
`base_branch` input defaults to empty (`.github/workflows/replay.yml:28`), and
`bin/replay-job.mjs` passes it through to
`lib/replay-runner-worker.mjs:74` as `--base-branch` only when nonempty.
With an explicit fresh `baseline/<number>` branch, `livePr`
(`lib/commands.mjs:430-442`) selects `planPureReplay` on an onboarded fork
whose upstream base has no recorder. `planPureReplay`
(`lib/replay-pr.mjs:958-967`) emits `ensure-base` from the exact upstream
`baseSha`, carrying the recorder from trusted fork main. Approved reviewer
guidance is carried separately by `carryReviewerGuidance`.
`executePlan` (`lib/replay-pr.mjs:2440-2482`) checks out that base SHA, stages
the carried paths, and creates the fork-only baseline; it refuses an existing
branch with an unexpected tree instead of overwriting it. The PR then has
one change commit against that baseline. Both prepare and start must preserve
the same base selection and fingerprint.

Accordingly, the frozen-main conflicts for **9436, 9730, 9230, 9157 and 8984**
are **not patch failures on this explicitly configured route**: the planner
does not apply a patch to frozen main. It copies the touched head files and
removes deleted paths on top of the PR's own base. The excluded **9293, 8357
and 8740** would likewise avoid the frozen-main patch conflict, but still fail
the wording guards. With an empty input, the default route uses fork main;
`forkHoldsBase` selects pure versus two-commit behavior, and divergent touched
paths can yield a two-commit reconstruction rather than an automatic historical
base. That is not the requested one-commit replay mode. A textual patch
conflict alone proves neither that this default route fails nor that it
faithfully reproduces the original environment.

This reachability analysis assumes the future fork has the staged recorder,
approved grounding, and healthy finalized records, and that upstream historical
bases have no existing eligible recorder. Those live admission facts have not
been checked. No install success or runtime verification is inferred.

There is an additional recording boundary: the staged recorder's push filter
is `branches: [main]`. Creating `baseline/<number>` does not itself schedule
a recording on that branch. The own-base plans solve source-base selection,
not baseline evidence availability. An exact historical baseline capture must
be arranged and verified before expecting a compared execution-profile pair;
no App fallback behavior was checked or assumed here. The reported planner
passes are therefore not claims that hosted runtime verification would pass.

### Remaining merged-slot constraint

Screened merged dependency candidates **9157, 9022, 8914, 8922, 8790, 9091,
7913, 7898, 7957 and 6671** all returned exit 1 from a forward
`git apply --check` against frozen main. Public GitHub `.diff` downloads were
used for this additional screen; new selected rows record this method and a
SHA-256 of their downloaded diff. Original rows retain the local git-diff
method. The screened list is not an exhaustive proof that no suitable merged
PR exists. No zero-byte/invalid-input result was accepted as a patch check.

**Decision needed:** permit a historical own-base merged dependency candidate
for the remaining slot, or provide/continue searching for a merged candidate
that forward-applies to frozen main. Until then the cohort remains nine
selected candidates, not a completed final ten.

`plans.json` now contains all nine explicit own-base plans and hosted input
values, with 9694 retained only as an unfilled slot. `preflight.json` preserves
excluded original rows and the three replacement rows. No PAT was used and
no workflow was dispatched. The earlier harness suite remains applicable
because no harness source changed; new offline plan/selection checks are
reported in the handoff.

Follow-up checks: nine own-base plans and three same-group replacements passed
offline assertions; both open replacements passed frozen-main patch checks;
the unresolved slot remains explicitly excluded. The relevant existing suites
(`pure-replay`, `replay-preflight`, `replay-interface`) reported **102 passed,
0 failed**. `git diff --check` produced no output for this follow-up diff.

## Original requested cohort preflight (historical)

Frozen source main: `f248a380c9032f888296930879d1075d80f12bbf`.
Upstream base→head pairs below are not fork execution-profile pairs.
Full SHAs and all file lists are in
[preflight.json](infisical-onboarding/preflight.json).

| Upstream PR | Group | Upstream base → head | Files | Patch applies to frozen main | Recorder trigger | Pure-plan limitation |
|---|---|---|---:|---|---|---|
| 9436 | merged | `1d92ce1` → `132c54f` | 7 | No | Yes, frontend | Based on design/v4-controls-polish, not main |
| 9730 | merged | `7e5e7f2` → `28516c0` | 2 | No | Yes, frontend | Based on design/v4-controls-polish, not main |
| 9694 | merged | `1659bfa` → `247fedb` | 8 | Yes | **No** | Refused: changed files are outside recorder filters; visual workload omitted |
| 9230 | merged | `23856d0` → `83ee124` | 117 | No | Yes, backend | Install covers dependency slice only; does not run Go blackbox suite |
| 9293 | merged | `7a1be34` → `fa86c9b` | 416 | No | Yes, backend | Default generated body refused by upstream-reference guard in a file path |
| 9158 | open | `d194bbf` → `8cf1d3d` | 2 | Yes | Yes, backend | No offline pure-planner refusal |
| 8984 | open | `f7aefd6` → `5ec20d6` | 2 | No | Yes, backend | No offline pure-planner refusal; dependency state diverged |
| 8357 | open | `4a46bee` → `8f70444` | 728 | No | Yes, backend | Default body refused: banned vocabulary in a file path |
| 9406 | open | `b99a249` → `b26657a` | 11 | Yes | Yes, both | No offline pure-planner refusal; recorder's Node version stays fixed |
| 8740 | open | `7ece05e` → `b57bf44` | 27 | No | Yes, backend | Default generated body refused by upstream-reference guard in a file path |

Patch checks used local `git diff --binary <base> <head> -- <PR paths>` piped
into `git apply --check` and reverse-check against the frozen source checkout.
No reverse check succeeded. These diagnostics are not harness admission:
`planPureReplay` copies selected head files rather than applying a textual
patch, so a patch conflict does not prove it cannot replay. Conversely,
copying older entire manifests can restore unrelated changes and does not
prove source/application equivalence. Actual fork-base ancestry, approved
guidance, recorder health, hosted fingerprint, install success, and exact
execution-profile pairing remain unverified.

The preliminary API diff attempt hit HTTP 406 for 9293 (more than 300 files).
The local git checks above avoid that API diff-size limit. Full file listing
was paginated. No upstream dependency installation or application code ran
on this machine.

At the initial handoff no substitutions had been chosen or published. Select a merged replacement
for 9694 that changes backend/frontend dependency files. The default wording
refusals for 9293, 8357 and 8740 also need a supported routine-wording plan or
same-group replacement; no guard was bypassed. Seven hypothetical plans
initially formed before the recorder filter was narrowed; 9694 is now marked
refused in the saved plan summary, leaving six unrefused hypothetical plans.

## Original requested cohort runtime result table (all still unrecorded)

| Upstream PR | Fork PR | Fork head / compared pair | App result / new destinations | Capture | Verify / first failing leg | StampHog / cited record |
|---|---|---|---|---|---|---|
| 9436 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 9730 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 9694 | Not created | Not recorded | Undeterminable | Not recorded | Not run; trigger excludes change | Not run |
| 9230 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 9293 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 9158 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 8984 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 8357 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 9406 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |
| 8740 | Not created | Not recorded | Undeterminable | Not recorded | Not run; fork unavailable | Not run |

No `verify` PASS/FAIL or card is invented for nonexistent PRs. A failed,
partial or best-effort capture must not be reported as pass in this study,
even if a lower-level harness leg admits a scoped best-effort record.

## Offline verification

- Harness: `npm test`: 505 passed, 0 failed; CLI help loaded.
- Staged relay/publisher checks: 7 tests, OK (complete, best-effort, stale,
  missing, malformed, changed scope, and sticky head/verdict compatibility).
- Pinned kit bytes, action pin, and recorder filters checked against all ten
  file lists: PASS.
- The initial vendored engine suite found a policy-fixture mismatch after
  removal of PostHog connector exemptions; those inert source exemptions
  were retained instead. Final engine result: `38 passed in 3.29s`.
- `git diff --cached --check` reports three trailing-space-only lines in
  vendored Markdown fixtures (`garnet_comment_pr112.md`, `pr130.md`, `pr139.md`);
  source fixture contents were preserved rather than reformatted.

This report and future fork comments are visually unverified. No GitHub
Markdown desktop/phone review has been performed and no PR is being shown as
a finished exhibit. No harness PR was created, marked ready, or merged.

## Next boundary

After fkj creates the fork, verify App coverage and project linkage before
recording; then merge onboarding separately and inspect the initial finalized
baseline. Hosted prepare/start must be coordinated by the lead because its
concurrency group is shared. This handoff deliberately dispatches none.
The PAT is not used after the shared rate-limit notice; no attempts to obtain
new credentials or bypass organization installation controls were made.
