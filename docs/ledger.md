# Garnet Replay ship ledger (session 3ae721fd)

| # | Instruction (verbatim/short) | Owner | Artifact | State |
|---|---|---|---|---|
| 1 | NEW PRIVATE repo `garnet-labs/garnet-replay` | Farrukh (create) / me (push) | local repo ~/repos/garnet-replay; mirror draft PR in agent-install-kit | awaiting-his-click (token 403 on repo create) |
| 2 | Execution Diff JSON contract generalized from build_block.py, incl. GET /replays/github/{owner}/{repo}/{n} | me + sidekick A | schema/execution-diff.schema.json, lib/execution-diff.mjs, public/replays | implemented (commit 8d65abd; 50 corpus replays validate; GET verified locally) |
| 3 | Known Evidence mode first, default, Jibril-independent | sidekick A | lib/known-evidence.mjs, bin/replay.mjs | implemented; live-PR fetch not verified (no GitHub token in env — 401) |
| 4 | Live Replay second: two-commit branch, SHA-pinned action, vendored review.mjs, v0 gate (public npm/pnpm/yarn dep PRs, Linux) with "unsupported" message | sidekick B | live/, renderer/compare.mjs, lib/gate.mjs, lib/profile-diff.mjs | implemented locally; GitHub OIDC is the default with `id-token: write`, action pinned to unreleased main `e546567`; optional `GARNET_API_TOKEN` fallback; fork PRs cannot use OIDC; dry-run gate verified; end-to-end run has still NOT been executed |
| 5 | Result view emphasising delta + [Full evidence][JSON][Share]; no /public/compare permalink | me | renderer/result-page.mjs | implemented (e92f56e); cold-read desktop + 390px, adjacency test over 50 PRs |
| 6 | 20–30 seeds; real-clean from corpus/pnpm, surprising from runtime-review-demo, labelled constructed; never imply Dependabot PR produced scary delta | sidekick D + my review | seeds/seeds.json + public/replays (24) | implemented (20 real / 4 constructed; 3 constructed diffs use scope constructed-pair vs clean demo install, cold-read hero page) |
| 7 | Benchmark wired (run_arms/score) over seeds, results table, ≥1 "reviewer didn't have this" example; no publish | sidekick D | benchmark/ | staged, dry-run only — results.md is all "not run"; no "reviewer didn't have this" example exists yet (needs ANTHROPIC_API_KEY: absent) |
| 8 | README: "static reviewers read the diff; this shows you the run", quickstart, Profile Evidence Catalogue link, no verdict vocab | me | README.md | implemented; vocabulary test guards it |
| 9 | 3–5 demo permalinks staged as draft PR in website, not merged | me | garnet-website-2026#141 (draft, base dev-public-contract-reset) | awaiting-his-decision: 5 exhibits vs #140 one-exhibit rule |
| 10 | Launch writeup draft (pnpm at scale, SHA1-HULUD via npm analysis feed) unpublished | me | docs/launch-draft.md | implemented; SHA1-HULUD facts relabelled per knowledge note (2026-08-04 catch is probed; 492/53K are website copy) |
| 11 | Reuse, don't rebuild; focus packaging + UX | all | vendored files byte-identical; ports not rewrites | in-flight |
| 12 | Final summary: staged vs deliberately undone | me | message | sent at wrap-up |
| 13 | Consolidation: plan/ledger moved into repo; no other copies remain outside (agent-install-kit copy already gone; website PR #141 selector map stays in website repo by necessity) | sidekick B | docs/plan.md, docs/ledger.md | implemented locally |

Hero-demo PR #31 uses distinct Garnet profile job names per matrix side because the control-plane agent dedupe index includes the job name.
Hero-demo PR #31 also lets the sensor settle for 30 seconds before export so short-lived install flows reach the sensor's flush cadence.

Local commits (9, no remote): 8d65abd e92f56e 72e4a20 a8f0c07 fecbb96 0c15575 d14f677 8d7046d ee412d7. npm test 19/19, demo.mjs --assert ok.
Open decisions for Farrukh: (a) create empty private garnet-labs/garnet-replay so I can push; (b) repin Live Replay to the v2.3.0 tag SHA at release; an end-to-end run has still NOT been executed; (c) 5 website exhibits vs one-exhibit rule on #141; (d) run benchmark for real (ANTHROPIC_API_KEY) before any launch claim; (e) renderer copy is 6.9.8, canonical is 6.10.0 — refresh before publish.

Deliberately undone: create repo/push · visibility flip · merge website PRs · benchmark run with key · any posting · control-plane path changes · any action/CP/jibril commit.
