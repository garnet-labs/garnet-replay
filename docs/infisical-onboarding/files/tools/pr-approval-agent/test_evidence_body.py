"""Tests for evidence_body.py, the verbatim head-bound evidence mirror."""

from evidence_body import BEGIN_MARKER, END_MARKER, evidence_section, missing_section, select_evidence_comment, upsert
from test_runtime_evidence import COMMENT, HEAD

REPO = "garnet-labs/posthog"
TRUSTED = frozenset({"garnet-runtime-review[bot]"})


def _comment(body: str, login: str = "garnet-runtime-review[bot]", cid: int = 1) -> dict:
    return {"id": cid, "user": {"login": login}, "body": body, "html_url": "https://github.com/x"}


def test_select_requires_trusted_author_marker_and_head_binding():
    stale = COMMENT.replace(HEAD, "0" * 40)
    assert select_evidence_comment([_comment(stale)], HEAD, TRUSTED) is None
    assert select_evidence_comment([_comment(COMMENT, login="mallory")], HEAD, TRUSTED) is None
    assert select_evidence_comment([_comment("no markers here")], HEAD, TRUSTED) is None
    assert select_evidence_comment([_comment(COMMENT)], HEAD, TRUSTED) is not None


def test_select_prefers_app_comment_over_fallback():
    app = _comment(COMMENT + "\n:v1:app.garnet.ai", cid=2)
    picked = select_evidence_comment([_comment(COMMENT, cid=1), app], HEAD, TRUSTED)
    assert picked["id"] == 2


def test_evidence_section_mirrors_comment_verbatim():
    block = evidence_section(_comment(COMMENT), HEAD, REPO, 65536)
    assert block.startswith(BEGIN_MARKER)
    assert block.endswith(END_MARKER)
    assert COMMENT.strip() in block  # verbatim, not re-rendered
    assert f"Runtime evidence (Garnet, head `{HEAD[:7]}`)" in block
    assert "REVIEW.md" in block


def test_evidence_section_falls_back_to_pointer_when_over_budget():
    block = evidence_section(_comment(COMMENT), HEAD, REPO, 500)
    assert COMMENT.strip() not in block
    assert f"<!-- garnet:commit {HEAD} -->" in block
    assert "exceeds the description size budget" in block
    assert "https://github.com/x" in block


def test_missing_section_never_reads_clean():
    block = missing_section(HEAD)
    assert f"`{HEAD[:7]}`" in block
    assert "*no record*, not a clean run" in block


def test_upsert_replaces_only_line_anchored_markers():
    quoted = f"Example:\n```\n{BEGIN_MARKER} inline mention\n```\n"
    live = f"{quoted}\n{BEGIN_MARKER}\nold\n{END_MARKER}\n\nOutro."
    merged = upsert(live, "NEWBLOCK")
    assert "old" not in merged
    assert "inline mention" in merged  # quoted marker untouched
    assert merged.rstrip().endswith("Outro.")


def test_upsert_appends_when_block_absent_or_half_present():
    assert upsert("Body.", "NEWBLOCK").rstrip().endswith("NEWBLOCK")
    half = f"Intro.\n{BEGIN_MARKER}\nno end marker"
    assert upsert(half, "NEWBLOCK").rstrip().endswith("NEWBLOCK")


def test_upsert_is_idempotent():
    block = evidence_section(_comment(COMMENT), HEAD, REPO, 65536)
    once = upsert("Body.", block)
    assert upsert(once, block) == once
