# Garnet × pnpm: value wedges that survive a cold read

Grounding for everything below (verified in `garnet-labs/pnpm` @ current fork HEAD):

- Garnet runs in exactly one CI cell — `ci.yml` matrix `node 24 / blacksmith-8vcpu-ubuntu-2404 / garnet: true`, via `test.yml` → `garnet-org/action@v2.2.0`. Plus `release.yml` verification jobs, `update-latest.yml`, the Dependabot fixture workflow, and the fork evidence mirror.
- Garnet does **not** run on any workflow he actually watches for value: `benchmark.yml`, `pacquet-integrated-benchmark.yml`, `pacquet-micro-benchmark.yml`, `ecosystem-e2e.yml` — all `blacksmith-*-ubuntu-2404`, all jibril-capable, all uninstrumented.
- Bencher gets its data from `ci-performance-bencher-upload.yml`: a trusted `workflow_run` job that downloads untrusted artifacts, then `bencher run --project pnpm-ci-performance --testbed <t> --adapter shell_hyperfine --file <f> --branch <pr branch> [--start-point main --start-point-reset --start-point-clone-thresholds]`. Testbeds include `pnpm.ubuntu.node24` — i.e. **the Garnet-instrumented cell is already a named Bencher testbed**.
- `pacquet-integrated-benchmark-comment.yml` is the trusted PR-comment path; `pacquet-ci.yml` stages `pacquet-tests-all.json` / `pnpr-tests-all.json` + testbed metadata for that upload.
- Bencher accepts arbitrary metrics: BMF JSON + `--adapter json`, unknown measures auto-created, thresholds/alerts apply to them like latency (bencher.dev/docs/reference/bencher-metric-format).
- The action already has the diff machinery: `summarizeProfile`, `edgeCounts`, `compareJobEdges(headEdges, previousEdges)`, `pairWithPreviousJobs`, `renderJobDiffTree(job, delta, headSha, previousSha)` — commit-to-commit execution/egress diffs, already rendered.
- Jibril assertions today are a **fixed security set** (bad egress domain, proc-mem injection, binary-exec-and-delete). No user-defined assertions. Control plane does have global/repo/workflow-scoped network policy with allow/deny on CIDR + domain.

The gap in one line: **Bencher answers "is this change better or worse?" Garnet answers "what happened." Only the first is a decision; the second is a document.** Every wedge below converts Garnet output into a comparison against a baseline, because that is the shape of the only CI output he has said he gets value from.

---

## Tier 0 — the thing we sold, still not delivered (do first, it's nearly free)

**A. Instrument the release path he named, and give the release an egress verdict.**

He bought "monitor egress on anything that touches release path, tokens, etc." Today `release.yml` has Garnet on verification jobs, but the jobs that hold the credentials — `id-token: write` OIDC publish, `NPM_TOKEN`, `pn publish --provenance`, the Rust/pnpr publish and attestation stages — are the interesting ones, and the instrumented cell is not where the secrets are.

Do:
1. Add the action to the Linux publish/build/attest jobs in `release.yml` (one `uses:` per job; zero new permissions — the fork already has `GARNET_API_TOKEN`).
2. Create a **workflow-scoped network policy** for `release.yml` in the control plane: allow registry.npmjs.org, GitHub API/uploads, sigstore/fulcio/rekor, crates.io + static.crates.io, the Blacksmith/cache endpoints. Start in observe mode.
3. Output one line per release: *"publish reached 6 destinations, all expected"* — plus the diff against the previous release's egress set.

Why it matters daily: it isn't daily, it's per-release, but it's the exact promise he agreed to, it's the only surface where "unexpected destination" is a genuine stop-the-line event, and after the first release the policy diff is self-maintaining. Cost: a handful of workflow lines + a policy we own. This should not be blocked behind any of the below.

---

## Tier 1 — get inside the loop he already reads (cheapest real inline value)

**B1. Ship Garnet counts to Bencher as measures. Don't build a second dashboard.**

Turn the profile into BMF JSON and push it through his *existing* trusted upload job as extra measures on the testbed that already exists:

```json
{
  "install/frozen-lockfile": {
    "registry-connections":  { "value": 0 },
    "distinct-egress-hosts": { "value": 1 },
    "processes-spawned":     { "value": 412 },
    "dns-resolutions":       { "value": 3 }
  }
}
```

Then his own machinery does the work: `--start-point main --start-point-clone-thresholds` gives baseline comparison, thresholds give alerts, the existing comment shows the delta. He learns nothing new, configures nothing new.

Why this is the wedge and not a nice-to-have: these counts are **near-deterministic**, unlike wall time on shared Blacksmith runners. A count going 0 → 3 is a real signal at n=1; a 4% time change is not. We'd be handing his perf system the only metrics in it that can't be flaky. That's an argument he can check himself.

