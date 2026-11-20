# Infisical shadow queue

## 09:00Z window — current execution

Results branch: `devin/1795165388-infisical-results`, created from merged
harness main `18c637f`. New hosted dispatches use ref `main`. All hosted
replay and PAT calls stop by **09:55Z**. Prior sections below are retained
as historical observations, not current execution status.

The original 9436 start `44677319496` was a budget-blocked attempt, not a
replay result or harness/plan failure. Its failed log above cleanup states:

```text
[RATE_LIMIT_LOW] GitHub REST budget is 0; at least 200 requests are required. Reset: 2026-11-20T05:00:27.000Z.
```

Its downloaded `replay-job/job.json` corroborates `state: blocked`,
`reason: RATE_LIMIT_LOW`, and an empty `lines` array. No guard was bypassed
and no code fix was needed. Fresh prepare `44707458702` was dispatched from
`main` at 09:03:22Z, after queued/in-progress replay lists were both empty.

Fresh prepare succeeded. Start `44707652477` was dispatched at 09:04:46Z
with `plan=44707458702`, again after an idle queue observation. Its baseline
push recorder `44707971409` succeeded at exact baseline tip
`4abdbd5197abf2474b01e3ef7d68c03c48a2ed08`; both npm installs and sensor
post-processing succeeded. The uploaded public profile
`01a1f837-f0d8-7da5-a344-59879e12195d` matches repository, run, profile and
exact commit using `baseProfileMatches` (true). An uploaded profile alone
is not an App comparison or complete-capture claim.

At 09:18Z a one-poll read-only invocation of `waitForBaseRecord` returned
`state: recorded`, naming that exact baseline profile. Direct PAT reads also
confirmed baseline job logs are readable (HTTP 200), but the hosted start
remained in progress and no replay PR was visible. The hosted wait's reason
is not yet known; a token permission failure or invalid baseline profile
must not be inferred from a long-running job alone.

| Source selection | Fork replay PR | Head | Baseline | App / new destinations | Capture | Compared == baseline | Verify / first failing leg | StampHog / record cited | Hosted prepare / start |
|---|---|---|---|---|---|---|---|---|---|
| 9436 | Not yet published | — | `4abdbd5` | Pending | Undeterminable | Pending | Not run | Not dispatched | `44707458702` / `44707652477` in progress |
| 9730 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9022 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9230 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9157 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9158 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 8984 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9599 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9406 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |
| 9598 | Not dispatched | — | — | — | — | — | Not run | Not dispatched | — |

## Live execution — 2026-11-20

**Paused at 04:54Z by the revised schedule.** Infisical may use the hosted
replay workflow and `GARNET_LABS_GITHUB_PAT` only during 09:00–10:00Z on
November 20 UTC, then successive one-hour windows every ten hours
(19:00–20:00Z November 20, 05:00–06:00Z November 21, and so on).
No further dispatch, run watch, or PAT call was made after the stop notice.
An accepted start is left alone, not cancelled. A run that failed on budget
must be rerun in a permitted window, never counted as a completed result.

