#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pyyaml==6.0.3",
# ]
# ///
# ruff: noqa: T201
"""Garnet evidence mirror — upsert the head-bound Garnet Runtime Review
comment into the PR description between stable markers.

Python port of the reference `garnet-evidence-mirror` from
garnet-org/runtime-review-testbed (contract v6.6.1), adapted to this
repo's toolchain and `.stamphog/runtime-evidence.yml` trusted-bot config.

Why: some AI reviewers (verified empirically with Greptile) never receive
PR discussion comments in their review context, so the sticky comment —
however well marked — cannot ground them. Every mainstream reviewer does
read the PR description. Mirroring the comment verbatim into a marked
description section gives those reviewers the same bytes, with the same
head binding, at zero configuration.

Contract:
  - The mirrored record is byte-identical to the sticky comment (verbatim
    mirror). Nothing is summarized, reordered, or subtracted.
  - The section is bounded by `<!-- garnet:evidence:begin -->` /
    `<!-- garnet:evidence:end -->`, each alone on its own line; everything
    outside it is untouched. Marker text mentioned inside prose or code
    spans is never treated as a delimiter.
  - Only a comment whose `<!-- garnet:commit <sha> -->` equals the PR's
    current head is mirrored. No head-bound comment → the section states
    that no runtime evidence exists for the head (never silently stale).
  - When the mirror would push the description past GitHub's size limit,
    the section carries the head binding and a pointer to the sticky
    comment instead of the record, and says so explicitly.
"""

import re
import sys
import json
import argparse
import subprocess
from pathlib import Path

from runtime_evidence import COMMENT_MARKER, load_config

BEGIN_MARKER = "<!-- garnet:evidence:begin -->"
END_MARKER = "<!-- garnet:evidence:end -->"
# Delimiters count only when the marker is the entire line — prose that
# mentions the marker text must not be spliced.
_BEGIN_LINE_RE = re.compile(r"^<!-- garnet:evidence:begin -->[ \t]*\r?$", re.MULTILINE)
_END_LINE_RE = re.compile(r"^<!-- garnet:evidence:end -->[ \t]*\r?$", re.MULTILINE)
_COMMIT_RE = re.compile(r"<!--\s*garnet:commit\s+([0-9a-f]{40})\s*-->")

# GitHub caps issue/PR bodies at 65536 characters; leave headroom for the
# rest of the description.
BODY_LIMIT = 65536


def select_evidence_comment(comments: list[dict], head_sha: str, trusted_bots: frozenset[str]) -> dict | None:
    """The head-bound Garnet comment to mirror: trusted author, runtime-review
    marker, and a commit marker equal to the PR's current head. The installed
    App's live comment is preferred over any fallback poster."""
    bound = [
        c
        for c in comments
        if (c.get("user") or {}).get("login", "") in trusted_bots
        and COMMENT_MARKER in (c.get("body") or "")
        and (m := _COMMIT_RE.search(c["body"])) is not None
        and m.group(1) == head_sha
    ]
    for c in bound:
        if ":v1:app.garnet.ai" in c["body"]:
            return c
    return bound[0] if bound else None


def _section(inner: str) -> str:
    return "\n".join([BEGIN_MARKER, "## Runtime evidence (Garnet)", "", inner.strip(), END_MARKER])


def evidence_section(comment: dict, head_sha: str, repo: str, remaining_budget: int) -> str:
    sha7 = head_sha[:7]
    preamble = "\n".join(
        [
            f"Kernel-recorded execution record for head `{head_sha}`, mirrored verbatim from",
            "the sticky Garnet Runtime Review comment on this PR so reviewers that read only",
            "the description ground in the same bytes. Facts only: each action and the",
            "execution chain behind it. An execution chain is one path from the runner's",
            "root to an action, today an outbound connection; a destination is where that",
            "connection went. Judgment stays with the reviewer (see",
            f"[REVIEW.md](https://github.com/{repo}/blob/HEAD/REVIEW.md)). Cite grounded findings as:",
            "",
            f"> Runtime evidence (Garnet, head `{sha7}`): `<process lineage>` → `<destination>` "
            "(`<workflow>/<job>`) — <Execution Profile URL>",
            "",
        ]
    )
    mirrored = "\n".join(
        [
            "<details><summary>Execution record (verbatim mirror)</summary>",
            "",
            comment["body"].strip(),
            "",
            "</details>",
        ]
    )
    full = _section(f"{preamble}\n{mirrored}")
    if len(full) <= remaining_budget:
        return full
    return _section(
        f"<!-- garnet:commit {head_sha} -->\n{preamble}\nThe record for head `{sha7}` exceeds the "
        "description size budget and is not mirrored here — read it verbatim in "
        f"[the sticky Garnet Runtime Review comment]({comment['html_url']})."
    )


def missing_section(head_sha: str) -> str:
    return _section(
        f"No runtime evidence is bound to head `{head_sha[:7]}` yet — the sticky Garnet"
        " Runtime Review comment either has not been posted for this head or describes an earlier"
        " commit. Missing evidence means *no record*, not a clean run."
    )


def upsert(body: str, block: str) -> str:
    begin = _BEGIN_LINE_RE.search(body)
    if begin:
        after = body[begin.start() :]
        end = _END_LINE_RE.search(after)
        if end:
            return body[: begin.start()] + block + after[end.end() :]
    return f"{body.rstrip()}\n\n{block}\n"


def _gh_json(args: list[str], payload: dict | None = None) -> dict | list:
    cmd = ["gh", "api", *args]
    kwargs: dict = {"capture_output": True, "text": True, "check": True, "timeout": 30}
    if payload is not None:
        cmd += ["--input", "-"]
        kwargs["input"] = json.dumps(payload)
    result = subprocess.run(cmd, **kwargs)
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pr_number", type=int)
    parser.add_argument("--repo", required=True, help="owner/name")
    args = parser.parse_args()

    config = load_config(Path(__file__).resolve().parents[2] / ".stamphog")
    if config is None:
        print("runtime-evidence config absent; not mirroring")
        return 0

    pr = _gh_json([f"repos/{args.repo}/pulls/{args.pr_number}"])
    head_sha = pr["head"]["sha"]
    comments = _gh_json([f"repos/{args.repo}/issues/{args.pr_number}/comments", "--paginate"])
    comment = select_evidence_comment(comments, head_sha, config.trusted_bots)

    current_body = pr.get("body") or ""
    body_without_section = upsert(current_body, "\u0000").replace("\u0000", "")
    block = (
        evidence_section(comment, head_sha, args.repo, BODY_LIMIT - len(body_without_section))
        if comment
        else missing_section(head_sha)
    )
    next_body = upsert(current_body, block)
    if next_body == current_body:
        print("Evidence section already current; nothing to do.")
        return 0
    _gh_json([f"repos/{args.repo}/pulls/{args.pr_number}", "-X", "PATCH"], payload={"body": next_body})
    print(
        f"Mirrored head-bound record (comment {comment['id']}) into the PR description."
        if comment
        else "No head-bound record found; description section states evidence is missing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
