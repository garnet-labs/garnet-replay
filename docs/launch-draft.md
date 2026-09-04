# Show HN draft — NOT PUBLISHED

Status: draft for human review. Nothing below has been posted anywhere. Every number carries its source and its date; anything that could not be re-probed in this session is marked ASSUMPTION or SNAPSHOT.

## Title (≤80 chars)

Show HN: Garnet Replay – paste a dependency PR, see what actually ran (base vs head)

Alternates:
- Show HN: Execution Diff for pull requests – what a dependency bump ran, not what it changed
- Show HN: Static reviewers read the diff. This shows you the run.

## Body

Static review tools read the diff. Garnet Replay shows you the run.

Paste a public GitHub pull request. If Garnet already recorded that PR's CI at the kernel (eBPF, via the `garnet-org/action` sensor), you get an Execution Diff back immediately: the processes, network destinations and files that appear in the head commit's execution and not in the previous recorded head, and the ones that disappear. Each side links to its full Execution Profile, and the whole thing is one JSON document:

```
GET /replays/github/{owner}/{repo}/{number}
{
  "repo": {...}, "pull_request": {...},
  "base": {"sha": "…", "profile_id": null, "run_id": null},
  "head": {"sha": "…", "profile_id": "…", "run_id": "…"},
  "comparison": {"available": true, "scope": "previous-recorded-head-to-head"},
  "execution_diff": {
    "processes_added": [], "processes_removed": [],
    "network_added":   [], "network_removed":   [],
    "files_added":     [], "files_removed":     [],
    "totals": {"workload": {"added": 0, "removed": 0},
               "runner_background": {"added": 3, "removed": 1}}
  },
  "receipt_urls": {"base": null, "head": "https://app.garnet.ai/public/runs/…?profile=…"}
}
```

Two things we think are worth knowing before you try it.

**1. Most dependency bumps do not change what runs.** We replayed 50 historical `posthog-js` and lockfile bumps from PostHog's own git history as two-commit PRs (baseline install, then the update) with the sensor on. Across all 50, the workload — the steps the workflow itself ran — added and removed zero network destinations. Every delta the record shows is runner background: the GitHub-hosted runner's own provisioning agents talking to their own endpoints, which we attribute structurally (no recorded workflow step, no `Runner.Worker` descent) and render as a separate section so it never gets counted as your code. That is the honest result and we show it as such.

**2. When something does change, it is visible in the same record.** The seeded examples that show new execution come from `garnet-labs/garnet-runtime-review-demo`, a repository we authored to exercise specific shapes: a postinstall script that spawns `node` and connects out during `npm install`; a beacon two dependency levels deep. They are labelled `constructed` on every surface, in the JSON and on the page. We did not find these in a random Dependabot PR and we do not want anyone to think we did.

The recorder is the open `garnet-org/action` (pinned by commit SHA in every workflow we generate). The renderer is dependency-free Node and posts with a plain `GITHUB_TOKEN`; no GitHub App is needed to read the result. Recording uses GitHub OIDC by default through `id-token: write`, so no Garnet secret is needed. `GARNET_API_TOKEN` remains an optional fallback, and fork pull requests cannot use OIDC. The generated workflow pins unreleased main SHA `e546567` (v2.3.0 is not cut yet); repin to the v2.3.0 SHA at release.

There is also a small benchmark in the repo: the same LLM reviewer, source-only vs source + Execution Diff, over the seeded PRs, scored for whether its judgment changed and whether its findings cite something that is in the record. [RESULTS TABLE — fill from benchmark/ once run with a key; do not publish without it.]

Links: [repo URL once public] · [3–5 permalinks once the website map is merged; until then link `app.garnet.ai/public/runs/{run}?profile={id}` directly].

## First comment (author)

Background on the sensor, since "eBPF in CI" invites questions.

- pnpm's own CI has been running with it since May 2026. SNAPSHOT (Jibril production DB, 2026-05-14 → 2026-07-31): 3,162 agents, 8,056,936 events, 2,600 Execution Profiles; roughly two-thirds of everything the database held at that date came from pnpm. The public pnpm profiles we link are from our fork's CI, not pnpm/pnpm's — pnpm/pnpm's runs are not publicly published (probed 2026-08-06: 404 logged out).
- The npm analysis feed (a longpoll on npm's `_changes` feed → static scan → escalate to a full eBPF audit) is where a Shai-Hulud-shape install surfaced for us. SNAPSHOT (Jibril prod DB, observed 2026-08-05; not re-probed this session): on 2026-08-04, 10 profiles across 6 `jadoonf/npm-analysis-feed` runs recorded the lineage `npm install → sh → node-gyp → python3 → sh → node → sh → bun → sh → sudo → python3`, with node processes reading credential files and flows to `169.254.169.254`, `release-assets.githubusercontent.com` and `api.github.com` — the keyv@6.0.0-wave kill chain as described by JFrog/Wiz. Package identity was not in the database; it has to come from the run logs before this is quoted. The separate "492 packages / 53,000+ analyzed" figures are website copy (`constants/evidence-stories.ts` on `dev`, lastUpdated 2026-06-12), not something I can source to a probe; the backing repos (`jadoonf/sha1-hulud-research`, `jadoonf/npm-analysis-feed`) are private and the public site is removing those cards (garnet-website-2026 #140). If this comment goes out: use the probed 2026-08-04 catch, drop the 492/53K numbers unless someone re-sources them.
- Honesty gap to state if asked about pnpm: pnpm profiles since the 2026-07-13 runner migration show "No network flows found", so their egress assertions hold vacuously. The 2,600-profile count stands; the egress visibility on the recent ones does not.

What it does not do: it does not block, gate, or score the merge. It records, attributes, and shows. The words we avoid on purpose, because the record does not support them: verified, flagged, pass, fail, threat, detected, caught.

## Pre-publish checklist (human)

- [ ] `garnet-labs/garnet-replay` exists and is public (currently: not created; token cannot create org repos)
- [ ] website #141 decision (merge, or close under the one-exhibit rule) and the permalinks re-probed logged-out after deploy
- [ ] benchmark run with `ANTHROPIC_API_KEY`; table pasted; the "reviewer clearly did not have this" example chosen
- [ ] SHA1-HULUD / feed sentences: keep only if the backing repos are public
- [ ] every URL in the post returns 200 logged out, on the day of posting
