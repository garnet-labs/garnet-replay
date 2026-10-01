# Agent A/B: does Garnet runtime evidence change a coding agent's review?

One question, measured cheaply and reused many times: given a dependency pull
request, does the same frontier agent accept fewer policy violations, diagnose
them more exactly, and repair them, when the head-bound Garnet record reaches it?

## Task

Each task is one real npm package added to a constructed minimal app on the
fork `garnet-labs/express` (base branch `app-deps`, base dependency `ms@2.1.3`).
The package is real and published; the app context is constructed. Every task
is a prepared pair published with `replay live --prepared` (commit 1: the
recording workflow and app at baseline; commit 2: the package added), so the
record compares exact before/after heads and the recording workflow is
identical on both sides.

Policy the agent applies (`POLICY` in `lib/agent-ab.mjs`): the install/build job
must not contact destinations beyond the registry and runner infrastructure
unless the description discloses them.

## Cohorts

`score.mjs --cohort` and `run.mjs --cohort` select one or more:

- `baseline` (50): install-script, downloader, native and ordinary npm packages.
- `ai-infra` (34): AI runtimes, agent CLIs, MCP, model SDKs and vector stores
  (`onnxruntime-node`, `@anthropic-ai/claude-code`, `@openai/codex`,
  `@modelcontextprotocol/sdk`, `ai`, `langchain`, ...), each pinned to a version
  published at least a week before recording. Same constructed app.
- `prospect` (18, `prospect-tasks.json` via `build-prospects.mjs`): real upstream
  pull requests already replayed on prospect forks (Cline, Codex, Continue,
  DeepSec, Dub, Open-SWE, openai-node, OpenCode, OpenHands, pnpm, PostHog,
  Sentry JavaScript, MCP servers, uv, Vite). Real repository context, no
  repository tree tool, multi-ecosystem; the npm-registry policy wording makes
  this cohort exploratory, reported separately, never pooled into the headline.

## Answer key

From the finalized record only (`answerKey` in `lib/ci-contacts.mjs`, then
`truthFor`):

- `reject`: workload destinations beyond the registry added between the heads,
  not disclosed in the description.
- `accept`: a comparison exists, no such destination was added, and capture is
  declared complete. Records with capture not declared are `undeterminable`
  unless `score.mjs --admit-undeclared` is passed, which reports them as an
  explicitly labeled observed-clean stratum.
- Records that are pending, not head-bound, or without a comparison never enter
  `tasks.json` (`build.mjs`). The corpus `hypothesis` field is a sampling stratum,
  never a label.

## Arms (same model, same task, same tools, same scorer)

| arm | how the record reaches the agent | layer it tests (`docs/consumption-roadmap.md`) |
|---|---|---|
| `control` | not at all | today's reviewer |
| `tool` | `garnet_record` tool returns the rendered record on request | pull / MCP |
| `mirror` | verbatim Runtime Review comment between `garnet:evidence` markers in the description | 2 delivery |
| `guided` | `mirror` plus `live/templates/stage2/REVIEW.md` in the system prompt | 3 instruction |

`test/agent-ab.test.mjs` asserts the arms differ only in these places.

## What every episode records

`runs/<model>/<arm>/<task>.json`: full transcript, every tool call and result,
turns, provider-reported input/output tokens (`null` when the provider did not
report them, never 0), elapsed time, the structured submission
(decision, new destinations, responsible package, mechanism, repair files,
reason).

`score.mjs` derives per arm, on tasks every arm ran:

- false accepts / false rejects / decision accuracy with Wilson 95% intervals;
- exact diagnosis (decision plus exact violating hosts);
- turns, tool calls, tokens;
- reviewer consumption with the `replay consume` classifier: head-bound
  grounding (`Runtime evidence (Garnet, head <sha7>):` utterance or citation),
  record pulled (tool arm), runner-background destinations blamed on the change;
- paired sign tests per arm against control;
- repairs verified by re-recording (`repair.mjs`).

## Repair verification

`repair.mjs` takes rejects on recorded violations whose `repair_files` keep the
package at its version and touch only `app/package.json` / `app/smoke.mjs`,
regenerates the lockfile, and publishes the repair as a new prepared pair
(baseline = reviewed head). A repair counts only when that recording finalizes,
the install/import job succeeds, and none of the violating hosts appear.

## Running it for the most data per unit of cost

1. Record once: `prepare.mjs`, then `publish.sh <id> <name> <version>` per task
   (concurrency 6 is fine; `recorder health` skips the batch's own in-flight
   pull requests). Each pair is reused by every model, arm, and rerun.
2. Freeze: `build.mjs` writes `tasks.json` with the exact head, verbatim
   comment, receipt identifiers, and answer key.
3. Shake out on a cheap model and the `dev` split only.
4. Frontier models, all four arms, `dev` split; read transcripts.
5. `heldout` split (40%, SHA-256 bucket of the task id) once, at the end, with
   the protocol frozen.
6. Repairs for the best-performing treatment arm, then `score.mjs --split heldout`.

Cost is model tokens only; npm metadata and tarballs are cached per process.
`run.mjs` prices every episode from the gateway's published per-token rates,
sums recorded spend under `runs/`, checks `/v1/credits` before each episode, and
stops at `--budget-usd` (default 300) or `--credit-floor-usd` (default 2). A
model without published pricing, or a response without usage, stops the run:
unmetered spend is never assumed free.

## Limits to state with any result

- The app is constructed; packages, versions, and recorded behavior are real.
- One ecosystem (npm) and one CI shape (`npm ci` + import).
- The policy is network-destination based; it does not test code-level review.
- Records whose public profile or capture contract fails `replay verify` are
  reported, not hidden; the headline uses verified records only.
