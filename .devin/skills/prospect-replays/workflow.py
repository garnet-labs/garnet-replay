"""Bounded prospect selection, canonical replay, and independent cold reading."""

import asyncio
import json
import re


HARNESS = "garnet-labs/garnet-replay"
SHORTLIST = [
    "garnet-labs/posthog",
    "garnet-labs/pnpm",
    "garnet-labs/openclaw",
    "garnet-labs/n8n",
    "garnet-labs/browser-use",
    "garnet-labs/stagehand",
    "garnet-labs/cline",
    "garnet-labs/OpenHands",
    "garnet-labs/uv",
    "garnet-labs/gh-aw",
]
TARGET_COUNT = 5
MAX_ACTIVE = 2

CONTRACT = """
Farrukh authorized a fresh five-prospect batch: one NEW PR on each of five
EXISTING garnet-labs forks, using the latest garnet-labs/garnet-replay harness,
with an independent cold-read lane and verified learnings returned to that repo.
Goal: a reviewer learns something decision-relevant about what the change ran.
Publication success, a changed headline, and a useful finding are separate.

Read the current harness default branch README.md, AGENTS.md, SKILL.md and
applicable docs before planning. Fetch main and record the full exact harness
commit. Use its find -> live --dry-run -> live -> verify -> card -> status flow.
Prepared mode is allowed for a faithful, explicitly described controlled
workload; use docs/prepared.md. Do not substitute ad-hoc publication machinery.
Real upstream PRs are preferred. An install recording cannot establish runtime
application behavior, HTTP-response semantics, cache correctness, or a security
claim it never measures. No planted beacons, fabricated findings, exploitation,
or pretending a constructed control is an upstream fix.

One writer per fork; fresh routine branch and fork-only base branch when needed.
Preserve default branches and all pre-existing PRs. Exactly two non-empty
commits: recorded control, then actual change. No force-push, hook skips,
--no-wait, --allow-pending-recorder, --allow-behind, security-policy relaxation,
upstream writes/backlinks/mentions, or manual bot-comment editing. Never reopen
old PRs to trigger evidence. Inspect fetch AND push remotes/refspecs before
publication. Do not alter protected action/control-plane/Jibril repositories.
Honor inherited workflow gates; audit the full event/job surface, including
privileged pull_request_target and unrelated benchmark/release jobs before
spending runs. No instrumenting timed benchmarks or broad workflow rewrites.
Use recorder health even for prepared/injected mode: do not use an alternate
mode merely to evade a failed health gate. A fork without a usable path is
blocked, not an invitation to fabricate evidence.

Check existing Dependabot instrumentation and the exact action/auth configuration.
Preserve the harness's supported instrumentation; no claim that an org token
works without a live Dependabot run proving it. OIDC and explicit-token modes
must not be combined. Do not print or export credentials. Use provisioned auth.
Read-only GitHub API permission flags can differ from the authenticated write
path; evaluate actual authorized tool results, never bypass denied access.

Capture exact upstream base/head, fork base, commit1/commit2, workflow and
action SHA, run/job/attempt/profile selectors, workload command/exit, capture
status, verdict, and UTC evidence time. Pending/partial/stale/unbound is
undeterminable. Unchanged is acceptable evidence, not automatically a value
showcase. Runtime structural ancestry alone does not prove a causal explanation.
Inspect all card rows, not just headline counts: omitted rows are a failure.

No central harness edits from child lanes. Return concrete reproduction and
small proposed fixes to the parent, who owns that repo and its knowledge.
No recursive child sessions, except the persistent testing_agent for authorized
UI testing; no recurring automation or external outreach from a child.
Bound investigation, report an exact blocker and salvage artifacts if stuck.
Use Normal mode for bounded engineering judgment. Report through structured
output; upload artifacts and return their URLs, never local-only handoff paths.
"""

SELECT_SCHEMA = {
    "type": "object",
    "properties": {
        "harness_sha": {"type": "string"},
        "targets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "fork": {"type": "string"},
                    "upstream": {"type": "string"},
                    "candidate": {"type": "string"},
                    "rationale": {"type": "string"},
                    "workload": {"type": "string"},
                    "preflight": {"type": "string"},
                },
                "required": [
                    "fork", "upstream", "candidate", "rationale",
                    "workload", "preflight",
                ],
            },
        },
        "ranking": {"type": "string"},
        "blocker": {"type": "string"},
        "artifact_urls": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["harness_sha", "targets", "ranking", "blocker", "artifact_urls"],
}
RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "fork": {"type": "string"},
        "outcome": {"type": "string", "enum": ["verified", "blocked", "failed"]},
        "pr_url": {"type": "string"},
        "harness_sha": {"type": "string"},
        "pair": {"type": "string"},
        "evidence": {"type": "string"},
        "value": {"type": "string"},
        "blocker": {"type": "string"},
        "learnings": {"type": "string"},
        "artifact_urls": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "fork", "outcome", "pr_url", "harness_sha", "pair", "evidence",
        "value", "blocker", "learnings", "artifact_urls",
    ],
}


