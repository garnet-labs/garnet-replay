#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pyyaml==6.0.3",
# ]
# ///
# ruff: noqa: T201
"""Machine consumer of the Garnet Runtime Review summary marker (contract 7.0).

`runtime_evidence.py` reads the *rendered* comment: it parses the execution
tree so the LLM reviewer can judge each chain against the diff. This module
reads the *machine block* of the same comment — the `garnet:summary` HTML
marker — and applies contract 7.0's structural gate rule. Rendered prose can
be reworded between renderer releases; the marker is the contract surface a
gate is allowed to depend on.

Verdict table (contract 7.0, fail closed on every axis):

    complete capture + eligible baseline + unchanged
        → CLEAR: exactly one named deterministic deny (the
          dependency/toolchain deny) may be cleared, and the PR still goes to
          full review.
    changed
        → ESCALATE: the workload delta is quoted; nothing is cleared.
    degraded or unavailable capture, ineligible baseline, missing marker,
    unparseable marker, unknown field value, or marker head != PR head
        → UNDETERMINABLE: nothing is cleared.

Evidence never approves a PR. There is no "clean" outcome: the gate either
clears one deny into full review, escalates, or knows nothing.

Contract compatibility. Contract 7.0 states the gate inputs explicitly
(`status`, `verdict`, `capture_quality`, the workload/background delta
partition, `profile`, `digest`). Pre-7.0 markers carry none of them, so this
module can only *derive* the inputs from the counting fields, and it derives
them conservatively:

  - capture completeness comes from `jobs` >= 1 with no vanished jobs,
    chains, or destinations. A pre-7.0 marker cannot report sensor
    degradation at all, so a degraded capture is invisible on this axis.
  - the delta is unpartitioned before the v6.10 partition, so *any* added or
    removed destination escalates, including runner-background churn (a
    hosted-runner IP rotation) that contract 7.0 would keep quiet.

That derivation is off by default (`pre_contract7_compat: false`) — a
pre-7.0 marker is then undeterminable, which is the fail-closed reading.
Every derived input is named in the decision record so a reader can see
which fields were read and which were inferred.
"""

import re
import sys
import json
from dataclasses import dataclass, field
from pathlib import Path

import yaml

SUMMARY_MARKER_RE = re.compile(r"<!--\s*garnet:summary\s+(\{.*?\})\s*-->", re.DOTALL)

CLEAR = "clear"
ESCALATE = "escalate"
UNDETERMINABLE = "undeterminable"

GATE_CONTRACT = (10, 0)
# Markers from this contract on state `status` (finalized/recording), `outcome` (unchanged/changed/
# recorded) and `capture_quality` (complete/best-effort) instead of 7.0's verdict/profile/digest.
_OUTCOME_CONTRACT = (8, 0)

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_PROFILE_HOSTS = ("https://app.garnet.ai/",)

# Values the gate understands. Anything else on these axes is unknown, and
# unknown fails closed rather than being read as its nearest neighbour.
_CAPTURE_COMPLETE = "complete"
_CAPTURE_KNOWN = frozenset({"complete", "degraded", "unavailable", "best-effort"})
_VERDICT_UNCHANGED = "unchanged"
_VERDICT_CHANGED = "changed"
_VERDICT_KNOWN = frozenset({"unchanged", "changed", "undeterminable"})
_STATUS_KNOWN = frozenset({"complete", "partial", "degraded", "unavailable", "finalized", "recording"})

_CONFIG_FILENAME = "runtime-evidence.yml"


class GateProfileError(Exception):
    """Malformed gate-profile config — fail closed, like PolicyError."""


@dataclass(frozen=True)
class GateProfileConfig:
    enabled: bool
    clearable_deny: str
    pre_contract7_compat: bool