Implementation reality (be honest internally): the profile is only complete when jibril stops (action post step), so metrics must come from either (a) a new action output/file written in the post step — small change in a repo we own — or (b) server-side: the trusted upload job pulls the run's profiles from the Garnet API and emits BMF. (b) needs **zero** changes to the action and fits his architecture exactly (his upload job is already the "fetch untrusted data, upload with credentials" boundary). Prefer (b).

**Hard design constraint:** do not instrument a *timed* benchmark cell. Jibril in-job perturbs the exact number Bencher is measuring (and our post-step wall cost has been material). Emit counts from a non-timed profiling run of the same command, or from the already-instrumented CI cell. If we get this wrong once, we've corrupted his primary signal and we're out.

**B2. Be the "why" attached to his alerts (pure glue, no new product).**

When Bencher alerts a regression, the next question is always "what extra work happened." That answer already exists in the profile for the same SHA: extra registry round trips, new DNS, more child processes, a cache path that stopped being hit. Put the Garnet permalink for the matching run into the benchmark comment his `pacquet-integrated-benchmark-comment.yml` already posts. One link, in the message he already reads, at the moment he already cares.

---

## Tier 2 — the killers nobody has said

**C1. The "no-work" oracle: make Garnet the invariant test for pnpm's laziness claims.**

pnpm's entire competitive story is *not doing work*: frozen-lockfile installs, optimistic repeat install, CAS/store reuse, the Global Virtual Store, fast update, "prefer the workspace package and skip the registry," "skip the server exchange when there's nothing to resolve," pnpr resolving locally.

Every one of those is a claim of the form **"this operation must perform zero of X"** — and he has no oracle for it. Wall time is a proxy that hides the failure: a regression that reintroduces one avoidable HTTP round trip or one redundant tarball extraction costs ~30ms, disappears into runner noise, and is nonetheless a real bug in the feature's whole reason for existing. It ships, and it's found months later by a user with a cold cache and a slow network.

Garnet is the only tool in his CI that can assert it, at the kernel, on the real command:

- repeat install with unchanged lockfile → **0** connections to registry.npmjs.org
- warm store install → **0** tarball fetches, N CAS reads
- `--offline` / frozen CI install → **0** egress, full stop
- pnpr-backed resolution → no traffic leaves the box
- lifecycle scripts → exactly the interpreters `onlyBuiltDependencies` permits

Inline shape: a small set of named invariants, one CI check, and a per-PR delta when one flips. Feasibility: expressible today as a consumer of the profile JSON (invariants are counts + destination sets over data we already emit) — it is **glue we write, not a jibril feature**; user-defined assertions don't exist in the product, so don't promise them. Prototype one invariant end-to-end on the fork against his real benchmark command before we say a word about it.

Why it's killer: it is perf (his stated #1), it's a pass/fail decision not a document, it is unfakeable by any other tool in his stack, and the output doubles as public proof — "pnpm makes zero network calls on a repeat install, kernel-verified, every commit" is a claim he'd want to publish, and it comes with a permalink.

**C2. pacquet ↔ pnpm parity fingerprint — the Rust rewrite's missing gate.**

The rewrite's real risk is silent behavioral divergence, and his current gates are exit code, snapshot output, and wall time. None of them see *how* the work got done. `ecosystem-e2e.yml` already installs the same real-world dependency stacks with both implementations and both layouts on Linux, daily.

Profile both cells and diff the fingerprints: same registry endpoints and same number of them? extra DNS resolutions? extra child processes (`node-gyp`, `git`, a shelled-out tar)? does the Rust path spawn an interpreter the TS path never did? does one write outside the store?