def validate_selection(selection):
    """Refuse ambiguous inventory before any publication agent starts."""
    if not re.fullmatch(r"[0-9a-f]{40}", selection["harness_sha"]):
        raise ValueError("selection must name the full harness commit")
    targets = selection["targets"]
    if len(targets) != TARGET_COUNT:
        raise ValueError("selection must retain exactly five prospect rows")
    forks = [target["fork"] for target in targets]
    if len(set(forks)) != TARGET_COUNT:
        raise ValueError("one prospect row per fork is required")
    for target in targets:
        if not re.fullmatch(r"garnet-labs/[A-Za-z0-9_.-]+", target["fork"]):
            raise ValueError("only existing garnet-labs forks are eligible")
        for field in ("upstream", "candidate", "rationale", "workload", "preflight"):
            if not isinstance(target[field], str) or not target[field].strip():
                raise ValueError(f"missing selection evidence: {field}")


def failed_result(target, harness_sha, reason):
    """Keep failed lanes visible in the same result contract."""
    return {
        "fork": target["fork"],
        "outcome": "blocked",
        "pr_url": "",
        "harness_sha": harness_sha,
        "pair": "",
        "evidence": "",
        "value": "",
        "blocker": reason,
        "learnings": "",
        "artifact_urls": [],
    }


def reviewable(result, target):
    """A review may inspect a failed exhibit, but never a different fork."""
    pattern = rf"https://github\.com/{re.escape(target['fork'])}/pull/[1-9][0-9]*"
    return re.fullmatch(pattern, result["pr_url"]) is not None