@dataclass
class GateDecision:
    """What the machine consumer concluded, and everything it read to get there."""

    outcome: str  # CLEAR | ESCALATE | UNDETERMINABLE
    reason: str
    cleared_denies: list[str] = field(default_factory=list)
    marker: dict | None = None
    contract: str = ""
    inferred: list[str] = field(default_factory=list)
    delta: dict = field(default_factory=dict)
    profile_url: str = ""
    digest: str = ""

    # A gate decision is never an approval. Kept as an attribute so the
    # bundle carries it explicitly rather than by convention.
    approves: bool = False

    def as_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "reason": self.reason,
            "cleared_denies": self.cleared_denies,
            "contract": self.contract,
            "inferred_inputs": self.inferred,
            "delta": self.delta,
            "profile_url": self.profile_url,
            "digest": self.digest,
            "approves": self.approves,
            "marker": self.marker,
        }

    def transcript(self) -> str:
        """Human-readable record of the evaluation, for logs and reports."""
        lines = [f"outcome: {self.outcome}", f"reason: {self.reason}"]
        if self.contract:
            lines.append(f"contract: {self.contract}")
        if self.marker:
            lines.append(f"marker head: {self.marker.get('commit', '(none)')}")
            lines.append(f"marker previous: {self.marker.get('previous') or '(none)'}")
        if self.delta:
            lines.append("delta: " + ", ".join(f"{k}={v}" for k, v in sorted(self.delta.items())))
        if self.inferred:
            lines.append("inferred inputs (not stated by the marker): " + ", ".join(self.inferred))
        lines.append(f"cleared denies: {', '.join(self.cleared_denies) if self.cleared_denies else '(none)'}")
        if self.profile_url:
            lines.append(f"profile: {self.profile_url}")
        if self.digest:
            lines.append(f"digest: {self.digest}")
        lines.append("approves: false (evidence never approves)")
        return "\n".join(lines)


def load_config(stamphog_dir: Path) -> GateProfileConfig | None:
    """Load the `gate_profile` block of `.stamphog/runtime-evidence.yml`.

    None when the file or the block is absent (feature off).
    """
    path = stamphog_dir / _CONFIG_FILENAME
    if not path.exists():
        return None
    try:
        raw = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as exc:
        raise GateProfileError(f"could not read/parse {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise GateProfileError("runtime-evidence config root: must be a mapping")
    block = raw.get("gate_profile")
    if block is None:
        return None
    if not isinstance(block, dict):
        raise GateProfileError("gate_profile: must be a mapping")
    unknown = set(block) - {"enabled", "clearable_deny", "pre_contract7_compat"}
    if unknown:
        raise GateProfileError(f"gate_profile: unknown keys {sorted(unknown)}")
    clearable = block.get("clearable_deny")
    if not isinstance(clearable, str) or not clearable:
        raise GateProfileError("gate_profile: clearable_deny must be a non-empty string")
    for key in ("enabled", "pre_contract7_compat"):
        if key in block and not isinstance(block[key], bool):
            raise GateProfileError(f"gate_profile: {key} must be a boolean")
    return GateProfileConfig(
        enabled=bool(block.get("enabled", False)),
        clearable_deny=clearable,
        pre_contract7_compat=bool(block.get("pre_contract7_compat", False)),
    )


def parse_summary_marker(body: str) -> tuple[dict | None, str]:
    """Extract the `garnet:summary` JSON object from a comment body.

    Returns (marker, error). Exactly one of the two is set.
    """
    match = SUMMARY_MARKER_RE.search(body or "")
    if match is None:
        return None, "comment carries no garnet:summary marker"
    try:
        marker = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        return None, f"garnet:summary marker is not valid JSON ({exc.msg})"
    if not isinstance(marker, dict):
        return None, "garnet:summary marker is not a JSON object"
    return marker, ""


def evaluate(body: str | None, head_sha: str, deny: list[str], config: GateProfileConfig) -> GateDecision:
    """Apply the contract 7.0 verdict table to a Runtime Review comment body.

    `body` is the comment posted by a trusted Garnet author (the caller owns
    that trust check), or None when no such comment exists.
    """
    if not config.enabled:
        return GateDecision(outcome=UNDETERMINABLE, reason="gate profile disabled in .stamphog/runtime-evidence.yml")
    if not body:
        return GateDecision(outcome=UNDETERMINABLE, reason="no Runtime Review comment from a trusted author on this PR")

    marker, error = parse_summary_marker(body)
    if marker is None:
        return GateDecision(outcome=UNDETERMINABLE, reason=error)

    contract_raw = marker.get("contract")
    contract = _parse_contract(contract_raw)
    if contract is None:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=f"marker declares no usable contract version ({contract_raw!r})",
            marker=marker,
        )
    contract_str = str(contract_raw)
    if contract > GATE_CONTRACT:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=(
                f"marker contract {contract_str} is newer than the {GATE_CONTRACT[0]}.{GATE_CONTRACT[1]} "
                "rules this gate implements"
            ),
            marker=marker,
            contract=contract_str,
        )
    pre_contract7 = contract < (7, 0)
    outcome_contract = contract >= _OUTCOME_CONTRACT
    if pre_contract7 and not config.pre_contract7_compat:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=(
                f"marker contract {contract_str} predates 7.0 and states none of the gate inputs "
                "(status, verdict, capture_quality, delta partition); compat derivation is off"
            ),
            marker=marker,
            contract=contract_str,
        )

    inferred: list[str] = []

    commit = marker.get("commit")
    if not isinstance(commit, str) or not _SHA_RE.match(commit):
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=f"marker states no usable head commit ({commit!r})",
            marker=marker,
            contract=contract_str,
        )
    if commit != head_sha:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=(
                f"marker head {commit[:7]} is not the PR head {head_sha[:7] if head_sha else '(unknown)'} — "
                "the comment describes an earlier push"
            ),
            marker=marker,
            contract=contract_str,
        )

    profile_url, profile_error = _read_profile(marker, pre_contract7 or outcome_contract, inferred)
    if profile_error:
        return GateDecision(
            outcome=UNDETERMINABLE, reason=profile_error, marker=marker, contract=contract_str, inferred=inferred
        )
    digest, digest_error = _read_digest(marker, pre_contract7 or outcome_contract, inferred)
    if digest_error:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=digest_error,
            marker=marker,
            contract=contract_str,
            inferred=inferred,
            profile_url=profile_url,
        )

    capture_error = _check_capture(marker, pre_contract7, inferred)
    if capture_error:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=capture_error,
            marker=marker,
            contract=contract_str,
            inferred=inferred,
            profile_url=profile_url,
            digest=digest,
        )

    baseline_error = _check_baseline(marker, commit)
    if baseline_error:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=baseline_error,
            marker=marker,
            contract=contract_str,
            inferred=inferred,
            profile_url=profile_url,
            digest=digest,
        )

    delta, delta_error = _read_delta(marker, pre_contract7, inferred)
    if delta_error:
        return GateDecision(
            outcome=UNDETERMINABLE,
            reason=delta_error,
            marker=marker,
            contract=contract_str,
            inferred=inferred,
            profile_url=profile_url,
            digest=digest,
        )

    verdict, verdict_error = _read_verdict(marker, pre_contract7, delta, inferred)
    common = {
        "marker": marker,
        "contract": contract_str,
        "inferred": inferred,
        "delta": delta,
        "profile_url": profile_url,
        "digest": digest,
    }
    if verdict_error:
        return GateDecision(outcome=UNDETERMINABLE, reason=verdict_error, **common)

    if verdict == _VERDICT_CHANGED:
        return GateDecision(outcome=ESCALATE, reason=_escalation_reason(delta, commit, marker), **common)

    if deny and set(deny) != {config.clearable_deny}:
        return GateDecision(
            outcome=CLEAR,
            reason=(
                f"complete capture, eligible baseline, workload unchanged versus "
                f"{str(marker.get('previous'))[:7]} — but the deny set ({', '.join(sorted(deny))}) is not the single "
                f"clearable {config.clearable_deny} deny, so nothing is cleared"
            ),
            **common,
        )
    return GateDecision(
        outcome=CLEAR,
        reason=(
            f"complete capture, eligible baseline, workload unchanged versus "
            f"{str(marker.get('previous'))[:7]} — {config.clearable_deny} cleared to full review"
        ),
        cleared_denies=[config.clearable_deny] if deny else [],
        **common,
    )


