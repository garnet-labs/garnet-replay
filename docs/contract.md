# Evidence contract

Every replay JSON (`schema/execution-diff.schema.json`, `schema_version:
execution-diff/v1`) carries five evidence blocks in addition to the diff itself.
`lib/evidence.mjs` computes them; `withEvidenceFields()` attaches them to any
diff that lacks them. Nothing outside `claims` is a supported statement.

## `capture` — did the run record what it claims?

```json
"capture": {
  "status": "complete | partial | none | not-declared",
  "expected_cells": 6, "recorded_cells": 6,
  "executed_sha_verified": 6, "lineage_missing": 0,
  "final_record": true,
  "reasons": []
}
```

A cell is one recorded side (`baseline` or `update`) and repetition, with the
SHA the job was asked to run and the SHA it executed. Fewer cells than expected,
a missing profile, an executed SHA that differs from the expected one, cells on
different runner identities, or chains whose lineage was not recorded make the
capture `partial`, with each reason listed. When a record carries only the App's
own `status`/`capture_quality` markers, those decide. A record with no
accounting at all is `not-declared`, and no completeness is claimed.

## `verdict` — what may be said about the comparison

| Verdict | Phrase on rendered surfaces | When |
|---|---|---|
| `new-behavior` | new behavior recorded | complete capture, workload connections added, no variance |
| `unchanged` | no new behavior recorded | complete capture, comparison available, nothing added, no variance |
| `recorded` | first record, no comparison | complete capture, no previous commit to compare against |
| `undeterminable` | undeterminable | capture `none`, `partial`, or `not-declared`; stale or unbound evidence; missing delta counts; variance between repetitions |

Partial, stale, or incomplete evidence never establishes a comparison verdict.
Recorded observations remain visible while the result is undeterminable.
Every verdict carries `reasons`, and the first reason is the
one the card and the comment print.

## `pair` — which two commits, at what scope

```json
"pair": {
  "base_sha": "…40…", "head_sha": "…40…",
  "scope": "pr-base-to-head",
  "label": "real",
  "transition": "puppeteer 24.40.0 → 25.9.0",
  "line": "base 1a2b3c4 → head 5d6e7f8 · scope pr-base-to-head · puppeteer 24.40.0 → 25.9.0 · real"
}
```

Scopes: `pr-base-to-head` (a real pull request replayed on the fork),
`immediate-parent-to-head` (commit 2 against commit 1 of a transition),
`previous-recorded-head-to-head` (the App's own comparison on a branch),
`constructed-pair` (seeds only), `unavailable`. The Garnet comment's own header,
`@@ <prev7> (previous) vs <head7> (this commit) @@`, is the same pair in the
App's words; `replay verify` accepts either as long as `head7` is the pull
request head.

## `supersession` — is the record still about this pull request?

```json
"supersession": { "superseded": false, "record_head": "…", "current_head": "…", "reasons": [] }
```

A new head commit, a rebase that moves the base, or a record with no head SHA
supersedes the record. Superseded records are not evidence for the current pull
request; cards and `verify` fail closed on them.

## `claims` — every sentence, with its class

| Class | Meaning |
|---|---|
| `observed-runtime-behavior` | what the record shows on the head: workload and runner-background connection counts |
| `comparison-result` | the verdict sentence between base and head at the stated scope |
| `required-check-state` | the state of `garnet/evidence` or the recording check on this head |
| `reviewer-consumption-evidence` | a reviewer or agent cited this record, with the URL |
| `unsupported-claim` | what the record does not carry: compile or build success, file writes outside the recorded file kinds, secret reads, absence of behavior in unrecorded jobs, that nothing else happened; plus the undeterminable reasons |

One-pagers, cards, and Slack posts copy claims verbatim. A sentence with no
class is not a claim the harness makes.

## Repetitions and variance

`repetitions.variance` counts destinations seen in some repetitions of a side
but not all. `stableAcrossRepetitions()` separates stable from varying
destinations; varying ones are excluded from the comparison and reported. With
any variance, the verdict is `undeterminable`.

## Public report and card gates

Live `verify` reads the anonymous API for each job's public run/profile link and
requires the exact repository, run ID, profile ID, and current PR head SHA.
Malformed selectors, missing identity, HTTP errors, and merge-ref identities
fail the gate. This proves identity, not completeness or causality; declared
complete capture is a separate required leg.

Cards quote all recorded job sections, including unchanged workload trees and
runner background. They expose capture and the actual previous-recorded/head
pair. If the ledger identifies that previous SHA as commit 1, scope is immediate
parent → head; a source-PR scope does not override a different recorded pair.
An undeterminable card can retain quoted observations for diagnosis, but is not
a shareable exhibit. Reviewer outcomes and workload scope require a cold read;
they cannot be inferred from a green recording job or destination counts.

## Vocabulary

`contract/vocab.json` is vendored from the Runtime Review testbed. Banned words
(`baseline`, `verdict`, `score`, `clean`, `safe`, `detected`, `threat`,
`process chain`, `Runtime Review` …) may not appear in renderer-owned copy on
rendered surfaces; machine JSON keeps its field names. Residue terms (`devin`,
`harness`, `execution diff`, session URLs) may not appear anywhere on the fork.
`assertVocabClean()` and `assertOutbound()` in `lib/guards.mjs` are the tests.
"Execution Diff" is the internal block name; people read "new behavior".

## `intent` — declared claims checked against the scoped delta

Optional block on the diff (present only when claims were declared, e.g. via
`replay pair --steps … --claim …` or `--intent file.json`):

```json
"intent": {
  "outcome": "supported | contradicted | needs-explanation | undeterminable",
  "steps": ["Run E2E test"],
  "claims": [
    { "id": "storefront-removed", "kind": "network",
      "match": { "destination": "mock.shop" },
      "expect": "present-before-absent-after",
      "outcome": "supported", "before": ["mock.shop"], "after": [],
      "steps": ["Run E2E test"], "source": "pr-body" }
  ],
  "uncovered": { "added": [], "removed": [] },
  "stepsMissing": { "base": [], "head": [] }
}
```

A claim is `kind` (`network` or `process`), a `match` (`destination` exact or
`*.suffix` for network; `ancestry` substring for process; omitted for
`no-added`/`no-removed`), an `expect`
(`present-before-absent-after`, `absent-before-present-after`, `present-both`,
`absent-both`, `no-added`, `no-removed`), and optional `steps` naming the
recorded workflow steps (ordinal stripped) it is scoped to. Per-claim
outcomes:

| Outcome | When |
|---|---|
| `supported` | both sides recorded, complete capture, steps present, predicate holds |
| `contradicted` | same preconditions, predicate false |
| `unobservable` | preconditions hold but the matched behaviour appears on neither side (removal/addition cannot be told apart from "never exercised") |
| `undeterminable` | a side is null, capture is not complete, or a scoped step is missing on either side |

Aggregate `outcome`: `supported` only when every claim is supported and the
scoped delta holds no added or removed workload row outside the claims;
`contradicted` when any claim is; `needs-explanation` when all claims are
supported but uncovered delta rows remain; otherwise `undeterminable`. The
block emits one `intent-check-result` claim in `claims`. Runner background
rows never count toward a claim. Step scoping also restricts the diff's
workload `network`/`process` rows to the declared steps and reports
`execution_diff.steps` / `steps_missing`.

## `intent-check-result` — did the record carry the stated change?

Added to the `claims` class enum. One line is emitted when an `intent` block
exists: the aggregate outcome and the claim count over the declared steps.
It never judges safety and never reads as "verified" or "clean".
