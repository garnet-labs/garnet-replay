# PostHog bot queue shadow mirror — November 2026

Status: partial cohort, limited by the shared API budget and assigned window.
Six finalized records are head-only first records; none establishes a
before/after comparison. This is not a completed ten-replay benchmark.

Upstream reads are observational only. Numbers below refer to PostHog/posthog;
they are intentionally plain text, not links. All writes target garnet-labs.
Merge gate is pending: workflow disabled; the operator has not enabled it.
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

These are failed/not-yet-run exhibits, not shareable runtime comparisons.
All ten merge-gate cells remain **pending: workflow disabled**. The state was
read directly again at 05:47Z; no gate approval or refusal is inferred. Human
merge agreement is therefore **not evaluable** for the five merged selections;
for the five open selections, the gate has no current decision.

| Upstream PR | Outcome | Fork PR | App / capture | Dependency proof | StampHog | Merge gate | Verify / first reason | Auth |
|---|---|---|---|---|---|---|---|---|
| 137300 | merged | [270](https://github.com/garnet-labs/posthog/pull/270) | finalized first record; 6 jobs; best-effort | no exact-name check; install proof success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC |
| 136476 | merged | [271](https://github.com/garnet-labs/posthog/pull/271) | finalized first record; 6 jobs; best-effort | success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC |
| 136144 | merged | [272](https://github.com/garnet-labs/posthog/pull/272) | finalized first record; 6 jobs; best-effort | success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC |
| 136142 | merged | [273](https://github.com/garnet-labs/posthog/pull/273) | finalized first record; 6 jobs; best-effort | success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC |
| 135839 | merged | [274](https://github.com/garnet-labs/posthog/pull/274) | finalized first record; 6 jobs; best-effort | success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC |
| 139025 | open | not created | not recorded | not run | not run | pending: workflow disabled | not run | not executed |
| 137397 | open | not created | not recorded | not run | not run | pending: workflow disabled | not run | not executed |
| 136655 | open | not created | not recorded | not run | not run | pending: workflow disabled | not run | not executed |
| 131764 | open | not created | not recorded | not run | not run | pending: workflow disabled | not run | not executed |
| 125809 | open | [269](https://github.com/garnet-labs/posthog/pull/269) | finalized first record; 6 jobs; best-effort | no exact-name check; install proof success | did not run | pending: workflow disabled | FAIL: no pair line on the comment | OIDC (logs confirmed) |

Every row's merge-gate result is **pending: workflow disabled**, not a harness
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
| 125809 / 269 | `e4bc5f9f6ea93acc54e94b56efb754c960d00de4` | undeterminable (`previous: null`) | App scope null; planned pr-base-to-head; Node → 24.22.3 (selection only) |

For uncreated PRs, head, compared commit and runtime scope are all
unavailable; candidate version changes are not measured transitions. These
one-commit replays carry the recorder onto upstream-based dedicated base
branches, but the App has no recorded baseline for these comparisons. A planned
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

Counts reconcile to the ten selection rows, snapshot 05:47Z:

- Upstream: **5 merged + 5 open = 10**.
- Fork PRs: **6 created (5 merged-source + 1 open-source) + 4 uncreated = 10**.
- App: **6 finalized best-effort first records + 4 not recorded = 10**;
  zero complete captures and zero measured before/after comparisons.
- Verify: **0 PASS + 6 FAIL (missing pair) + 4 not run = 10**.
- Merge gate: **10 pending: workflow disabled**; zero agreement decisions.
- StampHog: **0 verdicts + 6 did not run + 4 no fork PR = 10**.
- Exact-name Dependency proof: **4 success + 2 absent + 4 no fork PR = 10**.
  Success is a check conclusion, not proof that a reviewer lifted any file.
- Authentication: **6 OIDC recorder executions + 4 not executed = 10**.

`replay verify` and `replay card` were run on all six created PRs. Every card
is undeterminable (incomplete). The failed 271 verification's transient HTTP
403 was retried after the budget reset and then failed on the missing pair.
Generated evidence is under `out/posthog/`, including cards, per-PR verification
logs for 271–274, `shadow-manifest.json`, and `shadow-rows/{rows.json,table.md,note.md}`.
The manifest has the required `fork`, `upstream`, `authorClass`, `chained` and
`classification` fields; `chained` is false. Host classifications remain empty:
without a comparison, none of these observed destinations is established as
introduced, and no attribution or infrastructure-equivalence claim is made.

The actual collection command was
`node bin/replay.mjs rows out/posthog/shadow-manifest.json --no-verify --out out/posthog/shadow-rows`.
It collected **six**, not ten, rows. `--no-verify` avoids rerunning the separate
CLI checks; the generated table's verify cells say not run and do not supersede
the six explicit FAIL results above. The collector also renders first-record
job folds as changed while the App summary says `outcome: first`, `changed: 0`;
that generated display is not adopted as a behavioral-change conclusion here.
The requested all-ten manifest collection is unfinished because four fork PRs
do not exist. Generated `out/` artifacts are not committed.

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

### Next window

At 05:46Z the idle guard blocked preparing 139025: another session's hosted
run **44682935810** was in progress (`posthog`, 125809,
`posthog-node24-1795153092-approved-start`, prepare 44682617273). It is not
counted as this cohort's result. No parallel start or cancellation was issued.
The six PR heads in this report were still finalized and bound at 05:47Z.
No recording remains pending among these six at that snapshot.

For the next assigned window (15:00–16:00Z), resume 139025, 137397, 136655 and
131764 with fresh serial prepares; inspect each complete plan before starting.
Coordinate ownership of the other 125809 run before touching 269. Establish
recorded baselines for any intended comparisons rather than relabelling these
head-only records; no base recording or two-commit repair was made here.
StampHog still needs a supported activation path if actual verdicts are wanted;
the existing workflow has no manual dispatch. Merge-gate enablement remains a
separate escalated decision. Do not mark the replay PRs ready or merge them.

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
- The results/ledger branch is pushed for the lead to open its PR. No PR is
  opened, marked ready, or merged here.

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