Each divergence is either a bug or a deliberate perf win — which is precisely the question a rewrite review is trying to answer, on every PR. The action already renders exactly this diff; here the axis is "binary A vs binary B" instead of "SHA vs previous SHA", which is a projection change over machinery that exists (`compareJobEdges` / `renderJobDiffTree` don't care where the two edge sets came from).

This is the highest-ceiling wedge: it attaches Garnet to the project's top strategic risk, in a workflow that already exists, and there is no other product on the market that produces it.

**C3. Dependency-bump behavior diff, wired to features he already built.**

He already merged the Dependabot fixture-install profiling workflow. Level it up into a reviewer verdict, framed in *his* vocabulary: pnpm has `trustPolicy`, `minimumReleaseAge`, `onlyBuiltDependencies` — features whose whole purpose is deciding *whether a package may execute code at install time*. Today those decisions are made from policy, not observation.

Per bump, answer empirically: does this version's install run scripts, spawn interpreters, or reach destinations the previous version didn't? Old → new, one line, on the bot PR he's triaging anyway among 6-8 other bot comments. Secondary payoff: the same data is ground truth for maintaining his `onlyBuiltDependencies` allowlist.

Lower ceiling than C1/C2 (bumps are mostly boring, so most verdicts are "no change" — which is fine as long as the comment stays one line and silent when clean), but it is the most direct bridge from the supply-chain story we sold to a thing he reads daily.

---

## Prerequisites that gate all of the above (don't lead with wedges we can't hold)

1. **Profile reliability on heavy jobs.** An empty or missing profile on the job he checks is the fastest way to lose him — worse on a benchmark comment than on a security summary, because Bencher never no-shows.
2. **Linux-only** is fine here: every benchmark/e2e workflow is Blacksmith Ubuntu. Don't propose Windows/macOS coverage.
3. **Wall-time budget on anything near a timed cell** — see the B1 constraint. Non-negotiable.
4. **Fork PRs** have no in-job coverage; C2/C3 should be scoped to same-repo/scheduled workflows initially so we don't promise something that silently degrades for contributors.

## Sequencing

1. **A** (release-path instrumentation + workflow-scoped policy) — days, delivers the original promise, no new product.
2. **B2** (Garnet permalink in the benchmark comment) — hours, first genuinely inline touch.
3. **B1** via the server-side BMF path — the moment his own thresholds start alerting on a Garnet-derived count, we are inside his loop with his UI.
4. **C1**, one invariant, prototyped on the fork, shown as a diff — this is the demo that reframes Garnet from "security evidence" to "perf oracle."
5. **C2** as the flagship follow-on, pitched against the rewrite.
6. **C3** whenever the Dependabot lane is being touched anyway.

## What to stop saying

"We capture what your CI ran." He has no unanswered question there. Every pitch above is phrased as a **baseline comparison producing a verdict** — because that is what he told us he pays attention to, and Bencher already proved the shape works on him.

---

# Addendum: perf × runtime context as *reviewer* fuel

Read of his review constitution (verified in the fork at HEAD): `REVIEW_GUIDE.md` (336 lines, §1 security → §2 performance → §9 parity), `REVIEW.md` (the Garnet grounding contract), `.pr_agent.toml` (Qodo), `.coderabbit.yaml`, `AGENTS.md`/`CLAUDE.md`. Greptile is not configured in-repo; the two configured bots are Qodo + CodeRabbit, with an explicit division of labour.

## What his constitution actually says (this is the whole opportunity)

1. **He wrote the review priority order as "security first, performance second," and it's enforced in both bot prompts.** Qodo's `issues_user_guidelines` gives Qodo "primary depth on security *and performance*"; CodeRabbit takes correctness/conventions.

2. **§2 "Performance review rules" is written almost entirely in units Garnet measures — and nothing else in his CI does.** Verbatim rejection criteria: changes that add *"thousands of filesystem ops per install"*, *"a network round trip per dependency"*, *"full metadata fetches where smaller/cached data would do"*, *"repeated parsing/scans in resolver/linker loops"*, *"expensive checks on the warm path"*. Those are syscall and egress counts. Today a bot must **guess them from the diff**, and Bencher can only show that some aggregate got slower.

3. **§2 also states the burden of proof: "A performance change must be measured. If it's pitched as perf, there must be a number."** Right now that number is produced by hand, by the author, per PR — and a reviewer has no way to check it. That's a chore in his daily loop that CI could just do.

4. **The Garnet contract is already wired into both bots — and it is used for security only.** Qodo's guidelines instruct it to reconcile execution chains and destinations against the diff for *dependency, lockfile, or CI changes*, to treat unexpected destinations as a §1 security finding, to ignore runner-platform chains, and to label findings "verified at runtime" vs static inference. CodeRabbit's `path_instructions` carry the same grounding-verdict rule. **There is not one word instructing either bot to use runtime evidence for §2.** Half the machine is built and idle.

5. **He has already tuned out unsubstantiated perf comments.** `inline_comments_severity_threshold = 3` with a comment stating the intent: keep low-severity *perf*/style nits out of inline threads on every push. So the ask is not "more perf comments" — it is *"the perf comment that earns an inline thread is the one carrying a runtime number."*

6. **Reviews gate merge, not just discussion.** `enable_auto_approval = true`, `auto_approve_for_no_suggestions = true`, `auto_approve_for_low_review_effort = 2`. So an evidence-backed perf finding doesn't just get read — it removes the PR from the auto-approve lane. (Mechanism inferred from Qodo's documented `/improve` behavior, not probed: a suggestion existing is what withholds the approval.) That makes runtime-grounded perf the highest-leverage place Garnet output can land in this repo.

7. **§9 parity** requires every user-visible change to land in both pnpm and pacquet, and reviewers must judge two implementations' equivalence from a diff. The guide even documents a known bot failure mode here ("when a bot says a symbol is 'not referenced', it may be searching only one major's branch").

## The wedge: make Garnet the evidence layer under the reviewers he already trusts

