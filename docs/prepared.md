# Prepared two-state comparisons

Use `live <slug> --prepared <json> --work <checkout> --branch <new-branch>`
when the question compares two explicit states, such as two released binaries
under one resolver configuration. Run with `--dry-run` first.

The input is a JSON object with:

- `transition`: `name`, `from`, `to` strings identifying the comparison.
- `baseline`: repository-relative paths mapped to complete UTF-8 file contents.
- `change`: paths mapped to their second-commit contents. Every path must also
  occur in `baseline`. Unlisted paths retain the fork's current default state.
- `workflow`: a workflow path included in `baseline`, recording pull requests
  with `garnet-org/action`. Its path filter must include a changed path. If it
  requires a label, pass `--label`.

The input must include the complete controlled workload and locked bootstrap
dependencies. It does not install dependencies or infer commands. Review the
workflow before running: runner, fixture, environment, setup assertions, action
pins, and authentication are the author's responsibility. Use explicit-token
authentication or OIDC as appropriate for the target; do not combine them.
Workflow files cannot change in commit 2.

The checkout must exist and have no uncommitted or untracked files. A new branch
is created without replacing any existing branch. Both commits must change
files. Publication uses the same fork-only guards as upstream replays: push
commit 1, open the fork pull request, wait for its finalized head-bound record,
then push commit 2. `--no-wait` is refused. No comment is synthesized.

After an interruption once both local commits exist, repeat the input and branch
with `--resume`. Resume refuses a moved default base, additional commits,
undeclared changed paths, changed commit messages, or different file contents.
If interrupted while authoring a commit, inspect and finish the declared local
states before resuming; the command never discards partial work.

The comparison is `immediate-parent-to-head`. The second workflow still has to
finish and `replay verify <pr-url>` must pass before sharing. Prepared input,
successful commands, and successful CI alone are not runtime evidence.
