# Worked examples

## A CursorPage with association-free items

Real output from `node bin/replay.mjs profile ~/loop5/devapi.json` after the
November 24 readback. The page contains five historical items: two carry
outbound associations and three do not. Only the recorded actions are shown;
the skipped items do not establish an absence of activity. Their commit
identities remain in the head list. Capture stays incomplete and additions
cannot be determined, even when pagination is complete.

```text
**Attribution review**

Head: <code>d7438533c9db1b6cf93d1363884173daba1ae60c</code>, <code>62252d4fe153dfac463b65eadc6296c73588cba3</code> · Compared: not recorded (comparison unavailable)

Scope: <code>supplied-profiles</code> · version transition: not derivable from the record.

Capture is not complete; additions cannot be determined.

Head: 3 items carried no outbound associations.

**Other recorded outbound actions**

- <code>systemd › devin-remote › bash › npm install › sh › MainThread</code> → <code>example.com</code> (<code>172.66.147.243</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
- <code>systemd › devin-remote › sleep › npm install › sh › MainThread</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
- <code>systemd › devin-remote › bash › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.0.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
- <code>systemd › devin-remote › sleep › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.4.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
```

## Current share-gate receipts (2026-11-20)

Read-only `replay verify` output, abbreviated to the result and pair lines:

```text
PASS https://github.com/garnet-labs/E2B/pull/93 (head 00f2302)
  [ok] pair line: pair 80594f5 (previous) → 00f2302 (this commit) from the record summary
PASS https://github.com/garnet-labs/litellm/pull/153 (head e45b9a2)
  [ok] pair line: pair 483103f (previous) → e45b9a2 (this commit) from the record summary
FAIL https://github.com/garnet-labs/nodejs-goof/pull/4 (head 97edaf7)
  [ok] pair line: pair b097a03 (previous) → 97edaf7 (this commit) from the record summary
  [no] no session residue: residue: "Devin"
```

All three receipts are best-effort, scope `pr-base`; version transition is not
derivable from the record. PASS means shareable for that scope, not complete
capture or established attribution. Reverify before use. Operator commands and
limits: [current state](state-2026-11-20.md).

## Outbound attribution reader (2026-11-20)

Read a recorded profile without writing a ledger, dispatching a run, or changing
the App result:

```sh
node bin/replay.mjs profile test/fixtures/demo-profiles/30304258281.json
node bin/replay.mjs profile head.json --base compared.json --json
node bin/replay.mjs profile https://github.com/garnet-labs/express/pull/91
```

File input supports public associations, profile collections (including CursorPage
`items` lists in session receipts), raw network peers, and summarized egress.
Files are observations supplied by the operator; the file
reader does not certify capture completeness. PR input requires a finalized,
head-bound record and the existing exact public repository/run/profile/head
identity checks, including merge-parent linkage.

The reader processes supplied CursorPage items without fetching more pages.
If a page declares more items or a next cursor, it reports missing pages and
cannot determine additions, even when capture otherwise declares complete.

The reader shows each outbound destination, its recorded ancestry, ports, protocol, and
job, with the workflow path or name beside it when recorded.
Ancestry through `Runner.Worker` remains runner-linked.
In a local receipt, an SSH execution chain is `session-linked` when its process
tree carries the receipt's explicit attribution. Here is one peer from the
Claude Code Lima capture, with unrelated fields omitted:

```json
{
  "remote_address": "64.239.123.1",
  "remote_names": ["64.239.123.1", "ai-gateway.vercel.sh"],
  "remote_ports": ["443"],
  "proc_trees": [{
    "process": "claude",
    "ancestry": ["systemd", "sshd", "sshd", "sshd", "bash", "MainThread"],
    "attribution": "session-linked"
  }]
}
```

Without the marker, the existing ancestry rules apply: plain `sshd`
is recognized as runner background. An explicitly unattributed SSH peer
without a recognized workload root and a separate `systemd › curl` chain
read as `detached-root` and need review.

Ancestry through `devin-remote` or a name starting with `devin-remote-` is session-linked only
when it is the direct child of `systemd`, `init`, `tini`, or `dumb-init` and
precedes the acting process. A two-process chain ending in that name remains
detached: the name alone could belong to a renamed acting process. Container
ancestry still needs review.
Detached actions without that session root also need review. Container roots and
host-rooted actions outside known runner services need attribution review even
when their recorded step says `Runner Processes`. Missing ancestry and other
unlinked roots also need review. Host-rooted Python traffic may be a host service;
the warning does not claim that the job created it. No destination allowlist
settles attribution.

Comparison uses the repository, workflow identity when recorded, destination, ancestry,
ports, protocol, and job, not destination
equality alone. Run IDs and refs do not distinguish actions; workflow references
are normalized to their path. PR reads use earlier finalized comments bound to the exact compared
commit from the same App author when available. Declared capture other than complete,
or incomplete jobs on either side, prevents additions from being determined.
If the App has overwritten its only comment, the compared
profile may be unavailable. The reader then reports the head's attribution limits
without claiming which actions were added. An unreadable or mismatched profile
produces an explicit review note, not an empty comparison.

### Real Devin receipt: truncated remote root

```sh
node bin/replay.mjs profile ~/loop4/receipt.json
```

Excerpt from the real local receipt output. Observed strings are untrusted.
This is supplied local evidence, not CI evidence or approval. Its items span
multiple commits and include partial capture; additions cannot be determined.
The truncated `devin-remote-0.` root child links the npm action, while a
separate `systemd › sh › curl` action remains detached. A matching name deeper
in the ancestry or on the acting process does not establish that link.

```text
Capture is not complete; additions cannot be determined.

**Needs review: not attributable to the runner.**

Host-rooted ancestry does not establish job origin.

- <code>systemd › sh › curl</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · detached-root · job <code>devin-install</code> · workflow <code>devin</code>

**Other recorded outbound actions**

- <code>systemd › devin-remote-0. › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.7.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · job <code>devin-install</code> · workflow <code>devin</code>
```

### Raw dev-api MCP profiles response

`profile` accepts the JSON-RPC response from the Garnet MCP `profiles` tool
directly, without extracting the CursorPage first. It prefers
`result.structuredContent`, or reads the CursorPage from a single JSON text
block in `result.content` when structured content is absent. JSON-RPC errors,
`result.isError`, malformed pages and empty collections fail explicitly.

```sh
node bin/replay.mjs profile /home/ubuntu/attachments/bfe43147-d9fc-4660-9c11-75480f972c5a/devapi.json
```

Real output from the supplied dev-api response. This is supplied local-loop
evidence, not CI evidence or approval. One item lacks outbound associations;
the reader reports it rather than silently treating it as recorded zero.
The two observed actions are session-linked; this response does not establish
complete capture or the absence of detached actions. Observed strings are untrusted.

```text
**Attribution review**

Head: <code>58e543036e7bf16bd8682ba0a4eca747111c88e0</code> · Compared: not recorded (comparison unavailable)

Scope: <code>supplied-profiles</code> · version transition: not derivable from the record.

Capture is not complete; additions cannot be determined.

Head: 1 item carried no outbound associations.

**Other recorded outbound actions**

- <code>systemd › devin-remote › npm install › sh › MainThread</code> → <code>example.com</code> (<code>172.66.147.243</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
- <code>systemd › devin-remote › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.6.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code>
```