Not a new surface. The same mirrored evidence block, plus a performance clause in the same two prompts, so a bot can write the sentence none of his three tools can produce alone:

> **Runtime evidence (Garnet, head `a1b2c3d`)**: this resolver change adds a registry round trip per dependency — connections to registry.npmjs.org for the same fixture went 41 → 2,133, chain rooted in `node → pnpm → resolve`. Bencher `pnpm.ubuntu.node24` shows +12% on the same head. Verified at runtime; §2 "network round trip per dependency".

Decompose why that lands:
- **Bencher knows the number but not the cause.** Its answer to "why is this 12% slower" is another benchmark run.
- **The bots know the diff but not the behavior.** They can only say "this *may* add a fetch per package."
- **Garnet knows the behavior but not the review question** — which is exactly today's problem: we hand him a document instead of a finding.
- Fused, each one supplies what the other two are missing, and the output is a §2 verdict in his own vocabulary, at severity ≥3, in the thread he already reads. It also discharges the "there must be a number" burden automatically, for every PR, without the author benchmarking by hand.

And the noise story is the right way round: when the runtime delta is nil, the reviewer says nothing. Silence is the common case, which is what makes the loud case worth reading.

### Concrete, cheap, in a lane we already have

- **D1 — extend the reviewer contract to §2 (prompt-only, no product work).** Add a performance clause to Qodo's `issues_user_guidelines` and CodeRabbit's `path_instructions` mapping each §2 rejection criterion to the runtime observable that evidences it, with the same discipline the security clause already has: only for changed code, name the hot path, label "verified at runtime" vs static inference, and never restate Garnet's own verdicts (`REVIEW.md` rule 6). Same file, same shape, same review — this is a one-PR change to the fork and the highest value-per-line move on the list.
- **D2 — put the counts in the mirrored block** so there's something for the clause to cite: per-destination connection counts and process-spawn counts for the instrumented job, plus the delta vs the previous profiled commit (`compareJobEdges` already computes it). No cross-workflow plumbing needed for the Bencher half — the Bencher comment/alert is in the PR conversation, which both bots read.
- **D3 — parity fingerprint as reviewer evidence (this is C2 aimed at §9).** When both stacks run the same fixture, a divergence in destinations/round trips/spawned processes is *precisely* the §9 finding the bots currently cannot substantiate. Same rendering machinery, new axis.
- **D4 — vacuous-test check, scoped honestly.** §7 demands tests "assert the effect actually happened, so the test can't pass on an empty array or unchanged fixture." Garnet can show the new path *did work at runtime* — the fixture install actually fetched, the lifecycle script actually spawned, the store was actually written. It **cannot** do function-level coverage; the profile is process-level execution chains and egress. Pitch it as "this test did/did not perform the operation it claims to test," never as coverage.

### Correction to C3 from reading the config