def _parse_contract(raw: object) -> tuple[int, int] | None:
    if not isinstance(raw, str):
        return None
    match = re.match(r"^(\d+)\.(\d+)(?:\.\d+)?$", raw.strip())
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _read_profile(marker: dict, pre_contract7: bool, inferred: list[str]) -> tuple[str, str]:
    raw = marker.get("profile")
    if raw is None:
        if pre_contract7:
            inferred.append("profile (absent before 7.0)")
            return "", ""
        return "", "marker states no profile URL"
    if not isinstance(raw, str) or not raw.startswith(_PROFILE_HOSTS):
        return "", f"marker profile URL is not a Garnet profile URL ({raw!r})"
    return raw, ""


def _read_digest(marker: dict, pre_contract7: bool, inferred: list[str]) -> tuple[str, str]:
    raw = marker.get("digest")
    if raw is None:
        if pre_contract7:
            inferred.append("digest (absent before 7.0)")
            return "", ""
        return "", "marker states no digest"
    if not isinstance(raw, str) or not raw.strip():
        return "", f"marker digest is not a usable string ({raw!r})"
    return raw.strip(), ""


def _check_capture(marker: dict, pre_contract7: bool, inferred: list[str]) -> str:
    """Empty string when the capture is complete; otherwise why it is not."""
    quality = marker.get("capture_quality")
    status = marker.get("status")
    if quality is None and status is None:
        if not pre_contract7:
            return "marker states neither status nor capture_quality"
        derived = _derive_capture(marker)
        if derived != _CAPTURE_COMPLETE:
            return derived
        inferred.append(
            "capture_quality (derived from jobs/vanished counts; pre-7.0 markers cannot report sensor degradation)"
        )
        return ""
    if status is not None:
        if status not in _STATUS_KNOWN:
            return f"marker status {status!r} is not a value this gate understands"
        if status not in ("complete", "finalized"):
            return f"capture status is {status!r}"
    if quality is not None:
        if quality not in _CAPTURE_KNOWN:
            return f"marker capture_quality {quality!r} is not a value this gate understands"
        if quality != _CAPTURE_COMPLETE:
            return f"capture quality is {quality!r}"
    return ""


