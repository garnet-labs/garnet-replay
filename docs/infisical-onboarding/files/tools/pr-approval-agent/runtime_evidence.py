"""Consume Garnet Runtime Review evidence posted on the PR.

Garnet runs an eBPF sensor (Jibril) inside CI jobs and posts a sticky
"Garnet Runtime Review" comment on the PR: the execution tree recorded
while the PR's code actually ran — process lineage chains with the
outbound destinations each chain produced — keyed to the head commit via
an embedded `<!-- garnet:commit <sha> -->` marker. That gives stamphog
something no static reviewer has: kernel-recorded ground truth about what
a change *did* when it ran, not what its diff *looks like* it would do.

This module mirrors migration_risk.py's shape: a deterministic CI signal,
bound to the head commit, interpreted conservatively, feeding a scoped
deny-list bypass plus a TRUSTED prompt block for the LLM reviewer.

Grounding model — the execution tree is the evidence. There is no static
egress allowlist: every destination is judged by the process lineage that
produced it, in the context of the diff, by the LLM reviewer. The only
deterministic signals are integrity (trusted author, head-pinned,
parseable, non-empty) and the renderer's own comparison against the
previously profiled commit (new `+` chains).

Semantics (all fail toward "no bypass"):
    missing   → no Garnet comment for the current head, or a comment from
                which no execution tree could be parsed (waiting state, or
                a renderer format this parser doesn't understand);
                deny-list applies normally and the reviewer is told no
                usable runtime evidence exists.
    recorded  → an execution tree exists for the head commit (snapshot:
                no previous profiled commit to compare against). No
                bypass — with no comparison baseline the tree cannot
                attest that the change left the workload unchanged; the
                full tree still reaches the LLM reviewer in-prompt.
    unchanged → an execution tree exists and the renderer's comparison
                against the previously profiled commit shows no genuinely
                new workload destinations. Scoped bypass: a
                deps_toolchain-only deny may proceed to LLM review (never
                auto-approve). A `+` chain whose destination was already
                recorded (in the unchanged or removed set of the same
                comment) is a RESHAPED chain — the same destination under
                a different process lineage, which installer
                nondeterminism produces run to run. Reshaped chains never
                diverge on their own. `+` chains rooted in the runner
                substrate (systemd-rooted provisioning, no recorded
                workflow step) are runner churn, not workload divergence —
                they never diverge either, but both are still reported to
                the reviewer.
    diverged  → the comparison shows at least one genuinely NEW workload
                destination versus the previously profiled commit. No
                bypass. "New" is an observation; "unexpected" is the
                reviewer's judgment against the diff — the new chains are
                handed to the LLM reviewer as advisory context with
                showstopper guidance, not turned into a deterministic
                refusal.

Trust model: only comments authored by the configured Garnet bot logins
are read, the commit marker must equal the PR head SHA (a stale comment
from an earlier push is ignored), and the configuration lives in
`.stamphog/runtime-evidence.yml` (trusted, human-reviewed via the
stamphog_policy deny which covers `.stamphog/**`).
"""

import re
import html
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import yaml

COMMENT_MARKER = "<!-- garnet-runtime-review -->"

_COMMIT_MARKER_RE = re.compile(r"<!--\s*garnet:commit\s+([0-9a-f]{40})\s*-->")
_DESTINATION_RE = re.compile(r"[→○]\s*([^\s<][^<\n]*?)\s*(?:\(([^)]*)\))?\s*$")
_TAG_RE = re.compile(r"<(strong|em)>|</(strong|em)>")
_PERMALINK_RE = re.compile(r'href="(https://app\.garnet\.ai/public/runs/[^"]+)"')
_EXPLAINER_RE = re.compile(r"<details[^>]*>\s*<summary>(?:<sub>)?💡.*?</details>", flags=re.DOTALL)
_SUBSTRATE_RE = re.compile(
    r"<details[^>]*>\s*<summary><sub>(?:dns \+ )?runner (?:substrate|background)\b.*?</details>",
    flags=re.DOTALL,
)
_DEFANG_RE = re.compile(r"\[([.:])\]")

