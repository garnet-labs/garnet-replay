#!/usr/bin/env python3
"""CI-shape stand-in for StampHog's server-side publisher.

In production the engine runs server-side and the GitHub App (stamphog[bot])
publishes the verdict as one sticky comment marked
`<!-- stamphog:review-status -->`: lead prose first, judgment bullets, then a
collapsed "Gate mechanics and policy version" table. This repo runs the same
engine in Actions, so this shim publishes the body shape under the
replay-compatible sticky marker, upserted, as github-actions[bot].

Body precedence:
1. `review_body` from the engine's --output-json — the exact markdown the
   engine renders for LLM-reviewed verdicts. Posted verbatim.
2. Gate-only paths (WAIT / gate refusals / auto-approvals): the deciding gate
   messages as the lead prose, then the same mechanics table built from the
   same JSON fields the renderer uses.

Usage: stamphog-publish.py <verdict.json> <owner/repo> <pr_number>
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile

MARKER = "<!-- stamphog-sticky-review -->"
LEGACY_MARKER = "<!-- stamphog-verdict -->"


def gh(args: list[str]) -> str:
    result = subprocess.run(["gh"] + args, check=True, capture_output=True, text=True)
    return result.stdout


def mechanics_table(d: dict) -> str:
    rows = [
        f"| {g['gate']} | {'✓' if g.get('passed') else '✗'} | {g.get('message', '')} |"
        for g in (d.get("gates") or [])
    ]
    rows.append(
        f"| stamphog {d.get('stamphog_version', '')} |  | "
        f"`.stamphog/policy.yml` @ `{(d.get('policy', {}).get('commit_sha') or '')[:7]}`"
        f" · reviewed head `{(d.get('head_sha') or '')[:7]}` |"
    )
    return (
        "<details>\n<summary>Gate mechanics and policy version</summary>\n\n"
        "| Gate |  | Result |\n|---|---|---|\n" + "\n".join(rows) + "\n\n</details>"
    )


def render_body(d: dict) -> str:
    verdict = (d.get("final_verdict") or "UNDETERMINABLE").replace("-", "_")
    receipt = f"reviewed `{d.get('head_sha', '')}` — verdict: **{verdict}**"
    body = d.get("review_body")
    if body:
        return receipt + "\n\n" + body
    gates = d.get("gates") or []
    failing = [g.get("message", "") for g in gates if not g.get("passed")]
    verdict = d.get("final_verdict") or ""
    if failing:
        lead = " ".join(m for m in failing if m)
    elif verdict == "AUTO-APPROVED":
        lead = "All gates clear — within the auto-approve envelope."
    else:
        lead = f"{verdict or 'No verdict'} — gate mechanics below; full log in the workflow run."
    citation = (d.get("classification") or {}).get("runtime_evidence_citation")
    return "\n\n".join(part for part in [receipt, lead, mechanics_table(d), citation] if part)


def main() -> None:
    verdict_path, repo, pr = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(verdict_path) as f:
        d = json.load(f)
    full = MARKER + "\n" + render_body(d)

    comments = json.loads(gh(["api", f"repos/{repo}/issues/{pr}/comments", "--paginate"]))
    existing = [c["id"] for c in comments if MARKER in (c.get("body") or "")]
    legacy = [c["id"] for c in comments if LEGACY_MARKER in (c.get("body") or "")]

    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(full)
        body_file = f.name

    if existing:
        gh(["api", "-X", "PATCH", f"repos/{repo}/issues/comments/{existing[-1]}", "-F", f"body=@{body_file}"])
        print(f"updated review-status comment {existing[-1]}")
    else:
        gh(["api", "-X", "POST", f"repos/{repo}/issues/{pr}/comments", "-F", f"body=@{body_file}"])
        print("created review-status comment")

    for cid in legacy:
        gh(["api", "-X", "DELETE", f"repos/{repo}/issues/comments/{cid}"])
        print(f"deleted legacy verdict comment {cid}")


if __name__ == "__main__":
    main()
