#!/usr/bin/env python3
"""merge-gate: reads the Garnet Runtime Review comment on a pull request and posts
what the record says, in the record's own terms, so a reviewer sees the outcome
without opening the fold.

Garnet decides the outcome (nothing new, changed, capture incomplete); this
gate only relays it and names the changed destinations with the execution
chain that reached them. It classifies nothing itself. Missing, pending, stale
or incomplete evidence is undeterminable, never "no change".

Proof of concept. Garnet reports; the reviewer decides.
"""

import html
import json
import re
import subprocess
import sys

MARKER = "<!-- merge-gate-poc -->"
BOT = "garnet-runtime-review[bot]"

SUMMARY_RE = re.compile(r"<!--\s*garnet:summary\s+(\{.*?\})\s*-->", re.DOTALL)
EXPLAINER_RE = re.compile(r"<details>\s*<summary><sub>How to read this</sub></summary>.*?</details>", re.DOTALL)
JOB_FOLD_RE = re.compile(r"<details[^>]*>\s*<summary>(.*?)</summary>(.*?)</details>", re.DOTALL)
JOB_NAME_RE = re.compile(r"<b>([^<]+)</b>|<code>([^<]+)</code>")
DIFF_FENCE_RE = re.compile(r"```diff\n(.*?)```", re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
DEFANG_RE = re.compile(r"\[\.\]")

DEPENDENCY_FILE_RE = re.compile(
    r"(^|/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|package-lock\.json|"
    r"pyproject\.toml|uv\.lock|requirements[^/]*\.txt|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|\.nvmrc)$"
)


def gh(method, path, fields=None):
    cmd = ["gh", "api", "-X", method, path]
    for key, value in (fields or {}).items():
        cmd += ["-f", f"{key}={value}"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"gh api {method} {path}: {result.stderr[:300]}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def plain(text):
    return html.unescape(TAG_RE.sub("", text)).strip()


def parse_summary(body):
    match = SUMMARY_RE.search(body)
    if match is None:
        return None
    try:
        summary = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return summary if isinstance(summary, dict) else None


def changed_destinations(body):
    """The `+` destinations of each recorded job with the chain that reached them.

    Reads only the job folds; the "How to read this" legend is dropped first, so its
    sample tree is never mistaken for the record.
    """
    body = EXPLAINER_RE.sub("", body)
    changes = []
    for heading, fold in JOB_FOLD_RE.findall(body):
        names = [b or c for b, c in JOB_NAME_RE.findall(heading)]
        job = next((n for n in names if not re.fullmatch(r"[+\u2212\-\d&nbsp;\s]+", html.unescape(n))), names[0] if names else "recorded job")
        for fence in DIFF_FENCE_RE.findall(fold):
            rows = []
            for raw in fence.splitlines():
                if raw.startswith("@@") or not raw.strip():
                    continue
                mark, line = (raw[:1], raw[1:]) if raw[:1] in "+- " else (" ", raw)
                stripped = line.lstrip(" │├└─")
                depth = len(line) - len(stripped)
                name = plain(DEFANG_RE.sub(".", stripped)).lstrip("○→ ").strip()
                if name:
                    rows.append((mark, depth, name))
            stack = []
            for index, (mark, depth, name) in enumerate(rows):
                while stack and stack[-1][0] >= depth:
                    stack.pop()
                has_children = index + 1 < len(rows) and rows[index + 1][1] > depth
                if mark == "+" and not has_children and "." in name:
                    changes.append({"job": plain(job), "destination": name, "chain": [p for _, p in stack]})
                stack.append((depth, name))
    return changes


def evidence_gaps(summary, head):
    gaps = []
    if summary.get("status") != "finalized":
        gaps.append(f"record status is `{summary.get('status', 'missing')}`, not finalized")
    if summary.get("commit") != head:
        gaps.append(f"record is bound to `{str(summary.get('commit', 'missing'))[:12]}`, not the head `{head[:12]}`")
    quality = summary.get("capture_quality")
    if quality != "complete":
        gaps.append(f"capture is `{quality or 'undeclared'}`, not declared complete")
    incomplete = summary.get("incomplete")
    if not isinstance(incomplete, int) or incomplete > 0:
        gaps.append(f"{incomplete if isinstance(incomplete, int) else 'an unknown number of'} job(s) recorded incompletely")
    return gaps


def pr_files(owner, repo, pr):
    files = gh("GET", f"/repos/{owner}/{repo}/pulls/{pr}/files?per_page=100")
    return [f["filename"] for f in files]


def decide(summary, gaps, changes):
    """Garnet's outcome, relayed. A finalized, head-bound record that shows new
    destinations is CHANGED whatever its capture quality; a record that shows
    nothing new is NOTHING NEW only when the capture is declared complete.
    Everything else is UNDETERMINABLE."""
    bound = summary.get("status") == "finalized" and not any(g.startswith("record is bound") for g in gaps)
    outcome = summary.get("outcome")
    if bound and outcome == "changed" and changes:
        return "CHANGED"
    if not gaps and outcome == "unchanged":
        return "NOTHING NEW"
    return "UNDETERMINABLE"


def render(summary, decision, gaps, changes, head, files):
    jobs = summary.get("jobs")
    destinations = summary.get("destinations")
    dependency_only = bool(files) and all(DEPENDENCY_FILE_RE.search(f) for f in files)
    lines = [
        MARKER,
        f"## Merge gate: **{decision}**",
        "",
        f"Head `{head[:12]}` · {jobs if isinstance(jobs, int) else 'unknown'} recorded job(s) · "
        f"{destinations if isinstance(destinations, int) else 'unknown'} destinations · "
        f"recorded {summary.get('recorded', 'time unknown')}.",
        f"Changed files: {'dependency manifests only' if dependency_only else f'{len(files)} files, not only dependency manifests'}.",
        "",
    ]
    heading = summary.get("line") or summary.get("heading")
    if heading:
        lines += [f"Garnet: {heading}", ""]
    if gaps:
        lines += ["Evidence gaps (nothing new cannot be concluded until these clear):", ""]
        lines += [f"- {gap}" for gap in gaps] + [""]
    if changes:
        lines += ["New in this commit, with the execution chain that reached it:", ""]
        for change in changes:
            chain = " → ".join(change["chain"][-3:]) or "chain not shown in the comment"
            lines.append(f"- `{change['destination']}` · {chain} · job {change['job']}")
        lines.append("")
    elif decision == "NOTHING NEW":
        lines += ["Nothing new recorded against the last recorded run on the default branch.", ""]
    lines += ["_Garnet reports; the reviewer decides._"]
    return "\n".join(lines)


def main():
    owner_repo, pr = sys.argv[1], sys.argv[2]
    owner, repo = owner_repo.split("/")
    head = gh("GET", f"/repos/{owner}/{repo}/pulls/{pr}")["head"]["sha"]
    comments = gh("GET", f"/repos/{owner}/{repo}/issues/{pr}/comments?per_page=100")
    reviews = [c["body"] for c in comments if c["user"]["login"] == BOT and "garnet:summary" in c["body"]]
    if not reviews:
        print("no Runtime Review comment found; skipping")
        return
    body = reviews[-1]
    summary = parse_summary(body)
    if summary is None:
        print("Runtime Review comment carries no readable garnet:summary marker; skipping")
        return
    files = pr_files(owner, repo, pr)
    gaps = evidence_gaps(summary, head)
    changes = changed_destinations(body)
    decision = decide(summary, gaps, changes)
    rendered = render(summary, decision, gaps, changes, head, files)
    if "--dry-run" in sys.argv[3:]:
        print(rendered)
        return
    mine = [c for c in comments if MARKER in c["body"]]
    if mine:
        if mine[-1]["body"] == rendered:
            print("gate comment already current")
            return
        gh("PATCH", f"/repos/{owner}/{repo}/issues/comments/{mine[-1]['id']}", {"body": rendered})
    else:
        gh("POST", f"/repos/{owner}/{repo}/issues/{pr}/comments", {"body": rendered})
    print(f"{decision} for {owner_repo}#{pr} at {head[:12]}")


if __name__ == "__main__":
    main()