The fork now exists on `main`. Recorder/reviewer onboarding merged through
[fork PR 2](https://github.com/garnet-labs/infisical/pull/2), merge
`291aed42e2616d1f4c4620a4029d0f3685f048c3`; deterministic review checks merged
through [fork PR 3](https://github.com/garnet-labs/infisical/pull/3), merge
`e884ecb0e8b765aa0e5a7356453470084bea01fb`. Both PRs contained one commit.
No custom secret was added; the recorder uses OIDC.

The recorder's [main push run](https://github.com/garnet-labs/infisical/actions/runs/44671660541)
succeeded at exact SHA `291aed42e2616d1f4c4620a4029d0f3685f048c3`.
Public profile `01a1f720-d7eb-7e88-9638-3d23017e7a89` and MCP agree on that
run/repository/SHA. The App finalized a best-effort first-record comment on
PR 2's head `e607d222076b6edf9c446a6951ede6237dd8b24f`, with `previous: null`
and no incomplete jobs. No separate main-commit comment was found. The
gate-only merge did not match recorder path filters. Neither onboarding PR
is a passing replay exhibit: verification rejects PR 2's missing pair and
closed state; PR 3 has no runtime record and is closed.

Serial execution is requested in the table order below, using hosted
`replay` from `devin/1795144182-infisical-target` and each historical
`baseline/<number>`. Before each prepare/start, queued and in-progress
replay runs must be absent. The initial queue observation at approximately
04:10Z found PostHog start run `44671871618` in progress. Recent start inputs
(as rendered in workflow run names) showed PostHog and n8n, but not Langfuse
or Supabase. The first-start priority grace period ends at 04:40Z; that does
not waive the empty-queue requirement. Cancelled runs are not results.

| Upstream PR | Hosted status | Fork PR URL | Head sha7 | Baseline sha7 | App result / new destinations | Capture quality | Compared == baseline | Verify / first failing leg | StampHog / cited record |
|---|---|---|---|---|---|---|---|---|---|
| 9436 | Prepare succeeded; start accepted, last known queued; paused | None found at 04:54:31Z | — | — | Not observed | Unknown | Not checked | Not run | Not run |
| 9730 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9022 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9230 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9157 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9158 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 8984 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9599 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9406 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |
| 9598 | Paused; neither prepare nor start dispatched | Not created by this execution | — | — | Not recorded | Not recorded | Not checked | Not run | Not run |

Hosted [prepare 44673479321](https://github.com/garnet-labs/garnet-replay/actions/runs/44673479321)
for 9436 succeeded after the queue was checked empty at 04:18:03Z. Its
artifact declares `state: prepared`, `baseBranch: baseline/9436`, and
signature `feffca67de5d623e6253d9185997ed0fd7cfcc1355a32692111c286f389229aa`.
Fork main was `e884ecb0e8b765aa0e5a7356453470084bea01fb`; the historical
base is `1d92ce124c207f0fe13885220e502361b333ad35`.

The first-start priority check was repeated at 04:52:52Z, after the
30-minute grace period. Recent inputs showed non-cancelled PostHog and n8n
starts; Langfuse and Supabase still had none in the preceding hour. Queued
and in-progress replay lists were both empty immediately before dispatch.
[Start 44677319496](https://github.com/garnet-labs/garnet-replay/actions/runs/44677319496)
was accepted at 04:52:52Z, using prepare `44673479321`, the required harness
ref, `base_branch=baseline/9436`, and `two_commit=false`. Its last observed
status was `queued`. The attempted watcher exited with the following
connection error; this is not a workflow conclusion:

```text
error connecting to api.github.com
check your internet connection or https://githubstatus.com
```

The schedule stop arrived during connection-error backoff. No further
hosted run status was fetched and no cancellation was attempted. Treat
`44677319496` as potentially in flight until it is inspected in the next
permitted window. A default-token fork PR listing at 04:54:31Z contained
only onboarding PRs 2/3 and an independent dependency-update PR 1: no replay
PR was visible. No baseline profile, head record, comparison, StampHog
verdict, verification or card is claimed for this start. Inspect and, if
budget-failed/cancelled, rerun this first replay before proceeding to 9730.

Best-effort remains explicitly scoped; no partial, failed, stale or unbound
record is a pass. Baseline equality is checked independently of the harness.

## Historical preparation (superseded status)

The following sections preserve the offline preparation and its then-current
blockers. They are not the current fork/onboarding or runtime execution state.

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

## Final selection — ten historical own-base candidates

The historical own-base requirement is now approved for every replay;
forward-applying to frozen main is no longer required. Merged dependency PR
9022 fills the 9694 slot: four changed files including backend manifest and
lockfile, smaller than the other broad merged dependency updates screened.
All ten pass the offline own-base planner without custom messages, exceptions,
or guard changes. This is not a hosted prepare receipt or runtime verification.

Final follow-up validation: ten-plan/group/trigger/wording assertions passed;
YAML checks accepted main and nested baseline branches, rejected unrelated
branches, and retained path filters/OIDC. The focused App-pair probe accepted
a mismatched previous SHA and rejected missing pairs/stale heads, establishing
the verifier limitation below. Existing ladder, pure-replay and replay-preflight
suites reported **179 passed, 0 failed**. `git diff --check` was silent.

| Slot / upstream PR | Group | One-line offline status |
|---|---|---|
| 9436 | merged | Retained; planner passes with `base_branch=baseline/9436`; frozen-main conflict avoided by explicit own-base replay. |
| 9730 | merged | Retained; planner passes with `base_branch=baseline/9730`; frozen-main conflict avoided by explicit own-base replay. |
| 9022 ← 9694 | merged | Selected; four files including backend manifest/lockfile; planner passes with `base_branch=baseline/9022`; frozen-main conflict no longer blocks selection. |
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

The staged recorder now has push branches `[main, 'baseline/**']`, retaining
the package-file and recorder-file path filters. The newly carried recorder
file on a fresh fork-only baseline reaches those filters. Baseline pushes
therefore schedule their own dependency-install captures. Existing branches
with unexpected trees remain refused rather than overwritten. No run has
actually been dispatched or captured here.

### Verification contract: head binding is not baseline binding

`replay verify` does **not** enforce that an App record compares against the
fork baseline tip. In `evaluateExhibit` (`lib/verify.mjs:145-150`), base
supersession is checked only for a synthetic `garnet:replay` marker with
`scope=pr-base-to-head`. For ordinary App comments,
`lib/verify.mjs:188-203` accepts a valid `summary.previous` SHA and requires
`summary.commit`/the commit marker to match the current PR head; it does not
compare `summary.previous` to `pr.base.sha`. `verifyExhibit` authenticates
the linked current-head profiles, not a separately fetched baseline profile.
The existing ladder test explicitly passes an App pair whose previous SHA
differs from the PR base; a focused offline probe reproduces that limitation.
No verifier behavior was changed in this documentation/onboarding step.

For this cohort require, in addition to `replay verify`: (1) capture the actual
fork baseline tip SHA after recorder/guidance carry, (2) wait for its successful,
finalized exact-SHA push profile, (3) require the finalized head record's
compared SHA to equal that tip, and (4) retain both run/profile identities and
capture status. The expected compared commit is the **fork baseline tip**,
not the raw upstream base SHA, because onboarding carry creates a new commit.
The planner does not pause between baseline push and PR publication; the new
trigger alone does not prove baseline finalization precedes head comparison.
App baseline selection/fallback and race handling have not been exercised.
If the actual compared SHA differs, do not accept the intended pair merely
because `replay verify` passes. Report the mismatch instead.

### Resolved merged-slot constraint (screening history)

Screened merged dependency candidates **9157, 9022, 8914, 8922, 8790, 9091,
7913, 7898, 7957 and 6671** all returned exit 1 from a forward
`git apply --check` against frozen main. Public GitHub `.diff` downloads were
used for this additional screen; new selected rows record this method and a
SHA-256 of their downloaded diff. Original rows retain the local git-diff
method. The screened list is not an exhaustive proof that no suitable merged
PR exists. No zero-byte/invalid-input result was accepted as a patch check.

The historical own-base decision resolves this constraint: 9022 is selected
without claiming it forward-applies to frozen main.

`plans.json` now contains all ten explicit own-base plans and hosted input
values. `preflight.json` preserves excluded original rows and all four
replacement rows. No PAT was used and
no workflow was dispatched. The earlier harness suite remains applicable
because no harness source changed; new offline plan/selection checks are
reported in the handoff.

Prior follow-up checks: nine own-base plans and three same-group replacements passed
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

## Historical original-cohort placeholder table

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

## Historical pre-onboarding boundary

After fkj creates the fork, verify App coverage and project linkage before
recording; then merge onboarding separately and inspect the initial finalized
baseline. Hosted prepare/start must be coordinated by the lead because its
concurrency group is shared. This handoff deliberately dispatches none.
The PAT is not used after the shared rate-limit notice; no attempts to obtain
new credentials or bypass organization installation controls were made.
