# Garnet Replay MVP: hard-mode plan (private, no publish)

## Strategic object
`PR → base execution + head execution → Execution Diff → JSON`, HTTP+JSON only.
Launch narrative: the reviewer benchmark (source-only vs source + Execution Diff).

## Facts that shape the plan (all live-probed this session)
1. Repo creation blocked: the Devin GitHub token is an App installation token; `POST /orgs/garnet-labs/repos` → 403. Farrukh must create the empty private repo `garnet-labs/garnet-replay` (or grant repo-creation). Until then the tool is built as a standalone git repo locally and mirrored as a draft PR branch in the private `garnet-labs/agent-install-kit`, so it stays reviewable now and moves with one `git push` later.
2. Known Evidence is already control-plane truth: the App comment on a PR is rendered by control-plane from `ProfilesForGitHubPRCommit` + `PreviousGitHubPRCommitSHA` (`garnet:summary.previous`). Parsing that comment (fetch_corpus.py, exact-head gate) yields base/head SHAs, receipt ids and the diff, with only `GITHUB_TOKEN`. No control-plane change. Full head profile: `app.garnet.ai/api/public/runs/{run}?profile={id}` (200 logged out, probed).
3. All 50 posthog corpus PRs are `garnet_exact_head=true` with contract 6.10.0 and zero workload delta (all churn is runner background). Hero deltas must come from `garnet-labs/garnet-runtime-review-demo` runs (30304293294 postinstall beacon, 30305397518 transitive beacon; both 200 logged out), labelled constructed.
4. Live Replay recording needs `GARNET_API_TOKEN` at pinned `garnet-org/action@3d47f4a… # v2.2.0` (throws without `api_token`). Comment/JSON path is GITHUB_TOKEN-only. Stated as such in copy; never claimed tokenless.
5. Vendored renderer is garnet-ui `cmd/garnet-runtime-review` at CONTRACT_VERSION 6.9.8 (origin/dev and origin/main both 6.9.8); the App comments are 6.10.0. Vendored byte-identical, labelled 6.9.8 in VENDORED.md; re-vendor when garnet-ui ships 6.10.0.
6. Benchmark harness (`run_arms.py`, `score.py`) needs `ANTHROPIC_API_KEY`; not present in this environment. Wiring is staged and dry-run tested; the actual run is a human/keyed step.
7. Website: #140 `dev-public-contract-reset` (draft) already adds the canonical exhibit `32909555254` and enforces "one exhibit". Permalink additions are staged as a draft PR stacked on that branch, and the one-exhibit tension is flagged rather than resolved unilaterally.

## Repo layout (`garnet-replay/`)
```
README.md                      static reviewers read the diff; this shows you the run
schema/execution-diff.schema.json   the contract (rename of build_block.py's block)
lib/execution-diff.mjs         build_block.py port: comment → Execution Diff JSON
lib/receipt.mjs                fetch_corpus.py port: PR → App comment, exact-head gate, markers
lib/known-evidence.mjs         PR URL → Execution Diff (default mode)
lib/gate.mjs                   Live Replay v0 support gate (public, npm/pnpm/yarn, dep PR, Linux)
bin/replay.mjs                 CLI: known <pr-url> | live <repo> [--dependency] | serve | seed
renderer/review.mjs, demo.mjs  vendored verbatim from garnet-ui (6.9.8)
renderer/compare.mjs           two-profile comparison comment (delta-first, reuses review.mjs trees)
renderer/result-page.mjs       delta-first HTML result view: [Full evidence] [JSON] [Share]
live/replay-branch.mjs         two-commit baseline→update branch + workflow injection
live/templates/                garnet-dependency-replay.yml (SHA-pinned), install.sh, compare wiring
public/replays/github/{owner}/{repo}/{n}.json   static GET shape
public/replays/github/{owner}/{repo}/{n}/index.html
seeds/seeds.json               20–30 entries, source + label (real-clean | constructed)
benchmark/README.md, run.sh    wraps posthog run_arms.py/score.py over seeds; results table template
docs/launch-draft.md           Show HN draft (unpublished)
test/*.test.mjs                node:test; renderer --assert; schema validation; fixtures from corpus
```

## Honesty gates (CI in the repo)
- Every seed labelled `real-clean` must come from corpus.json with `garnet_exact_head=true`; every `constructed` seed must point at garnet-runtime-review-demo and carry the label in JSON and on the page.
- Aggregates on the result page equal the lists rendered beneath them (adjacency test).
- No verdict vocabulary in copy: `/verified|flagged|pass|warn|fail|threat|detected|caught|security scanner/i` gate over README, page, comment.
- Vendored renderer `demo.mjs --assert` passes; vendored files byte-equal to recorded upstream SHA.

## Lanes
- Lane A (sidekick, now): repo skeleton, schema, receipt/execution-diff ports, known-evidence CLI, static GET layout, tests. I author schema + gates text.
- Lane B (sidekick, after A): Live Replay (replay-branch.mjs, templates, gate.mjs), compare.mjs integration, tests.
- Lane C (me): result page HTML (rendered-browser artifact), cold read desktop + 390px.
- Lane D (sidekick): seeds.json from corpus + demo cases, benchmark wiring + dry-run, launch draft skeleton from evidence-stories.ts (I write the copy).
- Lane E (me): website permalink draft PR stacked on #140 branch; agent-install-kit mirror draft PR.

## Deliberately undone (human triggers)
Create `garnet-labs/garnet-replay` (private) and push · flip visibility · merge website permalink PR · merge #140 · run benchmark with a key · post anywhere.