`.pr_agent.toml` sets `ignore_pr_authors = ["dependabot[bot]", "renovate[bot]"]` — **Qodo does not review dependency-bump PRs at all.** So on the exact PRs where "what does this new version actually do at install time" is the whole question, the security-and-performance reviewer is switched off by design (CodeRabbit isn't configured to skip them, so it likely still comments — unprobed). That makes the Dependabot behavior-diff a *gap-filler* rather than one more bot voice, and raises C3's priority: it's the only automated behavioral signal available on those PRs, and it needs no reviewer prompt at all.

### Revised sequencing

1. **D1 + D2** — reviewer §2 clause + counts in the mirror. Cheapest thing on either list, lands inside the surface he reads every day, and it converts our existing evidence from a document into a finding.
2. **A** (release-path instrumentation + egress policy) — delivers the original promise.
3. **B1/B2** (Garnet counts as Bencher measures; permalink in the benchmark comment) — his alerting, his UI.
4. **C1** (no-work oracle) — one invariant, prototyped on the fork; this is what reframes Garnet as a perf instrument.
5. **C2/D3** (parity fingerprint) — flagship, aimed at both the rewrite and §9.
6. **C3** (Dependabot behavior diff) — now better justified by the Qodo ignore.

---

# Addendum 2: velocity / throughput — and the capability floor it has to respect

Before the wedges, the thing that constrains all of them. Verified by reading the profile data model the sensor actually emits (`jibril-ashkaal@v1.4.0` `pkg/ongoing`: `Profile{Network, ProfileDetections, Telemetry, Assertions}`), not from prior notes:

| Question he'd ask | Can today's profile answer it | Field |
|---|---|---|
| How many outbound connections did this job make? | Yes, exactly | `telemetry.network.egress.total_connections` |
| How many distinct destinations? | Yes | `telemetry.network.egress.total_domains` |
| Which destinations, over what protocol/ports? | Yes | `network.egress.peers[].remote_names / remote_ports / protocol` |
| **Which workflow step caused this connection?** | **Yes — and this is under-used** | `network.egress.peers[].proc_trees[].github_step` |
| What executable and ancestry reached out? | Yes | `proc_trees[].executable / arguments / ancestry` |
| Did a named assertion pass or fail? | Yes | `assertions[].result` |
| How many filesystem operations did the install do? | **No.** The profile carries no file telemetry — `file_list` exists on detection events, not in the profile | — |
| How long did any step/process take? | **No.** `ProcessTree` has no timestamps; only detection `Evidence` is stamped | — |

Two consequences, stated plainly so we don't oversell:

1. §2's *"thousands of filesystem operations per install"* criterion is **not** measurable with today's product. The §2 clause (D1) must cite only egress-shaped criteria — round trips per dependency, metadata fetches, warm-path network work. Correct the earlier framing accordingly.
2. Anything shaped like "where is CI spending its time" is out of scope. Garnet answers *what ran and what it talked to*, never *how long it took*. Bencher owns time; that division is also what keeps us off his primary signal.

The under-used primitive is `github_step`. Every outbound connection is already attributable to the workflow step that produced it. That is the basis for most of what follows.

## Where his throughput actually goes

Not review reading time — that's minutes. The expensive loops are: **fork PRs he must read carefully because nothing tells him what they do**, **dependency bumps nobody automated** (Qodo is configured off for `dependabot[bot]`/`renovate[bot]`), **network-flake triage in 60-minute job logs**, and **release cuts he hand-checks**. Each one is a wait or a manual read that a runtime record can shorten.

- **V1 — "behavior-neutral" proof, so bumps merge without a manual read.** Same fixture, previous profiled commit vs head: identical connection count, identical destination set, identical per-step attribution ⇒ the bump changed nothing at runtime. Today his only options are trust or read the tarball. This is the same machinery as C3, aimed at velocity rather than security, and it lands where his security-and-performance reviewer is switched off by design.
- **V2 — step-attributed egress inventory as the triage shortcut.** When a job fails or hangs on the network, the question is "which step reached what". `proc_trees[].github_step` answers it in one table instead of a log scroll. Cheap: the data is already in every profile we record.
- **V3 — hermeticity gate (C1 restated for velocity).** A frozen-lockfile repeat install should make zero registry connections; a unit-test job should make none at all. Every connection that shouldn't be there is a future flake and a future minute of CI. Deterministic counts make this a gate; wall time hides it entirely.
- **V4 — fork PR coverage is the biggest single throughput unlock, and it's ours to fix.** Most open PRs on his repo come from forks, and those runs produce no telemetry at all today (credential-less `pull_request` runs cannot authenticate; the action skips). The PRs where "what does this actually do" costs him the most attention are exactly the ones we're blind on. Tokenless ingest or the trusted mirror path converts careful reading into a glance.
- **V5 — release-cut confidence.** A per-release egress verdict over the publish/attest jobs (the ones holding `NPM_TOKEN` and `id-token: write`, which are *not* instrumented today) is what lets him cut a release without hand-checking. This is the original supply-chain promise, restated as speed.
- **V6 — let the auto-approve lane be trusted rather than brave.** He already runs `enable_auto_approval` + `auto_approve_for_no_suggestions`. "No new destination, no behavior delta" is a positive signal that makes auto-approval defensible; a new destination pulls the PR out of the lane. Safety and speed from one artifact — this is the only wedge that improves both directions at once.

Sequencing note: V1/V2/V6 are prompt-and-rendering work on top of data we already capture. V4 needs the fork-ingest path. V5 needs coverage expansion, which is an ask, not a build.

---

# Addendum 3: the three wedges, run for real on the replay harness (2026-09-23)

Everything above this line is analysis. This section is the first *evidenced* pass: the three
ranked wedges were replayed onto `garnet-labs/pnpm` through the canonical harness
(`garnet-labs/garnet-replay`, branch `devin/1790100529-stage-a-rereview`, harness commit
`7b6249c`), each as a two-commit replay of the maintainer's own upstream PR, each gated by
`replay verify` before anything could be called shareable. Three parallel lanes,
workflow run `wfr-a009646745b34d2d9f14cb608da7009a`.

**Verdicts: 0 holds, 0 partial, 2 undeterminable, 1 fails.** No exhibit is shareable.

| Wedge | Upstream PR | Fork PR | Changed path ran? | `replay verify` | Verdict |
|---|---|---|---|---|---|
| 1 — connection behaviour under concurrency | pnpm/pnpm 15289 | https://github.com/garnet-labs/pnpm/pull/67 | partially (test binaries, direct not proxied) | FAIL (2 legs) | undeterminable |
| 2 — lifecycle-script receipt | pnpm/pnpm 15278 | https://github.com/garnet-labs/pnpm/pull/68 | yes (new test, 0.311 s) | FAIL (3 legs) | undeterminable |
| 3 — benchmark-confounder witness | pnpm/pnpm 15228 | none (fail-closed at plan time) | no | not run | fails |

## The finding that outranks all three wedges

`replay verify` **cannot pass on any pull-request-triggered replay under the deployed
v6.10.0 contract**, for two independent reasons, both observed on both fork PRs:

1. **Profile identity is the merge ref, not the head.** The control plane records
   `run.commit_sha` as the `refs/pull/N/merge` SHA (`44895ea` for PR 67 head `3dcf14c`;
   `5beaafd7` for PR 68 head `1f0ad76`). `AGENTS.md` says a merge-ref SHA cannot stand in
   for the replay head without verified executed-source linkage, and that linkage path is
   not implemented, so the identity leg fails every time.
2. **Capture completeness is never declared.** Contract 6.10.0's `garnet:summary` carries no
   `capture_quality`/`capture` field at all, so the completeness leg reports
   "capture not declared; comparison undeterminable" on every record the product emits today.

This is not a property of these three wedges. It means **no pnpm exhibit produced today can
pass the evidence gate**, and the ledger can never record a shareable replay until either the
contract declares capture completeness and binds the head SHA, or the harness implements the
executed-source-linkage path `AGENTS.md` already allows. This is the single highest-priority
item on the list — above every wedge — because it gates the act of sharing, not the content.

## Per-wedge evidence

**Wedge 1 (connection behaviour) — undeterminable, and the workload is wrong.**
Recorded: 98 associations / 19 destinations on `77becc9`, 108 / 21 on `3dcf14c`;
39 vs 42 flows to `registry.npmjs.org`. But the cold 1,645-package install
(`resolved 1645, reused 0, downloaded 1644`, identical both sides) is performed by
**released pnpm 12.5.1 from `pnpm/setup`**, not by the changed binary; the changed network
crate only appears in nextest processes (27 vs 28 flows), all **direct, unproxied**, with
`networkConcurrency` and `maxSockets` never set — so the new per-origin proxy socket cap is
never exercised. The intended sentence ("parent opened 214 flows, head opened 50") is not
reachable from this job at all. Both predicted kill artifacts landed: no ground-truth flow
source exists in the instrumented job (no pcap/proxy/forwarder), so every count is a floor;
and v6.10 per-destination dedupe collapses all 39/42 flows to one rendered line — which in the
comparison sits under a background `MainThread` row. The rendered diff a maintainer sees is
`+7 −5 destinations` of chronyd NTP churn, snapd, and Blacksmith blob storage.
Also recorded: `flow_id` is not unique per record (34 distinct values across 98 records).

**Wedge 2 (lifecycle receipt) — undeterminable, and it is unreachable by construction.**
The changed path did run (`ci_with_ignore_scripts_skips_lifecycle_scripts_when_clean_script_is_present`,
PASS 0.311 s, commit 2 only). But the upstream change's lifecycle scripts are
`echo clean-script-ran` / `echo project-install-script-ran`: sub-second, no socket, no marker.
v6.10's only action class is an outbound connection, so **the expected recordable-event count
is 0 on both sides** — the receipt cannot distinguish "skipped" from "ran silently", which is
exactly the kill artifact, arriving structurally rather than as a sensor miss. Profile:
112 associations (commit 1) vs 143 (commit 2), `lineage_recorded` true on all; zero
attributable to any lifecycle script on either side. The rendered `+4 −4 destinations` are
entirely chronyd NTP IP churn — and the renderer counts them as *workload* change
(`backgroundAdded: 0, backgroundRemoved: 0`), which is a renderer defect in its own right.
The maintainer's decisive counter-argument survives: 15278's own fixture test proves the
scripts were skipped, portably, in 0.3 s. The residual honest value is only for dependency
code he does not control — and reaching it needs a fixture with a long-lived, host-reaching
lifecycle script, which is a new experiment, not a replay of 15278.

**Wedge 3 (benchmark witness) — fails, on capability grounds, at plan time.**
The harness refused both dry runs and wrote nothing to the fork. The changed comparator
(`.github/scripts/compare-integrated-benchmarks.mjs`) executes only in the **timed**
`benchmark` job and in a privileged `workflow_run` comment job that no pull-request recorder
covers; instrumenting the timed cell is forbidden (our own post-step cost was
777–793 s on ~10-minute jobs in the other two lanes — 13 % and up, measured this run).
So there is no non-timed, path-reachable job that executes the changed code. This is the
capability-blocked verdict predicted above, now evidenced rather than argued.

## What this changes in the ranking

- **Wedge 2 was ranked #1-cheapest and "ships on today's renderer". That is now false.**
  It is unreachable without a new fixture, because a negative receipt over an action class
  the sensor cannot see is not a receipt.
- **Wedge 1's blocker is not only the dedupe defect** (which is confirmed, again, on a real
  exhibit) — the replayed change's network path is not exercised by the job that carries the
  install traffic. Any future attempt needs a proxied, high-concurrency install performed by
  the *built* binary, plus a proxy log as denominator.