async def main():
    await register_workflow({
        "name": "prospect-replays",
        "description": "Select five review opportunities, replay, independently cold-read",
        "soft_time_limit_minutes": 25,
        "phases": [
            {"title": "select", "detail": "Rank existing forks and measured workloads",
             "count": 1, "soft_time_limit_minutes": 20},
            {"title": "replay", "detail": "Five new canonical replay PRs",
             "count": TARGET_COUNT, "soft_time_limit_minutes": 45},
            {"title": "cold-read", "detail": "Independent evidence and rendered review",
             "count": TARGET_COUNT, "soft_time_limit_minutes": 20},
        ],
    })
    log("Selection starts; no hosted writes in this stage")
    selection = await agent(
        CONTRACT + """
READ-ONLY SELECTOR. Inventory existing garnet-labs forks via GitHub, then rank
the strongest five opportunities. Start with this shortlist but use the complete
accessible fork inventory if a better prospect is evidenced:
""" + json.dumps(SHORTLIST) + """
Probe latest upstream changes and run canonical find for promising candidates.
Inspect exact candidate diff, recent finalized recorder evidence, workflow
triggers/auth/pins, native workload fit, and already-open replays. Do not select
an existing replay pair as a 'fresh' example. Prefer five distinct companies
or projects with clear reviewer questions; do not fill five slots with generic
dependency installs. Score 0-3 each for decision relevance, observable change,
faithful workload, reproducibility, recording readiness, and prospect fit.
Explain each score with evidence, source URLs, UTC observations. Keep commercial
fit as judgment rather than invented demand. Prioritize real diffs with
install/native/download/egress consequences when the recorded job covers them.

Compare at least ten prospects if access allows. Prior work is a lead: PostHog
202 and OpenClaw 32 had finalized records; pnpm 53 finalized after an older
stall; many older comments remained stuck. Refresh, do not assume these persist.
Read existing target ledgers and examples. PostHog 202 already demonstrated a
puppeteer allow-build; do not duplicate it merely because it worked.
Choose a candidate-specific workload, not a changed title. If no defensible
candidate exists in a slot, keep an explicit blocked prospect row with the
reason rather than silently reducing the five. Record possible alternatives
but do not launch them. No fork creation, branches, PRs, runs or comments.
Return the full harness SHA and exactly five unique fork rows. artifact_urls
should include an uploaded selection report with ranked rejects and evidence.
""",
        phase="select", label="rank-prospects", schema=SELECT_SCHEMA,
        repos=[HARNESS], mode="normal",
    )
    validate_selection(selection)
    log("Selection complete: " + json.dumps(selection, sort_keys=True))
    slots = asyncio.Semaphore(MAX_ACTIVE)

    async def prospect(target):
        async with slots:
            log("Replay starts: " + target["fork"])
            try:
                result = await agent(
                    CONTRACT + "\nSelected prospect:\n"
                    + json.dumps(target, sort_keys=True)
                    + "\nSelection harness SHA: " + selection["harness_sha"]
                    + """
YOU OWN REPLAY PRODUCTION for this fork only. Fetch the latest harness main;
record any advance from selection and reconcile its docs before execution.
Confirm the candidate's exact source refs and actual recording boundary.
If the chosen candidate is weak or infeasible, investigate at most two
alternatives in this SAME fork and explain any change. Never change the
allocated fork or invent an engineering defect to satisfy the quota.

Use find and dry-run, audit touched paths and full workflow event surface,
then launch one new replay PR through the harness. A prepared workload must
execute genuine target code and preserve a single reviewed variable; no
parallel bespoke recorder. Do not launch a generic install for a hypothesis
about unrelated runtime code. Use a fresh fork-only base branch if necessary;
never --sync-fork. If preflight cannot be satisfied, return blocked before
writing. Run hooks normally; baseline failures are reported, never skipped.
Bound commit1 wait to 20 minutes and commit2 finalization to 20 minutes.
No automatic reruns or replacement PRs after publication; diagnose and return
the precise stopped state. Do not force publication past a failed share gate.

After commit2 finalizes, run verify, then card, then status. Record native
workload outcomes and completeness separately from network verdict. Your
'verified' means the automated gate passed, not independent cold-read approval.
Do not perform UI testing; a separate lane owns the cold read.
Save a compact JSON evidence manifest, raw canonical command outputs, prepared
input if used, and proposed harness fixes. Upload for the parent/reviewer.
Return PR URL even when its evidence is failed/pending, explicitly classified.
Do not write to garnet-replay; the parent owns central fixes and docs.
""",
                    phase="replay", label=target["fork"], schema=RESULT_SCHEMA,
                    repos=[HARNESS, target["fork"]], mode="normal",
                )
            except WorkflowAgentError as error:
                result = failed_result(
                    target, selection["harness_sha"], "Replay agent: " + str(error)
                )
            log("Replay settled: " + json.dumps(result, sort_keys=True))
        if not reviewable(result, target):
            return {"target": target, "replay": result, "cold_read": None}
        async with slots:
            log("Independent cold read starts: " + target["fork"])
            attachments = "\n".join(
                f'ATTACHMENT:"{url}"' for url in result["artifact_urls"]
            )
            try:
                review = await agent(
                    CONTRACT + "\nIndependent input:\n"
                    + json.dumps({"target": target, "replay": result}, sort_keys=True)
                    + """
READ-ONLY INDEPENDENT COLD REVIEW. The producer's verdict is a claim to test.
Read the actual PR diff, body, two commits, every bot comment, current Runtime
Review, run/job/profile and exact pair. Re-run canonical verify at the same
head. Confirm record completeness declarations and any implicit limitation.
Check whether the recorded workload can answer the selected reviewer question;
a green recorder or coincident destination alone is not enough.

UI testing is explicitly approved by Farrukh's sentence:
"For each i want a new pr in existing fork repos, following altest replay conventison, and a cold read lane to verify if what we want is acutally working."
Delegate rendered inspection to your persistent testing_agent with that verbatim
approval. It owns browser setup and recording. Inspect the COMPLETE real GitHub
PR at desktop and about 390px; if browser authentication blocks it, use GitHub's
Markdown API to render the freshly fetched exact bytes locally and disclose
the fallback. Read title/body/commits/comments, unfold all execution trees,
reconcile all numbers with visible content, follow exact public permalink.
Retain full uncropped screenshots and recording, upload and return URLs.

Report four separate outcomes: workload, capture, hypothesis, incremental
reviewer value. Check for runner churn, ungrounded causal wording, omitted card
rows, wrong comparison scope, setup residue, wrong trigger context, incomplete
capture, and misleading 'unchanged'. For unrelated failed checks, inspect logs
before classifying them; a red PR still affects cold-reader trust.
No source edits, pushes, labels, comments, reruns, or harness changes. Return
specific findings with reproduction and owner. outcome=verified only if BOTH
the evidence/shape gate and cold read pass; value may still be weak.
One review pass, no automatic retries. Report exact blockers instead of
pretending a screenshot or cold read happened. Attach a concise full report.
""" + "\n" + attachments,
                    phase="cold-read", label=target["fork"],
                    schema=RESULT_SCHEMA, repos=[HARNESS], mode="normal",
                )
            except WorkflowAgentError as error:
                review = failed_result(
                    target, result["harness_sha"], "Cold-read agent: " + str(error)
                )
            log("Cold read settled: " + json.dumps(review, sort_keys=True))
            return {"target": target, "replay": result, "cold_read": review}

    results = await asyncio.gather(*(prospect(target) for target in selection["targets"]))
    log("Batch complete; parent must reconcile all five and persist tested fixes")
    log(json.dumps({"selection": selection, "results": results}, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