_CONFIG_FILENAME = "runtime-evidence.yml"

# Roots of the runner-substrate process tree. Contract v6.9 comments render
# the substrate inline in the same comparison fence as the workload (older
# contracts used a separate fold, handled by _SUBSTRATE_RE), so substrate
# chains are also recognized structurally by their process names. Runner
# infrastructure destinations (e.g. rotating hosted-compute IPs) never count
# toward divergence.
_SUBSTRATE_PROCESSES = ("systemd", "systemd-network")


class RuntimeEvidenceError(Exception):
    """Malformed runtime-evidence config — fail closed, like PolicyError."""


@dataclass(frozen=True)
class RuntimeEvidenceConfig:
    trusted_bots: frozenset[str]
    bypass_categories: frozenset[str]


@dataclass
class RuntimeEvidence:
    """Parsed execution tree for the PR's current head commit."""

    status: str  # "missing" | "recorded" | "unchanged" | "diverged"
    commit_sha: str = ""
    destinations: list[dict] = field(default_factory=list)  # {dest, note, lineage, new, reshaped, substrate}
    permalinks: list[str] = field(default_factory=list)

    @property
    def new_destinations(self) -> list[dict]:
        """Destinations genuinely new versus the previously profiled commit."""
        return [d for d in self.destinations if d["new"]]

    @property
    def new_workload_destinations(self) -> list[dict]:
        """New destinations attributable to the workload (runner substrate excluded)."""
        return [d for d in self.destinations if d["new"] and not d.get("substrate")]

    @property
    def substrate_destinations(self) -> list[dict]:
        """Destinations recorded in the runner-substrate section of the comment."""
        return [d for d in self.destinations if d.get("substrate")]

    @property
    def reshaped_chains(self) -> list[dict]:
        """`+` chains whose destination the previous profile already recorded."""
        return [d for d in self.destinations if d.get("reshaped")]

    @property
    def chains(self) -> list[str]:
        """Distinct process lineage chains, in recorded order."""
        out: list[str] = []
        for d in self.destinations:
            if d["lineage"] and d["lineage"] not in out:
                out.append(d["lineage"])
        return out


