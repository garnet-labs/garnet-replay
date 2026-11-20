"""Tests for evidence_status.py, the garnet/runtime-evidence commit-status mirror."""

import evidence_status
from evidence_status import status_payload
from runtime_evidence import RuntimeEvidence, parse_comment
from test_runtime_evidence import COMMENT, HEAD, V66_COMMENT


def test_recorded_maps_to_success():
    evidence = parse_comment(COMMENT, HEAD)
    assert evidence.status == "recorded"
    state, description = status_payload(evidence)
    assert state == "success"
    assert description == "recorded: 3 destination(s) across 2 execution chain(s), head-pinned"


def test_unchanged_maps_to_success():
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org\n", "")
    evidence = parse_comment(body, HEAD)
    assert evidence.status == "unchanged"
    state, description = status_payload(evidence)
    assert state == "success"
    assert description.startswith("unchanged:")


def test_diverged_maps_to_failure_naming_new_destinations():
    evidence = parse_comment(V66_COMMENT, HEAD)
    assert evidence.status == "diverged"
    state, description = status_payload(evidence)
    assert state == "failure"
    assert description == "1 new destination(s) vs previous profile: httpbin.org"


def test_reshaped_chains_stay_success_and_are_counted():
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org", "+    ├─ → github[.]com")
    evidence = parse_comment(body, HEAD)
    assert evidence.status == "unchanged"
    state, description = status_payload(evidence)
    assert state == "success"
    assert "1 reshaped chain(s)" in description
    assert len(description) <= 140


def test_missing_maps_to_pending():
    for evidence in (
        RuntimeEvidence(status="missing"),
        # Stale comment: marker for an older head.
        parse_comment(COMMENT, "0" * 40),
        # Head-pinned waiting-state comment with zero parseable destinations.
        parse_comment(
            f"<!-- garnet-runtime-review -->\n<!-- garnet:commit {HEAD} -->\nstill recording",
            HEAD,
        ),
    ):
        assert evidence.status == "missing"
        state, description = status_payload(evidence)
        assert state == "pending"
        assert "fail-closed" in description


def test_main_posts_status_from_live_shapes(monkeypatch, capsys):
    posted = {}

    def fake_gh_json(args):
        endpoint = args[0]
        if endpoint.endswith("/pulls/65"):
            return {"head": {"sha": HEAD}, "html_url": "https://github.com/o/r/pull/65"}
        posted["args"] = args
        return {}

    monkeypatch.setattr(evidence_status, "_gh_json", fake_gh_json)
    monkeypatch.setattr(
        evidence_status,
        "fetch_runtime_evidence",
        lambda repo, pr, head, config: parse_comment(COMMENT, head),
    )
    monkeypatch.setattr("sys.argv", ["evidence_status.py", "65", "--repo", "o/r"])

    assert evidence_status.main() == 0
    assert posted["args"][0] == f"repos/o/r/statuses/{HEAD}"
    values = posted["args"][2::2]
    assert "state=success" in values
    assert "context=garnet/runtime-evidence" in values
    assert any(v.startswith("description=recorded: 3 destination(s)") for v in values)
    assert any(v.startswith("target_url=https://app.garnet.ai/public/runs/") for v in values)
    assert "success" in capsys.readouterr().out


def test_main_without_config_posts_nothing(monkeypatch, tmp_path, capsys):
    calls = []
    monkeypatch.setattr(evidence_status, "_gh_json", lambda args: calls.append(args))
    monkeypatch.setattr(evidence_status, "load_config", lambda _p: None)
    monkeypatch.setattr("sys.argv", ["evidence_status.py", "65", "--repo", "o/r"])

    assert evidence_status.main() == 0
    assert calls == []
    assert "not posting" in capsys.readouterr().out


def test_posted_description_fits_github_status_limit(monkeypatch):
    # GitHub rejects status descriptions over 140 chars; main() must slice
    # before posting. Worst realistic case: several long new-chain hostnames.
    posted = {}

    def fake_gh_json(args):
        if args[0].endswith("/pulls/65"):
            return {"head": {"sha": HEAD}, "html_url": "https://github.com/o/r/pull/65"}
        posted["args"] = args
        return {}

    long = [{"dest": "a" * 60 + f"{i}.evil.example", "note": "", "lineage": "", "new": True} for i in range(5)]
    evidence = RuntimeEvidence(status="diverged", commit_sha=HEAD, destinations=long)
    assert len(status_payload(evidence)[1]) > 140

    monkeypatch.setattr(evidence_status, "_gh_json", fake_gh_json)
    monkeypatch.setattr(evidence_status, "fetch_runtime_evidence", lambda *a: evidence)
    monkeypatch.setattr("sys.argv", ["evidence_status.py", "65", "--repo", "o/r"])

    assert evidence_status.main() == 0
    (description,) = [v for v in posted["args"][2::2] if v.startswith("description=")]
    assert len(description.removeprefix("description=")) <= 140