def _derive_capture(marker: dict) -> str:
    """Pre-7.0 capture completeness, derived from the counting fields."""
    jobs = marker.get("jobs")
    if not isinstance(jobs, int) or jobs < 1:
        return f"marker records no captured job (jobs={jobs!r})"
    for key in ("vanished", "vanishedChains", "vanishedDestinations"):
        value = marker.get(key)
        if value is None:
            continue
        if not isinstance(value, int) or value < 0:
            return f"marker {key} is not a usable count ({value!r})"
        if value > 0:
            return f"capture is incomplete: {key}={value}"
    return _CAPTURE_COMPLETE


def _check_baseline(marker: dict, commit: str) -> str:
    previous = marker.get("previous")
    if previous is None or previous == "":
        return "no eligible baseline: this is the first profiled commit, nothing to compare against"
    if not isinstance(previous, str) or not _SHA_RE.match(previous):
        return f"baseline commit is not a usable sha ({previous!r})"
    if previous == commit:
        return "baseline commit equals the head commit — the comparison is against itself"
    return ""


def _read_delta(marker: dict, pre_contract7: bool, inferred: list[str]) -> tuple[dict, str]:
    """Workload/background delta partition, or the pre-7.0 unpartitioned counts."""
    workload = marker.get("workload")
    background = marker.get("background")
    if workload is None and _is_count(marker.get("added")) and _is_count(marker.get("removed")) and "outcome" in marker:
        workload = {"added": marker["added"], "removed": marker["removed"]}
        if _is_count(marker.get("backgroundAdded")) and _is_count(marker.get("backgroundRemoved")):
            background = {"added": marker["backgroundAdded"], "removed": marker["backgroundRemoved"]}
    if isinstance(workload, dict):
        added, removed = workload.get("added"), workload.get("removed")
        if not _is_count(added) or not _is_count(removed):
            return {}, f"marker workload delta is not usable ({workload!r})"
        delta = {"workload_added": added, "workload_removed": removed}
        if isinstance(background, dict) and _is_count(background.get("added")) and _is_count(background.get("removed")):
            delta["background_added"] = background["added"]
            delta["background_removed"] = background["removed"]
        return delta, ""
    if not pre_contract7:
        return {}, "marker states no workload delta partition"
    added, removed, changed = marker.get("added"), marker.get("removed"), marker.get("changed")
    if not _is_count(added) or not _is_count(removed) or not _is_count(changed):
        return {}, f"marker delta counts are not usable (added={added!r}, removed={removed!r}, changed={changed!r})"
    inferred.append(
        "workload delta (pre-7.0 markers do not partition workload from runner background, "
        "so every added or removed destination counts as workload)"
    )
    return {"unpartitioned_added": added, "unpartitioned_removed": removed, "jobs_changed": changed}, ""


def _read_verdict(marker: dict, pre_contract7: bool, delta: dict, inferred: list[str]) -> tuple[str, str]:
    verdict = marker.get("verdict")
    if verdict is None and "outcome" in marker:
        outcome = marker.get("outcome")
        if outcome == "recorded":
            return "", "marker outcome is 'recorded': a first record with no recorded default-branch run to compare with"
        verdict = outcome
    if verdict is not None:
        if verdict not in _VERDICT_KNOWN:
            return "", f"marker verdict {verdict!r} is not a value this gate understands"
        if verdict == "undeterminable":
            return "", "marker itself reports an undeterminable comparison"
        if isinstance(delta.get("workload_added"), int):
            stated_change = bool(delta["workload_added"] or delta["workload_removed"])
            if stated_change != (verdict == _VERDICT_CHANGED):
                return "", f"marker verdict {verdict!r} contradicts its own workload delta {delta}"
        return verdict, ""
    if not pre_contract7:
        return "", "marker states no verdict"
    inferred.append("verdict (derived from the delta counts)")
    changed = bool(delta.get("unpartitioned_added") or delta.get("unpartitioned_removed") or delta.get("jobs_changed"))
    return (_VERDICT_CHANGED if changed else _VERDICT_UNCHANGED), ""


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _escalation_reason(delta: dict, commit: str, marker: dict) -> str:
    previous = str(marker.get("previous") or "")[:7] or "(no baseline)"
    if "workload_added" in delta:
        quoted = f"+{delta['workload_added']} −{delta['workload_removed']} workload destinations"
        if "background_added" in delta:
            quoted += (
                f" (runner background: +{delta['background_added']} −{delta['background_removed']}, not escalated)"
            )
    else:
        quoted = (
            f"+{delta.get('unpartitioned_added', 0)} −{delta.get('unpartitioned_removed', 0)} destinations across "
            f"{delta.get('jobs_changed', 0)} changed job(s), unpartitioned"
        )
    return f"{commit[:7]} versus {previous}: {quoted} — escalate; nothing cleared"


