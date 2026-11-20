#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pyyaml==6.0.3",
# ]
# ///
# ruff: noqa: T201
"""Mirror the Garnet runtime-evidence verdict as a commit status on the PR head.

Surfaces the same parse `review_pr.py` consumes as a `garnet/runtime-evidence`
status in the PR checks UI, bound to the head SHA:

    success  → an execution tree is recorded for the head with no
               genuinely new destinations versus the previously profiled
               commit (reshaped chains — an already-recorded destination
               under a different lineage — stay success and are counted)
    failure  → the tree shows at least one genuinely NEW destination
               versus the previously profiled commit
    pending  → no usable evidence for the head yet (waiting, stale, or a
               renderer format the parser refuses to trust)

The status is informational plus branch-protection-ready; the deny-bypass
decision itself stays inside review_pr.py.
"""

import sys
import json
import argparse
import subprocess
from pathlib import Path

from runtime_evidence import RuntimeEvidence, fetch_runtime_evidence, load_config

_CONTEXT = "garnet/runtime-evidence"


def status_payload(evidence: RuntimeEvidence) -> tuple[str, str]:
    """Map parsed evidence to a commit-status (state, description)."""
    if evidence.status in ("recorded", "unchanged"):
        reshaped = evidence.reshaped_chains
        suffix = f", {len(reshaped)} reshaped chain(s)" if reshaped else ""
        return (
            "success",
            f"{evidence.status}: {len(evidence.destinations)} destination(s) across "
            f"{len(evidence.chains)} execution chain(s){suffix}, head-pinned",
        )
    if evidence.status == "diverged":
        named = ", ".join(d["dest"] for d in evidence.new_destinations[:3])
        return "failure", f"{len(evidence.new_destinations)} new destination(s) vs previous profile: {named}"
    return "pending", "no usable runtime evidence for this head yet (fail-closed)"


def _gh_json(args: list[str]) -> dict:
    result = subprocess.run(["gh", "api", *args], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pr_number", type=int)
    parser.add_argument("--repo", required=True, help="owner/name")
    args = parser.parse_args()

    config = load_config(Path(__file__).resolve().parents[2] / ".stamphog")
    if config is None:
        print("runtime-evidence config absent; not posting a status")
        return 0

    pr = _gh_json([f"repos/{args.repo}/pulls/{args.pr_number}"])
    head_sha = pr["head"]["sha"]
    evidence = fetch_runtime_evidence(args.repo, args.pr_number, head_sha, config)

    state, description = status_payload(evidence)
    target_url = evidence.permalinks[0] if evidence.permalinks else pr["html_url"]
    _gh_json(
        [
            f"repos/{args.repo}/statuses/{head_sha}",
            "-f",
            f"state={state}",
            "-f",
            f"context={_CONTEXT}",
            "-f",
            f"description={description[:140]}",
            "-f",
            f"target_url={target_url}",
        ]
    )
    print(f"{_CONTEXT} @ {head_sha[:9]}: {state} ({description})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
