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
