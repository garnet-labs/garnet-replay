# Benchmark results

Reviewer: **Devin** (this agent), both arms, one pass per seed. Not an external model run and not a human study;
the source-only (control) review for each seed was written before the seed's Execution Diff block was read, then
frozen; the treatment arm re-reviewed the same title/body/diff with the block alongside. Raw arm files:
`benchmark/runs/devin/<seed>.{control,treatment}.json`. Scoring: `benchmark/results-from-devin.mjs`.

Seeds: 25 (21 real, 4 constructed). Judgment changed: **7/25**.
Highest severity changed: **4/25**. Evidence-grounded findings: 0 (control) → 25 (treatment).
Source-only blind spots (severity rose on a finding the diff could not supply): **3** — constructed-30305397518, constructed-30376868306, real-reference-31.

Honesty notes:
- The real PostHog seeds (20) all record 0 workload destinations added; the treatment arm's only effect there is to
  close open questions raised by the diff (e.g. real-164 should_fix → consider, real-140/165/182 comment → approve).
  That is a de-escalation, not a discovery.
- The one real escalation is `real-reference-31`: a one-line `file:` dependency add in garnet-labs/garnet-runtime-review-reference#31,
  kernel-recorded on its own two commits (8703692 → b639b38) in a single OIDC replay run. Source-only review could only
  ask what the tarball does; the record shows node → dash → node reaching api.ipify.org, ip-api.com and httpbin.org.
  The package is a deliberately authored demo beacon in a garnet-labs demo repo, not a third-party supply-chain incident.
- The 4 constructed seeds compare against a clean constructed install (`constructed-pair`), not a PR's own parent.

| seed | label | judgment (control → treatment) | highest severity | judgment_changed | severity_changed | evidence_grounded (c → t) | source blind spot |
|---|---|---|---|---|---|---|---|
| constructed-30304258281 | constructed | approve → approve | consider → consider | false | false | 0 → 1 |  |
| constructed-30304293294 | constructed | request_changes → request_changes | must_fix → must_fix | false | false | 0 → 1 |  |
| constructed-30305397518 | constructed | comment → request_changes | should_fix → must_fix | true | true | 0 → 1 | yes |
| constructed-30376868306 | constructed | comment → request_changes | consider → must_fix | true | true | 0 → 1 | yes |
| real-139 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-140 | real | comment → approve | consider → consider | true | false | 0 → 1 |  |
| real-141 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-142 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-143 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-145 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-146 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-147 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-148 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-149 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-150 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-151 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-155 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-164 | real | comment → approve | should_fix → consider | true | true | 0 → 1 |  |
| real-165 | real | comment → approve | consider → consider | true | false | 0 → 1 |  |
| real-173 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-176 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-182 | real | comment → approve | consider → consider | true | false | 0 → 1 |  |
| real-184 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-186 | real | approve → approve | consider → consider | false | false | 0 → 1 |  |
| real-reference-31 | real | comment → request_changes | consider → must_fix | true | true | 0 → 1 | yes |
