# Five-prospect batch: evidence and operating decision

Observed 2026-09-11, with parent GitHub/API reconciliation at 18:00 UTC.
Production harness: `6363ec516525479e857414f803f21cff6209ae67`.
The stricter verifier described here is the change accompanying this report.
These are dated results: re-query the exact PR head before reusing any claim.

## Outcome

Five fresh fork PRs were published with two commits each. All ten recording
jobs completed successfully. The original verifier accepted all five, but
independent review exposed two common gaps: capture completeness was not
declared, and public reports identified merge commits instead of replay heads.
The revised verifier returns FAIL for every row. All five comparison results
are therefore **undeterminable**, and none is approved as an outreach exhibit.

| Prospect / fork PR | Recorded workload | Hypothesis and incremental reviewer value | Independent read |
|---|---|---|---|
| [Vite #5](https://github.com/garnet-labs/vitejs-vite/pull/5) | Root pnpm install; both jobs succeeded | Browser-download lineage is useful context. The apparent gained/lost endpoint is an alias ambiguity; no dependency-caused destination change is established. | Not shareable: identity, completeness, alias interpretation, omitted card rows. |
| [PostHog #203](https://github.com/garnet-labs/posthog/pull/203) | Python sentiment dependency group only; both jobs succeeded | Wheel-install context is available; runner churn does not explain the Python change. Application behavior and other dependency groups were not measured. | Not shareable: identity, completeness, PR file-list drift, headline and narrow-width readability. |
| [Dub #37](https://github.com/garnet-labs/dub/pull/37) | Root pnpm workspace install; both jobs succeeded | A possible unchanged install control. It cannot establish application equivalence or identify the responsible lifecycle package. Nested stripe-app npm install is outside scope. | Not shareable: identity, completeness, card scope/row loss, differing public/comment counts. |
| [OpenHands #10](https://github.com/garnet-labs/OpenHands/pull/10) | Frontend npm install with scripts; both jobs succeeded | Strongest review lead: new lockfile entries resolve through a third-party mirror. The diff and redirect probe support that mechanism; the record alone does not establish dependency causality, stability, or math rendering. | Not shareable: identity, completeness, file count drift, narrow-width clipping. |
| [openai-node #43](https://github.com/garnet-labs/openai-node/pull/43) | Root pnpm install including examples; both jobs succeeded | Low incremental value for Express 4 → 5: installation does not answer runtime compatibility. | Not shareable: identity, completeness, lost workload/background rows, selected-base Dependabot policy overwritten. |

Claim classes: job completion is `required-check-state`; recorded contacts are
`observed-runtime-behavior`; every comparison above is undeterminable with
`capture-not-declared` and `public-head-mismatch` reasons. Prospect ranking and
reviewer usefulness are judgment. No independent agent review changing a
merge decision was demonstrated; agent-consumption value remains untested.

All five independent reads finished, including desktop and approximately
390px checks. Their reports preserve the original verifier's results; the
strict reconciliation in this document supersedes those acceptance claims:
[Vite](https://app.devin.ai/attachments/956015cd-e7c9-46b4-82af-294f85807804/cold-read-report-vitejs-vite-5.md),
[PostHog](https://app.devin.ai/attachments/4bb1813f-3a67-4cd1-9575-7d003f20291c/COLD-READ-posthog-203.md),
[Dub](https://app.devin.ai/attachments/2220a8a6-3a90-442b-ad55-6e0d0fbf4b57/coldread-report-dub-37.md),
[OpenHands](https://app.devin.ai/attachments/1347f3fa-fa45-419d-8bf7-57b56e43ec3f/REPORT.md),
[openai-node](https://app.devin.ai/attachments/f1b2b09d-9a83-419a-9889-f3da3d7fbc2c/cold-review-openai-node-pr43.md).

Next candidate selection should lead with a review question the measured
command can answer. OpenHands' lockfile routing is the strongest lead here;
Express compatibility needs an application workload. A popular repository
or a major version change alone is insufficient.

## Exact source and replay pairs

Source base → source head is the upstream patch provenance. The fork PR base
equals source base in each row. Recorded comparison is commit 1 → commit 2
(immediate parent → head), not source base → source head.

| Prospect | Source PR | Source base → head | Fork commit 1 → commit 2 |
|---|---|---|---|
| Vite | [23445](https://github.com/vitejs/vite/pull/23445) | `68aeb8a3b5a5a2ccd505288999bae1a5e6942ee1` → `982a5b4b6b599ce2c7217077e283235aad3dc4a2` | `d49352d0d5dbd5434fbd1e361f93cf87a6a08638` → `0712550b791322e7b019e22ae0e0be8512368ff6` |
| PostHog | [99349](https://github.com/PostHog/posthog/pull/99349) | `4eebf7d3716618d59c0dd412bf141159462db97f` → `05ba0d9934719a3c7c32e27f133f02413edf87c3` | `d7edcbd4a227ca8778da0e115c4db1517af5e25e` → `b0d8c42c9c7ae28f8aa43f5e5e7dcdd862d7b7cf` |
| Dub | [4489](https://github.com/dubinc/dub/pull/4489) | `94cb73a2800e8117f57a85f26688ff9b062728c5` → `4e078755ac1743fadd5605b02ef6f57a780276b5` | `35c0f21d8940cdf38dffffb3ffd4aafdb84735ee` → `eed0e64112df093645aa8594578bda6869249592` |
| OpenHands | [17270](https://github.com/OpenHands/OpenHands/pull/17270) | `0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1` → `3b684610006f94958daccbb738f543215c89a1a3` | `4c1a44a5fb38ffa5f3d8bdc8315d5fe3bd865d41` → `cc0afe66eae24f448b0a3215354cd18eefcc7562` |
| openai-node | [2684](https://github.com/openai/openai-node/pull/2684) | `fdb038e21509264bcdf81741a40988dd694188b1` → `b71263b05e5543f6e3dad509001d4027b085c49a` | `c5dddb15638866f2eb902b54d0975c62b9ca96b4` → `74a34f98b93159867579d34b448926e5fc94712e` |

Version changes include Playwright Chromium 1.62.1 → 1.63.0 and pnpm 12.2.1 →
12.3.4 (Vite); Python wheel dependency updates (PostHog); eleven dependency
updates including Next 15.5.8 → 15.5.24 (Dub); added KaTeX 0.16.47,
rehype-katex 7.0.1, remark-math 6.0.0 (OpenHands); and Express 4.22.2 → 5.2.1
with @types/express 4.17.25 → 5.0.6 (openai-node). Compound changes are not
single-variable causal experiments.

## Recording selectors

Every listed run is attempt 1. Job IDs below were refreshed from the GitHub
jobs API, including Dub commit 1 (the producer initially supplied a different
job ID). Missing profile selectors remain missing, not inferred from a run ID.

| Prospect | Commit 1 run / job | Commit 2 run / job | Commit 2 profile |
|---|---|---|---|
| Vite | `34624432424` / `103345970903` | `34624634687` / `103346643245` | `01a09165-9dfe-7f24-af9a-652d6c3d6948` |
| PostHog | `34624476629` / `103346114215` | `34624686640` / `103346806030` | `01a09166-6050-7307-94aa-cc579877690d` |
| Dub | `34625772390` / `103350371156` | `34626014140` / `103351180616` | `01a09172-beee-781a-bc67-2e0434bbb129` |
| OpenHands | `34629245400` / `103361766851` | `34629397391` / `103362257533` | `01a09193-d3d4-707f-823a-d137810394b9` |
| openai-node | `34626481259` / `103352712672` | `34626638779` / `103353224009` | `01a09178-936c-7b2c-8de7-bcb789f0e574` |

Commit 1 profile selectors recovered in lane evidence: Dub
`01a09170-faa7-798b-8d07-591ed6aff6c4`; openai-node
`01a09177-0baf-720f-9ed4-ee152385af3d`; OpenHands
`01a09192-0327-7b5b-bad8-0bb545bcc31b`. Vite and PostHog
commit 1 profile selectors were not yet reconciled in this checkpoint.

Vite, Dub, OpenHands, and openai-node use `.github/workflows/garnet-record.yml`,
`pull_request`, `ubuntu-latest`, and
`garnet-org/action@e546567a72e4fede11ec39d6e9f75b539adef22c`.
Their authentication is OIDC (`contents: read`, `id-token: write`, no
`api_token`). This is a main-branch pin, not a release claim. The pnpm command
is `corepack enable && pnpm install --no-frozen-lockfile`; OpenHands instead
uses `npm ci --ignore-scripts=false` in `frontend`.

PostHog uses `.github/workflows/garnet-sentiment.yml`, `pull_request`,
`ubuntu-latest`, `garnet-org/action@3d47f4a9004f7356c980a0e8d420ef5984750e3c`,
explicit `api_token` with no OIDC permission, and
`uv sync --frozen --only-group sentiment`. This preserves an existing fork
recorder and measures only that dependency group.

Inherited CI is separate from the recording jobs. Producer audits reported
unrelated CI cancellations/failures and extra workflows firing. No claim that
all target CI passed follows from the recording jobs succeeding. OpenHands'
Ubuntu application tests failed on commit 2; commit 1's corresponding run was
cancelled, so attribution is unresolved. openai-node's Castiron job failed on
both commits because the fork lacked the required promotion ref.

openai-node commit 1 overwrote existing Dependabot configuration, including
its cooldown policy: planning inspected the fork default branch rather than
the chosen source base. The correction below applies to future plans; the
historical replay remains intact. These human-created PR runs do not prove
Dependabot secret delivery.

## Public identity failures

Anonymous public pages return HTTP 200. The API's `run.commit_sha` is instead:

| Prospect / exact public report | Public commit | Public ref |
|---|---|---|
| [Vite](https://app.garnet.ai/public/runs/34624634687?profile=01a09165-9dfe-7f24-af9a-652d6c3d6948) | `432510f4220460267bd8c26c71095729781a1fa2` | `refs/pull/5/merge` |
| [PostHog](https://app.garnet.ai/public/runs/34624686640?profile=01a09166-6050-7307-94aa-cc579877690d) | `d8cd30760e54cff661f9e31f0acb810d56e97fd3` | `refs/pull/203/merge` |
| [Dub](https://app.garnet.ai/public/runs/34626014140?profile=01a09172-beee-781a-bc67-2e0434bbb129) | `0871c263707a4c5a93a2d60f7190bef4c100808a` | `refs/pull/37/merge` |
| [OpenHands](https://app.garnet.ai/public/runs/34629397391?profile=01a09193-d3d4-707f-823a-d137810394b9) | `f96d95f3028a76ff06ffd1e3e13fa6d0881aac84` | `refs/pull/10/merge` |
| [openai-node](https://app.garnet.ai/public/runs/34626638779?profile=01a09178-936c-7b2c-8de7-bcb789f0e574) | `b32e9bc68345fb422de535e105d80fd87660bbec` | `refs/pull/43/merge` |

These mismatches do not establish that a different tree executed. They establish
that the public identity does not prove the claimed replay head. Resolution
requires executed-source provenance; replacing the public SHA with a convenient
head label would not prove it either.

## Demonstrated fixes and open ownership

| Observation | Owner / change | State / next action |
|---|---|---|
| HTTP 200 accepted a different commit identity | Harness: validate public repository/run/profile/head | Regression-covered in this change |
| Undeclared capture accepted as comparison evidence | Harness: separate complete-capture gate, undeterminable cards | Regression-covered in this change |
| Unchanged/workload rows lost from cards | Harness: preserve recorded job sections and all rows | Regression-covered; rendered validation required |
| Empty reviewer section / wrong comparison scope | Harness: explicit unrecorded reviewer outcome and recorded pair scope | Regression-covered |
| Setup files absent from generated PR body | Harness: full change list plus additional commit-1 files | Regression-covered for new plans; existing target PRs preserved |
| Existing Dependabot policy overwritten on a source-base replay | Harness: inspect the exact upstream base SHA for `--base-branch` / `--sync-fork`; fork default otherwise | Regression-covered; checking the named fork branch would fail before its creation |
| Mixed ecosystems and invisible health checks | Harness: root-lock preference, ambiguous roots require selection; document `--ecosystem`; preflight inject/prepared modes too | Implemented in this change |
| Commit-2 publication mistaken for finalization | Harness: pending message and next `verify` command | Implemented; automatic commit-2 wait remains future work |
| Wrong `gh` credential routing from checkout | Operator: use target checkout context for API diagnostics | Observed workaround; portable routing change deferred because standard `gh api` has no `--repo` flag |
| Public identity, capture accounting, alias/count drift | Product evidence producers / public-report owners | Open; exact selectors above; no protected-repo edits authorized |
| Generic installs do not answer product hypotheses | Candidate selector / cold reader | Rank by actual measured decision; preserve unchanged controls without promoting them |
| Version transition unavailable in real-PR cards | Harness: retain exact source pair; human-derived transitions above | Automatic multi-manifest/lockfile derivation remains open; do not invent one from destination differences |
| Base-ref publication failed in a producer checkout | Harness/operator: checkout-state handling and git error detail | Producer workaround retained; general fix remains open pending reproduction |

## Reusable batch entrypoint and automation decision

Use [.devin/skills/prospect-replays/SKILL.md](../.devin/skills/prospect-replays/SKILL.md).
The workflow coordinates selection, five producers, and five independent
readers with at most two active sessions. The parent owns reconciliation and
the canonical repository. A blocked row remains in the batch.

Do not schedule automatic replay publication from this result. Five successful
publications with zero accepted exhibits do not validate unattended production.
No recurring automation was created. A future scheduled discovery-only run can
rank candidates and propose dry runs, but publication requires a separately
authorized batch. Keep procedure in this repository, not copied into schedules.

Activation prerequisites: one new batch passes strict capture/public identity
and cold-reader gates, durable result schema is consumed successfully, schedule
and identity are chosen, run/concurrency limits are validated, and unattended
child-session permissions are explicit. No automatic reruns or replacement PRs.

## Prior obligations retained

This batch does not close the earlier pnpm 14819 experiment, Stage 2 live
consumer proof, or Dependabot org-token verification. It does not certify the
workspace UI in PR #8. The proposed `next`, standalone `wait`, universal JSON,
stable named exits, and read-only MCP surface in `docs/agent-interface.md`
remain future work. Earlier PASS claims for PostHog #202, OpenClaw #32 and uv #4
used older verification and must be refreshed before reuse.