- **Wedge 3's verdict is unchanged but now evidenced**: capability-blocked, not effort-blocked.
- **The post-step wall cost (777–793 s) is now measured on this repo's own CI**, which
  independently confirms the B1 constraint: never instrument a timed cell.

## Next actions, with owner

1. **Contract/renderer (Garnet product, parent sprint lane):** declare capture completeness in
   the summary contract, and bind profile identity to the PR head (or expose the merge-ref →
   head linkage) so `replay verify` can pass at all. Nothing downstream ships without this.
2. **Renderer (v6.11 lane, testbed 135 / control-plane 674):** per-chain attribution — already
   in flight — plus two new defects this run surfaced: background-only destination churn is
   counted as workload change, and `flow_id` is not a unique record key.
3. **Harness (garnet-replay, PR 21 branch):** implement the executed-source-linkage path
   `AGENTS.md` permits; report "not declared by contract 6.10.0" as its own leg state so a
   contract gap is distinguishable from a bad exhibit; scope the placeholder scan to the
   instrumented job; record-mode-specific commit-1 wording; `packageManager` preflight before
   the fork's Husky hooks.
4. **Wedges:** do not rebuild 1 or 2 as replays of 15289/15278. Wedge 1 needs a proxied
   high-concurrency install executed by the built binary; wedge 2 needs a long-lived
   host-reaching lifecycle fixture. Both are new experiments and need a decision before spend.

