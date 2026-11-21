# PostHog bot queue shadow mirror — November 2026

Status: partial cohort, updated during the November 21 01:00–02:00Z window.
Three paired best-effort changed results are adopted from another Garnet
session after individual pair verification, as authorized at approximately
01:20Z. Five merged selections require reruns and two open selections are held
for fresh bases after harness PR 129. The original six first-only records
remain not-a-result. This is not a completed ten-replay benchmark.

Upstream reads are observational only. Numbers below refer to PostHog/posthog;
they are intentionally plain text, not links. All writes target garnet-labs.
Merge gate is not run: workflow disabled_manually; the operator has not enabled it.
The evaluated gate is the fork-owned `.github/merge-gate/gate.py` at `aee1db6`,
with StampHog policy in `.stamphog/policy.yml` and
`.stamphog/runtime-evidence.yml`; no replacement decision is inferred here.

## Selection (candidate evidence, not runtime evidence)

| Upstream PR | State at selection | Bot | Reason |
|---|---|---|---|
| 137300 | merged | posthog-js-upgrader | posthoganalytics 7.91.4; root and gateway Python manifests, lockfiles and pinned requirements reach recorded install paths. |
| 136476 | merged | posthog-js-upgrader | posthog-node 5.74.0; root and desktop pnpm lockfiles reach recorded Linux installs. |
| 136144 | merged | posthog-js-upgrader | posthog-js 1.450.0; workspace declaration and lockfiles change dependency resolution. |
| 136142 | merged | posthog-js-upgrader | posthog-js-lite 4.14.0; root pnpm lockfile and manifests change install inputs. |
| 135839 | merged | posthog-js-upgrader | @posthog/mcp 1.2.2; root pnpm lockfile reaches recorded install path. |
| 139025 | open | posthog-js-upgrader | posthog-node 6.0.5; root and desktop lockfiles; younger than three days, retained for current queue coverage. |
| 137397 | open | posthog-js-upgrader | posthog-js 1.453.0; workspace and desktop install inputs; younger than three days. |
| 136655 | open | posthog-js-upgrader | @posthog/mcp 1.6.0; root lockfile; open since November 16. |
| 131764 | open | scheduled-actions-posthog | Browserslist database lockfile update; open since November 9. |
| 125809 | open | renovate | Node 24.22.3; desktop node-version recording trigger; open since October 29. |

Finder dependency rows score 11: missing runtime record, install-time surface,
lockfile delta, manifest change, dependency-only diff. These are candidate
signals only, not proof installation succeeds or application compatibility.
No selected PR matches the ledger's prior replay upstream numbers (99349,
105613); none is a merge-queue batch. All five merged selections are within
60 days; widening to 120 days was not required.

## Results

The main table counts three adopted, individually verified paired results,
five merged selections needing reruns, and two held open selections. CLI
verification is not a complete-capture or runtime-pass conclusion. The adopted
rows are explicitly marked "opened by another Garnet session".
All ten merge-gate cells say **not run: workflow disabled_manually**. The state was
read through the CLI at 01:03Z on November 21 and independently by authenticated
REST at 01:12Z; no gate approval or refusal is inferred. Human
merge agreement is therefore **not evaluable** for the five merged selections;
for the five open selections, the gate has no current decision.