def gate_row(decision: GateDecision) -> str:
    """One-line gate summary for the review output."""
    return f"{decision.outcome} — {decision.reason}"


def prompt_block(decision: GateDecision) -> str:
    """TRUSTED prompt block: what the machine gate concluded from the marker."""
    lines = [
        "Runtime Review gate profile (Garnet garnet:summary machine block, contract 7.0 to 10.x, TRUSTED — read from the "
        "comment's garnet:summary marker, not its prose):",
        f"  Outcome: {decision.outcome.upper()} — {decision.reason}",
    ]
    if decision.delta:
        lines.append("  Delta: " + ", ".join(f"{k}={v}" for k, v in sorted(decision.delta.items())))
    if decision.inferred:
        lines.append("  Inputs the marker did not state, derived conservatively: " + "; ".join(decision.inferred))
    if decision.outcome == ESCALATE:
        lines.append(
            "  The recorded workload changed versus the previously profiled commit. Judge the new chains "
            "against the diff: if the diff does not explain them, that is a showstopper."
        )
    elif decision.outcome == UNDETERMINABLE:
        lines.append(
            "  No usable machine verdict for this head. Judge the PR without it; do not read the absence "
            "of evidence as evidence of a clean run."
        )
    lines.append("  A gate outcome never approves a PR; at most it clears one deny category into full review.")
    return "\n".join(lines)


def _cli(argv: list[str]) -> int:
    """Evaluate a comment body against a head SHA and print the transcript.

    Reads the body from a file (`--body-file`) or from a live PR
    (`--repo`/`--pr`, using the trusted-bot list in the runtime-evidence
    config). Used to record gate transcripts per scenario.
    """
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate the Garnet gate profile for a PR head")
    parser.add_argument("--repo")
    parser.add_argument("--pr", type=int)
    parser.add_argument("--body-file")
    parser.add_argument("--head", help="PR head SHA (fetched from the PR when omitted)")
    parser.add_argument("--deny", default="", help="comma-separated deny categories on the PR")
    parser.add_argument("--stamphog-dir", default=str(Path(__file__).resolve().parents[2] / ".stamphog"))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    config = load_config(Path(args.stamphog_dir))
    if config is None:
        print("gate profile: no config block in .stamphog/runtime-evidence.yml", file=sys.stderr)
        return 2

    head = args.head or ""
    if args.body_file:
        body: str | None = Path(args.body_file).read_text()
    else:
        if not (args.repo and args.pr):
            parser.error("--repo and --pr are required without --body-file")
        import subprocess

        from runtime_evidence import (
            COMMENT_MARKER,
            load_config as load_runtime_config,
        )

        runtime_config = load_runtime_config(Path(args.stamphog_dir))
        trusted = runtime_config.trusted_bots if runtime_config else frozenset()
        if not head:
            head = json.loads(
                subprocess.run(
                    ["gh", "api", f"repos/{args.repo}/pulls/{args.pr}"],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=30,
                ).stdout
            )["head"]["sha"]
        comments = json.loads(
            subprocess.run(
                ["gh", "api", f"repos/{args.repo}/issues/{args.pr}/comments", "--paginate"],
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            ).stdout
        )
        body = None
        for comment in comments:
            if (comment.get("user") or {}).get("login", "") in trusted and COMMENT_MARKER in (
                comment.get("body") or ""
            ):
                body = comment["body"]

    deny = [c for c in args.deny.split(",") if c]
    decision = evaluate(body, head, deny, config)
    if args.json:
        print(json.dumps(decision.as_dict(), indent=2))
    else:
        print(f"PR head: {head or '(none)'}")
        print(f"deny categories: {', '.join(deny) if deny else '(none)'}")
        print(decision.transcript())
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
