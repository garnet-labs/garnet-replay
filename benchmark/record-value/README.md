# What the record adds to review

This benchmark asks whether the PR diff accounts for the outbound connections a reviewer flagged. A **would-block row** is a positive workload change in a finalized App comparison for the PR's current head, not a claim that the PR was blocked or should be rejected.

## Reproduce

1. Start **jevos-v5** on `127.0.0.1:8017` using the [jevos release instructions](https://github.com/feder-cr/jev/releases/tag/jevos-v5). Set `AI_GATEWAY_API_KEY` for the independent judge; the default is `openai/gpt-4.1-mini`.
2. From the repo root, run `node benchmark/record-value/collect.mjs` with an authenticated `gh` (or `GARNET_LABS_GITHUB_PAT`). It inspects the org-wide App-author PR search, the replay ledgers, and the five explicitly selected PostHog PRs. It does not write to GitHub.
3. Run `node benchmark/record-value/run.mjs`. The ignored `out/record-value/` directory contains `rows.json` with full inputs and collection exclusions, `results.json` with model results and failures, and `report.md` with the linked summary. Only public PR inputs go to the judge. Collection is a point-in-time snapshot; repeating it may yield a different cohort.

Both prompts get the same title, description, diff, and destination-only question. The collector strips the machine-mirrored Garnet block from the prompt description. Author-written descriptions can still discuss runtime behavior. The second prompt adds the App's compared SHA, capture quality, and signed workload additions with their recorded paths and jobs. A step absent from the App record stays unknown. Diff and other input caps trim deterministic prefix/suffix excerpts and record omitted lengths; the same capped source is used in both arms.

The independent judge gets both source excerpts and **jevos** probabilities in deterministically shuffled positions. Arm labels are withheld, but the evidence itself is visible. The 0–3 rubric scores whether the input supports a correct yes **or** no; neither an increased yes probability nor a flip implies better review. The 95% interval resamples upstream-change groups using a seeded cluster bootstrap. The sample is changed-only and includes historical and constructed fork exhibits, so it cannot estimate general-review accuracy or production blocking rates. App search is bounded by GitHub indexing plus the ledger and named PR lists; private PR inputs are excluded.

## Results: Nov 27 snapshot

The independent judge scored the record-assisted input **0.885 points higher** on a 0–3 scale across 96 pairs (95% cluster bootstrap interval: 0.698 to 1.084). In the 9-pair Nov 24–29 subset, the difference was **+0.667 points** (0.222 to 1.222).

Snapshot: 2026-11-27T02:04:49.527Z. Scorer: **jevos-v5** (local, fingerprint `d6c9958f24d8c5aa698625ae743cf93fadb22eba84ef7dde7580b7558e8bc94b`); independent judge: `openai/gpt-4.1-mini`.

Inspected 1263 PRs from the org-wide App-author search and replay ledgers: 341 lacked a positive eligible workload change, 826 were incomplete during collection, and 96 qualified. 0 qualified rows lack a complete model pair.

| Source | Paired PRs | P(yes), source | P(yes), with record | Flips at 0.5 | Judge delta (0–3) | 95% cluster bootstrap interval |
|---|---:|---:|---:|---:|---:|---:|
| All sources | 96 (95 changes) | 0.145 | 0.336 | 13 | 0.885 | 0.698 to 1.084 |
| Historical fork records | 84 (84 changes) | 0.139 | 0.327 | 11 | 0.917 | 0.714 to 1.119 |
| Nov 20 PostHog shadow mirrors | 3 (2 changes) | 0.165 | 0.633 | 2 | 0.667 | 0.000 to 1.000 |
| Nov 24–29 | 9 (9 changes) | 0.191 | 0.320 | 0 | 0.667 | 0.222 to 1.222 |

Positive judge delta means the record-assisted input was more useful. P(yes) measures whether the diff explains the behavior, not accuracy; a decrease may be appropriate. This is a model-scored, changed-only study, not evidence of improved approval accuracy. Neither arm ran PR code.

[PostHog #276](https://github.com/garnet-labs/posthog/pull/276) and [#277](https://github.com/garnet-labs/posthog/pull/277) are separate observations of one upstream change and share a bootstrap cluster. The Nov 24–29 row is a partial, as-of snapshot, not the planned 30 PRs + 20 reruns.

36 diffs and one record excerpt were truncated. The 826 collection exclusions include 208 non-public PRs; these were not sent to either scorer. The other 618 rows did not supply a usable current-head record for this comparison.

<details>
<summary>Per-PR scores and App evidence (96 pairs)</summary>

| PR | Source | Record | P(yes): source → record | Judge: source → record | Omitted diff characters |
|---|---|---|---:|---:|---:|
| [garnet-labs/actions#1](https://github.com/garnet-labs/actions/pull/1) | Historical fork records | [best-effort](https://github.com/garnet-labs/actions/pull/1#issuecomment-6534462048) | 0.154 → 0.166 | 3 → 3 | 0 |
| [garnet-labs/actions#10](https://github.com/garnet-labs/actions/pull/10) | Historical fork records | [best-effort](https://github.com/garnet-labs/actions/pull/10#issuecomment-6674991619) | 0.283 → 0.376 | 3 → 3 | 0 |
| [garnet-labs/actions#16](https://github.com/garnet-labs/actions/pull/16) | Historical fork records | [best-effort](https://github.com/garnet-labs/actions/pull/16#issuecomment-6704130597) | 0.426 → 0.321 | 3 → 3 | 3415 |
| [garnet-labs/actions#19](https://github.com/garnet-labs/actions/pull/19) | Historical fork records | [best-effort](https://github.com/garnet-labs/actions/pull/19#issuecomment-6704301616) | 0.796 → 0.309 | 3 → 3 | 0 |
| [garnet-labs/actions#9](https://github.com/garnet-labs/actions/pull/9) | Historical fork records | [best-effort](https://github.com/garnet-labs/actions/pull/9#issuecomment-6674945698) | 0.380 → 0.442 | 3 → 3 | 0 |
| [garnet-labs/airbyte#16](https://github.com/garnet-labs/airbyte/pull/16) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/16#issuecomment-6872985200) | 0.133 → 0.185 | 0 → 1 | 251027 |
| [garnet-labs/airbyte#17](https://github.com/garnet-labs/airbyte/pull/17) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/17#issuecomment-6872988786) | 0.131 → 0.185 | 1 → 1 | 361042 |
| [garnet-labs/airbyte#18](https://github.com/garnet-labs/airbyte/pull/18) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/18#issuecomment-6876157297) | 0.064 → 0.162 | 0 → 0 | 302428 |
| [garnet-labs/airbyte#27](https://github.com/garnet-labs/airbyte/pull/27) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/27#issuecomment-6938525243) | 0.116 → 0.581 | 0 → 0 | 0 |
| [garnet-labs/airbyte#35](https://github.com/garnet-labs/airbyte/pull/35) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/35#issuecomment-6940773932) | 0.148 → 0.254 | 0 → 2 | 0 |
| [garnet-labs/airbyte#40](https://github.com/garnet-labs/airbyte/pull/40) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/40#issuecomment-6985291734) | 0.174 → 0.250 | 0 → 2 | 0 |
| [garnet-labs/airbyte#43](https://github.com/garnet-labs/airbyte/pull/43) | Historical fork records | [best-effort](https://github.com/garnet-labs/airbyte/pull/43#issuecomment-6985611523) | 0.154 → 0.226 | 1 → 2 | 0 |
| [garnet-labs/browser-use#2](https://github.com/garnet-labs/browser-use/pull/2) | Historical fork records | [best-effort](https://github.com/garnet-labs/browser-use/pull/2#issuecomment-4942523388) | 0.374 → 0.913 | 1 → 3 | 0 |
| [garnet-labs/claude-ship-garnet#10](https://github.com/garnet-labs/claude-ship-garnet/pull/10) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/10#issuecomment-7180949280) | 0.059 → 0.180 | 1 → 1 | 0 |
| [garnet-labs/claude-ship-garnet#11](https://github.com/garnet-labs/claude-ship-garnet/pull/11) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/11#issuecomment-7181105685) | 0.283 → 0.307 | 3 → 3 | 4891 |
| [garnet-labs/claude-ship-garnet#12](https://github.com/garnet-labs/claude-ship-garnet/pull/12) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/12#issuecomment-7181191380) | 0.105 → 0.261 | 0 → 2 | 103895 |
| [garnet-labs/claude-ship-garnet#19](https://github.com/garnet-labs/claude-ship-garnet/pull/19) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/19#issuecomment-7203418236) | 0.537 → 0.779 | 3 → 3 | 0 |
| [garnet-labs/claude-ship-garnet#2](https://github.com/garnet-labs/claude-ship-garnet/pull/2) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/2#issuecomment-7173393789) | 0.375 → 0.327 | 3 → 3 | 0 |
| [garnet-labs/claude-ship-garnet#9](https://github.com/garnet-labs/claude-ship-garnet/pull/9) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/claude-ship-garnet/pull/9#issuecomment-7180944418) | 0.099 → 0.240 | 1 → 3 | 77683 |
| [garnet-labs/clawhub-plugin-receipts#1](https://github.com/garnet-labs/clawhub-plugin-receipts/pull/1) | Historical fork records | [best-effort](https://github.com/garnet-labs/clawhub-plugin-receipts/pull/1#issuecomment-7113328267) | 0.206 → 0.262 | 3 → 3 | 38889 |
| [garnet-labs/cline#34](https://github.com/garnet-labs/cline/pull/34) | Historical fork records | [best-effort](https://github.com/garnet-labs/cline/pull/34#issuecomment-6936723744) | 0.097 → 0.224 | 1 → 2 | 215615 |
| [garnet-labs/cline#35](https://github.com/garnet-labs/cline/pull/35) | Historical fork records | [best-effort](https://github.com/garnet-labs/cline/pull/35#issuecomment-6937095334) | 0.098 → 0.195 | 0 → 3 | 215615 |
| [garnet-labs/cline#36](https://github.com/garnet-labs/cline/pull/36) | Historical fork records | [best-effort](https://github.com/garnet-labs/cline/pull/36#issuecomment-6937205531) | 0.098 → 0.213 | 0 → 3 | 215615 |
| [garnet-labs/code-interpreter#13](https://github.com/garnet-labs/code-interpreter/pull/13) | Historical fork records | [best-effort](https://github.com/garnet-labs/code-interpreter/pull/13#issuecomment-6703613534) | 0.113 → 0.378 | 1 → 3 | 325119 |
| [garnet-labs/code-interpreter#15](https://github.com/garnet-labs/code-interpreter/pull/15) | Historical fork records | [best-effort](https://github.com/garnet-labs/code-interpreter/pull/15#issuecomment-6704174666) | 0.098 → 0.102 | 3 → 3 | 0 |
| [garnet-labs/code-interpreter#24](https://github.com/garnet-labs/code-interpreter/pull/24) | Historical fork records | [best-effort](https://github.com/garnet-labs/code-interpreter/pull/24#issuecomment-6957625563) | 0.172 → 0.575 | 1 → 1 | 24254 |
| [garnet-labs/dspy#2](https://github.com/garnet-labs/dspy/pull/2) | Historical fork records | [best-effort](https://github.com/garnet-labs/dspy/pull/2#issuecomment-6380838734) | 0.073 → 0.146 | 0 → 1 | 0 |
| [garnet-labs/dspy#6](https://github.com/garnet-labs/dspy/pull/6) | Historical fork records | [best-effort](https://github.com/garnet-labs/dspy/pull/6#issuecomment-6603364627) | 0.118 → 0.164 | 1 → 1 | 0 |
| [garnet-labs/dspy#7](https://github.com/garnet-labs/dspy/pull/7) | Historical fork records | [best-effort](https://github.com/garnet-labs/dspy/pull/7#issuecomment-6603363176) | 0.111 → 0.152 | 1 → 1 | 0 |
| [garnet-labs/E2B#104](https://github.com/garnet-labs/E2B/pull/104) | Historical fork records | [best-effort](https://github.com/garnet-labs/E2B/pull/104#issuecomment-6958209449) | 0.125 → 0.274 | 1 → 2 | 76480 |
| [garnet-labs/E2B#87](https://github.com/garnet-labs/E2B/pull/87) | Historical fork records | [best-effort](https://github.com/garnet-labs/E2B/pull/87#issuecomment-6872143482) | 0.046 → 0.409 | 1 → 3 | 0 |
| [garnet-labs/E2B#91](https://github.com/garnet-labs/E2B/pull/91) | Historical fork records | [best-effort](https://github.com/garnet-labs/E2B/pull/91#issuecomment-6876270317) | 0.042 → 0.147 | 0 → 2 | 0 |
| [garnet-labs/E2B#93](https://github.com/garnet-labs/E2B/pull/93) | Historical fork records | [best-effort](https://github.com/garnet-labs/E2B/pull/93#issuecomment-6935783452) | 0.049 → 0.147 | 0 → 0 | 0 |
| [garnet-labs/express#92](https://github.com/garnet-labs/express/pull/92) | Historical fork records | [best-effort](https://github.com/garnet-labs/express/pull/92#issuecomment-7023282899) | 0.126 → 0.413 | 1 → 2 | 0 |
| [garnet-labs/ghaw-garnet-reference#10](https://github.com/garnet-labs/ghaw-garnet-reference/pull/10) | Historical fork records | [best-effort](https://github.com/garnet-labs/ghaw-garnet-reference/pull/10#issuecomment-6617386912) | 0.083 → 0.298 | 2 → 3 | 47303 |
| [garnet-labs/ghaw-garnet-reference#8](https://github.com/garnet-labs/ghaw-garnet-reference/pull/8) | Historical fork records | [best-effort](https://github.com/garnet-labs/ghaw-garnet-reference/pull/8#issuecomment-6615094423) | 0.046 → 0.187 | 1 → 3 | 10522 |
| [garnet-labs/litellm#107](https://github.com/garnet-labs/litellm/pull/107) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/107#issuecomment-6773891177) | 0.038 → 0.110 | 0 → 1 | 0 |
| [garnet-labs/litellm#111](https://github.com/garnet-labs/litellm/pull/111) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/111#issuecomment-6776594864) | 0.058 → 0.833 | 0 → 2 | 0 |
| [garnet-labs/litellm#112](https://github.com/garnet-labs/litellm/pull/112) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/112#issuecomment-6780738269) | 0.064 → 0.170 | 0 → 0 | 0 |
| [garnet-labs/litellm#114](https://github.com/garnet-labs/litellm/pull/114) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/114#issuecomment-6787218816) | 0.116 → 0.557 | 0 → 1 | 0 |
| [garnet-labs/litellm#115](https://github.com/garnet-labs/litellm/pull/115) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/115#issuecomment-6787221068) | 0.117 → 0.847 | 0 → 0 | 0 |
| [garnet-labs/litellm#118](https://github.com/garnet-labs/litellm/pull/118) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/118#issuecomment-6838977978) | 0.089 → 0.200 | 0 → 2 | 0 |
| [garnet-labs/litellm#120](https://github.com/garnet-labs/litellm/pull/120) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/120#issuecomment-6845113862) | 0.065 → 0.199 | 0 → 1 | 0 |
| [garnet-labs/litellm#122](https://github.com/garnet-labs/litellm/pull/122) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/122#issuecomment-6848458968) | 0.056 → 0.148 | 1 → 2 | 0 |
| [garnet-labs/litellm#125](https://github.com/garnet-labs/litellm/pull/125) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/125#issuecomment-6872144796) | 0.029 → 0.159 | 0 → 0 | 0 |
| [garnet-labs/litellm#126](https://github.com/garnet-labs/litellm/pull/126) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/126#issuecomment-6872145451) | 0.653 → 0.759 | 1 → 3 | 0 |
| [garnet-labs/litellm#127](https://github.com/garnet-labs/litellm/pull/127) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/127#issuecomment-6872236451) | 0.051 → 0.224 | 0 → 0 | 0 |
| [garnet-labs/litellm#128](https://github.com/garnet-labs/litellm/pull/128) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/128#issuecomment-6872237817) | 0.073 → 0.268 | 0 → 0 | 0 |
| [garnet-labs/litellm#133](https://github.com/garnet-labs/litellm/pull/133) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/133#issuecomment-6872476509) | 0.084 → 0.218 | 0 → 2 | 0 |
| [garnet-labs/litellm#135](https://github.com/garnet-labs/litellm/pull/135) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/135#issuecomment-6875193571) | 0.166 → 0.236 | 1 → 2 | 0 |
| [garnet-labs/litellm#136](https://github.com/garnet-labs/litellm/pull/136) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/136#issuecomment-6875194227) | 0.123 → 0.233 | 0 → 2 | 0 |
| [garnet-labs/litellm#139](https://github.com/garnet-labs/litellm/pull/139) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/139#issuecomment-6930752088) | 0.049 → 0.162 | 0 → 1 | 0 |
| [garnet-labs/litellm#141](https://github.com/garnet-labs/litellm/pull/141) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/141#issuecomment-6931391015) | 0.049 → 0.155 | 0 → 0 | 0 |
| [garnet-labs/litellm#142](https://github.com/garnet-labs/litellm/pull/142) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/142#issuecomment-6936437448) | 0.034 → 0.135 | 0 → 1 | 0 |
| [garnet-labs/litellm#147](https://github.com/garnet-labs/litellm/pull/147) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/147#issuecomment-6939432893) | 0.098 → 0.304 | 1 → 1 | 4619 |
| [garnet-labs/litellm#155](https://github.com/garnet-labs/litellm/pull/155) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/155#issuecomment-6958561188) | 0.087 → 0.770 | 0 → 1 | 1914 |
| [garnet-labs/litellm#158](https://github.com/garnet-labs/litellm/pull/158) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/158#issuecomment-6985354895) | 0.127 → 0.298 | 0 → 1 | 0 |
| [garnet-labs/litellm#71](https://github.com/garnet-labs/litellm/pull/71) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/71#issuecomment-6703635625) | 0.098 → 0.273 | 1 → 1 | 19980 |
| [garnet-labs/litellm#72](https://github.com/garnet-labs/litellm/pull/72) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/72#issuecomment-6703636329) | 0.101 → 0.334 | 0 → 1 | 11336 |
| [garnet-labs/litellm#73](https://github.com/garnet-labs/litellm/pull/73) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/73#issuecomment-6703642753) | 0.119 → 0.326 | 0 → 3 | 85802 |
| [garnet-labs/litellm#76](https://github.com/garnet-labs/litellm/pull/76) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/76#issuecomment-6704172106) | 0.075 → 0.375 | 0 → 2 | 11732 |
| [garnet-labs/litellm#81](https://github.com/garnet-labs/litellm/pull/81) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/81#issuecomment-6771429122) | 0.105 → 0.279 | 0 → 1 | 11336 |
| [garnet-labs/litellm#84](https://github.com/garnet-labs/litellm/pull/84) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/84#issuecomment-6771431481) | 0.106 → 0.449 | 3 → 3 | 62406 |
| [garnet-labs/litellm#88](https://github.com/garnet-labs/litellm/pull/88) | Historical fork records | [best-effort](https://github.com/garnet-labs/litellm/pull/88#issuecomment-6771575904) | 0.098 → 0.318 | 1 → 1 | 8637 |
| [garnet-labs/n8n#45](https://github.com/garnet-labs/n8n/pull/45) | Historical fork records | [best-effort](https://github.com/garnet-labs/n8n/pull/45#issuecomment-7032132459) | 0.198 → 0.693 | 0 → 3 | 53344 |
| [garnet-labs/nodejs-goof#2](https://github.com/garnet-labs/nodejs-goof/pull/2) | Historical fork records | [best-effort](https://github.com/garnet-labs/nodejs-goof/pull/2#issuecomment-6926553661) | 0.088 → 0.274 | 0 → 1 | 297998 |
| [garnet-labs/nodejs-goof#3](https://github.com/garnet-labs/nodejs-goof/pull/3) | Historical fork records | [best-effort](https://github.com/garnet-labs/nodejs-goof/pull/3#issuecomment-6927622548) | 0.090 → 0.265 | 1 → 1 | 297998 |
| [garnet-labs/nodejs-goof#4](https://github.com/garnet-labs/nodejs-goof/pull/4) | Historical fork records | [best-effort](https://github.com/garnet-labs/nodejs-goof/pull/4#issuecomment-6930464777) | 0.102 → 0.356 | 0 → 2 | 297998 |
| [garnet-labs/pnpm#130](https://github.com/garnet-labs/pnpm/pull/130) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/130#issuecomment-6776083073) | 0.585 → 0.887 | 2 → 3 | 0 |
| [garnet-labs/pnpm#137](https://github.com/garnet-labs/pnpm/pull/137) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/137#issuecomment-6965595988) | 0.491 → 0.298 | 2 → 3 | 0 |
| [garnet-labs/pnpm#138](https://github.com/garnet-labs/pnpm/pull/138) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/138#issuecomment-6966763610) | 0.073 → 0.397 | 1 → 2 | 0 |
| [garnet-labs/pnpm#139](https://github.com/garnet-labs/pnpm/pull/139) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/139#issuecomment-6966754735) | 0.090 → 0.191 | 1 → 3 | 0 |
| [garnet-labs/pnpm#142](https://github.com/garnet-labs/pnpm/pull/142) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/142#issuecomment-7014423429) | 0.268 → 0.626 | 2 → 3 | 0 |
| [garnet-labs/pnpm#143](https://github.com/garnet-labs/pnpm/pull/143) | Historical fork records | [best-effort](https://github.com/garnet-labs/pnpm/pull/143#issuecomment-7014428505) | 0.198 → 0.466 | 3 → 3 | 0 |
| [garnet-labs/pnpm#161](https://github.com/garnet-labs/pnpm/pull/161) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/pnpm/pull/161#issuecomment-7147392179) | 0.089 → 0.147 | 1 → 1 | 21613 |
| [garnet-labs/posthog#235](https://github.com/garnet-labs/posthog/pull/235) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/235#issuecomment-6617032336) | 0.047 → 0.182 | 0 → 3 | 0 |
| [garnet-labs/posthog#240](https://github.com/garnet-labs/posthog/pull/240) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/240#issuecomment-6620077455) | 0.066 → 0.434 | 0 → 3 | 0 |
| [garnet-labs/posthog#247](https://github.com/garnet-labs/posthog/pull/247) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/247#issuecomment-6649599403) | 0.191 → 0.175 | 1 → 1 | 2465 |
| [garnet-labs/posthog#249](https://github.com/garnet-labs/posthog/pull/249) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/249#issuecomment-6663846680) | 0.066 → 0.395 | 0 → 3 | 0 |
| [garnet-labs/posthog#263](https://github.com/garnet-labs/posthog/pull/263) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/263#issuecomment-6849547333) | 0.119 → 0.673 | 0 → 1 | 2269 |
| [garnet-labs/posthog#266](https://github.com/garnet-labs/posthog/pull/266) | Historical fork records | [best-effort](https://github.com/garnet-labs/posthog/pull/266#issuecomment-6987588841) | 0.077 → 0.248 | 2 → 2 | 4654 |
| [garnet-labs/posthog#276](https://github.com/garnet-labs/posthog/pull/276) | Nov 20 PostHog shadow mirrors | [best-effort](https://github.com/garnet-labs/posthog/pull/276#issuecomment-7032274311) | 0.077 → 0.171 | 0 → 1 | 20411 |
| [garnet-labs/posthog#277](https://github.com/garnet-labs/posthog/pull/277) | Nov 20 PostHog shadow mirrors | [best-effort](https://github.com/garnet-labs/posthog/pull/277#issuecomment-7032489084) | 0.095 → 0.847 | 0 → 1 | 2224 |
| [garnet-labs/posthog#278](https://github.com/garnet-labs/posthog/pull/278) | Nov 20 PostHog shadow mirrors | [best-effort](https://github.com/garnet-labs/posthog/pull/278#issuecomment-7032565866) | 0.324 → 0.882 | 1 → 1 | 7196 |
| [garnet-labs/posthog#280](https://github.com/garnet-labs/posthog/pull/280) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/posthog/pull/280#issuecomment-7124810802) | 0.084 → 0.319 | 0 → 1 | 0 |
| [garnet-labs/posthog#282](https://github.com/garnet-labs/posthog/pull/282) | Nov 24–29 | [best-effort](https://github.com/garnet-labs/posthog/pull/282#issuecomment-7125189593) | 0.091 → 0.318 | 1 → 2 | 0 |
| [garnet-labs/roast#8](https://github.com/garnet-labs/roast/pull/8) | Historical fork records | [best-effort](https://github.com/garnet-labs/roast/pull/8#issuecomment-7030031694) | 0.132 → 0.374 | 3 → 3 | 0 |
| [garnet-labs/sentry-javascript#64](https://github.com/garnet-labs/sentry-javascript/pull/64) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/64#issuecomment-6642156217) | 0.064 → 0.175 | 3 → 3 | 0 |
| [garnet-labs/sentry-javascript#65](https://github.com/garnet-labs/sentry-javascript/pull/65) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/65#issuecomment-6642151143) | 0.067 → 0.309 | 0 → 0 | 0 |
| [garnet-labs/sentry-javascript#68](https://github.com/garnet-labs/sentry-javascript/pull/68) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/68#issuecomment-6678455015) | 0.056 → 0.372 | 0 → 0 | 0 |
| [garnet-labs/sentry-javascript#69](https://github.com/garnet-labs/sentry-javascript/pull/69) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/69#issuecomment-6678456877) | 0.206 → 0.238 | 1 → 2 | 0 |
| [garnet-labs/sentry-javascript#85](https://github.com/garnet-labs/sentry-javascript/pull/85) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/85#issuecomment-6931731647) | 0.104 → 0.259 | 0 → 0 | 0 |
| [garnet-labs/sentry-javascript#86](https://github.com/garnet-labs/sentry-javascript/pull/86) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/86#issuecomment-6935378182) | 0.102 → 0.398 | 1 → 1 | 0 |
| [garnet-labs/sentry-javascript#92](https://github.com/garnet-labs/sentry-javascript/pull/92) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/92#issuecomment-6977242676) | 0.070 → 0.285 | 0 → 1 | 0 |
| [garnet-labs/sentry-javascript#94](https://github.com/garnet-labs/sentry-javascript/pull/94) | Historical fork records | [best-effort](https://github.com/garnet-labs/sentry-javascript/pull/94#issuecomment-6985684308) | 0.080 → 0.190 | 1 → 1 | 0 |
| [garnet-labs/skyvern#7](https://github.com/garnet-labs/skyvern/pull/7) | Historical fork records | [best-effort](https://github.com/garnet-labs/skyvern/pull/7#issuecomment-6645156606) | 0.100 → 0.316 | 1 → 1 | 0 |

</details>

Collection exclusions and model failures are in the generated `rows.json` and `results.json` with evidence URLs. A missing record or unusable comparison is incomplete, not clean.
