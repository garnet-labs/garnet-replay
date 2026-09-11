# Agent interface: what an agent can rely on today, and what is missing

Audience: people deciding how coding agents (Devin, Claude Code, Cursor, custom
runners) should drive this harness, and the agents themselves. `SKILL.md` is the
procedure; this page is the contract and the gap list.

## What holds today

| Property | State | Where |
|---|---|---|
| Non-interactive | every command runs to completion or throws; no prompts | `bin/replay.mjs` |
| Plan before write | `live … --dry-run` and `stage2 … --dry-run` print the full plan and write nothing | `lib/commands.mjs` |
| Fork-only writes | asserted in code before the first push; upstream is never a write target | `lib/guards.mjs` |
| Resumable | rerunning `live` on an existing fork branch matches the fork head against commit 1 and commit 2 by tree, then by patch, and continues from there; a foreign head, extra commits past the base, a commit 1 rooted on an older base, or a closed pull request's leftover branch stops the run with `--branch <name>` as the way out | `publicationState` and the `reconcile` step in `lib/replay-pr.mjs` |
| Fail closed | pending, partial, stale, or unbound evidence is `undeterminable`; the wait step never treats a placeholder comment as a record | `lib/evidence.mjs`, `lib/wait.mjs`, `lib/receipt.mjs` |
| Exit code | `0` on success, `1` on any error (message on stderr) and on `verify` FAIL | `bin/replay.mjs` |
| Machine-readable state | one ledger per target, `targets/<slug>.json`, written by the commands; `status <slug>` prints the next command | `lib/ledger.mjs`, `lib/status.mjs` |
| Machine-readable artifacts | `out/<slug>/` holds the card, verify report, and consumption report as JSON beside the Markdown | `lib/commands.mjs` |
| Vocabulary gate | rendered artifacts are checked against `contract/vocab.json` before they are written | `assertVocabClean` |

An agent that follows `SKILL.md` can run `find → live --dry-run → live → verify →
card → status` today without a human in the loop, and cannot write anywhere but
the fork.

## What is missing for an agent-grade tool

Ordered by how much it removes from an agent's guesswork. None of these change
the evidence semantics; they change how the result is delivered.

1. **`--json` on every command.** Today the JSON is written to `out/` and the
   terminal gets prose. An agent wants one JSON envelope on stdout:
   `{ "command", "ok", "result", "next", "error": { "code", "message", "retryable" } }`.
   Prose moves to stderr or behind `--human`.
2. **Named exit codes.** `1` covers everything from "wrong flag" to "fork head is
   foreign". Agents branch on codes: `2` usage, `3` guard refused (fork, leak,
   commit count), `4` evidence not ready (rerun later), `5` evidence contradicts
   (do not rerun; redesign), `6` remote error (retryable).
3. **`replay next <slug>`.** `status` already computes the next command; expose it
   alone, in JSON, with the exact argv, so an agent never composes flags.
4. **Wait as a separate verb.** `replay wait <pr-url> [--commit 1|2]` returns
   `recorded | pending | failed` with the exact SHA it is bound to, so an agent
   can poll on its own schedule instead of holding a `live` process open.
5. **Idempotency keys in the ledger.** Each replay row already carries branch and
   SHAs; add a `runId` so two agents cannot open two pull requests for the same
   candidate, and `live` refuses when a row for the same transition is open.
6. **Structured refusals.** Guard failures currently throw prose. Emit
   `{ "guard": "fork-target", "expected", "actual" }` so an agent can report the
   refusal without parsing.
7. **Skill and MCP exposure.** `SKILL.md` is the skill. An MCP server should wrap
   only the read verbs (`find`, `status`, `card`, `verify`, `consume`) and the
   plan mode of the write verbs (`live --dry-run`, `stage2 --dry-run`); the write
   verbs stay behind the CLI so a human or an agent with shell access owns the
   push. No tool exposes arbitrary shell.
8. **Evidence schema for consumers.** `schema/execution-diff.schema.json` covers
   the record; add `schema/card.schema.json` and `schema/verify.schema.json` so
   review agents can validate what they cite.

Items 1 to 4 are a single change to `bin/replay.mjs` and `lib/commands.mjs` with
tests on the envelope shape; 5 to 8 each touch one module. None of them require
a change to the recording workflow or to any target repository.

## What an agent must not do

The rules in `AGENTS.md` apply to agents driving the CLI as much as to agents
editing it: fork-only writes, exactly two routine commits, no Garnet or session
wording on the fork, no claim past the captured record, `verify` before any share.
An agent that cannot get a finalized record reports `undeterminable` and stops.