| Upstream PR | Outcome | Fork PR | App / capture | Dependency proof | StampHog | Merge gate | Verify / first reason | Auth |
|---|---|---|---|---|---|---|---|---|
| 137300 | merged; rerun after 129 | [270](https://github.com/garnet-labs/posthog/pull/270) | not-a-result: first-only; 6 jobs; best-effort | no exact-name check; install proof success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | FAIL: no pair line on the comment | OIDC |
| 136476 | merged; rerun after 129 | [271](https://github.com/garnet-labs/posthog/pull/271) | not-a-result: first-only; 6 jobs; best-effort | success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | FAIL: no pair line on the comment | OIDC |
| 136144 | merged; rerun after 129 | [272](https://github.com/garnet-labs/posthog/pull/272) | not-a-result: first-only; 6 jobs; best-effort | success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | FAIL: no pair line on the comment | OIDC |
| 136142 | merged; rerun after 129 | [273](https://github.com/garnet-labs/posthog/pull/273) | not-a-result: first-only; 6 jobs; best-effort | success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | FAIL: no pair line on the comment | OIDC |
| 135839 | merged; rerun after 129 | [274](https://github.com/garnet-labs/posthog/pull/274) | not-a-result: first-only; 6 jobs; best-effort | success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | FAIL: no pair line on the comment | OIDC |
| 139025 | open; adopted result | [278](https://github.com/garnet-labs/posthog/pull/278); opened by another Garnet session | finalized paired best-effort changed; 4/6 jobs changed; not complete | no exact-name check; install proof success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | PASS on own pair (CLI only) | executed auth unverified |
| 137397 | open; held for 129 (fresh base) | not created | not recorded | not run | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | not run | not executed |
| 136655 | open; adopted result | [277](https://github.com/garnet-labs/posthog/pull/277); opened by another Garnet session | finalized paired best-effort changed; 3/6 jobs changed; not complete | no exact-name check; install proof success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | PASS on own pair (CLI only) | executed auth unverified |
| 131764 | open; held for 129 (fresh base) | not created | not recorded | not run | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | not run | not executed |
| 125809 | open; adopted result | [279](https://github.com/garnet-labs/posthog/pull/279); opened by another Garnet session | finalized paired best-effort changed; 4/6 jobs changed; not complete | no exact-name check; install proof success | skipped: requires non-draft + stamphog label; pending fkj | not run: workflow disabled_manually | PASS on own pair (CLI only) | executed auth unverified |

Every row's merge-gate result is **not run: workflow disabled_manually**, not a harness
decision. StampHog has no sticky verdict on the observed heads. The fork's PR
Approval Agent workflow has no `workflow_dispatch`; its pull-request arm
requires a non-draft PR with the `stamphog` label, and its App-comment arm
requires that label already be present. The harness-created PRs are drafts
without that label. No synthetic reviewer or gate verdict is substituted.

### Exact evidence pairs

| Upstream PR / fork PR | Recorded replay head | Compared commit | Scope / transition |
|---|---|---|---|
| 137300 / 270 | `6c3fffccd24fd31590ce7436777cff1831480071` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; posthoganalytics → 7.91.4 (selection only) |
| 136476 / 271 | `9a8b59e0ccac07375ec0b54b530a546dddc66866` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; posthog-node → 5.74.0 (selection only) |
| 136144 / 272 | `886040c0f84c8e93bd64895841337ac11a29a95c` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; posthog-js → 1.450.0 (selection only) |
| 136142 / 273 | `8a74d84feb91372548df24cefdcc942da661703f` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; posthog-js-lite → 4.14.0 (selection only) |
| 135839 / 274 | `b48b33f4506b696be823b8850bec4a391b587622` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; @posthog/mcp → 1.2.2 (selection only) |
| 139025 / 278 | `e57299e4f23a0992ef8a0cd5d4e40218b8126001` | `a4060b9a92aaf2825ab25b2e90550f0032ac4bee` | `pr-base`; compared → head; best-effort changed |
| 136655 / 277 | `ca16296c4618227b9a71bf8aa834226f9224851e` | `9b47d27a09ed84e49defd9ce0943a8edd0f6ad39` | `pr-base`; compared → head; best-effort changed |
| 125809 / 279 | `631c6afb0f7173ae1024dc303156af60e84287d3` | `9445f46f4e83ed1400cc81b88165adb707d72f5c` | `pr-base`; compared → head; best-effort changed |

The two held selections have no recorded pair. The original six first-only
replays carried the recorder onto upstream-based dedicated base branches,
but the App reports no compared record for those original heads. Five bases
still have no branch recording; the late Node base recording below has not
produced a comparison on the closed PR. A planned
upstream base SHA is not a compared runtime record. The cards therefore report
**undeterminable (incomplete)**, not unchanged. Public merge-ref profiles for
269 and 270 passed the CLI's executed-source linkage check against their exact
PR heads; the merge-ref SHA is not substituted for either head above.

The successful `Garnet install proof` checks are not renamed to `Dependency
proof`: that separate exact-name check is successful on 271–274, not on 269 or 270 at
the snapshot. A successful check alone does not establish an attestation or a
StampHog approval. In the carried recorder, the attestation step requires an
`unchanged` comparison; `first` records cannot satisfy that condition.

### Sources and aggregate counts

| Fork PR | Finalized App comment | Recording run |
|---|---|---|
| 269 | [App record](https://github.com/garnet-labs/posthog/pull/269#issuecomment-7030247370) | 44672581895 |
| 270 | [App record](https://github.com/garnet-labs/posthog/pull/270#issuecomment-7030514701) | 44674834441 |
| 271 | [App record](https://github.com/garnet-labs/posthog/pull/271#issuecomment-7030728145) | 44676386550 |
| 272 | [App record](https://github.com/garnet-labs/posthog/pull/272#issuecomment-7031104706) | 44679055429 |
| 273 | [App record](https://github.com/garnet-labs/posthog/pull/273#issuecomment-7031321987) | 44680568368 |
| 274 | [App record](https://github.com/garnet-labs/posthog/pull/274#issuecomment-7031581573) | 44682435529 |

Counts reconcile to the ten selection rows after the approximately 01:20Z
adoption decision and one fresh verification of each adopted PR:

- Upstream: **5 merged + 5 open = 10**.
- Selection outcomes: **3 adopted paired best-effort changed results + 5
  merged selections needing reruns after 129 + 2 open selections held for 129
  (fresh bases) = 10**. All three results come from open upstream PRs; no
  merged-source selection has a usable comparison result.
- Capture: **3 paired best-effort + 5 first-only best-effort not-a-result + 2
  unrecorded = 10**; zero complete captures. Historical 269 is first-only,
  closed/unmerged and excluded in favor of adopted 279, not counted twice.
- CLI verify on the main rows: **3 PASS on their own pairs + 5 FAIL (missing
  pair) + 2 not run = 10**. PASS describes verification, not a runtime pass.
- Merge gate: **10 not run: workflow disabled_manually**; zero decisions.
- StampHog: **10 skipped: requires non-draft + stamphog label; pending fkj**;
  zero verdicts. The exact App-comment alternative is documented below.
- Exact-name Dependency proof: **4 success + 4 absent + 2 no fork PR = 10**.
  Success is a check conclusion, not proof that a reviewer lifted any file.
- Authentication: **5 OIDC recorder executions + 3 executed auth unverified
  (opened by another Garnet session) + 2 not executed = 10**.

The six historical attempts 269–274 remain **6 not-a-result, verify FAIL**.
They overlap five main-table rerun rows and the superseded Node attempt;
they are not six additional selections or results.

`replay verify` and `replay card` were run on the original six attempts. Every card
is undeterminable (incomplete). The failed 271 verification's transient HTTP
403 was retried after the budget reset and then failed on the missing pair.
Generated evidence is under `out/posthog/`, including cards, per-PR verification
logs, `shadow-manifest.json`, and `window01-rows/{rows.json,table.md,note.md}`.
The manifest has the required `fork`, `upstream`, `authorClass`, `chained` and
`classification` fields; `chained` is false. Host classifications remain empty:
without a comparison, none of these observed destinations is established as
introduced, and no attribution or infrastructure-equivalence claim is made.

The actual collection command was
`node bin/replay.mjs rows out/posthog/shadow-manifest.json --no-verify --out out/posthog/window01-rows`.
It collected **six**, not ten, rows. `--no-verify` avoids rerunning the separate
CLI checks; the generated table's verify cells say not run and do not supersede
the six historical FAIL results. The collector also renders first-record
job folds as changed while the App summary says `outcome: first`, `changed: 0`;
that generated display is not adopted as a behavioral-change conclusion here.
This earlier six-entry collection does not include adopted 277–279. The
all-ten collection is unfinished; 137397 and 131764 still have no fork PR.
Generated `out/` artifacts are not committed.

### Measured workload and limits (observed-runtime-behavior)

The carried recorder measures Linux dependency installation, not application
behavior or compatibility:

- Root pnpm workspace: `pnpm install --no-frozen-lockfile`.
- Root Python project: system XML libraries, then
  `UV_PROJECT_ENVIRONMENT=$pythonLocation uv sync --frozen --dev`.
- Desktop workspace (`products/desktop`): `pnpm install --no-frozen-lockfile`.
- LLM gateway (`services/llm-gateway`): `uv sync --frozen --dev`.
- Acceptance requirements: a virtual environment and
  `pip install -r common/ingestion/acceptance_tests/requirements.txt`.
- CLI requirements: a virtual environment and
  `pip install -r tools/infra-scripts/clitools/requirements.txt`.

Setup action traffic is also visible in these job records. Other product
workloads, mobile builds, application execution and compatibility are omitted.
Successful installs and destination counts are not evidence of equivalence,
attribution to a particular dependency, reviewer consumption, or merge safety.
The proof-only job is not instrumented; six recorded jobs out of seven workflow
jobs is the App's own coverage statement, not seven captured workloads.

### Authentication preflight

The canonical recorder template already uses OIDC. `repinActionRef` changes
only action refs, and `ground` manages reviewer guidance, so neither migrates
this existing recorder's authentication. The authorized minimal migration
was committed through the contents API (no third-party local checkout) as
`69cdbd967c1e966b0ab4c71f22726cb68bc07f21` on the fork's default branch.
Only `.github/workflows/garnet-ci.yml` changed: six recording jobs now grant
`contents: read` and `id-token: write`, and omit the `api_token` input.
No secrets, action pin, commands, proof logic or other workflow files changed.

Prepare run `44671526604` succeeded. Its plan names the updated default
snapshot above, includes `.github/workflows/garnet-ci.yml` among the carried
recorders, and creates `deps/node-24-base` with the fork recorder. That base
did not exist before execution, so there was no separate stale copy to edit.
Start run `44671871618` is the first OIDC execution check. All six recording
jobs logged `Using OIDC workflow token for control-plane requests` and recorded
successfully. The App finalized with `capture_quality: best-effort`, six jobs
and 26 destinations; it also states six of seven workflow jobs were recorded.
This proves the exercised authentication path, not a complete comparison.

Serial prepare/start pairs so far: 125809 `44671526604` / `44671871618`;
137300 `44673507757` / `44674217686`; 136476 `44675525335` / `44675841908`.
136144 `44678144884` / `44678510469`; 136142 `44679674225` / `44680024606`;
135839 `44681447953` / `44681796585`.
Each approved plan listed `.github/workflows/garnet-ci.yml` and the OIDC-migrated
default snapshot. Starts were dispatched only after checking shared workflow
idleness. An additional start attempt `44673862346` failed before execution
because the plan input was omitted; it produced no fork PR and was retried with
the explicit approved plan. No cancelled run is counted as a result.

The local `GARNET_LABS_GITHUB_PAT` rate-limit probe returned a core limit of
12500, remaining 10931, reset epoch 1795144784. Its `GET /user` request returned
`Resource not accessible by integration (HTTP 403)`, so its user identity
could not be compared with the hosted failure's user ID 3413596. The hosted
failure was `API rate limit exceeded for user ID 3413596 (HTTP 403)` at
2026-11-20 03:13:22 UTC. No identity equivalence is assumed.
Serial retry `44666348634` also failed with `RATE_LIMIT_LOW`: budget 0,
reset `2026-11-20T04:00:21.000Z`. Execution resumed after that shared reset.

Prepare `44676982796` for 136144 subsequently failed with
`GitHub REST budget is 0; at least 200 requests are required. Reset: 2026-11-20T05:00:27.000Z.`
At 04:53Z a direct authenticated Node fetch also returned HTTP 403 and
`API rate limit exceeded for user ID 3413596`, remaining 0, reset epoch
1795150826. The contemporaneous `gh api rate_limit` reported remaining 10804;
that apparent CLI budget did not describe the exhausted hosted/direct-fetch
path and was not used to bypass its admission guard.

The subsequently assigned PostHog API window is 05:00–06:00Z on November 20,
then 15:00–16:00Z (repeating every ten hours). No token calls or hosted starts
or polls were made between that instruction and the start of the 05:00Z
window. Work must stop polling at 06:00Z and report by approximately 06:05Z;
unfinished runs and budget failures roll into the next assigned window.

### Earlier window handoff (November 20)

At 05:46Z the idle guard blocked preparing 139025: another session's hosted
run **44682935810** was in progress (`posthog`, 125809,
`posthog-node24-1795153092-approved-start`, prepare 44682617273). It is not
counted as this cohort's result. No parallel start or cancellation was issued.
The six PR heads in this report were still finalized and bound at 05:47Z.
No recording remains pending among these six at that snapshot.

The following 15:00–16:00Z window was missed during a quota suspension. Work
resumed only inside the November 21 01:00–02:00Z window. The follow-up below
supersedes the earlier resume plan: a recorded tip alone is not sufficient
when the source base differs. No baseline repair, ready transition or label
change was authorized for this follow-up.

### Setup-only merge authorization

No replay PR was marked ready or merged. Setup status:

- Onboarding [265](https://github.com/garnet-labs/posthog/pull/265) was already
  merged on November 17 at 19:07:55Z, merge commit
  `9401cee91ec99680526a61e077d7db4135769e0f`. No new merge was needed.
- Recorder OIDC setup had no PR: the authorized minimal change was made by
  [direct commit](https://github.com/garnet-labs/posthog/commit/69cdbd967c1e966b0ab4c71f22726cb68bc07f21).
- No gate setup PR was created in this task. The existing gate reference is
  [aee1db6](https://github.com/garnet-labs/posthog/commit/aee1db69f6a10196dacd03f15721cf6e4df6b072).
  Merge authorization does not enable its disabled workflow; it remains disabled.
- The results/ledger branch is published as PR 127 in garnet-replay. This
  follow-up only updates its branch; it does not mark it ready or merge it.

## Upstream observations

Read via the upstream pull-request and review APIs on November 20, before
replaying. Open ages are measured at approximately 03:14Z; merged ages are
opening to merge. Approvers below are observed approval reviews, not claims
that the same approval is still standing after later commits.

| Upstream PR | Merge outcome | Hours open | Observed approver |
|---|---|---:|---|
| 137300 | merged | 26.3 | turnipdabeets |
| 136476 | merged | 0.7 | turnipdabeets |
| 136144 | merged | 24.7 | turnipdabeets |
| 136142 | merged | 25.7 | turnipdabeets |
| 135839 | merged | 38.6 | ioannisj |
| 139025 | open | 9.4 | none observed |
| 137397 | open | 56.6 | none observed |
| 136655 | open | 80.0 | none observed |
| 131764 | open | 255.2 | none observed |
| 125809 | open | 511.9 | Piccirello |

## Follow-up window — November 21, 01:00–02:00Z

### Run actor and ownership

Read-only lookup of hosted run `44682935810` returned
`triggering_actor.login: devin-ai-integration[bot]` (also its `actor.login`),
`status: completed`, `conclusion: failure`. The earlier cohort start
`44671871618` has the same triggering actor, so the bot identity does not
establish which session owned the later run. No cancellation, rerun, comment,
head update or other fork mutation was made to it or PR 269.

PR 269 is now observed closed, unmerged, at `2026-11-20T05:40:43Z`, with the
same head `e4bc5f9f6ea93acc54e94b56efb754c960d00de4`. The closure actor was not
investigated. No attempt was made to reopen or replace it.

### Missing-pair diagnosis (read-only)

The documented comparison contract is the last recorded runs on the PR's base
branch (`docs/state-2026-11-05.md`, scope `pr-base`). Recording the parent under
the same workflow is also required by `SKILL.md`; a source SHA without a
recording is not a baseline. The carried recorder runs six install jobs on PRs,
but its original `push.branches: [master]` excludes the dedicated replay bases.

This is reachable in the actual cohort, not just a possible code path:

| Fork PR | Base branch | Current push filter | Base recording observed |
|---|---|---|---|
| 269 | `deps/node-24-base` | master and this base (later update) | successful push run 44683741313, after closure and the App comment |
| 270 | `deps/cohort-137300-base` | master only | no runs returned for this branch and recorder |
| 271 | `deps/node-client-base` | master only | no runs returned for this branch and recorder |
| 272 | `deps/web-client-base` | master only | no runs returned for this branch and recorder |
| 273 | `deps/lite-client-base` | master only | no runs returned for this branch and recorder |
| 274 | `deps/mcp-client-base` | master only | no runs returned for this branch and recorder |

All six current App summaries explicitly say `status: finalized`,
`outcome: first`, `previous: null`, `scope: null`, `incomplete: 0` and
`capture_quality: best-effort`. The five master-only filters explain why
creating their base branches did not run this recorder. For 269, the original
carry commit `3c68b1be442f55dd8f8a19da1af480a4c1309fa6` also has the master-only
filter. Its App comment was last updated at `2026-11-20T04:41:59Z`; the later
base push was created at `05:50:56Z`, after both that update and PR closure.

As a check against the hypothesis that the Node base is still unrecorded, its
current tip **does** have an uploaded, commit-bound recording:

- Tip: `9445f46f4e83ed1400cc81b88165adb707d72f5c`.
- [Recording run 44683741313](https://github.com/garnet-labs/posthog/actions/runs/44683741313):
  completed, success; all six recorded install jobs succeeded.
- All six public profiles name repository `garnet-labs/posthog`, that exact
  commit, workflow `Garnet Runtime Visibility`, run `44683741313`, and their
  respective job IDs. Logs show successful sensor stop and emitted summaries.
  One exact [dependency-install profile](https://app.garnet.ai/public/runs/44683741313?profile=01a1f787-808b-7f1b-9d24-755e8b5de86a)
  identifies job `dep-install`; the other five identities are saved in
  `out/posthog/window01-base-records.json`.

Thus “no baseline exists now” is false for 269. The existing first record has
not become a paired record simply because a later base recording exists.
The App's backend selection implementation was not inspected; an end-to-end
repair or automatic rebinding is **unverified**. No baseline was moved or
recorded, no head was re-recorded, and no pair was synthesized in this window.

A future authorized repair must record each actual PR base under the same
workflow/jobs and then establish whether a fresh head recording is required.
The carried `garnet-ci.yml` has `workflow_dispatch` and checks out
`inputs.checkout_ref || github.event.pull_request.head.sha || github.sha`.
A dispatch on a base ref is a possible recording route without a branch move,
but was not used under this window's read-only diagnosis constraint.

### Before adoption: fresh-start compatibility and no starts

Harness PR 129 was read as open and `merged: false`. The successful read-only
[prepare 44848027478](https://github.com/garnet-labs/garnet-replay/actions/runs/44848027478)
for 139025 carries `.github/workflows/garnet-ci.yml` plus the other eligible
recorders, and explicitly requires `ensure-base` followed by a successful
exact-tip base-recording wait before publishing the one-commit replay.
The full plan was read; it requires source base
`884e0a38ce85ddbb153622dec767f469a6704c54`, not the recorded Node base tip.

Read-only GitHub comparisons show why reusing that tip cannot satisfy the
plans' exact source-base requirement:

| Upstream PR | Source base | Relative to recorded Node tip | Start |
|---|---|---|---|
| 139025 | `884e0a38ce85ddbb153622dec767f469a6704c54` | diverged; 2544 source commits ahead, 2 fork commits behind | not started; later adopted 278 |
| 137397 | `9564b5ef1436d1cb18e091aa3f9b5804f42fa6f7` | diverged; 2944 ahead, 2 behind | held |
| 136655 | `a83adca5008c154525d29aa306a6301b7f0cd338` | diverged; 2255 ahead, 2 behind | not started; later adopted 277 |
| 131764 | `8729d2006f774f96a694a65dcec2f660eb833e13` | source is 980 commits older; differences include non-carry files | held |

The first three comparisons have merge base
`fa45929896f476941aa1e2e3c0ec0174cb7447ec`, the original source parent of the
Node base. For 131764, non-carry differences include `.agents/architecture.md`
and `.agents/security.md`; it is not an identical tree with only recorder or
reviewer changes. The hosted executor refuses an unexpected base tree and
allows upgrades only for carry/reviewer-only differences. These plans need
fresh bases, not just reuse of an already recorded tip. Fresh starts were held
by the fresh/moved-baseline rule while 129 is unmerged; adoption later avoided
duplicate starts for 139025 and 136655. No replay start, baseline
push, baseline dispatch or new fork PR was issued. No new `RECORD_PENDING`,
budget failure or cancelled result is counted; prepare success is not a replay.

Operator caveat: the prepare's idle-count probe returned one in-progress run
but was not enforced as a blocking guard before dispatch. Only the read-only
prepare ran; no start followed, and no other session's run was cancelled.

### StampHog and merge gate

The exact `pr-approval-agent.yml` event and job conditions read from master are:

- `pull_request.types: [labeled, ready_for_review, synchronize]`. Its PR arm
  requires the head repository to equal this repository, `draft == false`,
  and either the newly applied label to be `stamphog`, or a non-`labeled` event
  on a PR already carrying that label.
- `issue_comment.types: [created, edited]`. Its comment arm requires a PR,
  author exactly `garnet-runtime-review[bot]`, body containing
  `garnet-runtime-review`, and an existing `stamphog` label. This arm has **no
  draft check**; a qualifying App update on a labelled draft can trigger it.
- No `workflow_dispatch` and no human comment-command arm exist.

All six PRs are drafts without `stamphog`; no sticky verdict exists on any.
With explicit approval, marking a labelled PR ready, or applying `stamphog`
to a non-draft PR, would satisfy the PR arm. A genuine App comment update on a
labelled PR satisfies the other arm. Neither a ready transition nor a label
was applied. There is no supported non-mutating trigger available to this
operator; no bot comment was impersonated and no secret was added.

The workflow API returns `merge-gate.yml` ID `367503888`,
`state: disabled_manually`, despite the reported enablement. An independent
authenticated REST read at 01:12Z returned HTTP 200 with the same state. It supports
`workflow_dispatch` with input `pr`, but was not dispatched or enabled while
disabled. There are no new MERGE/HOLD/AUDIT decisions to report; every table
cell says **not run: workflow disabled_manually** rather than an inferred decision.

### Refreshed outputs and next action

All six `replay verify` commands exited 1 with first failure
`pair line: no pair line on the comment`; 269 additionally fails
`pull request open: state closed`. All six `card` commands exited 0 and
reported `undeterminable (incomplete)`. The six-entry `rows --no-verify`
collection completed; its generated verify cells are not substituted for the
separate CLI results. No new fork PR was created in this window and the
all-ten collection is still incomplete. Existing other-session PRs were found
separately, as described below. `targets/posthog.json` was updated only by the
card commands.

### Adopted results opened by another Garnet session

A bounded read of the 15 most recently created fork PRs found three later
replays, none created by this session's recorded operations. At approximately
01:20Z, the user authorized counting each if its own pair passes verification;
one fresh verification was run per PR before adoption. No duplicates were started.
PRs 277 and 278 identify a separate shadow-mirror session in their bot banners;
their creation times are November 20 06:34Z and 06:40Z. PR 279 was created at
07:01Z and changes the same two Node-version files as the closed PR 269.
The exact hosted preparation/start provenance and executed auth path for these
three were not established. Adoption follows the explicit verification-based
decision; each main-table row says "opened by another Garnet session".

All three have finalized, head-bound App records with `outcome: changed`,
`capture_quality: best-effort`, six jobs and zero incomplete jobs. These are
scoped changed results, not complete captures or clean/pass runtime outcomes.
Each `replay verify` exited 0; its mechanical checks do not establish hosted
provenance, reviewer approval, or a merge-gate decision.

| Upstream selection | Observed fork PR | Compared commit | Head | Scope / transition | App result | CLI verification |
|---|---|---|---|---|---|---|
| 136655 | [277](https://github.com/garnet-labs/posthog/pull/277) | `9b47d27a09ed84e49defd9ce0943a8edd0f6ad39` | `ca16296c4618227b9a71bf8aa834226f9224851e` | `pr-base`; compared → head | best-effort changed; 3/6 jobs changed | exit 0 |
| 139025 | [278](https://github.com/garnet-labs/posthog/pull/278) | `a4060b9a92aaf2825ab25b2e90550f0032ac4bee` | `e57299e4f23a0992ef8a0cd5d4e40218b8126001` | `pr-base`; compared → head | best-effort changed; 4/6 jobs changed | exit 0 |
| 125809 (adopted instead of 269) | [279](https://github.com/garnet-labs/posthog/pull/279) | `9445f46f4e83ed1400cc81b88165adb707d72f5c` | `631c6afb0f7173ae1024dc303156af60e84287d3` | `pr-base`; compared → head | best-effort changed; 4/6 jobs changed | exit 0 |

All three are unlabelled drafts. No StampHog sticky verdict or merge-gate
comment was found. Their exact-name `Dependency proof` check is absent;
`Garnet install proof` and all six recorded jobs succeeded. No cards or rows
were collected for them; their verification logs and snapshots are saved as
`out/posthog/decision-pr-{277,278,279}-verify.txt` and
`out/posthog/window01-other-snapshots.json`.

The later Node PR is a concrete counterexample to a general inability to pair:
its App names the recorded tip `9445f46f...` as `previous`, with `scope: pr-base`,
on a later head. Thus the base recording can participate in a new comparison;
the old comment on 269 nevertheless remains first-only. This does not verify
automatic rebinding or a repair of 269–274.

Among the nine inspected exhibits, eight selected upstream changes have at
least one fork PR; 269 and 279 cover the same selection. A closed earlier
attempt, 276, was also listed but not inspected or counted as a new selection.
Only 137397 and 131764 have no matching PR in the bounded recent read. These
observational counts are distinct from this session's six hosted PRs and are
not an all-ten result.

Next: after PR 129 merges, rerun merged selections 137300, 136476, 136144,
136142 and 135839, and replay held open selections 137397 and 131764 with fresh
bases. Keep 269–274 as not-a-result historical attempts; do not duplicate the
three adopted results from open upstream PRs. Obtain explicit StampHog
activation approval and confirm the gate really is active before expecting
reviewer or gate decisions.