def load_config(stamphog_dir: Path) -> RuntimeEvidenceConfig | None:
    """Load `.stamphog/runtime-evidence.yml`; None when absent (feature off)."""
    path = stamphog_dir / _CONFIG_FILENAME
    if not path.exists():
        return None
    try:
        raw = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as exc:
        raise RuntimeEvidenceError(f"could not read/parse {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise RuntimeEvidenceError("runtime-evidence config root: must be a mapping")
    # `gate_profile` is read by gate_profile.py, which validates it there.
    unknown = set(raw) - {"version", "trusted_bots", "bypass_categories", "gate_profile"}
    if unknown:
        raise RuntimeEvidenceError(f"runtime-evidence config: unknown keys {sorted(unknown)}")
    if raw.get("version") != 1:
        raise RuntimeEvidenceError(f"runtime-evidence config: unsupported version {raw.get('version')!r}")
    bots = raw.get("trusted_bots") or []
    bypass = raw.get("bypass_categories") or []
    if not bots or not all(isinstance(b, str) for b in bots):
        raise RuntimeEvidenceError("runtime-evidence config: trusted_bots must be a non-empty string list")
    if not all(isinstance(c, str) for c in bypass):
        raise RuntimeEvidenceError("runtime-evidence config: bypass_categories must be strings")
    return RuntimeEvidenceConfig(
        trusted_bots=frozenset(bots),
        bypass_categories=frozenset(bypass),
    )


def fetch_evidence_comment(repo: str, pr_number: int, config: RuntimeEvidenceConfig) -> str | None:
    """Body of the Garnet sticky comment authored by a trusted bot, if any."""
    for comment in _issue_comments(repo, pr_number):
        login = (comment.get("user") or {}).get("login", "")
        body = comment.get("body") or ""
        if login in config.trusted_bots and COMMENT_MARKER in body:
            return body
    return None


def fetch_runtime_evidence(repo: str, pr_number: int, head_sha: str, config: RuntimeEvidenceConfig) -> RuntimeEvidence:
    """Find the Garnet sticky comment on the PR and parse it for the head commit."""
    body = fetch_evidence_comment(repo, pr_number, config)
    if body is None:
        return RuntimeEvidence(status="missing")
    return parse_comment(body, head_sha)


def parse_comment(body: str, head_sha: str) -> RuntimeEvidence:
    """Parse the Garnet comment body; evidence counts only for the current head."""
    marker = _COMMIT_MARKER_RE.search(body)
    if marker is None or marker.group(1) != head_sha:
        return RuntimeEvidence(status="missing")

    destinations, compared = _extract_destinations(body)
    permalinks = _PERMALINK_RE.findall(body)
    if not destinations:
        # Zero parsed destinations means the evidence is unusable — the run is
        # still recording, or the renderer format drifted past this parser.
        # Either way there is no bypass.
        return RuntimeEvidence(status="missing")
    if any(d["new"] and not d.get("substrate") for d in destinations):
        status = "diverged"
    elif compared:
        status = "unchanged"
    else:
        status = "recorded"
    return RuntimeEvidence(
        status=status,
        commit_sha=marker.group(1),
        destinations=destinations,
        permalinks=[html.unescape(p) for p in permalinks],
    )


def _refang(dest: str) -> str:
    """Undo the comment's hostname defanging (`github[.]com` → `github.com`)."""
    return _DEFANG_RE.sub(r"\1", dest)


def _extract_destinations(body: str) -> tuple[list[dict], bool]:
    """Extract the execution tree: `→ destination` leaves plus the process
    lineage above each, and whether the comment compared against a
    previously profiled commit.

    Two evidence containers exist:
    - <pre> trees (snapshot jobs and substrate folds): process nodes wrapped
      in <em>/<strong>, destination leaves as `→ name` (optionally with a
      parenthesised note such as `(dns resolver)`).
    - ```diff fences (changed jobs in comparison comments): the same tree
      with a leading diff column — `+` (new chain vs the previous profiled
      commit), space (unchanged), `-` (no longer recorded; not current
      evidence). Space and `-` destinations form the previous profile's
      destination set, so `+` chains that merely moved an already-recorded
      destination classify as reshaped rather than genuinely new.

    Lineage is reconstructed from tree indentation depth. Hostnames are
    defanged in the comment and refanged here.

    Explainer exclusion: the current contract wraps its sample tree in the
    “How to read this” details fold, which is removed wholesale before
    parsing; older contracts root real trees at `<name> · job` (sample
    trees lack that root).
    """
    body = _EXPLAINER_RE.sub("", body)
    substrate_blocks = _SUBSTRATE_RE.findall(body)
    body = _SUBSTRATE_RE.sub("", body)
    results: list[dict] = []
    seen: dict[tuple[str, str], dict] = {}
    prev_profile_dests: set[str] = set()
    pres = re.findall(r"<pre>(.*?)</pre>", body, flags=re.DOTALL)
    legacy_contract = any("· job" in pre for pre in pres)
    for pre in pres:
        if legacy_contract and "· job" not in pre:
            continue
        _walk_tree([(line, False) for line in pre.splitlines()], results, seen)
    fences = re.findall(r"```diff\n(.*?)```", body, flags=re.DOTALL)
    for fence in fences:
        lines: list[tuple[str, bool]] = []
        for raw in fence.splitlines():
            if raw.startswith("@@"):
                continue
            if raw.startswith("-"):
                removed = _fence_destination(raw[1:])
                if removed:
                    prev_profile_dests.add(removed)
                continue
            added = raw.startswith("+")
            text = raw[1:] if raw[:1] in "+ " else raw
            if not added:
                unchanged = _fence_destination(text)
                if unchanged:
                    prev_profile_dests.add(unchanged)
            lines.append((text, added))
        _walk_tree(lines, results, seen)
    _classify_added(results, prev_profile_dests)
    compared = bool(fences)
    for block in substrate_blocks:
        sub_results: list[dict] = []
        sub_seen: dict[tuple[str, str], dict] = {}
        for pre in re.findall(r"<pre>(.*?)</pre>", block, flags=re.DOTALL):
            _walk_tree([(line, False) for line in pre.splitlines()], sub_results, sub_seen)
        for fence in re.findall(r"```diff\n(.*?)```", block, flags=re.DOTALL):
            compared = True
            lines = [
                (raw[1:] if raw[:1] in "+ " else raw, False)
                for raw in fence.splitlines()
                if not raw.startswith(("@@", "-"))
            ]
            _walk_tree(lines, sub_results, sub_seen)
        for r in sub_results:
            r["reshaped"] = False
            r["substrate"] = True
            results.append(r)
    return results, compared


def _fence_destination(line: str) -> str | None:
    """Destination named on a comparison-fence tree line, or None for process lines."""
    text = _TAG_RE.sub("", line)
    text = re.sub(r"^[\s│├└─]+", "", text).strip()
    match = _DESTINATION_RE.search(text)
    if text.startswith(("→", "○")) and match:
        return _refang(html.unescape(match.group(1)).strip())
    return None


def _is_substrate_lineage(lineage: str) -> bool:
    """Whether a chain belongs to the runner substrate.

    A bare `systemd` root is not enough: a real workload can run as a systemd
    service (`systemd > deploy.service > ○ somewhere`) and must still count
    toward divergence. Only the hosted-runner shapes classify as substrate --
    `systemd-network`, `hosted-compute-*`, and `systemd` chains that either
    consist of runner infrastructure processes or descend through the
    hosted-compute provisioning agent without ever reaching Runner.Worker.
    """
    # Contract v6.10 labels the section root inline, e.g.
    # `systemd (runner background · +3 −1)` — classify on the process name.
    parts = [re.sub(r"\s*\([^)]*\)$", "", p).strip() for p in lineage.split(" > ") if p]
    if not parts:
        return False
    if parts[0].startswith("hosted-compute-") or parts[0] == "systemd-network":
        return True
    if parts[0] != "systemd":
        return False
    # Attribution is structural: on a hosted runner, workload always descends
    # through Runner.Worker. A chain under the hosted-compute provisioning
    # agent that never reaches Runner.Worker (e.g. `sudo > provjobd`) is the
    # runner provisioning itself, whatever the process names are.
    if any(p.startswith("hosted-compute-") for p in parts[1:]) and "Runner.Worker" not in parts:
        return True
    return all(p in _SUBSTRATE_PROCESSES or p.startswith("hosted-compute-") for p in parts[1:])


def _classify_added(results: list[dict], prev_profile_dests: set[str]) -> None:
    """Split `+` chains into genuinely-new destinations vs reshaped chains.

    Only comparison fences carry evidence about the previous profile: a
    space-prefixed line means the previous profile recorded the destination
    too, `-` means it recorded it but the current run did not. A `+` chain
    whose destination sits in that fence-derived set reshaped the lineage of
    an already-recorded destination; any other `+` destination is genuinely
    new. Snapshot `<pre>` trees are current-head evidence only and never
    qualify a `+` chain as reshaped.
    """
    for r in results:
        if _is_substrate_lineage(r["lineage"]):
            r["substrate"] = True
            r["new"] = False
            r["reshaped"] = False
            continue
        r["reshaped"] = r["new"] and r["dest"] in prev_profile_dests
        r["new"] = r["new"] and r["dest"] not in prev_profile_dests


def _walk_tree(lines: list[tuple[str, bool]], results: list[dict], seen: dict[tuple[str, str], dict]) -> None:
    stack: list[tuple[int, str]] = []  # (depth, process name)
    for line, added in lines:
        depth = _tree_depth(line)
        text = _TAG_RE.sub("", line)
        text = re.sub(r"^[\s│├└─]+", "", text).strip()
        if not text:
            continue
        dest_match = _DESTINATION_RE.search(text)
        if text.startswith(("→", "○")) and dest_match:
            dest = _refang(html.unescape(dest_match.group(1)).strip())
            note = (dest_match.group(2) or "").strip()
            lineage = " > ".join(name for d, name in stack if d < depth)
            key = (dest, lineage)
            existing = seen.get(key)
            if existing is None:
                record = {"dest": dest, "note": note, "lineage": lineage, "new": added, "reshaped": False}
                seen[key] = record
                results.append(record)
            elif added:
                # Another job recording the same chain as NEW outranks an
                # earlier unchanged occurrence — a new chain must never be
                # masked by a job where it already existed.
                existing["new"] = True
        else:
            name = html.unescape(re.sub(r"\s*·\s*job$", "", text)).strip()
            while stack and stack[-1][0] >= depth:
                stack.pop()
            stack.append((depth, name))


def _tree_depth(line: str) -> int:
    """Indentation depth of a rendered tree line (3 columns per level)."""
    stripped = _TAG_RE.sub("", line)
    prefix_len = len(stripped) - len(stripped.lstrip(" │├└─"))
    return prefix_len // 3


def bypassable_deny(deny: list[str], evidence: RuntimeEvidence, config: RuntimeEvidenceConfig) -> list[str]:
    """Return deny categories cleared by usable runtime evidence.

    Conservative on purpose: only configured categories (deps_toolchain by
    default) are ever bypassable, only on a matched `unchanged` comparison
    against the previously profiled commit — a first snapshot (`recorded`)
    has no baseline and cannot attest that the change left the workload
    unchanged — and only when *every* deny category on the PR is
    bypassable — a PR that also trips auth or crypto_secrets keeps its
    full deny even with clean runtime evidence.
    Like the migration-risk bypass, this never auto-approves: the PR still
    gets full LLM review with the execution tree in the prompt, and the
    reviewer judges each chain against the diff.
    """
    if evidence.status != "unchanged":
        return []
    if not deny or not set(deny) <= config.bypass_categories:
        return []
    return list(deny)


def prompt_block(evidence: RuntimeEvidence) -> str:
    """Render the TRUSTED prompt block describing the execution tree."""
    if evidence.status == "missing":
        return (
            "Runtime evidence (Garnet): none recorded for the current head commit. "
            "Judge the PR without runtime evidence; do not assume execution was clean."
        )
    lines = [
        f"Runtime evidence (Garnet, TRUSTED — kernel-recorded execution tree while this PR's "
        f"code ran in CI, head {evidence.commit_sha[:7]}). Each line is a destination and the "
        f"process lineage chain that produced it:"
    ]
    for d in evidence.destinations:
        if d["new"]:
            flag = "NEW DESTINATION"
        elif d.get("reshaped"):
            flag = "reshaped chain"
        elif d.get("substrate"):
            flag = "runner substrate chain"
        else:
            flag = "chain"
        note = f" ({d['note']})" if d["note"] else ""
        lineage = d["lineage"] or "(no recorded lineage)"
        lines.append(f"  - [{flag}] {lineage} → {d['dest']}{note}")
    if evidence.reshaped_chains:
        lines.append(
            "  Reshaped chains: the same destination was recorded in the previous profile under "
            "a different process lineage. Installer nondeterminism (npm/pnpm spawn ordering) "
            "produces this normally — weigh a reshaped chain only if the diff makes the "
            "reshaping itself suspicious."
        )
    if evidence.status == "diverged":
        lines.append(
            "  Verdict guidance: at least one workload destination is NEW versus the previously "
            "profiled commit. \"New\" is an observation, not a verdict: judge each new chain "
            "against the diff. If the diff clearly explains that exact chain and destination "
            "(a declared dependency source, an allowlisted lifecycle script's documented fetch), "
            "the recording is confirmation. If the diff does not explain it, or the chain "
            "represents a trust decision (a lifecycle script granted execution, a new script in "
            "a manifest), it is a showstopper — REFUSE and name the chain."
        )
    else:
        lines.append(
            "  Verdict guidance: ground your judgment in this execution tree. For each chain, "
            "ask whether its lineage explains its destination and whether the diff explains the "
            "chain (a package install reaching its registry is coherent; a lifecycle script "
            "spawning a network client the diff never mentions is not). If the recorded workload "
            "does not exercise the code this diff changes, say so — the tree is then evidence "
            "about the CI workload only, not assurance about the change. The tree never vouches "
            "for logic correctness."
        )
    for link in evidence.permalinks[:3]:
        lines.append(f"  Evidence permalink: {link}")
    return "\n".join(lines)


def citation_block(evidence: RuntimeEvidence) -> str | None:
    """Verifiable Markdown citation for the posted verdict comment.

    Whenever runtime evidence existed for the reviewed head, the verdict
    comment carries the exact commit binding, the recorded execution
    chains (with any chain new versus the previously profiled commit
    called out), and the Garnet public run permalinks — so anyone can
    independently verify the kernel-recorded execution tree the verdict
    relied on, without re-running anything.
    """
    if evidence.status == "missing":
        return None
    lines = [
        "<details>",
        f"<summary>Runtime evidence (Garnet) — kernel-recorded execution tree for head <code>{evidence.commit_sha[:7]}</code></summary>",
        "",
        f"Status: **{evidence.status}** — {len(evidence.destinations)} destination(s) across "
        f"{len(evidence.chains)} execution chain(s).",
        "",
        "Grounding: the execution tree (process lineage → destination) is the evidence. "
        "There is no static egress allowlist; the reviewer judges each chain against the diff. "
        "Usable evidence can clear only the configured deny categories to full review — it "
        "never approves a PR by itself.",
    ]
    new = evidence.new_destinations
    reshaped = evidence.reshaped_chains
    if new:
        lines.append("")
        lines.append(f"{len(new)} destination(s) NEW versus the previously profiled commit:")
        for d in new:
            note = f" ({d['note']})" if d["note"] else ""
            lineage = f"`{d['lineage']}` → " if d["lineage"] else ""
            lines.append(f"- {lineage}`{d['dest']}`{note}")
    elif evidence.status == "unchanged":
        lines.append("")
        lines.append("No new destinations versus the previously profiled commit.")
    else:
        lines.append("")
        lines.append("First profiled commit for this PR — snapshot, no comparison baseline.")
    if reshaped:
        lines.append("")
        lines.append(
            f"{len(reshaped)} reshaped chain(s) — destination already in the previous profile, "
            "recorded under a different process lineage:"
        )
        for d in reshaped:
            note = f" ({d['note']})" if d["note"] else ""
            lineage = f"`{d['lineage']}` → " if d["lineage"] else ""
            lines.append(f"- {lineage}`{d['dest']}`{note}")
    lines.append("")
    lines.append("Verify independently:")
    for link in evidence.permalinks[:3]:
        lines.append(f"- [Garnet run profile]({link})")
    lines.append(
        "- The `Garnet Runtime Review` comment on this PR "
        f"(its embedded commit marker must equal `{evidence.commit_sha[:7]}`)."
    )
    lines += ["", "</details>"]
    return "\n".join(lines)


def evidence_dict(evidence: RuntimeEvidence | None) -> dict | None:
    """Full evidence for the machine-readable review bundle."""
    if evidence is None:
        return None
    return {
        "status": evidence.status,
        "commit_sha": evidence.commit_sha,
        "destinations": evidence.destinations,
        "permalinks": evidence.permalinks,
    }


def _issue_comments(repo: str, pr_number: int) -> list[dict]:
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/issues/{pr_number}/comments", "--paginate"],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    return json.loads(result.stdout)
