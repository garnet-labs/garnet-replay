---
name: prospect-replays
description: Select five existing forks, run new canonical replays, independently cold-read each result, and return verified improvements to this repository.
---

# Five-prospect replay batch

Use when a human authorizes a batch of new replay PRs on existing forks.
The repository's root `SKILL.md` remains the replay procedure.
`workflow.py` coordinates that procedure through Devin's dynamic workflow
runtime; it is not a second replay implementation.

1. Fetch the current default branch. Read `README.md`, `AGENTS.md`, the root
   `SKILL.md`, and applicable mode docs. Record the full commit used.
2. Recover related active sessions and PRs. Reserve one writer per fork.
   Preserve existing PRs and default branches.
3. Invoke Devin's builtin `dynamic-workflows` skill. Explain the selection
   session, five producers, five independent readers, two-session concurrency
   limit, separate machines, and ACU use before launching.
4. Run `workflow.py` with `run_workflow`. The selector inventories accessible
   existing forks and records five rows. Each producer uses canonical CLI
   commands. A failed prospect remains in the results.
5. Save the returned workflow run ID. Resume interrupted work with that ID
   and unchanged inputs; inspect existing branches and PRs before resuming.
   Do not automatically rerun a completed batch: external evidence may have
   changed and a new invocation authorizes new writes.
6. The independent reader delegates approved rendered checks to the testing
   agent. A CLI PASS alone does not establish reviewer value or visual quality.
7. Reconcile all five outcomes. Fix demonstrated harness defects in this repo
   with focused regression checks; return blocked product issues to their owner.
   Never modify protected product repositories or silently weaken gates.
8. Keep validated operating knowledge here: procedure, candidate rubric,
   evidence schema, regression cases, and example links. Generated cards and
   logs remain in `out/` or attached to the session.
9. Only after this procedure has worked, consider a scheduled automation whose
   prompt fetches this repo and invokes this skill. Validate the exact schedule,
   access, run limits, and child-session approval settings before requesting
   activation. The schedule must not carry its own copy of the procedure.

## Acceptance

Each row separates workload success, capture status, hypothesis result, and
incremental reviewer value. Record source pair, fork pair, harness SHA, workflow
and action refs, run/job/attempt/profile, observation time, verification and
cold-read results. Missing evidence stays incomplete; unchanged does not imply
a failed experiment or a valuable demonstration.

The first batch completed with zero strictly accepted exhibits; see
[`docs/prospect-batch.md`](../../../docs/prospect-batch.md).
Publication automation remains inactive until its acceptance prerequisites pass.
Run `python3 -m py_compile .devin/skills/prospect-replays/workflow.py` for syntax.