---

# Demand & PMF signal read — 2026-09-30

Source: the eight pull requests Farrukh named, read in full (bodies, review comments, bot
findings) from live GitHub data. Seven merged (`#16076`, `#15451`, `#15361`, `#15339`,
`#13496`, `#13063`, `#12969`), one open (`#16411`). Raw extracts are reproducible from the
GitHub API; this section records only what they say about Garnet's pull.

## The headline finding

**Garnet appears in these eight pull requests eight times. Every appearance is a cost item
or a trust-boundary item. Not one is evidence the maintainer used.**

| Pull request | What Garnet is in it | Direction |
|---|---|---|
| `#12969` (Blacksmith runners) | Qodo: `GARNET_API_TOKEN` now consumed on a Blacksmith runner — "expanding that secret's trust boundary"; suggested fix is to keep the Garnet leg on a GitHub-hosted runner or gate the token to fewer runs | push-back |
| `#13496` (parallel TS jobs) | Qodo finding titled "Overbroad Garnet token scope" — the token reaches every Ubuntu Node leg (22/24/26), not just the instrumented one. The Garnet smoke job was also the serialized gate other test jobs waited on; this pull request dissolves it into the matrix | push-back |
| `#13063` (release verification) | Qodo: `verify_ts_release` on an arbitrary branch receives `secrets.GARNET_API_TOKEN` while running repo-controlled build steps and lifecycle scripts — "a straightforward secret-exfiltration path". Recommended remediation option 1: "If the garnet step is required for verification, replace it with a non-secret configuration or a public token with no privileges" | push-back, and it targets the release path we sold |
| `#15361` (CI trim) | "**Garnet runs on one TS chunk** instead of all three Node.js 24 chunks. Its post step took about 160 s on each, which made those chunks the longest Linux legs: 9.3 min median against 6.6 min" | cost trim |
| `#15451` (CI caching) | "**Garnet runs on the Node.js 24 chunk that finishes first.** Its post step takes about 100 s; the chunk that carried it had a 9.7 min median against about 7.5 for the others." Before/after table lists "TS CI / Node 24 chunk with Garnet: 9.7 min → 7.7 min" | cost trim, second iteration |
| `#15339` (dependency bump) | "Garnet references now use v2.3.0", bundled with CodeQL v4.38.2 in a routine pin bump, priority **Low** | dependency surface only |
| `#16076` (reporter diagnostics) | "Garnet annotation `check_annotation_81178840020` is an intentional fork-credential recording skip, not the test failure" — Garnet output appearing in his triage as something to explain away | noise |
| `#16411` (doctor checks) | Garnet absent. He builds the runtime diagnostic himself instead — see below | dead end |

**The trajectory is the signal.** Three Node 24 chunks → one chunk (`#15361`) → "the chunk
that finishes first" (`#15451`). Each step is measured, justified by wall time, and
published in the pull request body. The next step on that line is one leg on a cheaper
trigger, and the step after is removal. Nothing in these eight pull requests gives him a
reason not to take it. Our own measurement agrees with his: the replay lanes' post step
cost 777–793 s on ~10-minute jobs (13 %+).

