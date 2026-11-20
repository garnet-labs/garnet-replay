"""Tests for the contract 7.0 machine gate consumer."""

import json

import pytest

from gate_profile import (
    CLEAR,
    ESCALATE,
    UNDETERMINABLE,
    GateProfileConfig,
    GateProfileError,
    evaluate,
    load_config,
    parse_summary_marker,
    prompt_block,
)

HEAD = "a" * 40
PREV = "b" * 40

CONFIG = GateProfileConfig(enabled=True, clearable_deny="deps_toolchain", pre_contract7_compat=True)
STRICT = GateProfileConfig(enabled=True, clearable_deny="deps_toolchain", pre_contract7_compat=False)


def marker_body(**overrides) -> str:
    marker = {
        "contract": "7.0.0",
        "status": "complete",
        "verdict": "unchanged",
        "capture_quality": "complete",
        "commit": HEAD,
        "previous": PREV,
        "jobs": 1,
        "changed": 0,
        "workload": {"added": 0, "removed": 0},
        "background": {"added": 3, "removed": 2},
        "profile": "https://app.garnet.ai/public/runs/123",
        "digest": "sha256:deadbeef",
    }
    for key, value in overrides.items():
        if value is None:
            marker.pop(key, None)
        else:
            marker[key] = value
    return f"<!-- garnet-runtime-review -->\n<!-- garnet:summary {json.dumps(marker)} -->\nrendered prose\n"


def legacy_body(**overrides) -> str:
    marker = {
        "contract": "6.9.8",
        "commit": HEAD,
        "previous": PREV,
        "jobs": 1,
        "changed": 0,
        "added": 0,
        "removed": 0,
        "vanished": 0,
        "vanishedDestinations": 0,
        "chains": 40,
        "destinations": 11,
    }
    for key, value in overrides.items():
        if value is None:
            marker.pop(key, None)
        else:
            marker[key] = value
    return f"<!-- garnet-runtime-review -->\n<!-- garnet:summary {json.dumps(marker)} -->\n"


# ── the three outcomes ───────────────────────────────────────────


