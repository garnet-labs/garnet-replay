# CI Contacts

**The task:** a pull request says X. What did its CI install/build job actually
run and contact on the network?

Each task is one pull request (title, description, diff) plus the kernel-level
execution record of its CI job, compared against an earlier recording. The
model answers with the new outbound destinations and a verdict:

```json
{ "new_destinations": ["api.ipify.org"], "verdict": "new-behavior" | "no-new-behavior" | "cannot-tell", "reason": "..." }
```

Two tracks:

- `diff`: title, description and diff only. This is what a reviewer sees today.
- `record`: the same inputs with the execution record alongside. This version
  inlines a rendered record. A tool-call variant, where the model fetches the
  record itself, is where the MCP lane plugs in.

## Answer key

The key comes from the recorded execution diff (`public/replays/**.json`), via
`answerKey` in `lib/ci-contacts.mjs`:

- `new-behavior`: the record compares two heads and shows workload destinations
  added. `hidden_from_diff` lists the ones whose hostnames do not appear in the diff.
- `no-new-behavior`: the record compares two heads, adds no workload
  destination, and declares capture complete.
- `cannot-tell`: there is no comparison base, or no workload destination was
  added but capture is not declared complete. Answering "no new behavior" here
  counts as `clean claimed without support`.

Runner-infrastructure destinations are distractors. Naming one counts against
precision and is reported as `runner-infra named`.

## Current set: 25 tasks, from existing records only

| group | tasks | what it tests |
|---|---|---|
| hidden new behavior | 3: `constructed-30305397518`, `constructed-30376868306`, `real-reference-31` | whether the model says "clean" when the change makes CI contact new hosts that the diff does not show |
| visible new behavior | 1: `constructed-30304293294` | a `postinstall` curl in plain text; a diff-only reviewer should catch it |
| unsupported clean | 21: 20 PostHog dependency PRs (capture not declared) and 1 first recording with no base | whether the model claims "no new behavior" over incomplete evidence |
| verified clean | **0** | false-alarm rate on genuinely clean PRs: **not measurable yet** |

Known limits. Read these before quoting any number:

- The set is small, and two of the three hidden tasks share a byte-identical
  diff (`constructed-30376868306`, `real-reference-31`). That leaves two
  distinct hidden shapes: a bundled transitive install script visible in the
  lockfile, and an opaque `file:` tarball with no lockfile.
- All hidden-behavior tasks come from `garnet-labs` demo repositories and use
  one beacon package. None is a third-party incident.
- The constructed tasks compare against a clean constructed install, not the
  PR's own parent.
- PostHog descriptions are omitted because they are the replay's own text, and
  the replay marker file is dropped from the diff. One `package.json` context
  line that names the recording harness is redacted (`task.redactions`).
- There are no verified-clean tasks. PostHog pairs are scored as
  unsupported-clean because their records carry no capture accounting, not
  because anything was found.
- There is no held-out split yet. Anything published here should be treated as
  training data from then on.

## Run

```sh
node benchmark/ci-contacts/build.mjs                    # tasks.json from seeds + records
ANTHROPIC_API_KEY=... node benchmark/ci-contacts/run.mjs --model anthropic:<model-id> --track diff
OPENAI_API_KEY=...    node benchmark/ci-contacts/run.mjs --model openai:<model-id>    --track record
GEMINI_API_KEY=...    node benchmark/ci-contacts/run.mjs --model gemini:<model-id>    --track diff
node benchmark/ci-contacts/run.mjs --model cmd:'<cli that reads stdin>' --name <label> --track diff
node benchmark/ci-contacts/score.mjs                    # results.md from runs/
```

To run offline, `--emit-prompts <dir>` writes prompt files that contain no
answer key. `--import <dir> --name <label>` reads `<dir>/<task>.txt` replies
back in.

## Next tasks to add

These are ordered by what the current set cannot measure:

1. **Verified-clean pairs**, the most important. Take real dependency bumps
   recorded with complete capture on an onboarded fork (one-commit replays),
   where the record shows no workload change.
2. **Hidden shapes, one per mechanism:** a registry version bump whose new
   release adds an install script (lockfile integrity change only), a
   build-plugin change, a `prepare` script in a git dependency, a binary fetched
   at build time, and a transitive dependency added through lockfile-only
   churn. Each needs a recorded pair with capture complete, so each goes
   through `replay setup` and `replay live` like any other replay.
3. **Real tasks from the prospect forks**, once strict `replay verify` passes
   for them.

## First reading (2026-09-25)

The first reading used three Claude models (Haiku, Sonnet, Opus), each run as a
Claude Code subagent, with one agent per model per track answering all 25
prompt files in one pass. Raw replies are under `runs/`, and the scored table is
in `results.md`.

| | Haiku diff | Sonnet diff | Opus diff | Haiku record | Sonnet record | Opus record |
|---|---|---|---|---|---|---|
| hidden new behavior flagged | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| hidden new behavior called clean | 3/3 | 1/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| visible `postinstall` curl flagged | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| clean claimed without support | 18/21 | 19/21 | 5/21 | 0/21 | 21/21 | 0/21 |
| false alarms | 3 | 2 | 1 | 1 | 0 | 0 |

What this shows, and what it does not:

- **The diff-only gap exists.** No model flagged any hidden-beacon task from
  the diff. The best diff-only behavior was to abstain (Opus, 3/3 cannot-tell).
  Haiku called all three clean.
- **Reading the rendered record is easy at this size.** Every model named the
  hidden destinations once the record was present. What separated the models
  was calibration: Sonnet read every "capture: not declared" record as clean
  (21/21), while Haiku and Opus did not.
- **The set rewards abstaining too much.** With no verified-clean tasks,
  answering "cannot-tell" everywhere costs nothing. Verified-clean pairs come
  before any public number.
- **This was not a clean experiment.**
  - Batching 25 tasks per agent let answers bleed across tasks:
    - Sonnet's diff answer for `real-142` cites the `ms` package from a
      constructed task.
    - Haiku's record answer for `real-182` lists the beacon hosts, which appear
      nowhere in that task.
  - The subagents could technically use tools, so they were only instructed to
    read their prompt files.
  - It was one pass, with no sampling variance measured.
  - Three diff-track "false alarms" on `constructed-30304258281` (adding `ms`
    fetches from the npm registry) are defensible readings. The key scores them
    as false alarms only because that record has no comparison base.

The next measured run should use `run.mjs` against the provider APIs, one
request per task, across several samples.
