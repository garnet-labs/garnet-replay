# Gate profile — reading the Runtime Review machine block

StampHog reads the Garnet Runtime Review comment twice. `runtime_evidence.py` reads the
rendered part: it parses the execution tree so the reviewer can judge each chain against the
diff. `gate_profile.py` reads the machine part — the `garnet:summary` HTML marker — and applies
one structural rule. Prose gets reworded between renderer releases; the marker is the contract
surface a gate may depend on.

## The rule (contract 7.0)

| Marker says | Gate outcome |
|---|---|
| complete capture · eligible baseline · workload unchanged | `clear` — the one named deterministic deny (`deps_toolchain`) may be cleared, and the PR goes to full review |
| workload changed | `escalate` — the delta is quoted for the reviewer, nothing is cleared |
| degraded or unavailable capture, ineligible baseline, missing or unparseable marker, unknown field value, marker head ≠ PR head | `undeterminable` — nothing is cleared |

Every axis fails closed: a field the gate does not recognise is not read as its nearest
neighbour, it lands on `undeterminable`. A marker whose contract is newer than 7.0 is
undeterminable too, because a later contract can change what a field means.

Two properties hold on every path. The gate never approves — at most it moves one deny
category into full review, and `GateDecision.approves` is `False` in the serialized bundle. And
there is no "clean" outcome: absence of evidence is `undeterminable`, never a pass.

Both readings must agree before anything is cleared. `review_pr.py` still asks the tree parser
for a bypass, then withholds it unless the marker cleared the same category, so a renderer
change that the tree parser misreads cannot clear a deny on its own.

## Gate inputs

Contract 7.0 states them: `status`, `verdict`, `capture_quality`, the workload/background delta
partition, the run `profile` URL, and the `digest`. The partition matters for the outcome —
a hosted runner rotating its own egress IPs is background churn and does not escalate; a new
destination under a workflow step is workload and does.

## Pre-7.0 markers

Production (`api.garnet.ai` v1.32.0, probed 2026-08-18) renders contract `6.9.8`, which states
none of those fields. With `pre_contract7_compat: true` the gate derives what it can and names
every derivation in its decision record:

- capture completeness from `jobs` ≥ 1 with no vanished jobs, chains, or destinations. A pre-7.0
  marker cannot report sensor degradation at all, so that axis is invisible.
- the delta from `added`/`removed`/`changed`, which are unpartitioned. Any added or removed
  destination therefore escalates, including runner-background churn that 7.0 keeps quiet.
- `profile` and `digest` are absent and simply not checked.

Turn the flag off and every pre-7.0 marker is undeterminable, which is the strict reading. Leave
it on while production renders 6.x; the derivations are conservative in the direction of
escalating, never of clearing.

## Config and transcripts

```yaml
# .stamphog/runtime-evidence.yml
gate_profile:
    enabled: true
    clearable_deny: deps_toolchain
    pre_contract7_compat: true
```

```bash
uv run tools/pr-approval-agent/gate_profile.py --repo garnet-labs/posthog --pr 130 --deny deps_toolchain
uv run tools/pr-approval-agent/gate_profile.py --body-file some-comment.md --head <sha> --json
```

The CLI prints the PR head, the deny categories, the outcome and its reason, the comparison pair
the marker states, the delta, and which inputs were derived rather than read.
