# First wave — Run track board (2026-10-24)

Harness: garnet-replay `22be09e` (main, after PR 66) for OpenHands, dspy and the probe; `5b13221` (main, after PR 67) for skyvern. Action pin `8cccc854` (v2.4.0). Outreach: **gated** on every row (action PR 192 + control-plane PR 745).

| target | fork PR | verify legs (13) | public run report | cold read (SKILL.md step 7) |
| --- | --- | --- | --- | --- |
| OpenHands — upstream change 18873 | [OpenHands#26](https://github.com/garnet-labs/OpenHands/pull/26), head `b6176ea`, 1 commit | **FAIL** (exit 1). PASS: comment present, head-bound, comment finalized, outcome determinable, pair line `5f03b71 → b6176ea`, public permalink, no session residue, label, pull request open, sensor coverage 1/1. FAIL: capture completeness (not declared), check settled (`test-and-build (ubuntu)` cancelled), public profile identity (merge ref `a11e3911`, not head) | [run 40065042983](https://app.garnet.ai/public/runs/40065042983?profile=01a16c67-861b-7075-bdf6-c6250dd74549) | **FAIL.** The headline "+1 −1 destinations" is an Azure blob host rotation (`blob.blz25…` → `blob.bn3…`), not the release bump in the diff. Runner/GitHub hosts sit under the workload tree. A fork bot comment claims a `.pr/` directory the PR does not contain. |
| dspy — upstream change 10706 | [dspy#2](https://github.com/garnet-labs/dspy/pull/2), head `bc02ea4`, 2 commits (`pr-base-to-head`) | **FAIL** (exit 1). PASS: 11 legs, including head-bound, pair line `0975b70 → bc02ea4` and check settled (all 22 checks completed). FAIL: capture completeness (not declared), public profile identity (merge ref `e2ad20d1`, not head) | [run 40069918928](https://app.garnet.ai/public/runs/40069918928?profile=01a16c95-5696-7d2e-9867-6515f75ca55e) | **FAIL.** The change bumps `docs/requirements.txt`, which the recorded job (`mcp_v2_test`) never installs. So "1 job changed +1 −1" is GitHub host churn (`glb-…github.com` → `results-receiver.actions…`) under the workload tree. Commit 1 shows a red ✗ on the timeline. Hostnames are cut mid-name (`…store.core[.]windows`, `…actions[.]githubusercontent`). |
| skyvern — upstream change 9021 (stands in for databricks-agents) | [skyvern#2](https://github.com/garnet-labs/skyvern/pull/2), head `fce207f`, 2 commits (`pr-base-to-head`); onboarding [skyvern#1](https://github.com/garnet-labs/skyvern/pull/1) merged `--no-ff` | **FAIL** (exit 1). PASS: 11 legs, including head-bound, pair line `63fdb94 → fce207f`, check settled and sensor coverage 1/1. FAIL: capture completeness (not declared), public profile identity (merge ref `0c156a10`, not head) | [run 40076776136](https://app.garnet.ai/public/runs/40076776136?profile=01a16d20-86d2-77c1-bb59-5e543ac3c448) | **FAIL.** The change does reach the recorded job (`uv.lock`, installed by `uv sync` in `Run tests and pre-commit`), but the headline "+2 −4 destinations" is Azure blob and GitHub host rotation (`blob.*.store.core[.]windows`, `productionresultssa*`, `results-receiver.actions…`) under the workload tree. Both commits show a red ✗ on the timeline (`claude-review` fails for a missing fork secret). The title is truncated ("in the…"). |
| databricks-agents | — | blocked: no public GitHub source repository (`databricks/databricks-agents` 404) | — | — |
| cognee, npm IOC set | — | parked by scope change (npm: analysis feed 404) | — | — |

## Fail-closed probe (share gate)
`GH_TOKEN="$(gh auth token)" node bin/replay.mjs verify https://github.com/garnet-labs/OpenHands/pull/27` at harness `22be09e`, against PR head `514ae95` while commit 2's `test-and-build (ubuntu)` was still queued, **exited 1**.
- The record was still bound to commit 1 (`1d3dda4`).
- Failing legs: head-bound (head moved), capture completeness, pair line, check settled (no head check belongs to run 40066889366), public profile identity.
- Output ended: `not shareable until every leg reads ok`.

## Did not read cleanly to a first-time viewer
1. All three exhibits headline a change that is runner/GitHub infrastructure churn, not the PR's diff, and those hosts are not attributed to runner background.
2. dspy: the recorded job does not exercise the changed file, so this candidate cannot show the change.
3. dspy and skyvern: the "sync dependency manifests before update" commit and a red ✗ show on the timeline (dspy commit 1; skyvern both commits, from `claude-review` lacking its fork secret).
4. OpenHands: the cancelled ubuntu leg (the v2.4.0 post step pushed the job past `timeout-minutes: 25`) and an unrelated fork bot comment.
5. Hostname truncation in the rendered tree.
At phone width (390px) the tree scrolls horizontally inside the code block, which is readable.

## Fleet repin

| fork | file | before → after | jibril_version | excluded | repin commit |
| --- | --- | --- | --- | --- | --- |
| garnet-labs/cline | .github/workflows/garnet-cline-ci.yml | v2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 6641d0ce6e64768d2a8df7be269e99e867063e98 |
| garnet-labs/cline | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/codex | .github/workflows/blob-size-policy.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0 | false | 4e0a2820ace562cba22d716c6abd3fcf0ce4c13a |
| garnet-labs/codex | .github/workflows/blocking-ci.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0 | false | 2d4257bbdfb96e9dbbcf33d7adcc1b0e20344614 |
| garnet-labs/codex | .github/workflows/cargo-deny.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0 | false | 4e0a2820ace562cba22d716c6abd3fcf0ce4c13a |
| garnet-labs/codex | .github/workflows/codespell.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0 | false | 4e0a2820ace562cba22d716c6abd3fcf0ce4c13a |
| garnet-labs/codex | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/codex | .github/workflows/garnet-runtime-coverage.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c, 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0, v2.15.0 | false | 2d4257bbdfb96e9dbbcf33d7adcc1b0e20344614 |
| garnet-labs/codex | .github/workflows/repo-checks.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0 | false | 4e0a2820ace562cba22d716c6abd3fcf0ce4c13a |
| garnet-labs/codex | .github/workflows/rust-ci.yml | 3d47f4a9004f7356c980a0e8d420ef5984750e3c, 3d47f4a9004f7356c980a0e8d420ef5984750e3c, 3d47f4a9004f7356c980a0e8d420ef5984750e3c, 3d47f4a9004f7356c980a0e8d420ef5984750e3c, 3d47f4a9004f7356c980a0e8d420ef5984750e3c → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.15.0, v2.15.0, v2.15.0, v2.15.0, v2.15.0 | false | 4e0a2820ace562cba22d716c6abd3fcf0ce4c13a |
| garnet-labs/continue | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/deepsec | .github/workflows/ci.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.17.0-rc.9 | false | 23aece1f7734e069ed7e03ce32c4f12304354e47 |
| garnet-labs/dub | .github/workflows/deepsec-review.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.17.0-rc.8 | false | 79012a25ee6c28ec1f8fd0f32ecd36edb8f9b9bb |
| garnet-labs/dub | .github/workflows/deploy-embed-script.yml | v2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | ad5d8b88aa43ffea4a9d88be876119463e801661 |
| garnet-labs/dub | .github/workflows/garnet-deepsec-demo.yml | f54d7f914c5290c3d09b22d76249002013d730d2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | ad5d8b88aa43ffea4a9d88be876119463e801661 |
| garnet-labs/dub | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/dub | .github/workflows/playwright.yaml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 79012a25ee6c28ec1f8fd0f32ecd36edb8f9b9bb |
| garnet-labs/dub | .github/workflows/prettier.yaml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 79012a25ee6c28ec1f8fd0f32ecd36edb8f9b9bb |
| garnet-labs/express | .github/workflows/ci.yml | v2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 5723d37696721789ad24572522f7a6b9f34a271a |
| garnet-labs/express | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/open-swe | .github/workflows/garnet-ci.yml | v2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.13.0 | false | d0b1fd70135150614e7cecd9e3a590ca81c889f0 |
| garnet-labs/open-swe | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/openai-node | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/openai-node | .github/workflows/garnet-openai-node-ci.yml | v2 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | fabef094ebaa6235ec57d868c3ba40855ef43451 |
| garnet-labs/opencode | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/pnpm | .github/workflows/garnet-dependabot-fixtures.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 57a3176cd7d5145887ff7f04b34eed55ea09da98 |
| garnet-labs/pnpm | .github/workflows/garnet-dependabot-record.yml | 9696f3cae14437203c56dac7d78d9449b9ba3764 → 9696f3cae14437203c56dac7d78d9449b9ba3764 | v2.17.0 | true | — |
| garnet-labs/pnpm | .github/workflows/garnet-execution-diff.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 57a3176cd7d5145887ff7f04b34eed55ea09da98 |
| garnet-labs/pnpm | .github/workflows/garnet-jibril-release-gate-job.yml | 9696f3cae14437203c56dac7d78d9449b9ba3764, 9696f3cae14437203c56dac7d78d9449b9ba3764 → 9696f3cae14437203c56dac7d78d9449b9ba3764, 9696f3cae14437203c56dac7d78d9449b9ba3764 | "", ${{ inputs.jibril_version }}, ${{ inputs.jibril_version }} | true | — |
| garnet-labs/pnpm | .github/workflows/garnet-oidc-canary.yml | 9696f3cae14437203c56dac7d78d9449b9ba3764 → 9696f3cae14437203c56dac7d78d9449b9ba3764 | v2.17.0 | true | — |
| garnet-labs/pnpm | .github/workflows/release.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea, 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 6d4f893ec1a6463dbe159b4e0acc7b0e793e8306 |
| garnet-labs/pnpm | .github/workflows/test.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 6d4f893ec1a6463dbe159b4e0acc7b0e793e8306 |
| garnet-labs/pnpm | .github/workflows/update-latest.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 6d4f893ec1a6463dbe159b4e0acc7b0e793e8306 |
| garnet-labs/posthog | .github/workflows/ci-vendored-packages.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.16.0 | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/posthog | .github/workflows/garnet-ci.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.16.0 | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/posthog | .github/workflows/garnet-dependabot-livestream.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/posthog | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/posthog | .github/workflows/garnet-python-toolchain.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.16.0 | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/posthog | .github/workflows/garnet-replay-headless.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.16.0 | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/posthog | .github/workflows/garnet-sentiment.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | v2.16.0 | false | 4b2857b2d26506a29cbe69bef1183fd5fcc672e5 |
| garnet-labs/sentry-javascript | .github/workflows/build.yml | 245ad6be82de3200c205109c8ca7ac816dc692ea → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57, 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | 0ac46d984bdc4990c6773713c34cfa0d55a896c9 |
| garnet-labs/sentry-javascript | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/servers | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/uv | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/vitejs-vite | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
| garnet-labs/OpenHands | .github/workflows/ci.yml | 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 → 8cccc85403e4ac4e05fb7822c994d3c199f9aa57 | default | false | — |
| garnet-labs/OpenHands | .github/workflows/garnet-dependabot-record.yml | e546567a72e4fede11ec39d6e9f75b539adef22c → e546567a72e4fede11ec39d6e9f75b539adef22c | v2.16.0 | true | — |
