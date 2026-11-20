# Infisical onboarding bundle

Prepared for the future `garnet-labs/infisical` fork. Nothing in `files/` is
installed on a fork yet. Copy paths relative to `files/` into the fork only
after checking the then-current default branch for conflicts. Do not copy
the surrounding research report into a fork PR body.

## Commit groups

1. One onboarding commit, routine title `ci: record dependency installs`:
   `.github/workflows/garnet-record.yml` plus the five reviewer kit files and
   `.greptile/rules.md`. The current source has `.greptile/config.json`;
   retain it. Run `replay ground infisical --dry-run` after the fork exists
   and reconcile with its safe merge plan before publication. Merge this
   onboarding PR on the fork before any replay. The workflow file change
   triggers the first recording, including a default-branch baseline on merge.
   Push recording also covers `baseline/**`, so historical fork-only base
   branches schedule their own dependency-install capture. Wait for that
   capture before accepting the head's compared pair.
2. One separate onboarding commit, routine title `ci: add review checks`:
   `tools/`, `.stamphog/`, `.github/merge-gate/`, `.github/scripts/`, and the
   other three workflows. Merge on fork `main`. Do not replace upstream
   workflows or policy files without checking for conflicts.

The recorder uses Node 26, matching the frozen source's `.nvmrc` and backend
engine requirement. It measures `npm ci` in `backend/` and `frontend/` under
the pinned v2.5.2 action. Frontend install is attempted even after backend
install failure; a failed install still fails the job. Existing npm release
age and script-allowance policies are retained. No application, Go, database,
browser, Cipher visual-workload, or build command is measured.

The recorder triggers only when either package manifest/lockfile or the
recorder workflow changes. It does not record every code-only PR. PR 9694
does not reach these filters and is replaced by merged dependency PR 9022;
its visual workload is outside the declared scope in any case.

All ten selected replays use `base_branch=baseline/<number>`, carrying the
approved recorder and reviewer guidance onto the exact historical source base.
The resulting fork baseline tip differs from the raw upstream base SHA.
For App comments, `replay verify` does **not** require `summary.previous` to
equal that tip: it checks the current head and a recorded compared SHA, not
historical-baseline selection. Before calling a pair valid for this cohort,
independently require the finalized head record's compared SHA to equal the
actual fork baseline tip, and inspect the successful baseline run's exact-SHA
profile and capture. The planner pushes baseline and head without waiting for
baseline finalization; scheduling alone does not establish comparison order.

## Gate modes

- `Merge gate`: the canonical standalone PostHog comment relay, with optional
  read-only `--dry-run`. This is a separate consumer, not the StampHog engine.
  Its manual workflow defaults to dry run. Missing or malformed comments
  print `skipping` and return zero; that is not evidence acceptance. The
  inherited parser reads the first 100 PR comments/files and may miss later
  records. A best-effort CHANGED is a scoped observation, not a pass.
- `Stamphog Review`: dispatch with `pr_number`. Always passes `--dry-run`,
  checks out trusted `main`, and never checks out or executes the PR head.
  It accepts manual dispatch for bot-authored PRs. The local engine adaptation
  permits bot authors only in dry-run mode; full-review bot refusal remains.
  It fetches the head for analysis but does not install the PR workload.
  `DRY-RUN` is published as `DRY_RUN` in the cohort receipt, never APPROVED.
- `Garnet merge check`: the harness `garnet/merge-safety` template pinned to
  `8664272347a9489f250040f8ef2b059f10729be4`. Hold or undeterminable fails.
  It checks out only the trusted harness, never PR code. Branch protection
  is not configured by this bundle; it is advisory until made required.

The StampHog publisher emits `<!-- stamphog-sticky-review -->` and
`reviewed <full head SHA> — verdict: ...` in the exact code-span form expected
by `lib/cohort-rows.mjs`; it runs as `github-actions[bot]`. Runtime citations
are preserved in the JSON and gate-only sticky receipt when available.
The removed PostHog Dependency proof attestation points at a workflow absent
from Infisical; the runtime-evidence consumer remains enabled. No absent
attestation is claimed. Ownership is advisory: the vendored resolver supports
PostHog's distributed ownership files, not Infisical-specific ownership policy.

## Required configuration

| Location | Required configuration |
|---|---|
| Fork recorder | No custom secret or variable. OIDC: `contents: read`, `id-token: write`, no `api_token`. Garnet App installation and project linkage still must be verified. |
| Fork standalone relay | Built-in `GITHUB_TOKEN`; read contents and write issues/PR comments. No LLM key. |
| Fork StampHog | Built-in `GITHUB_TOKEN`; contents/checks/statuses read, issues/PRs write. `ANTHROPIC_API_KEY`, gateway keys, and `GARNET_API_TOKEN` are not used. |
| Fork merge-safety | Built-in `GITHUB_TOKEN`; contents and PR read. Public pinned harness must remain readable. |
| Harness hosted replay | Existing `REPLAY_FORK_TOKEN` with fork writes and upstream read. No new fork token secret is provisioned here. |
| Optional harness receipts | `RECEIPTS_DISPATCH_TOKEN` and `RECEIPTS_REPO`; absent values skip notification, not replay verification. |

GitHub-hosted runners, Actions enabled, and permission to publish workflow
comments/artifacts are prerequisites. `uv` installs the engine's pinned Python
dependencies; deterministic mode does not require an LLM credential. Gate
execution is deliberately not separately sensor-recorded, avoiding unrelated
gate jobs contaminating the dependency-install comparison.

## Checks

```sh
python3 docs/infisical-onboarding/check_gate.py
PYTHONPATH=docs/infisical-onboarding/files/tools/pr-approval-agent:docs/infisical-onboarding/files/tools/owners \
  python3 -m pytest -q docs/infisical-onboarding/files/tools/pr-approval-agent/test_review_pr.py
```

The second command needs Python 3.12+, pytest, PyYAML, click, anthropic 0.80.0,
and posthoganalytics 7.20.4; existing tests stub the agent SDK. The first uses
only Python's standard library. Neither invokes a live review or GitHub write.

`preflight.json` retains the ten upstream base/head pairs, all file paths,
current-main patch checks, and trigger eligibility. `plans.json` contains
hypothetical pure-planner summaries and refusal reasons, not hosted prepare
receipts. The operator must prepare again against the actual onboarded fork.