**The token is a standing liability, flagged three times by his own reviewer.** Qodo has now
written, in a merged pull request touching the release path, that the Garnet step should be
replaced with "a non-secret configuration or a public token with no privileges". That is
free, deliverable value we have not delivered: `garnet-org/action` supports OIDC
(`contents: read` + `id-token: write`, no `api_token`), which closes all three findings at
once and removes the only security argument against keeping us in CI.

## Where he actually reaches for runtime evidence

**`#16411` — `pnpm doctor` lifecycle-script checks. The strongest demand signal in the set,
and we cannot answer it.**

He adds three checks to diagnose why a package executable called from a lifecycle script
exits 127 — "the failure in `pnpm/pnpm#16308`, **which nobody could reproduce**". What he
builds is a hand-rolled process-execution recorder:

- list the `node` executables on `PATH` in lookup order, and warn about entries a lookup
  skips (broken version-manager link, no execute permission, a directory);
- report the shell that runs scripts, and what `/bin/sh` actually is, "since `/bin/sh`
  starts every `.bin` shim";
- install a temporary project whose `postinstall` calls a dependency's executable, and on
  failure attach "the last 20 lines of an `sh -x` trace of the shim, which show the `PATH`
  it searched and where `node` went missing".

This is our category — a process, its lineage under a lifecycle script, and what it
resolved — arrived at by a maintainer who had no recorder and wrote one. And the deployed
public contract (`runtime-review-public/v3`) records **network associations only**: no
`execve` argv, no resolved binary path, no `PATH`, no file access, no exit status. We can
say a process existed and what it connected to. We cannot say which `node` the shim
found, which is the entire question. Wedge 2 (the lifecycle receipt) now has a named,
live host — and a named, missing data class.

**`#16076` — the benchmark-confounder pain, again.** His shepherd journal dispositions two
"inconclusive because samples overlap" benchmark rows (590.62 ms vs 652.19 ms; 7.66 ms vs
10.52 ms) and resolves each as "no speculative performance change". That is wedge 3's
target bucket occurring in the wild, twice in one pull request. The verdict from the replay
run stands unchanged: capability-blocked. Overlapping medians on a shared runner are a
CPU/IO-contention question, and v3 has no CPU, IO, or timing field. A witness that can only
say "same destinations" cannot separate those two medians.

**`#15451`, `#15361` — his perf work is now Rust build graph and cache-key work**
(rust-cache rooting, shared Windows test builds, thin LTO, 16 vCPU overlap). None of it is
observable as network or process behaviour. The instrumented cell is not where his
measurements live, and the jobs whose numbers he publishes are the ones we are forbidden to
instrument.

## What this does to the ranking

1. **New, and top of the list because it is free and closes a live objection: shrink our own
   footprint.** Move the fork's Garnet legs to OIDC (no `api_token`), and cut the post step's
   wall cost. This answers Qodo's three findings, removes the trim trajectory's motive, and
   needs no contract change. It is not a wedge — it is the price of staying in the room long
   enough to land one.
2. **Wedge 2 (lifecycle receipt) keeps its rank but changes shape.** It is no longer
   "negative receipt over network actions" (which `#15278` proved undeliverable — the
   scripts are sub-second `echo`s and the only action class is an outbound connection).
   `#16411`/`#16308` define the version that matters: *which binary a lifecycle script's
   shim actually executed, and from which `PATH` entry*. That is a contract request
   (process exec attributes), not an experiment we can run today.
3. **Wedge 1 (connection behaviour) unchanged**: gated on chain-granular attribution
   (v6.11, not deployed) plus a proxied high-concurrency install executed by the *built*
   binary.
4. **Wedge 3 (benchmark witness) unchanged**: capability-blocked, now with two more
   in-the-wild instances of the bucket it would serve.
5. **Demoted further: anything riding CI wall time.** Two consecutive merged pull requests
   cut Garnet's cost by name. Proposing more instrumented cells before the post step is
   cheap would be read as not having read his pull requests.

## Next actions, with owner

1. **Ours, authorized, do first:** OIDC on the fork's Garnet legs; measure and cut the post
   step. Evidence that closes it: a fork run with `id-token: write` and no `api_token`, and a
   post-step duration under the ~100 s he last measured.
2. **Garnet product (contract):** process-exec attributes — resolved binary path, argv,
   `PATH` as searched, exit status — scoped to the lifecycle-script case in `#16411`. This
   is the single contract change with a named upstream consumer. Decision needed before
   spend.
3. **Garnet product (contract, still blocking everything):** declare capture completeness,
   and bind profile identity to the pull request head. `replay verify` cannot pass without
   these; nothing is shareable meanwhile.
4. **Watch, automated:** the demand-signal section of the daily sweep automation
   (`auto-b12b7e03bde14b2ba0866457aa151980`) now reads his previous day's pnpm activity
   against this ledger and nudges only on a new or flipped signal.