def test_complete_capture_eligible_baseline_unchanged_clears_the_named_deny() -> None:
    decision = evaluate(marker_body(), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == CLEAR
    assert decision.cleared_denies == ["deps_toolchain"]
    assert decision.approves is False
    assert decision.digest == "sha256:deadbeef"


def test_changed_workload_escalates_quoting_the_delta() -> None:
    decision = evaluate(
        marker_body(verdict="changed", workload={"added": 2, "removed": 0}), HEAD, ["deps_toolchain"], CONFIG
    )
    assert decision.outcome == ESCALATE
    assert decision.cleared_denies == []
    assert "+2 −0 workload destinations" in decision.reason
    assert "runner background: +3 −2, not escalated" in decision.reason


def test_background_only_delta_does_not_escalate() -> None:
    decision = evaluate(marker_body(background={"added": 9, "removed": 4}), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == CLEAR
    assert decision.cleared_denies == ["deps_toolchain"]


# ── fail-closed paths ────────────────────────────────────────────


def test_no_comment_is_undeterminable() -> None:
    decision = evaluate(None, HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert decision.cleared_denies == []


def test_missing_marker_is_undeterminable() -> None:
    decision = evaluate("<!-- garnet-runtime-review -->\nprose only\n", HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "no garnet:summary marker" in decision.reason


def test_unparseable_marker_is_undeterminable() -> None:
    decision = evaluate("<!-- garnet:summary {not json} -->", HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "not valid JSON" in decision.reason


def test_head_mismatch_is_undeterminable() -> None:
    decision = evaluate(marker_body(), "c" * 40, ["deps_toolchain"], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "is not the PR head" in decision.reason
    assert decision.cleared_denies == []


def test_degraded_capture_is_undeterminable() -> None:
    decision = evaluate(marker_body(capture_quality="degraded"), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "capture quality is 'degraded'" in decision.reason


def test_unavailable_capture_is_undeterminable() -> None:
    decision = evaluate(marker_body(capture_quality="unavailable"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE


def test_unknown_capture_value_is_undeterminable() -> None:
    decision = evaluate(marker_body(capture_quality="mostly-fine"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "not a value this gate understands" in decision.reason


def test_partial_status_is_undeterminable() -> None:
    decision = evaluate(marker_body(status="partial"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "capture status is 'partial'" in decision.reason


def test_first_profiled_commit_has_no_eligible_baseline() -> None:
    decision = evaluate(marker_body(previous=None), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "first profiled commit" in decision.reason


def test_baseline_equal_to_head_is_ineligible() -> None:
    decision = evaluate(marker_body(previous=HEAD), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "against itself" in decision.reason


def test_newer_contract_than_the_gate_is_undeterminable() -> None:
    decision = evaluate(marker_body(contract="8.1.0"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "newer than the 7.0 rules" in decision.reason


def test_missing_contract_is_undeterminable() -> None:
    decision = evaluate(marker_body(contract=None), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE


def test_verdict_contradicting_its_own_delta_is_undeterminable() -> None:
    decision = evaluate(marker_body(verdict="unchanged", workload={"added": 1, "removed": 0}), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "contradicts its own workload delta" in decision.reason


def test_marker_reporting_its_own_undeterminable_verdict_is_undeterminable() -> None:
    decision = evaluate(marker_body(verdict="undeterminable"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE


def test_non_garnet_profile_url_is_undeterminable() -> None:
    decision = evaluate(marker_body(profile="https://example.com/run/1"), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE


@pytest.mark.parametrize("field", ["profile", "digest", "workload"])
def test_contract7_marker_missing_a_gate_input_is_undeterminable(field: str) -> None:
    decision = evaluate(marker_body(**{field: None, "verdict": None}), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE


def test_disabled_gate_never_clears() -> None:
    disabled = GateProfileConfig(enabled=False, clearable_deny="deps_toolchain", pre_contract7_compat=True)
    decision = evaluate(marker_body(), HEAD, ["deps_toolchain"], disabled)
    assert decision.outcome == UNDETERMINABLE


# ── deny scoping ─────────────────────────────────────────────────


def test_deny_set_wider_than_the_clearable_deny_clears_nothing() -> None:
    decision = evaluate(marker_body(), HEAD, ["deps_toolchain", "auth"], CONFIG)
    assert decision.outcome == CLEAR
    assert decision.cleared_denies == []
    assert "is not the single clearable deps_toolchain deny" in decision.reason


def test_pr_without_denies_clears_nothing_to_clear() -> None:
    decision = evaluate(marker_body(), HEAD, [], CONFIG)
    assert decision.outcome == CLEAR
    assert decision.cleared_denies == []


# ── pre-7.0 compatibility ────────────────────────────────────────


def test_pre_contract7_marker_is_undeterminable_when_compat_is_off() -> None:
    decision = evaluate(legacy_body(), HEAD, ["deps_toolchain"], STRICT)
    assert decision.outcome == UNDETERMINABLE
    assert "predates 7.0" in decision.reason


def test_pre_contract7_unchanged_clears_and_names_every_derived_input() -> None:
    decision = evaluate(legacy_body(), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == CLEAR
    assert decision.cleared_denies == ["deps_toolchain"]
    joined = " ".join(decision.inferred)
    assert "capture_quality" in joined
    assert "workload delta" in joined
    assert "verdict" in joined
    assert "profile" in joined
    assert "digest" in joined


def test_pre_contract7_unpartitioned_delta_escalates_even_for_background_churn() -> None:
    decision = evaluate(legacy_body(added=3, removed=2, changed=1), HEAD, ["deps_toolchain"], CONFIG)
    assert decision.outcome == ESCALATE
    assert "+3 −2 destinations across 1 changed job(s), unpartitioned" in decision.reason


def test_pre_contract7_vanished_job_is_incomplete_capture() -> None:
    decision = evaluate(legacy_body(vanished=1), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "capture is incomplete: vanished=1" in decision.reason


def test_pre_contract7_zero_jobs_is_incomplete_capture() -> None:
    decision = evaluate(legacy_body(jobs=0), HEAD, [], CONFIG)
    assert decision.outcome == UNDETERMINABLE
    assert "records no captured job" in decision.reason


def test_real_production_marker_from_pr130_fixture_escalates_on_runner_rotation() -> None:
    """The live pre-7.0 renderer cannot say the delta was runner background."""
    from pathlib import Path

    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr130.md").read_text()
    head = "eb0d3f112a57265e92e744ca62ee0a1c0cd6a1ef"
    decision = evaluate(body, head, ["deps_toolchain"], CONFIG)
    assert decision.outcome == ESCALATE
    assert decision.contract == "6.9.8"
    assert decision.cleared_denies == []


# ── marker parsing and rendering ─────────────────────────────────


def test_parse_summary_marker_reads_the_json_object() -> None:
    marker, error = parse_summary_marker(marker_body())
    assert error == ""
    assert marker is not None
    assert marker["contract"] == "7.0.0"


def test_prompt_block_never_promises_approval() -> None:
    block = prompt_block(evaluate(marker_body(), HEAD, ["deps_toolchain"], CONFIG))
    assert "never approves" in block


def test_transcript_records_the_read_fields() -> None:
    transcript = evaluate(marker_body(), HEAD, ["deps_toolchain"], CONFIG).transcript()
    assert "outcome: clear" in transcript
    assert f"marker head: {HEAD}" in transcript
    assert "approves: false" in transcript


# ── config ───────────────────────────────────────────────────────


def test_load_config_reads_the_repo_config(tmp_path) -> None:
    (tmp_path / "runtime-evidence.yml").write_text(
        "version: 1\ntrusted_bots: ['x[bot]']\ngate_profile:\n"
        "  enabled: true\n  clearable_deny: deps_toolchain\n  pre_contract7_compat: false\n"
    )
    config = load_config(tmp_path)
    assert config == GateProfileConfig(enabled=True, clearable_deny="deps_toolchain", pre_contract7_compat=False)


def test_load_config_absent_block_disables_the_feature(tmp_path) -> None:
    (tmp_path / "runtime-evidence.yml").write_text("version: 1\ntrusted_bots: ['x[bot]']\n")
    assert load_config(tmp_path) is None


def test_load_config_rejects_unknown_keys(tmp_path) -> None:
    (tmp_path / "runtime-evidence.yml").write_text(
        "version: 1\ngate_profile:\n  enabled: true\n  clearable_deny: deps_toolchain\n  wat: 1\n"
    )
    with pytest.raises(GateProfileError):
        load_config(tmp_path)


def test_load_config_rejects_missing_clearable_deny(tmp_path) -> None:
    (tmp_path / "runtime-evidence.yml").write_text("version: 1\ngate_profile:\n  enabled: true\n")
    with pytest.raises(GateProfileError):
        load_config(tmp_path)
