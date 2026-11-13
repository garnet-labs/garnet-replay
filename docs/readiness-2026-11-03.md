# December outreach readiness — 2026-11-03

Probed 2026-11-03 15:00–17:00 UTC. Harness: garnet-replay `a9a1f4e` (main). Read-only on garnet-org: every garnet-org fact below comes from the GitHub API, a public URL or a workflow artifact. The only writes are job re-runs on the three first-wave forks (section 3) and this file.

**Verdict: NO-GO. Outreach stays gated.** No first-wave exhibit passes `replay verify`. Two legs, capture completeness and comment finalized, cannot pass on any App record today, because the control plane never declares a capture complete. The stated gate is also unmet: action #192 was closed unmerged and folded into the still-open action #198, and control-plane #745 is a draft with changes requested.

pnpm is the exception. It is the one ask that does not depend on verify: the App is live on pnpm/pnpm and posting there, and profile delivery is 343/343. It is held back only by item 6 (ATTENTION on the public profile). Item 10's egress-baseline framing was decided on 2026-11-13.

## (a) Status per surface

| surface | status | why (evidence in the numbered sections) |
| --- | --- | --- |
| garnet-org/action | yellow | v2.4.1 (`96e9f81`) is released and carries #181 and #195. #192 is not merged; its change is inside the still-open #198. (§1) |
| garnet-org/control-plane | yellow | Renderer v1.42.0 is deployed to prod and pnpm comments use contract 10.0.0. #745 is a draft with changes requested. `capture_quality` is never `complete`. (§1, §2) |
| Replay exhibits (OpenHands, dspy, skyvern) | red | All three FAIL verify. Every row fails capture completeness and public profile identity, plus comment finalized under contract 10.0.0. OpenHands' check settled passes after today's re-run. (§2, §3) |
| Cold read of the exhibits | yellow | The renderer fixed the infra headline. Candidate choice (dspy), fork hygiene (skyvern ✗, OpenHands bot comment and dependabot fold) and one confusing control-plane line remain. (§3) |
| Production tenant health | green (pnpm) / yellow (new tenant) | pnpm/pnpm: 343 profiles in 7 days, 343/343 agents delivered, no flags. A new external tenant has a COVERAGE flag. (§4) |
| pnpm outreach | yellow | The App comments on pnpm/pnpm PRs today. `no_bad_egress_domain` is still ATTENTION in the public profile. (§5) |
| garnet-documentation | red | The live quickstart pins `garnet-org/action@245ad6be` (v2.3.0), but garnet.ai/pins says v2.4.1. The pin-sync workflow fails on main. (§6) |
| garnet-website-2026 | yellow | Live, and `/pins` is correct. The final-comment exhibit PRs #182–#184 are open, so the live site predates the comment lock. #141 is irrelevant (a "do not merge" demo-selector draft). (§6) |
| garnet-ui | yellow | Public report and onboarding PRs (#311, #323, #324, #329) are open. The public report still carries the assertion. (§6) |
| garnet-org/jibril | green (no outreach blocker) | Stable v2.11.0. `no_bad_egress_domain` is a Jibril assertion; its calibration is item 6. |
| App / Marketplace | green | github.com/apps/garnet-runtime-review and the Marketplace listing both return 200. The App posts on pnpm/pnpm. |

## (b) Remaining delta, ordered by dependency

"Owner" means who acts next. A garnet-org owner is a proposal until they accept.

| # | item | repo · reference | owner | unblocks |
| --- | --- | --- | --- | --- |
| 1 | Review and merge #198 (it carries #192's titled delivery-failure annotations), then tag v2.4.2. | garnet-org/action · [#198](https://github.com/garnet-org/action/pull/198) | Nicolás review → Farrukh merge/tag | stated gate, half 1 |
| 2 | Address the changes requested on #745 (explicit profile-rejection reasons), merge it and deploy. | garnet-org/control-plane · [#745](https://github.com/garnet-org/control-plane/pull/745) | Nicolás + author | stated gate, half 2 |
| 3 | Define "complete capture" and emit `capture_quality: "complete"` when it holds. Today `captureDeclarationFor` returns only `best-effort` or `partial`. Proposed rule: every Garnet job in the run recorded, the sensor started, and the profile accepted. | garnet-org/control-plane · `githubapp/render/comment.go` (`captureDeclarationFor`), related [#657](https://github.com/garnet-org/control-plane/pull/657) | Farrukh (decision) → Nicolás | the verify "capture completeness" leg on every exhibit; any "No runtime changes" sentence |
| 4 | Rebase and merge the executed-source linkage in the identity leg. All three first-wave merge commits have the head as second parent and the same tree as the head (table in §2), so this alone turns the leg ok. | garnet-labs/garnet-replay · [#62](https://github.com/garnet-labs/garnet-replay/pull/62) (draft, `dirty`) | Devin (harness) | verify "public profile identity" on all forks |
| 5 | Repin docs to v2.4.1. Then either let the sync bot open PRs (repo setting "Allow GitHub Actions to create and approve pull requests") or drop `create-pull-request` from the workflow. | garnet-org/garnet-documentation · `quickstart.mdx`, `security.mdx`, `release.json`; `.github/workflows/sync-action-pin.yml` ([failed run 2026-11-02](https://github.com/garnet-org/garnet-documentation/actions/workflows/sync-action-pin.yml)) | Farrukh (setting, merge) | the first page an outreach recipient copies from |
| 6 | Calibrate `no_bad_egress_domain` so pnpm's docs-only control does not read ATTENTION, or take assertions out of the public projection. | garnet-org/jibril (assertion) or garnet-org/garnet-ui · [#311](https://github.com/garnet-org/garnet-ui/pull/311) | Farrukh picks the path → jibril owner or Nicolás | pnpm ask; every public profile link |
| 7 | Land docs comment-lock alignment. | garnet-org/garnet-documentation · [#102](https://github.com/garnet-org/garnet-documentation/pull/102) (draft, base main; supersedes #100/#101) | Farrukh | docs match the live comment |
| 8 | Land the website exhibits on the final comment. | garnet-org/garnet-website-2026 · [#184](https://github.com/garnet-org/garnet-website-2026/pull/184) / [#183](https://github.com/garnet-org/garnet-website-2026/pull/183) / [#182](https://github.com/garnet-org/garnet-website-2026/pull/182) | Farrukh | site matches the live comment |
| 9 | Land the public report and onboarding. | garnet-org/garnet-ui · [#324](https://github.com/garnet-org/garnet-ui/pull/324), [#323](https://github.com/garnet-org/garnet-ui/pull/323), [#329](https://github.com/garnet-org/garnet-ui/pull/329) (base dev) | Nicolás → Farrukh promote dev→main | first-viewer report and install path |
| 10 | Decided 2026-11-13: use the egress baseline supportable today, per "What the profiles show today"; the send claims nothing under "What is not shown". No per-PR behavior-change claim; waiting for items 3 and 4 was not chosen. | garnet-labs/garnet-replay · `docs/pnpm-proof.md` "Before sending" #2 | Farrukh (decided) | pnpm send |
| 11 | After 1, 3 and 4: repin the forks to the release that carries #198 (v2.4.2 per item 1; `replay repin`), re-record them, run verify and redo the cold read. Retire or re-run the hero's `garnet/runtime-evidence` status, which has been pending since 2026-09-10 ([reference#31](https://github.com/garnet-labs/garnet-runtime-review-reference/pull/31)). | garnet-labs forks · this harness | Devin (harness) | first-wave sends |
| 12 | Fork hygiene on the first-wave forks: drop or secret `claude-review` on skyvern; stop the `.pr/` notice bot and keep `garnet-dependabot-record.yml` out of replay heads on OpenHands; re-pick dspy with a candidate the recorded job installs. | garnet-labs/skyvern, OpenHands, dspy · `targets/*.json` | Devin (harness) | first-wave cold read |
| 13 | Fix the copy that puts `No record for <job>` next to a recorded fold of the same job name, for example by naming the matrix leg. | garnet-org/control-plane · `githubapp/render` | Nicolás | cold read |
| 14 | Look at the new external tenant `Ahmed-31-Anwar/task-manager`. It has a COVERAGE flag: 32 of 125 agents delivered a profile, mostly in its `CI` workflow. Treat it as the first real case for items 1 and 2, not as outreach. | garnet-labs/analytics-and-bi · tenant-monitor run [41403924609](https://github.com/garnet-labs/analytics-and-bi/actions/runs/41403924609) | Farrukh | December test (B) evidence |

Items 1, 2, 5, 6, 7, 8, 9, 10, 12 and 13 are independent of each other. Item 11 needs 1, 3, 4 and 12.

## (c) Go / no-go criteria

**Fork exhibits** (OpenHands, dspy, skyvern) go only when all of these hold:
1. `GH_TOKEN="$(gh auth token)" node bin/replay.mjs verify <fork PR>` exits 0, with all 14 legs ok, on harness main.
2. The stated gate is met: action #198 (or #192's change) is in a released tag the forks pin, and control-plane #745 is deployed to prod.
3. The cold read passes at 1280 px and 390 px. The headline names the PR's change. Runner and GitHub hosts sit under runner background, not the workload tree. There is no unrelated red ✗ or bot comment on the PR.

**pnpm send** goes when all of these hold:
1. A `garnet-runtime-review[bot]` comment is finalized on a new pnpm/pnpm same-repo PR. This is already observed on #17602.
2. `no_bad_egress_domain` no longer reads ATTENTION on a fresh pnpm public profile, or assertions are absent from the public projection.
3. Framing decided by Farrukh on 2026-11-13 (item 10): the egress baseline. The send claims only what "What the profiles show today" in `docs/pnpm-proof.md` supports, and claims nothing listed under "What is not shown". No per-PR behavior-change claim.

**Any send** also requires: the docs quickstart pin equals garnet.ai/pins, and every link in the message returns 200 logged out.

No-go stays in force while any of these is true: a verify leg reads `no`; a capture is not declared complete under a "nothing new" sentence; the docs pin drifts from garnet.ai/pins.

---

## 1. Outreach gate status

| reference | state (GitHub API, 2026-11-03) |
| --- | --- |
| action [#192](https://github.com/garnet-org/action/pull/192) annotations | **closed unmerged** 2026-10-28, "Superseded by #198" |
| action [#198](https://github.com/garnet-org/action/pull/198) stack (#196, #197, #192, #191, #194 + fixes) | open, not draft, `blocked`. CI green: dist, Relay legs 0/1, Smoke A/B/C, artifacts. Bot reviews only. |
| control-plane [#745](https://github.com/garnet-org/control-plane/pull/745) explicit rejections | **open draft**. nicolasparada CHANGES_REQUESTED 2026-10-27. Last update 2026-10-28. |
| action [#181](https://github.com/garnet-org/action/pull/181) artifact relay | merged 2026-10-16 as `8cccc854`, which is tag v2.4.0 |
| action [#195](https://github.com/garnet-org/action/pull/195) profile redaction | merged 2026-10-28 as `96e9f81e`, which is tag v2.4.1 (released 2026-10-28 17:24 UTC) |
| v2.4.1 contents | `git log v2.4.0..v2.4.1` = #195 only. Floating `v2` = `96e9f81`. |
| harness pin | already `96e9f81` (v2.4.1): `lib/replay-pr.mjs` `GARNET_ACTION_PIN`, `live/templates/garnet-record.yml`. The "repin to v2.4.1" line in `docs/plan.md` is done. `first-wave-2026-10-24.md` still names `8cccc854`, which was correct when it was recorded. |

## 2. Verify legs

`evaluateExhibit` in `lib/verify.mjs` now emits **14** legs. #70 added `reviewer grounding` after the board counted 13:

comment present · head-bound · capture completeness · comment finalized · verdict determinable · pair line · public permalink · check settled · no session residue · label · pull request open · public profile identity · sensor coverage · reviewer grounding.

Run at harness `a9a1f4e`, before today's re-runs (post-re-run results are at the end of §3). Every row exits FAIL.

| fork PR | failing legs | passing |
| --- | --- | --- |
| [OpenHands#26](https://github.com/garnet-labs/OpenHands/pull/26) `b6176ea` | capture completeness (not declared); check settled (`test-and-build (ubuntu)` cancelled); public profile identity (recorded `a11e391`, `refs/pull/26/merge`) | 11 |
| [dspy#2](https://github.com/garnet-labs/dspy/pull/2) `bc02ea4` | capture completeness; public profile identity (`e2ad20d`, `refs/pull/2/merge`). Sensor coverage read failed once ("jobs could not be read") and was ok on a second run. | 12 |
| [skyvern#2](https://github.com/garnet-labs/skyvern/pull/2) `fce207f` | capture completeness; public profile identity (`0c156a1`, `refs/pull/2/merge`) | 12 |

Reviewer grounding is ok on all three.

Where each fix belongs:

- **capture completeness → control-plane.** `captureDeclarationFor` (`githubapp/render/comment.go`) returns `best-effort` or `partial`, never `complete`. `CaptureQualityComplete` is defined in `declaration.go` but never emitted. No App record can pass this leg, and pnpm comments carry `"capture_quality":"best-effort"`. The harness leg is correct (AGENTS.md: "Require declared complete capture"). Item 3.
- **public profile identity → harness.** The record binds to GitHub's test merge. [#62](https://github.com/garnet-labs/garnet-replay/pull/62) accepts a test merge whose second parent is the head and whose tree equals the head's tree:

  | fork | merge commit tree | parents | head tree |
  | --- | --- | --- | --- |
  | OpenHands | `bacd2638` | `5f03b71`, `b6176ea` | `bacd2638` |
  | dspy | `10d24289` | `a9a402e`, `bc02ea4` | `10d24289` |
  | skyvern | `9945c515` | `fad99a6`, `fce207f` | `9945c515` |

  The product-side alternative is the action or sensor recording the PR head SHA (protected repo; not proposed here). Item 4.
- **check settled (OpenHands) → fork workload.** The ubuntu leg was cancelled at `timeout-minutes: 25` while the v2.4.0 post step ran. Today's re-run of the same run (still pinned to v2.4.0) finished in 17 min and the leg is ok, so the cancel was not reproducible.
- **comment finalized → control-plane** (same cause as capture completeness, new under contract 10.0.0).

## 3. Cold read under the current renderer

Today (16:04 UTC) the recorded job on each fork was re-run (`POST /actions/jobs/{id}/rerun`), so the App re-rendered each comment with the deployed renderer (v1.42.0, contract 10.0.0). The cold read below is of the live comment's Markdown, read top to bottom as a first-time viewer. Screenshots at 1280/390 px were not taken; do that before any send (go criterion 3).

| first-wave issue | after control-plane #760–#765 | where the rest belongs |
| --- | --- | --- |
| 1. Runner and GitHub hosts headline the change | **Resolved in the renderer.** Azure blob, `results-receiver`, `glb-…githubapp` and `hosted-compute-watchdog` now render under "Runner & GitHub's own traffic", tagged `(github infra)`, and are excluded from the count. [OpenHands#26](https://github.com/garnet-labs/OpenHands/pull/26) now reads `### Nothing new recorded` / `0 of 1 recorded job changed · 2 new on the runner, outside your steps`. | — |
| 2. dspy's recorded job never installs the changed file | **Unchanged (candidate choice).** [dspy#2](https://github.com/garnet-labs/dspy/pull/2) now reads `### Runtime behavior changed` / `1 of 1 recorded job changed`, with workload `+ bash › uv › git › git › git → github[.]com` against the last 3 `main` runs. A `docs/requirements.txt` bump that the job does not install cannot explain that line. | harness: pick a candidate whose changed manifest the recorded job installs |
| 3. Red ✗ on the commit timeline | dspy: no failing check on either commit now. **skyvern: `claude-review` still fails on both commits** (missing fork secret). | fork hygiene: harness/fork workflow |
| 4. OpenHands cancelled leg and unrelated bot comment | **Leg fixed:** attempt 2 of `test-and-build (ubuntu)` finished green in 17 min, and `check settled` is ok. **Bot comment still there:** `github-actions[bot]` "PR Artifacts Notice … `.pr/` directory". | fork hygiene: harness/fork workflow |
| 5. Hostname truncation | **Not resolved, now confined to the runner block.** `results-receiver.actions[.]githubusercontent`, `productionresultssa32.blob.core[.]windows` and the process `hosted-compute-` are cut where the name was recorded. | jibril (DNS name / 15-char comm); low, since it is outside the workload tree |

New on the re-render (OpenHands#26):
- `Garnet Dependabot Record / record · job removed ↳ ran at the PR base, not in this commit`. The fork's own `garnet-dependabot-record.yml` shows up in the exhibit. This is harness fork hygiene.
- `No record for test-and-build · 1 of 1 job recorded` sits next to a recorded `CI / test-and-build · nothing new` fold. For a first-time viewer the two lines read as a contradiction; the likely cause is the unrecorded windows matrix leg. This is control-plane copy.

skyvern#2 was still re-running at write time. Its comment is still the 2026-10-24 contract-6.13.0 render: `+2 −4 destinations`, with Azure blob hosts under `Runner.Worker` in the workload tree. That is the shape #760 replaced.

Verify after the re-run, for OpenHands and dspy: FAIL. `check settled` is now ok on OpenHands. `comment finalized` now also reads `no`, because the App declares `best-effort` where it used to declare nothing. The failing legs are capture completeness, comment finalized and public profile identity. Items 3 and 4 clear all three.

## 4. Production tenant health

The weekly sweep runs as `tenant-monitor.yml` and publishes an artifact; it is not committed to `reports/`. The newest committed report is still `reports/2026-10-07-pnpm-monitor/`. The latest run is [41403924609](https://github.com/garnet-labs/analytics-and-bi/actions/runs/41403924609) (2026-11-02 07:04 UTC, read replica, 7-day window, 30-day baseline), artifact `tenant-monitor.md`:

| tenant | 7d profiles | avg/day | 30d | last seen | agents → profiles | flags |
| --- | --- | --- | --- | --- | --- | --- |
| pnpm/pnpm | 343 | 54.1 | 1119 | 2026-11-01 | 343 → 343 (TS CI test 342/342, Tag 1/1) | none |
| Ahmed-31-Anwar/task-manager (new: first profile 2026-10-27) | 32 | 4.6 | 32 | 2026-10-29 | 125 → 32 (`CI` test 12/74, build 6/37; `CI with Garnet` 12/12) | COVERAGE |
| nicolasparada/garnet-action | 0 | 0 | 1 | 2026-10-16 | — | SILENT (personal test repo) |

pnpm/pnpm is active, with no SILENT, DROP, COVERAGE or EMPTY flags. Compared with Oct 7 (277 profiles, ~99%), volume is up and delivery is 100%. A new control-plane organization (`…@privaterelay.appleid.com`, 125 agents, created 2026-10-27) matches the new tenant's agent count; that link is an inference. The open analytics PRs #12, #15 and #17 do not change these numbers.

## 5. pnpm outreach readiness

- **App path is live.** `garnet-runtime-review[bot]` commented on 8 of the 12 most recent same-repo pnpm/pnpm PRs, all on 2026-11-03: #17602, #17603, #17604, #17610, #17620, #17622, #17624, #17626. #17611, #17618, #17621 and #17625 had none at probe time.
- [#17602](https://github.com/pnpm/pnpm/pull/17602) is finalized: contract 10.0.0, `### Nothing new recorded`, `0 of 1 recorded job changed`, "Garnet records 1 of 19 TS CI jobs". It compares with the last 10 recorded runs on `main`, best-effort capture, and has a [public profile](https://app.garnet.ai/public/runs/41644836982?profile=01a1a1aa-1b83-72be-9408-4304cd1d8c5a).
- [#17620](https://github.com/pnpm/pnpm/pull/17620) was pending at probe time ("0 of 5 jobs finished so far"). Recording now spans five cells, including Windows legs.
- **`no_bad_egress_domain` is still ATTENTION.** The public JSON for the #17602 profile (`/api/public/runs/41644836982`) carries `"no_bad_egress_domain","result":"ATTENTION"`. The PR comment itself shows no assertion. No calibration change was found in control-plane, where the assertion only appears in `service/firehose/slack.go`. The assertion lives in garnet-org/jibril (`internal/assertions`). Item 6.
- `docs/pnpm-proof.md` caveats still hold: not causal, not exact-head (merge ref), not complete, and fork PRs record nothing. Its egress-baseline framing was decided on 2026-11-13 (item 10); only item 6 still holds pnpm.

## 6. Other surfaces (first external viewer)

| check | result |
| --- | --- |
| garnet.ai, /pricing, /pins | 200. `/pins` names `96e9f81…` v2.4.1. |
| docs.garnet.ai, /quickstart, /agent-setup/github-actions | 200. **The quickstart snippet pins `garnet-org/action@245ad6be…` (v2.3.0).** In the repo, `245ad6be` appears in quickstart.mdx (4), release.json (1) and security.mdx (1). |
| docs pin sync | `Sync Action Pin` on main failed 2026-11-02: "GitHub Actions is not permitted to create or approve pull requests". |
| App install docs | Present: quickstart card → `github.com/apps/garnet-runtime-review/installations/select_target`, plus execution-profile.mdx and security.mdx. |
| github.com/apps/garnet-runtime-review, Marketplace listing | 200 |
| website PRs | #141 closed unmerged (demo selectors, "do not merge"; not a blocker). #182, #183 and #184 are open (final-comment exhibits). `dev` is 5 commits ahead of `main`. |
| docs PRs | #102 (draft, base main), #101 (draft, stacked), #100 (stacked) are open, for comment-lock alignment. Docs main is from 2026-10-09. |
| garnet-ui PRs | open: #311, #323, #324, #326, #328, #329 (base dev or stacked). Main is `72df926`. |
| `garnet/runtime-evidence` on reference#31 | still `pending` since 2026-09-10 (head `b639b38`) |
| jibril | stable v2.11.0 (2026-04-14). Nightly `jibril-v0.0.20261103T021234Z`. No viewer-facing blocker found. |