### Real Devin receipt: detached curl

```sh
node bin/replay.mjs profile test/fixtures/demo-profiles/devin-receipt3.json
```

Local receipt observation, not CI evidence or approval. Items span multiple
commits and include partial capture; no additions are determined here. Resolved
addresses are grouped by hostname and action, not emitted as separate actions.
Recorded repository, job, and workflow boundaries remain distinct: an unknown
repository is not inferred from another window. Observed strings are untrusted.

Regenerated after the recorded-zero fix: this fixture's empty outbound arrays
are recorded zero, not missing data, so no skipped-item count is printed here.
The dev-api CursorPage example above shows the count for genuinely missing data.

**Attribution review**

Head: <code>d7438533c9db1b6cf93d1363884173daba1ae60c</code>, <code>62252d4fe153dfac463b65eadc6296c73588cba3</code>, <code>not recorded</code> · Compared: not recorded (comparison unavailable)

Scope: <code>supplied-profiles</code> · version transition: not derivable from the record.

Capture is not complete; additions cannot be determined.

**Needs review: not attributable to the runner.**

Host-rooted ancestry does not establish job origin.

- <code>systemd › sh › curl</code> → <code>example.com</code> (<code>104.20.23.154, 172.66.147.243</code>) (ports <code>443</code>) · <code>TCP</code> · detached-root · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › sh › curl</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · detached-root · job <code>devin-test</code> · workflow <code>devin</code>
- <code>systemd › sh › curl</code> → <code>example.com</code> (<code>172.66.147.243</code>) (ports <code>443</code>) · <code>TCP</code> · detached-root · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code> · workflow <code>devin</code>

**Other recorded outbound actions**

