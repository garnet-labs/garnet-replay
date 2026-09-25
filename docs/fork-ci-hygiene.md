# Fork CI hygiene

Replay forks and POC repos in `garnet-labs` and `jadoonf` inherit upstream
workflows. Left on, their crons and bots burn Actions minutes and flood the
inbox with failures that have nothing to do with Garnet.

## Policy

On in forks/POCs:

- every workflow that runs `garnet-org/action`, directly or through a local
  reusable workflow it calls (`uses: ./` or `$/.github/workflows/...`)
- `garnet-*` support workflows (dependabot record/request/dispatch/publish,
  evidence gate/mirror, workload view, deepsec review)
- upstream CI that only fires on `pull_request` / `push` / `merge_group`
  (keeps the fork close to upstream and replay-ready)
- manual-only (`workflow_dispatch` / `workflow_call`) and branch-only replay
  workflows such as `garnet-record.yml`

Off: upstream workflows that fire on their own: `schedule`, `workflow_run`,
`issues`, `issue_comment`, `repository_dispatch`, including ones that mix
those with PR/push triggers.

Not in scope: Garnet product repos (garnet-replay, pulse, agent-install-kit,
garnet-runtime-review-reference, deepsec-plugin, product-testing,
action-testing-latest, jadoonf/npm-analysis-feed, garnet-incident-pipeline,
garnet-audit-harness, tabs-path-to-glory).

## 2026-09-23 cleanup

- Window analyzed: Actions runs since 2026-09-09 across 580 active repos.
- Disabled: 355 workflows in 72 repos (`disabled_manually`, verified
  355/355). About 4,400 runs in two weeks, about 1,200 failed.
  Cancelled 17 queued or in-progress runs. Run history was not deleted.
- Headline noise removed: posthog `ci-alerts-devex.yml` (Master CI Alerts),
  spawn `refactor.yml`, supabase `dashboard-pr-reminder.yml`, github-cli
  `dependabot-triage.lock.yml`, cli-1/github-cli `triage-scheduled-tasks.yml`,
  codeql-action `deflake.yml`, openclaw `pr-ci-sweeper.yml`, the two 15-minute
  `copilot-workflow-monitor.yml` pollers in garnet-agentic-harness-poc.
- Garnet schedules disabled for 0 successes in two weeks:
  analytics-and-bi `daily-report.yml`, ghaw-garnet-reference
  `daily-repo-status.lock.yml`, pip `ci.yml`, jadoonf/garnet-ai-security-demos
  `garnet-security-scan.yml`.
- Mixed cron+PR workflows kept on in replay forks: roast `ci.yaml`,
  pydantic `third-party.yml`, OpenHands `sdk-version-sync.yml`,
  openai-node `create-releases.yml`.
- Kept Garnet workflows failing on demand (worth a look): posthog
  `garnet-ci.yml` 0/4, codex `blocking-ci.yml` 0/9, linear `build.yaml` 0/6,
  qm `cicd.yml` 0/3.

Full list: [ops/fork-ci-cleanup-2026-09-23/disabled.tsv](../ops/fork-ci-cleanup-2026-09-23/disabled.tsv)
(repo, workflow id, file, triggers, reason).

| Repo | Disabled |
|---|---|
| garnet-labs/codeql-action | 64 |
| garnet-labs/openclaw | 28 |
| garnet-labs/n8n | 17 |
| garnet-labs/supabase | 15 |
| garnet-labs/posthog | 13 |
| garnet-labs/pnpm | 10 |
| garnet-labs/gh-aw | 10 |
| garnet-labs/ai | 9 |
| garnet-labs/spawn | 9 |
| garnet-labs/github-cli | 7 |
| garnet-labs/trivy | 7 |
| garnet-labs/clients | 7 |
| garnet-labs/codex | 7 |
| garnet-labs/langchain | 6 |
| garnet-labs/cli-1 | 6 |
| garnet-labs/goreleaser | 6 |
| garnet-labs/cline | 6 |
| garnet-labs/langchain-1 | 6 |
| garnet-labs/OpenHands | 6 |
| garnet-labs/pydantic | 5 |
| garnet-labs/prometheus | 5 |
| garnet-labs/open-swe | 5 |
| garnet-labs/vitejs-vite | 5 |
| garnet-labs/deepagents | 4 |
| garnet-labs/pydantic-ai | 4 |
| garnet-labs/dagger | 4 |
| garnet-labs/grype | 4 |
| garnet-labs/octokit.js | 3 |
| garnet-labs/sdk-internal | 3 |
| garnet-labs/pip | 3 |
| garnet-labs/cosign | 3 |
| garnet-labs/llama_index | 3 |
| garnet-labs/huggingface_hub | 3 |
| garnet-labs/hermes-agent | 3 |
| jadoonf/ultralytics | 3 |
| jadoonf/clinejection-poc | 3 |
| garnet-labs/rest.js | 3 |
| garnet-labs/continue | 3 |
| garnet-labs/browser-use | 3 |
| garnet-labs/build-push-action | 2 |
| garnet-labs/autogen | 2 |
| garnet-labs/express | 2 |
| garnet-labs/trufflehog | 2 |
| jadoonf/garnet-agentic-harness-poc | 2 |
| garnet-labs/opencode | 2 |
| garnet-labs/servers | 2 |
| garnet-labs/uv | 2 |
| garnet-labs/linear | 2 |
| garnet-labs/setup-node | 2 |
| garnet-labs/garnet-agentic-harness-poc | 2 |
| garnet-labs/openai-agents-python | 1 |
| garnet-labs/gato-streamlit-app | 1 |
| jadoonf/garnet-ai-security-demos | 1 |
| garnet-labs/ghaw-garnet-reference | 1 |
| garnet-labs/oss-collectors | 1 |
| garnet-labs/agentkit | 1 |
| garnet-labs/langgraph | 1 |
| garnet-labs/flask | 1 |
| garnet-labs/deepagentsjs | 1 |
| garnet-labs/checkout | 1 |
| garnet-labs/vite | 1 |
| garnet-labs/modal-client | 1 |
| garnet-labs/langsmith-sdk | 1 |
| garnet-labs/axios | 1 |
| garnet-labs/gatox | 1 |
| garnet-labs/neon-website-template | 1 |
| jadoonf/hf-test | 1 |
| jadoonf/chatgpt-vercel-clone | 1 |
| garnet-labs/dub | 1 |
| garnet-labs/analytics-and-bi | 1 |
| garnet-labs/roast | 1 |
| jadoonf/DEV_2026 | 1 |

## Replay impact

A disabled workflow does not run on any branch. If `live --record instrument`
targets an upstream workflow file that is in the list, enable it first:

```sh
ops/fork-ci-cleanup-2026-09-23/restore.sh garnet-labs/<fork> <file>.yml
```

## Undo

```sh
ops/fork-ci-cleanup-2026-09-23/restore.sh                      # all
ops/fork-ci-cleanup-2026-09-23/restore.sh garnet-labs/posthog  # one repo
```

New forks: apply the same policy right after forking. `gh workflow list --repo <fork>`
then `gh workflow disable <id>` for each self-triggering upstream workflow.