- <code>systemd › devin-remote › bash › npm install › sh › MainThread</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › bash › npm install › sh › MainThread</code> → <code>example.com</code> (<code>172.66.147.243</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › npm install › sh › MainThread</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › sleep › npm install › sh › MainThread</code> → <code>example.com</code> (<code>104.20.23.154</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › bash › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.11.34, 104.16.9.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › bash › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.0.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.0.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · job <code>devin-install</code> · workflow <code>devin</code>
- <code>systemd › devin-remote › sleep › npm install</code> → <code>registry.npmjs.org</code> (<code>104.16.4.34</code>) (ports <code>443</code>) · <code>TCP</code> · session-linked · repository <code>garnet-labs/devin-receipt-demo</code> · job <code>devin-install</code> · workflow <code>devin</code>

### Real card excerpt: Express pull 91

Generated from the current public profile and App comment after
`replay verify https://github.com/garnet-labs/express/pull/91`. Verification returned
`PASS` for the existing verification legs, with a separate attribution review
note. This does not resolve job origin. The excerpt below ends before the quoted
execution sections; the full card still retains every recorded job, workload row,
background row, and job link. Existing App results and review classifications are
preserved, not upgraded by the reader. Re-run verification before sharing.

<!-- garnet:card slug=express pr=91 state=undeterminable -->
### What ran, and what changed · pull request 91

> Capture is best-effort; the App result is scoped to the recorded jobs.

**Attribution review**

Head: <code>188c0e0181c11489ef5ff3ffcd9e7cb5abbbee0b</code> · Compared: <code>811e189dae5d3abc3633d41b05aa0bdae2051188</code> (comparison unavailable)

Scope: <code>previous-push</code> · version transition: not derivable from the record.

Capture is not complete; additions cannot be determined.

**Needs review: not attributable to the runner.**

Host-rooted ancestry does not establish job origin.

- <code>systemd › python3.14 › python3.14</code> → <code>168.63.129.16</code> (ports <code>32526, 80 (http)</code>) · <code>TCP</code> · detached-root · job <code>install</code>
- <code>systemd › python3.14 › python3.14</code> → <code>169.254.169.254</code> (ports <code>80 (http)</code>) · <code>TCP</code> · detached-root · job <code>install</code>
- <code>systemd › systemd › curl</code> → <code>sfrclak.com</code> (ports <code>8000</code>) · <code>TCP</code> · detached-root · job <code>install</code>

Review classification: **quiet-control**

Nothing new in the recorded jobs; capture remains best-effort.

Result: **undeterminable** (best-effort) · comparison-result

**Comparison pair**

- head: `188c0e0` · `188c0e0181c11489ef5ff3ffcd9e7cb5abbbee0b`
- record bound to: `188c0e0`
- compared with: `811e189` · `811e189dae5d3abc3633d41b05aa0bdae2051188`
- version transition: not derivable from the record
- scope: previous recorded head → head
- capture: best-effort (scoped result, not complete capture)
- App result: nothing new · 0 of 1 recorded jobs changed

Run verification and assess reviewer value before sharing.

## Receipt-bound review classification (2026-11-17)

Real output from the trusted, finalized E2B pull 93 record. The review assessment is separate from the App result; the card retains its recorded job and background rows. Run verify again before sharing.

<!-- garnet:card slug=E2B pr=93 state=new-behavior -->
### What ran, and what changed · pull request 93

> The recorded comparison is shown below.

Review classification: **finding**

The newly added generate:api step executes Redocly through node › dash › node and reaches otel.cloud.redocly[.]com; the PR base lacks this action. Scoped best-effort telemetry finding.

Assessment evidence: [source 1](https://github.com/garnet-labs/E2B/pull/93#issuecomment-6935783452) · [source 2](https://github.com/garnet-labs/E2B/compare/80594f50bbcd487b0f6a40caab0b4b6e56c7a66e...00f23022bc634bc0fdddc04d7c1754595cd99be7) · [source 3](https://app.garnet.ai/public/runs/44001036865?profile=01a1e74a-f62e-75e6-b130-fa930f04bd87)

Result: **new behavior recorded** (best-effort) · comparison-result

**Comparison pair**

- head: `00f2302` · `00f23022bc634bc0fdddc04d7c1754595cd99be7`
- record bound to: `00f2302`
- compared with: `80594f5` · `80594f50bbcd487b0f6a40caab0b4b6e56c7a66e`
- version transition: not derivable from the record
- scope: the App's last recorded runs on the base branch → head
- capture: best-effort (scoped result, not complete capture)
- App result: changed · 1 of 1 recorded jobs changed

Run verification and assess reviewer value before sharing.

**Execution chains** · quoted from the record · observed-runtime-behavior

### Runtime behavior changed

1 of 1 recorded job changed · compared with the PR base `rb/base-742148dee6-with`

<details>
<summary><b>Dependency install and test (recorded) / Install and test (recorded)</b> · +1<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>node</code> now reaches <code>otel.cloud.redocly[.]com</code></summary>

<blockquote>

<sub>Workload · <a href="https://github.com/garnet-labs/E2B/commit/80594f50bbcd487b0f6a40caab0b4b6e56c7a66e"><code>80594f5</code></a> → <a href="https://github.com/garnet-labs/E2B/pull/93/commits/00f23022bc634bc0fdddc04d7c1754595cd99be7"><code>00f2302</code></a></sub>

```diff
  bash
  ├─ bash › node
  │  └─ registry.npmjs[.]org
+ ├─ node › dash › node
+ │  └─ otel.cloud.redocly[.]com
  ├─ timeout › docker › docker-buildx
  │  └─ auth.docker[.]io
  └─ uv
     └─ dualstack.python.map.fastly[.]net

  node
  ├─ github[.]com
  └─ release-assets.githubusercontent[.]com
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  node
  ├─ productionresultssa3.blob.core.windows[.]net (github infra)
  └─ results-receiver.actions[.]githubusercontent (github infra)

  systemd
  ├─ Daemon › ExtHandler
  │  ├─ python3
  │  │  ├─ 168.63.129[.]16
  │  │  └─ 169.254.169[.]254 (Cloud IMDS)
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
+ ├─ chronyd-starter › chronyd
+ │  ├─ 169[.]254[.]169[.]123
+ │  ├─ 185.125.190[.]122
+ │  ├─ 185.125.190[.]123
+ │  ├─ 91.189.91[.]111
+ │  ├─ 91.189.91[.]112
+ │  └─ 91.189.91[.]113
  ├─ dockerd
  │  ├─ runc
  │  │  ├─ curl
  │  │  │  ├─ 10.0.0[.]2
  │  │  │  ├─ 168.63.129[.]16
  │  │  │  └─ nodejs[.]org
  │  │  ├─ go
  │  │  │  ├─ 10.0.0[.]2
  │  │  │  ├─ 168.63.129[.]16
  │  │  │  ├─ proxy.golang[.]org
  │  │  │  ├─ storage.googleapis[.]com
  │  │  │  └─ sum.golang[.]org
  │  │  ├─ node
  │  │  │  ├─ 10.0.0[.]2
  │  │  │  ├─ 168.63.129[.]16
  │  │  │  └─ registry.npmjs[.]org
  │  │  └─ pip3
  │  │     ├─ 10.0.0[.]2
  │  │     ├─ 168.63.129[.]16
  │  │     ├─ dualstack.python.map.fastly[.]net
  │  │     └─ files.pythonhosted[.]org
  │  ├─ d3ipk8a4rcghwr.cloudfront[.]net
  │  ├─ production.cloudfront.docker[.]com
  │  └─ registry-1.docker[.]io
  ├─ hosted-compute-
  │  ├─ sudo › sudo
  │  │  ├─ 140.82.112[.]23
  │  │  └─ 20.75.202[.]224
  │  ├─ 140.82.112[.]23
  │  ├─ 140.82.113[.]24
  │  ├─ 140.82.114[.]23
  │  ├─ 20.75.202[.]224
  │  └─ hosted-compute-request-orchestrator-prod-iad-02 (github infra)
  ├─ systemd-resolve
  │  ├─ 10.0.0[.]2
  │  └─ 168.63.129[.]16
  └─ systemd-network
     └─ ip6-allrouters
```

<sub><a href="https://github.com/garnet-labs/E2B/actions/runs/44001036865/job/133764845979?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-E2B-pr93&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/44001036865?profile=01a1e74a-f62e-75e6-b130-fa930f04bd87&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-E2B-pr93&amp;utm_content=execution_profile&amp;utm_term=changed">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

**Would this have helped the review?**

Reviewer outcome: not recorded on this card.
Assess the recorded workload scope and action attribution before sharing.


## Receipt-bound triage report

Selected live and historical rows; archive status remains unshareable.

# Record triage

2 records: 1 finding, 1 undeterminable.

Review assessments retain the App result and capture limits. Re-run verify before sharing a finding or control.

<details>
<summary><b>E2B pull 93</b> · finding</summary>

[App record](https://github.com/garnet-labs/E2B/pull/93#issuecomment-6935783452)

**App:** Runtime behavior changed · 1 of 1 recorded job changed<br>
**Capture:** best-effort · **Verify:** PASS

The newly added generate:api step executes Redocly through node › dash › node and reaches otel.cloud.redocly[.]com; the PR base lacks this action. Scoped best-effort telemetry finding.

- Head: `00f23022bc634bc0fdddc04d7c1754595cd99be7`
- Compared: `80594f50bbcd487b0f6a40caab0b4b6e56c7a66e`
- Transition: not derivable from the record
- Scope: pr-base
- [Assessment source 1](https://github.com/garnet-labs/E2B/pull/93#issuecomment-6935783452)
- [Assessment source 2](https://github.com/garnet-labs/E2B/compare/80594f50bbcd487b0f6a40caab0b4b6e56c7a66e...00f23022bc634bc0fdddc04d7c1754595cd99be7)
- [Assessment source 3](https://app.garnet.ai/public/runs/44001036865?profile=01a1e74a-f62e-75e6-b130-fa930f04bd87)

</details>

<details>
<summary><b>continue pull 5</b> · undeterminable</summary>

[App record](https://github.com/garnet-labs/continue/pull/5)

**App:** new-behavior<br>
**Capture:** not-declared · **Verify:** not run

Saved snapshot; current head and capture have not been revalidated.

- Head: `df338ea7d1b2888b19319f49aad5479b291f8d7e`
- Compared: `d522cd12e3a7b75523cf910c0ad8f772f53b9fe6`
- Transition: form-data 4.0.4 → 4.0.6
- Scope: previous-recorded-head-to-head

</details>


## Historical verification gate

Verification examples below use default residue checking. For proofs whose
subject is the Devin loop itself, `verify <pr-url> --devin-loop` exempts only
Devin identity terms and hosts, and explicitly labels the residue leg with
`devin-loop mode applied`. All other legs and non-Devin residue remain enforced.

The [five-prospect report](prospect-batch.md) records the gate as observed on
2026-09-11, not the current state of those exhibits. At 18:00 UTC it reported:

```text
verify https://github.com/garnet-labs/OpenHands/pull/10 · FAIL
capture completeness: capture not declared; comparison undeterminable
public profile identity:
  repository garnet-labs/OpenHands
  run 34629397391 / profile 01a09193-d3d4-707f-823a-d137810394b9
  recorded f96d95f3028a76ff06ffd1e3e13fa6d0881aac84 (refs/pull/10/merge)
  expected cc0afe66eae24f448b0a3215354cd18eefcc7562
```

Both recording jobs succeeded. This output evaluates the evidence identity and
completeness, separately from workload success. A card preserves quoted job
sections for diagnosis but remains undeterminable until verification succeeds.
Historical results below describe the verifier used at their observation time.

At 2026-09-26 07:40 UTC, on a same-path two-commit replay whose E2E matrix ran
two instrumented jobs (excerpt; the check settled detail lists every job):

```text
FAIL https://github.com/garnet-labs/sentry-javascript/pull/4 (head a3ab2c6)
  [no] capture completeness: capture not declared; comparison undeterminable
  [ok] pair line: pair ce38306 (previous) → a3ab2c6 (this commit) from the record summary
  [ok] check settled: All required jobs passed or were skipped, …, E2E remix-hydrogen Test, E2E hydrogen-react-router-7 Test, … completed
  [no] public profile identity: garnet-labs/sentry-javascript / run 36225998050 / profile 01a0dc93-c92e-791e-afb1-fb562466c2d3; recorded dc937a7108457e0349f7a598b843026ef7cd9949 (refs/pull/4/merge); expected head a3ab2c604fafb23985fb54526314d6fd03b27644
  [no] sensor coverage: E2E hydrogen-react-router-7 Test: sensor did not start (setup did not complete: Failed to create agent: Control plane request failed: POST /api/v1/agents (HTTP 500: internal server error)); 1 of 2 jobs covered
not shareable until every leg reads ok
```

The record summary says `jobs: 1`. Without the sensor coverage leg nothing on
the record shows that a second E2E job ran unobserved.

Real output from the commands in this repository, unedited except for the shell
prompt. Captured 2026-09-10. Each example names the fork pull request it came
from so the output can be checked against the live state.

## 1. Plan a replay of a real upstream change (dry run)

The target is `garnet-labs/uv`, the change is upstream pull request 21570 (a
retry-on-Range-header change touching two manifests, three Rust files, and a test).
The fork's `main` has no recording workflow and no Dependabot configuration, so the
plan adds both in commit 1. The plan also compares the six touched paths on the
fork's `main` with the change's base before deciding what else commit 1 stages.

```sh
export GH_TOKEN=$(gh auth token)
node bin/replay.mjs live uv --pr 21570 --work ~/uv-fork --dry-run
```

```text
garnet-labs/uv@main has no .github/dependabot.yml; commit 1 adds one so the fork's own dependency pull requests get recorded
replay plan · uv · upstream change 21570 (number stays local)
fork (only write target): garnet-labs/uv
branch: chore/update-gn6 · base: main · scope: pr-base-to-head
compares: 0ebbd92 → 5dfaef5
record: recording workflow added in commit 1 (cargo); Dependabot pull requests on the fork run it too
dependabot: .github/dependabot.yml added in commit 1 (cargo, weekly)
paths (6): Cargo.lock, Cargo.toml, crates/uv-distribution/Cargo.toml, crates/uv-distribution/src/distribution_database.rs, crates/uv-distribution/src/error.rs, crates/uv/tests/it/network.rs
commit 1 stages: only what the plan adds (the touched paths on main match the change's base)

commands
  git -C /home/ubuntu/uv-fork fetch --prune origin   # reuse the fork checkout
  git -C /home/ubuntu/uv-fork remote add upstream https://github.com/astral-sh/uv.git   # add a read-only upstream remote
  git -C /home/ubuntu/uv-fork remote set-url --push upstream DISABLED-no-push   # disable pushing to upstream
  git -C /home/ubuntu/uv-fork fetch --no-tags upstream 0ebbd9274a55a8a53a13970be3b97e4209598e17 refs/pull/21570/head   # fetch the upstream base commit and the pull request head ref
  git -C /home/ubuntu/uv-fork cat-file -e 5dfaef57107facd8a1d6ef84616b5ef3d4f11ced^{commit}   # guard: the recorded head sha must be the fetched pull request head
  git -C /home/ubuntu/uv-fork remote get-url origin   # guard: origin must be the fork
  git -C /home/ubuntu/uv-fork status --porcelain --untracked-files=no   # guard: the checkout must have no uncommitted changes
  git -C /home/ubuntu/uv-fork rev-list --count 0ebbd9274a55a8a53a13970be3b97e4209598e17 ^origin/main   # guard: how far main on the fork is behind the change's base
  git -C /home/ubuntu/uv-fork checkout -B chore/update-gn6 origin/main   # create chore/update-gn6 from main
  git -C /home/ubuntu/uv-fork rm -q --ignore-unmatch -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: drop paths the change removes or renames
  git -C /home/ubuntu/uv-fork checkout 0ebbd9274a55a8a53a13970be3b97e4209598e17 -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: touched paths as the change found them
  write /home/ubuntu/uv-fork/.github/workflows/garnet-record.yml   # commit 1: add the recording workflow; Dependabot pull requests on the fork run it too
  git -C /home/ubuntu/uv-fork add -- .github/workflows/garnet-record.yml
  write /home/ubuntu/uv-fork/.github/dependabot.yml   # commit 1: add .github/dependabot.yml so the fork gets its own dependency pull requests, each recorded
  git -C /home/ubuntu/uv-fork add -- .github/dependabot.yml
  git -C /home/ubuntu/uv-fork add -A -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 1: stage the paths present after the reset
  git -C /home/ubuntu/uv-fork diff --cached --name-only   # guard: commit 1 must change something
  git -C /home/ubuntu/uv-fork commit -q -m <message below>   # commit 1
  git -C /home/ubuntu/uv-fork checkout 5dfaef57107facd8a1d6ef84616b5ef3d4f11ced -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 2: the change itself
  git -C /home/ubuntu/uv-fork add -A -- Cargo.lock Cargo.toml crates/uv-distribution/Cargo.toml crates/uv-distribution/src/distribution_database.rs crates/uv-distribution/src/error.rs crates/uv/tests/it/network.rs   # commit 2: stage the paths present at the head
  git -C /home/ubuntu/uv-fork diff --cached --name-only   # guard: commit 2 must change something
  git -C /home/ubuntu/uv-fork commit -q -m <message below>   # commit 2
  git -C /home/ubuntu/uv-fork rev-list --count origin/main..HEAD   # guard: exactly two new commits
  git -C /home/ubuntu/uv-fork rev-parse HEAD~1
  git -C /home/ubuntu/uv-fork rev-parse HEAD
  gh pr list --repo garnet-labs/uv --head chore/update-gn6 --state all --json number,state,isDraft,url   # reuse an existing fork pull request on this branch
  if a pull request exists: compare origin/chore/update-gn6 with HEAD~1 and HEAD by tree, then by patch   # match the fork branch against commit 1 and commit 2 by tree, then by patch; a closed pull request's branch is not reused
  git -C /home/ubuntu/uv-fork push --set-upstream origin HEAD~1:refs/heads/chore/update-gn6   # push commit 1 alone to chore/update-gn6 on the fork
  write /home/ubuntu/repos/garnet-replay/out/uv/replay-21570-body.md   # write the pull request body
  gh pr create --repo garnet-labs/uv --draft --base main --head chore/update-gn6 --title "Retry failed partial downloads with HTTP Range header when supported" --body-file /home/ubuntu/repos/garnet-replay/out/uv/replay-21570-body.md   # open a draft pull request on the fork (base main)
  wait for the record of commit 1 on garnet-labs/uv   # wait until commit 1 is recorded; the comparison on commit 2 needs it
  git -C /home/ubuntu/uv-fork push origin HEAD:refs/heads/chore/update-gn6   # push commit 2 to chore/update-gn6 on the fork

commit 1
  ci: record dependency installs on pull requests

  - .github/workflows/garnet-record.yml
  - .github/dependabot.yml

commit 2
  Retry failed partial downloads with HTTP Range header when supported

  - Cargo.lock
  - Cargo.toml
  - crates/uv-distribution/Cargo.toml
  - crates/uv-distribution/src/distribution_database.rs
  - crates/uv-distribution/src/error.rs
  - crates/uv/tests/it/network.rs

pull request (draft)
  title: Retry failed partial downloads with HTTP Range header when supported
  Two commits: the first prepares the branch, the second is the change itself.

  6 files:

  - Cargo.lock
  - Cargo.toml
  - crates/uv-distribution/Cargo.toml
  - crates/uv-distribution/src/distribution_database.rs
  - crates/uv-distribution/src/error.rs
  - crates/uv/tests/it/network.rs

dry run: nothing was executed.

note: garnet-labs/uv@main has no pull_request workflow running garnet-org/action; one is added in commit 1
```

How to read it:

- `commit 1 stages:` is decided before the checkout. The plan compares each
  touched path's blob on the fork's `main` with the same path at the change's
  base. Here they all match, so commit 1 stages only the two `.github/` files and
  its message names them. When at least one path differs, commit 1 stages the
  touched paths as the change found them and the subject reads
  `chore: sync touched files before update` (or `sync dependency manifests` when
  every touched path is a manifest or lockfile). When the comparison cannot be
  made (more than 40 paths, or an API error), the line says so and both messages
  are shown; the executed message then follows `git diff --cached --name-only`.
- When everything matches and nothing else would go into commit 1 (no recording
  workflow to add, no Dependabot file, no `--first` path), the plan refuses
  instead of producing an empty commit and says to pass `--first <path>`.
- Nothing names the upstream repository, its pull request number, or Garnet in the
  branch, commits, title, or body.

## 2. The share gate on a recorded fork pull request

The same change ran earlier as `garnet-labs/uv` pull request 4 (branch
`chore/range-retry`, head `2ef2522`, commit 1 `976ae59` carrying only the
recording workflow).

```sh
node bin/replay.mjs verify https://github.com/garnet-labs/uv/pull/4; echo "exit $?"
```

```text
PASS https://github.com/garnet-labs/uv/pull/4 (head 2ef2522)
  [ok] comment present: 1 Garnet comment
  [ok] head-bound: record bound to 2ef2522
  [ok] comment finalized: record is final; its contract does not declare capture completeness
  [ok] verdict determinable: App summary present
  [ok] pair line: pair 976ae59 (previous) → 2ef2522 (this commit) from the record summary
  [ok] public permalink: GET https://app.garnet.ai/public/runs/34534049128?profile=01a08d4e-d651-741b-9c0a-3666ff4ee271&amp;utm_source=github&amp;utm_medium=pr_comment → 200
  [ok] check settled: Dependency install (recorded) completed
  [ok] no session residue: PR body and other comments carry no harness or session traces
  [ok] label: label real
  [ok] pull request open: state open
exit 0
```

## 3. The evidence card for the same pull request

```sh
node bin/replay.mjs card https://github.com/garnet-labs/uv/pull/4   # writes out/uv/pr-4-card.md
```

````markdown
<!-- garnet:card slug=uv pr=4 state=unchanged -->
### What ran, and what changed · pull request 4

> *1&nbsp;job unchanged · compared with [`976ae59`](https://github.com/garnet-labs/uv/commit/976ae594edcb68fb2d46d0ce096befa2c41d2973)*

Result: **no new behavior recorded** · comparison-result

**Comparison pair**

- head: `2ef2522` · `2ef25221633f68fd67add73e757b73e0d9533e14`
- record bound to: `2ef2522`
- compared with: `976ae59` · `976ae594edcb68fb2d46d0ce096befa2c41d2973`
- version transition: not derivable from the record
- scope: pull request base → head

**Execution chains** · quoted from the record · observed-runtime-behavior

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ sudo
+ │  │  └─ provjobd
+ │  │     └─ ○ hosted-compute-watchdog-prod-iad-01[.]githubapp (github infra)
```

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ ○ 140.82.114.24
```

```diff
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ ○ glb-2a3c35-public-internal.githubapp[.]com (140.82.113.23) (github infra)
```

**Would this have helped the review?**

[View this run in Garnet →](https://app.garnet.ai/public/runs/34534049128?profile=01a08d4e-d651-741b-9c0a-3666ff4ee271&utm_source=github&utm_medium=pr_comment)
````

How to read it: the record is final and head-bound, so the card is shareable, and
its verdict is `unchanged`. The only movement is in the runner background
(GitHub's own hosted-compute processes), which the record separates from the
workload. The workload itself reads the same on both commits. This is a
cohort row, not a showcase: it says the change added no install-time behavior.

## 4. A pull request the gate refuses

`garnet-labs/posthog` pull request 198 has both commits (`9cba733`, `acd3f38`),
but its Garnet comment is still the pending placeholder.

```sh
node bin/replay.mjs verify https://github.com/garnet-labs/posthog/pull/198; echo "exit $?"
```

```text
FAIL https://github.com/garnet-labs/posthog/pull/198 (head acd3f38)
  [ok] comment present: 1 Garnet comment
  [ok] head-bound: record bound to acd3f38
  [no] comment finalized: placeholder text present: "<!-- garnet-control-plane-pending-pr-comment:"
  [no] verdict determinable: no machine summary on the record
  [no] pair line: no pair line on the comment
  [no] public permalink: no public profile link on the comment
  [no] check settled: no Garnet check on the head commit
  [ok] no session residue: PR body and other comments carry no harness or session traces
  [no] label: the record carries no real/constructed label
  [ok] pull request open: state open
not shareable until every leg reads ok
exit 1
```

A pending placeholder is not a record. `card` on this pull request renders
`undeterminable`, and `verify` exits 1 so a script or agent stops here.

## 5. A plan that stops before the write because the fork's recorder is stalled

`garnet-labs/pnpm` has four `pull_request` workflows that run `garnet-org/action`.
One of them runs only on labelled pull requests, and the fork's two newest
recorded pull requests still carry the pending placeholder. Real output, dry run:

```sh
node bin/replay.mjs live pnpm --pr 14819 --work /home/ubuntu/pnpm-fork --dry-run
```

```text
not counted as a recorder: .github/workflows/garnet-jibril-release-gate.yml runs only on pull requests labelled garnet-release-testing
recorder health: stalled · last finalized record on pull request 50 (2026-09-09); pending placeholder on 52 (since 2026-09-10), 51 (since 2026-09-10) · 8 recent pull requests read
replay plan · pnpm · upstream change 14819 (number stays local)
fork (only write target): garnet-labs/pnpm
branch: chore/update-bfn · base: main · scope: pr-base-to-head
compares: cfd4a73 → 14a66d6
record: fork's own recording workflow (every pull request)
paths (8): .changeset/accept-pnpm12-task-settings.md, .github/actions/pipeline-cache/action.yml, .github/workflows/ci.yml, .github/workflows/pacquet-ci.yml, pnpm-workspace.yaml, pnpm11/config/reader/src/getOptionsFromRootManifest.ts, pnpm11/config/reader/test/getOptionsFromRootManifest.test.ts, pnpm11/core/types/src/package.ts
commit 1 stages: the touched paths as the change found them (main on the fork differs on at least one)
…
dry run: nothing was executed.

note: without --allow-pending-recorder, the run stops here: the fork's recorder is stalled
```

Without `--dry-run` the same command stops with exit 1 before any write. The
plan itself is sound; the fork's recorder is not finalizing comments, so a pull
request opened now would wait for a record that is not arriving.

## 6. Local replay workspace

```sh
node bin/replay.mjs serve --port 8787
```

The URL-first entry accepts
`https://github.com/garnet-labs/garnet-runtime-review-reference/pull/31`
and opens `/garnet-labs/garnet-runtime-review-reference/pull/31`. Reloading
that route keeps the same comparison. The landing page renders the running
host as a URL replacement:

```diff
- github.com/garnet-labs/garnet-runtime-review-reference/pull/31
+ localhost:8787/garnet-labs/garnet-runtime-review-reference/pull/31
```

Use `http://` for the local server. The focused result labels this saved
artifact **Historical record · current GitHub head not checked** and keeps
the comparison's scope, base and head beside its observations.

The upstream route `/astral-sh/uv/pull/21570` resolves its ledger-mapped fork
[PR #4](https://github.com/garnet-labs/uv/pull/4). Its focused finding reads:

```text
Recorded observations · workload: +0 / −0 · runner background: +3 / −1
Scope: recorded jobs only. The receipt does not declare capture completeness.
```

Browser verification on 2026-09-11 covered direct PR navigation, history,
canonical dry-run preparation with recording disabled, and an isolated synthetic
recording/verification lifecycle. GitHub-rendered documentation and the
interface were read at desktop and 390px. No real replay was executed.

The workspace was cold-read in Chrome at desktop and 390px widths on
2026-09-11. With the checked-in artifact
`public/replays/github/garnet-labs/garnet-runtime-review-reference/31.json`,
its comparison showed:

```text
Dependency replay: chart-helpers #31
saved evidence · real pair · capture complete
base 8703692 → head b639b38 · immediate-parent-to-head

Workload
  Outbound connections: removed −0 | added +4
    api.ipify.org
    httpbin.org
    ip-api.com
    registry.npmjs.org
  Process observations: removed −0 | added +2
  File observations: not recorded

Runner background
  Outbound connections: removed −2 | added +2
  Process observations: removed −1 | added +0
  File observations: not recorded
```

The saved artifact supplies the label and verdict. This local rendering does not
establish a current share-gate result. Every observation and its available
ancestry is accessible in the viewer; the original artifact remains in Raw JSON.
See [workspace.md](workspace.md) for the planner and HTTP interface.

## 7. Public viewer entrypoint

```sh
node server.mjs
```

The landing page offers:

```text
Open a GitHub PR to inspect its recorded runtime evidence.
Public evidence viewer · recording runs in the local harness.
```

A configured upstream PR without a record directs the next action to:

```text
Prepare a replay in the local harness.
This viewer reads public evidence. Use the local harness to prepare and record a new replay on your fork.
```

The local HTTP checks return `runnerAvailable: false` and `canPrepare: false`.
Both preparation and Start POSTs return 405, including with valid local-origin
and intent headers. A separate test supplies ambient GitHub credentials and
checks that public lookups omit authorization. These checks verify the entrypoint
locally; they do not establish a deployed Vercel URL.

With `REPLAY_DISPATCH_TOKEN`, `REPLAY_OPERATOR_KEY` and `REPLAY_ORIGIN` set, the
same page runs the five-step wizard through `.github/workflows/replay.yml`
([walkthrough](walkthroughs.md#replay-a-new-pr-from-the-hosted-wizard)). No
credentialed hosted run has been recorded yet, so this section shows no hosted
wizard output; the offline behavior is covered by `test/hosted-runner.test.mjs`.

## Preserving the selected base's Dependabot policy

### Alternate-base baseline gate

Read-only output on 2026-11-20:

```sh
node bin/replay.mjs live posthog --pr 125809 --base-branch deps/node-24-base --dry-run
```

```text
branch: deps/node.js-24.22.3 · base: deps/node-24-base (set to the change's base) · scope: pr-base-to-head
compares: fa45929 → 76633f2
  set deps/node-24-base on the fork to the change's base carrying the recording workflow, unless it already does
  wait for successful push recordings on garnet-labs/posthog@deps/node-24-base at the base tip (.github/workflows/ci-vendored-packages.yml, .github/workflows/garnet-ci.yml, .github/workflows/garnet-dependabot-livestream.yml, .github/workflows/garnet-python-toolchain.yml, .github/workflows/garnet-replay-headless.yml, .github/workflows/garnet-sentiment.yml); skip when already recorded
dry run: nothing was executed.
```

These are selected plan lines, not recording evidence or a verified pair.
The hosted attempt on the earlier head stopped at a skipped baseline workflow;
it published no replay PR and produced no compared-commit pair line.

### Selected-base policy

Read-only CLI probe on 2026-09-11, after the five-prospect corrections:

```sh
node bin/replay.mjs live openai-node --pr 2684 \
  --base-branch rb/2684 --record inject --ecosystem pnpm --dry-run
```

The selected source base already has a Dependabot config. The plan preserves
it and lists the additional recorder separately from the upstream change:

```text
commit 1
  ci: record dependency installs on pull requests
  - .github/workflows/garnet-record.yml

commit 2
  chore(deps): bump express and @types/express
  - examples/package.json
  - pnpm-lock.yaml

dry run: nothing was executed.
```

The fresh cards for Vite #5, PostHog #203, Dub #37, OpenHands #10 and
openai-node #43 all report `undeterminable` with capture `not declared`.
They retain the recorded job sections and show immediate-parent-to-head
scope from the ledger's commit 1. The [batch report](prospect-batch.md)
records the public identity failures and independent reads. These examples
do not establish an accepted new-behavior showcase.

## Instrumented recording (dry run)

```text
recorder health: ok · last finalized record on pull request 10 (2026-09-11) · 8 recent pull requests read
replay plan · openhands · upstream change 17270 (number stays local)
fork (only write target): garnet-labs/OpenHands
branch: chore/update-dbq · base: main · scope: pr-base-to-head
compares: 0a5a65c → 3b68461
record: .github/workflows/ci.yml job test-and-build runs under the Garnet sensor from commit 1 (dropped job live-e2e; test-and-build: permissions contents: read, id-token: write; test-and-build: garnet-org/action step after checkout)
paths (5): __tests__/components/features/markdown/markdown-renderer.test.tsx, .github/pr-assets/pr-17270-latex-rendering.png, package-lock.json, package.json, src/components/features/markdown/markdown-renderer.tsx
commit 1 stages: the touched paths as the change found them (main on the fork differs on at least one)

commands
  git clone https://github.com/garnet-labs/OpenHands.git /home/ubuntu/ctx/work/openhands   # clone the fork (never the upstream)
  git -C /home/ubuntu/ctx/work/openhands remote add upstream https://github.com/OpenHands/OpenHands.git   # add a read-only upstream remote
  git -C /home/ubuntu/ctx/work/openhands remote set-url --push upstream DISABLED-no-push   # disable pushing to upstream
  git -C /home/ubuntu/ctx/work/openhands fetch --no-tags upstream 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 refs/pull/17270/head   # fetch the upstream base commit and the pull request head ref
  git -C /home/ubuntu/ctx/work/openhands cat-file -e 3b684610006f94958daccbb738f543215c89a1a3^{commit}   # guard: the recorded head sha must be the fetched pull request head
  git -C /home/ubuntu/ctx/work/openhands remote get-url origin   # guard: origin must be the fork
  git -C /home/ubuntu/ctx/work/openhands status --porcelain --untracked-files=no   # guard: the checkout must have no uncommitted changes
  git -C /home/ubuntu/ctx/work/openhands rev-list --count 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 ^origin/main   # guard: how far main on the fork is behind the change's base
  git -C /home/ubuntu/ctx/work/openhands checkout -B chore/update-dbq origin/main   # create chore/update-dbq from main
  git -C /home/ubuntu/ctx/work/openhands rm -q --ignore-unmatch -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: drop paths the change removes or renames
  git -C /home/ubuntu/ctx/work/openhands checkout 0a5a65c5a18a5054cdfaeed1d87c5d6924b44db1 -- __tests__/components/features/markdown/markdown-renderer.test.tsx package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: touched paths as the change found them
  write /home/ubuntu/ctx/work/openhands/.github/workflows/ci.yml   # commit 1: update .github/workflows/ci.yml
  git -C /home/ubuntu/ctx/work/openhands add -- .github/workflows/ci.yml
  git -C /home/ubuntu/ctx/work/openhands add -A -- __tests__/components/features/markdown/markdown-renderer.test.tsx package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 1: stage the paths present after the reset
  git -C /home/ubuntu/ctx/work/openhands diff --cached --name-only   # guard: commit 1 must change something
  git -C /home/ubuntu/ctx/work/openhands commit -q -m <message below>   # commit 1
  git -C /home/ubuntu/ctx/work/openhands checkout 3b684610006f94958daccbb738f543215c89a1a3 -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 2: the change itself
  git -C /home/ubuntu/ctx/work/openhands add -A -- __tests__/components/features/markdown/markdown-renderer.test.tsx .github/pr-assets/pr-17270-latex-rendering.png package-lock.json package.json src/components/features/markdown/markdown-renderer.tsx   # commit 2: stage the paths present at the head
  git -C /home/ubuntu/ctx/work/openhands diff --cached --name-only   # guard: commit 2 must change something
  git -C /home/ubuntu/ctx/work/openhands commit -q -m <message below>   # commit 2
  git -C /home/ubuntu/ctx/work/openhands rev-list --count origin/main..HEAD   # guard: exactly two new commits
  git -C /home/ubuntu/ctx/work/openhands rev-parse HEAD~1
  git -C /home/ubuntu/ctx/work/openhands rev-parse HEAD
  gh pr list --repo garnet-labs/OpenHands --head chore/update-dbq --state all --json number,state,isDraft,url   # reuse an existing fork pull request on this branch
  if a pull request exists: compare origin/chore/update-dbq with HEAD~1 and HEAD by tree, then by patch   # match the fork branch against commit 1 and commit 2 by tree, then by patch; a closed pull request's branch is not reused
  git -C /home/ubuntu/ctx/work/openhands push --set-upstream origin HEAD~1:refs/heads/chore/update-dbq   # push commit 1 alone to chore/update-dbq on the fork
  write /home/ubuntu/repos/garnet-replay/out/openhands/replay-17270-body.md   # write the pull request body
  gh pr create --repo garnet-labs/OpenHands --draft --base main --head chore/update-dbq --title "feat(markdown): render LaTeX math with KaTeX" --body-file /home/ubuntu/repos/garnet-replay/out/openhands/replay-17270-body.md   # open a draft pull request on the fork (base main)
  wait for the record of commit 1 on garnet-labs/OpenHands   # wait until commit 1 is recorded; the comparison on commit 2 needs it
  git -C /home/ubuntu/ctx/work/openhands push origin HEAD:refs/heads/chore/update-dbq   # push commit 2 to chore/update-dbq on the fork

commit 1
  chore: sync touched files before update

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

commit 2
  feat(markdown): render LaTeX math with KaTeX

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

pull request (draft)
  title: feat(markdown): render LaTeX math with KaTeX
  Two commits: the first prepares the branch, the second is the change itself.

  5 files:

  - __tests__/components/features/markdown/markdown-renderer.test.tsx
  - .github/pr-assets/pr-17270-latex-rendering.png
  - package-lock.json
  - package.json
  - src/components/features/markdown/markdown-renderer.tsx

  Commit 1 also prepares 1 additional file:

  - .github/workflows/ci.yml

dry run: nothing was executed.

note: garnet-labs/OpenHands@main has no pull_request workflow running garnet-org/action; the selected project workflow is instrumented in commit 1
```

## Refreshing a fork (dry run)

```text
refresh before: 189 behind, 8 ahead
refresh after: 0 behind, 9 ahead
dry run: nothing was executed.
```

## Consumption of a recorded fork pull request

`replay consume https://github.com/garnet-labs/pnpm/pull/66` (run 2026-09-22). The first receipt row is a negative statement about the head ("No runtime evidence for this head"): it is kept, but it is not head-bound and does not count as consumption. The second row is the head-bound citation that does.

<!-- garnet:consume pr=https://github.com/garnet-labs/pnpm/pull/66 head=ae2920fc99dbaa9069d8c258225b1c6a8df56904 consumed=true -->
### Consumption · https://github.com/garnet-labs/pnpm/pull/66

head: `ae2920f` · `ae2920fc99dbaa9069d8c258225b1c6a8df56904`

**not consumed** · no head-bound citation on the current head · reviewer-consumption-evidence

| check | state | detail | claim class |
|---|---|---|---|
| record | yes | record bound to head ae2920f | comparison-result |
| mirror | yes | evidence mirror in the body names the head commit | reviewer-consumption-evidence |
| consumers | no | no reviewer or agent cited the head-bound record | reviewer-consumption-evidence |
| receipts | yes | 3 receipt(s): 2 citation, 1 mention · devin-ai-integration[bot], qodo-code-review[bot] | reviewer-consumption-evidence |
| check | yes | Garnet Jibril Release Gate / reproduce / Verify profile, App comment and permalink: failure · Garnet Jibril Release Gate / reproduce / Same workload without the sensor: success · Garnet Jibril Release Gate / reproduce / Simulation — credential-less run skips cleanly: success · Garnet Jibril Release Gate / reproduce / Reproduce self-repo reference on Blacksmith: success · Mirror Garnet evidence for AI reviewers: success · Garnet Jibril Release Gate / reproduce: skipped | required-check-state |

funnel: delivered yes · visible yes · rereviewRequested no · attention yes · grounded yes · observation no · consumed-how: devin-ai-integration[bot] (citation, review-comment, after-record) · cold-read not yet rated · decision-impact unknown · attribution unknown · value-hypothesis unknown

#### Receipts · 3 receipt(s): 2 citation, 1 mention

Kept so weaker signals are not lost behind the consumed line; only head-bound utterance and citation rows count as consumption.

| tier | who | where | commit | matched | excerpt |
|---|---|---|---|---|---|
| citation | devin-ai-integration[bot] | [review-comment](https://github.com/garnet-labs/pnpm/pull/66#discussion_r4074133485) | `ae2920f` (head) | head ae2920f, reports no evidence | 🔍 **No runtime evidence for this head** |
| citation | devin-ai-integration[bot] | [review-comment](https://github.com/garnet-labs/pnpm/pull/66#discussion_r4074198082) | `ae2920f` (head) | head ae2920f, written before the record | Timing: the review ran before the TS CI Node 24 leg finished. Head-bound record for `ae2920f` now exists (job 106845400061): `Download action repository 'garnet-org/action@2609a287b43720d73e26304558b2ead0fafd369b'`, `Jibril Version: v2.1... |
| mention | qodo-code-review[bot] | [comment](https://github.com/garnet-labs/pnpm/pull/66#issuecomment-5780431967) | — | — | TEST["Test workflow"] --> ACTION{{"Garnet action"}} <-- RELEASE["Release workflow"] |


The funnel line places the result: the record was delivered and mirrored, no re-review was requested for this head (the fork predates the re-review step), the citation arrived after the record without a re-request, and nobody has read the review for cold-read, decision impact or value yet.

## Scoring a checked pull request by hand

`replay uat pnpm --pr 66 --cold-read 3 --note "..."` (run 2026-09-22). Only the fields passed change; the observed stages are recomputed by the next `replay consume`, which keeps these manual values while the head stays the same.

```text
pnpm · pull request 66 · head ae2920f · delivered yes · visible yes · rereviewRequested no · attention yes · grounded yes · observation no · consumed-how: devin-ai-integration[bot] (citation, review-comment, after-record) · cold-read 3 of 5 · decision-impact unknown · attribution unknown · value-hypothesis unknown
```

## Consumption harvest across a fork

`replay harvest pnpm --limit 60` (run 2026-09-22, after the negation and finalization-time fixes), first rows of `out/pnpm/consumption-harvest.md`. Each row also writes `out/pnpm/pr-<N>-consume.json` with the source comments; the ledger stores that path relative to the repository.

### Consumption harvest · garnet-labs/pnpm

57 pull request(s) with a record checked · 7 consumed (head-bound) · 33 with at least one receipt · 3 skipped (no record)

| pull request | head | record | mirror | consumed | receipts |
|---|---|---|---|---|---|
| 66 | `ae2920f` | head-bound | yes | no | 3 receipt(s): 2 citation, 1 mention |
| 65 | `68303b0` | head-bound | yes | no | 3 receipt(s): 3 mention |
| 64 | `d858adb` | head-bound | yes | no | no receipts |
| 63 | `afc58c1` | head-bound | yes | no | no receipts |
| 62 | `d0511cd` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 1 receipt(s): 1 utterance |
| 61 | `e9bbfe9` | head-bound | yes | yes · devin-ai-integration[bot] (comment) | 3 receipt(s): 1 utterance, 2 mention |
| 60 | `035e026` | head-bound | yes | no | no receipts |
| 59 | `664b018` | head-bound | yes | no | no receipts |
| 58 | `5d80a00` | head-bound | yes | no | no receipts |
| 57 | — | no | — | — | skipped: no record comment |
| … | | | | | |

## The evidence mirror block written into a pull request description

Rendered by `.github/scripts/garnet-evidence-mirror.mjs` (stage2 template, 2026-09-22) for a finalized four-job record. The preamble names the head by its short SHA so it wraps at phone width; the full SHA binding is the `garnet:commit` marker inside the copied comment. The register in parentheses (jobs, recorded time) is what `replay consume` compares against the live comment to call a copy stale. Placeholders in the citation line are code-formatted so GitHub Markdown does not drop them as unknown HTML tags.

```markdown
<!-- garnet:evidence:begin -->
## Runtime evidence (Garnet)

Kernel-recorded execution record for head `a7f477e` (4 jobs, recorded 2026-09-22 21:04:11 UTC), copied from the sticky Garnet Runtime Review comment on this PR so reviewers that read only the description ground in the same bytes. The comment is the source: it gains jobs as they finish and this block follows it. Facts only. Judgment stays with the reviewer. Cite grounded findings as:

> Runtime evidence (Garnet, head `a7f477e`): `<execution chain>` → `<destination>` (`<workflow>/<job>`) — `<Execution Profile URL>`

<details><summary>Execution record, copied from the comment (4 jobs, recorded 2026-09-22 21:04:11 UTC)</summary>

<!-- garnet-runtime-review -->
<!-- garnet:commit a7f477eb7ab5339e5fdccc73c70ad43e998ea0d5 -->
<!-- garnet:summary {"status":"finalized","jobs":4,"recorded":"2026-09-22 21:04:11 UTC"} -->
## Runtime Review

| Job | Destinations |
|---|---|
| ci / build | 3 |


</details>
<!-- garnet:evidence:end -->```

When the copy lags the comment (a later recorder job finished after the mirror ran), `replay consume` reports the mirror row as:

```text
| mirror | no | evidence mirror in the body is stale: 3 job(s) copied, the comment now has 4 | reviewer-consumption-evidence |
```

## Intended behaviour section on a card

When an `intent` block exists (a `pair` run with `--steps "Run E2E test"` and
the three declared claims over the constructed Sentry-shaped fixture pair —
`mock.shop` and `o1.ingest.sentry.io` under step `14. Run E2E test` on the
base, only the ingest host on the head), `replay card` renders:

```text
**Intended behaviour** · intent-check-result

- `storefront-removed`: Expected behaviour change is present in the record
- `sentry-ingest-kept`: Expected behaviour change is present in the record
- `no-new-outbound`: Expected behaviour change is present in the record
```

A contradicted claim renders `Record contradicts the stated change`; a
matched behaviour on neither side renders `Not observable in either record`;
a missing step or incomplete capture renders `Not determinable: <reason>`.
Workload delta rows no claim covers follow under `Change the pull request
does not describe:`. The section is absent when no claims were declared.

A declared step missing on one side makes the whole scoped comparison
`undeterminable` while the delta rows stay on the card as observations. A
`pair` run over the same fixtures with
`--steps "Run E2E test,Install Playwright"` and a base record lacking the
`Install Playwright` step reports
`step "Install Playwright" was not recorded before the change, so the scoped comparison is not available`
and renders:

```text
> A declared step was not recorded on both sides, so the scoped comparison is not available.

Result: **undeterminable** (steps-missing) · comparison-result

**Intended behaviour** · intent-check-result

- `network:mock.shop:present-before-absent-after`: Expected behaviour change is present in the record

Change the pull request does not describe:
- `cdn.playwright.dev`
- `Runner.Worker → npx → playwright`
```
