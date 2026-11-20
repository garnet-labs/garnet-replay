"""Tests for runtime_evidence.py — execution-tree parsing and bypass scoping."""

from pathlib import Path

import pytest

from runtime_evidence import (
    RuntimeEvidence,
    RuntimeEvidenceConfig,
    RuntimeEvidenceError,
    bypassable_deny,
    citation_block,
    evidence_dict,
    load_config,
    parse_comment,
    prompt_block,
)

HEAD = "6e5d0d4cf00a92a9e1fe697efe0e41b3ae61533e"

# Trimmed from a real control-plane githubapp golden (contract v6.4).
COMMENT = f"""<!-- garnet-runtime-review -->
<!-- garnet-run-profile -->
<!-- garnet:commit {HEAD} -->
**See what ran** — every outbound connection and its process lineage.

<details><summary><code>ci</code> / <a href="https://github.com/o/r/actions/runs/1"><code>install</code> ↗</a></summary>

<pre>
<em>install · job</em>
└─ <em>systemd</em>
   └─ <em>hosted-compute-agent</em>
      ├─ <em>Runner.Listener</em>
      │  └─ <em>Runner.Worker</em>
      │     └─ <strong>bash</strong>
      │        └─ <strong>node</strong>
      │           ├─ → registry.npmjs.org
      │           └─ → localhost (dns resolver)
      └─ <em>sudo</em>
         └─ <strong>provjobd920019609</strong>
            └─ → localhost (dns resolver)
</pre>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/1?profile=abc&amp;utm_source=github&amp;utm_medium=pr_comment">View Run Profile in Garnet ↗</a></sub></p>

</details>
"""


def _config() -> RuntimeEvidenceConfig:
    return RuntimeEvidenceConfig(
        trusted_bots=frozenset({"garnet-runtime-review[bot]"}),
        bypass_categories=frozenset({"deps_toolchain"}),
    )


def test_parse_extracts_destinations_and_lineage():
    ev = parse_comment(COMMENT, HEAD)
    dests = {d["dest"] for d in ev.destinations}
    assert dests == {"registry.npmjs.org", "localhost"}
    npm = next(d for d in ev.destinations if d["dest"] == "registry.npmjs.org")
    assert npm["lineage"].endswith("bash > node")
    resolver = next(d for d in ev.destinations if d["dest"] == "localhost" and "node" in d["lineage"])
    assert resolver["note"] == "dns resolver"
    assert ev.permalinks == ["https://app.garnet.ai/public/runs/1?profile=abc&utm_source=github&utm_medium=pr_comment"]


def test_snapshot_tree_is_recorded():
    ev = parse_comment(COMMENT, HEAD)
    assert ev.status == "recorded"
    assert ev.new_destinations == []
    assert len(ev.chains) == 2


def test_stale_commit_marker_is_missing():
    ev = parse_comment(COMMENT, "f" * 40)
    assert ev.status == "missing"


def test_no_commit_marker_is_missing():
    body = COMMENT.replace(f"<!-- garnet:commit {HEAD} -->", "")
    assert parse_comment(body, HEAD).status == "missing"


def test_zero_destinations_is_missing():
    # Waiting-state comment, or a renderer format this parser can't read:
    # unusable evidence must never clear a deny.
    body = f"<!-- garnet-runtime-review -->\n<!-- garnet:commit {HEAD} -->\nno record"
    ev = parse_comment(body, HEAD)
    assert ev.status == "missing"
    assert ev.destinations == []
    assert bypassable_deny(["deps_toolchain"], ev, _config()) == []


# Trimmed from the contract v6.6 goldens: no "· job" tree roots, defanged
# destination names, "How to read this" explainer fold with a sample tree.
COMMENT_V66 = f"""<!-- garnet-runtime-review -->
<!-- garnet-run-profile -->
<!-- garnet:commit {HEAD} -->
**Execution Profiles recorded for 1 job, triggered by [`{HEAD[:7]}`](https://github.com/o/r/commit/{HEAD})**

> *5&nbsp;execution chains · 2&nbsp;destinations · recorded at the kernel by Garnet*

<details><summary><code>ci</code> / <a href="https://github.com/o/r/actions/runs/2"><code>install</code>&nbsp;↗</a></summary>

<pre>
<em>Runner.Worker</em>
└─ <strong>bash</strong>
   └─ <strong>node</strong>
      ├─ → registry.npmjs[.]org
      └─ → localhost (dns resolver)
</pre>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/2?profile=def&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

---

<details open><summary><sub>💡 How to read this</sub></summary>

<pre>
<em>Runner.Worker</em>                ← runner (italic)
└─ <strong>npm install</strong>               ← your workflow step (bold)
   └─ → sample-domain[.]example  ← outbound connection, defanged
</pre>

</details>
"""


def test_v66_comment_parses_with_defang_normalized():
    ev = parse_comment(COMMENT_V66, HEAD)
    dests = {d["dest"] for d in ev.destinations}
    assert dests == {"registry.npmjs.org", "localhost"}
    assert ev.status == "recorded"
    npm = next(d for d in ev.destinations if d["dest"] == "registry.npmjs.org")
    assert npm["lineage"].endswith("bash > node")


def test_v66_explainer_sample_tree_ignored():
    ev = parse_comment(COMMENT_V66, HEAD)
    assert "sample-domain.example" not in {d["dest"] for d in ev.destinations}


def test_bypass_only_configured_categories():
    ev = parse_comment(COMMENT, HEAD)
    cfg = _config()
    # A first snapshot has no comparison baseline — no bypass.
    assert ev.status == "recorded"
    assert bypassable_deny(["deps_toolchain"], ev, cfg) == []
    unchanged = RuntimeEvidence(status="unchanged", commit_sha=HEAD, destinations=ev.destinations)
    assert bypassable_deny(["deps_toolchain"], unchanged, cfg) == ["deps_toolchain"]
    # A PR that also trips auth keeps its full deny.
    assert bypassable_deny(["auth", "deps_toolchain"], unchanged, cfg) == []
    assert bypassable_deny([], unchanged, cfg) == []


def test_no_bypass_on_diverged_missing_or_snapshot():
    cfg = _config()
    diverged = parse_comment(V66_COMMENT, HEAD)
    assert diverged.status == "diverged"
    assert bypassable_deny(["deps_toolchain"], diverged, cfg) == []
    missing = RuntimeEvidence(status="missing")
    assert bypassable_deny(["deps_toolchain"], missing, cfg) == []
    snapshot = RuntimeEvidence(status="recorded", commit_sha=HEAD)
    assert bypassable_deny(["deps_toolchain"], snapshot, cfg) == []


def test_prompt_block_names_new_chain():
    ev = parse_comment(V66_COMMENT, HEAD)
    block = prompt_block(ev)
    assert "[NEW DESTINATION] Runner.Worker > node → httpbin.org" in block
    assert "REFUSE" in block
    assert "Evidence permalink: https://app.garnet.ai/public/runs/1" in block


def test_prompt_block_grounds_on_lineage_not_allowlist():
    ev = parse_comment(COMMENT, HEAD)
    block = prompt_block(ev)
    assert "Runner.Worker > bash > node → registry.npmjs.org" in block
    assert "execution tree" in block
    assert "does not exercise the code this diff changes" in block
    assert "allowlist" not in block.lower()
    assert "expected-egress" not in block


def test_explainer_sample_tree_ignored():
    explainer = (
        "<details><summary><sub>💡 Reading this review</sub></summary>\n<pre>\n"
        "<em>Runner.Worker</em>\n└─ <strong>bash</strong>\n   └─ <strong>curl</strong>\n"
        "      └─ → evil-example.com\n</pre>\n</details>\n"
    )
    body = COMMENT.replace("**See what ran**", explainer + "**See what ran**")
    ev = parse_comment(body, HEAD)
    assert "evil-example.com" not in {d["dest"] for d in ev.destinations}
    assert ev.status == "recorded"


V66_COMMENT = f"""<!-- garnet-runtime-review -->
<!-- garnet-run-profile -->
<!-- garnet:commit {HEAD} -->
**Execution Profiles recorded for 2 jobs, triggered by [`6e5d0d4`](https://github.com/o/r/commit/{HEAD})**

> *7&nbsp;execution chains · 4&nbsp;destinations · changed since [`d84f4dc`](https://github.com/o/r/commit/d84f4dc) · recorded at the kernel by Garnet*

<details><summary><code>ci</code> / <a href="https://github.com/o/r/actions/runs/1"><code>install</code>&nbsp;↗</a></summary>

<pre>
<em>Runner.Worker</em>
└─ <strong>npm install</strong>
   ├─ → registry.npmjs[.]org
   └─ → localhost (dns resolver)
</pre>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/1?profile=abc&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

<details open><summary><b>+1&nbsp;−0</b> · <code>ci</code> / <a href="https://github.com/o/r/actions/runs/2"><code>test</code>&nbsp;↗</a></summary>

```diff
@@ 6e5d0d4 vs d84f4dc @@
  Runner.Worker
  └─ node
     ├─ → github[.]com
+    ├─ → httpbin[.]org
-    └─ → nodejs[.]org
```

</details>

<details><summary><sub>💡 How to read this</sub></summary>

<pre>
<em>Runner.Worker</em>                ← runner (italic)
└─ <strong>npm install</strong>               ← your workflow step (bold)
   └─ → evil-example[.]com  ← outbound connection, defanged
</pre>

</details>
"""


def test_v66_comparison_new_chain_is_diverged():
    ev = parse_comment(V66_COMMENT, HEAD)
    dests = {d["dest"] for d in ev.destinations}
    assert "registry.npmjs.org" in dests
    assert "github.com" in dests
    assert "httpbin.org" in dests
    assert "nodejs.org" not in dests
    assert "evil-example.com" not in dests
    assert ev.status == "diverged"
    assert [d["dest"] for d in ev.new_destinations] == ["httpbin.org"]
    new = next(d for d in ev.destinations if d["dest"] == "httpbin.org")
    assert new["lineage"].endswith("Runner.Worker > node")


def test_v66_comparison_without_new_chains_is_unchanged():
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org\n", "")
    ev = parse_comment(body, HEAD)
    assert ev.status == "unchanged"
    assert ev.new_destinations == []
    assert bypassable_deny(["deps_toolchain"], ev, _config()) == ["deps_toolchain"]


def test_v66_real_tree_containing_arrow_still_contributes_evidence():
    body = V66_COMMENT.replace("<strong>npm install</strong>", "<strong>npm install ← run</strong>")
    ev = parse_comment(body, HEAD)
    dests = {d["dest"] for d in ev.destinations}
    assert "registry.npmjs.org" in dests
    assert "evil-example.com" not in dests
    assert ev.status == "diverged"


def test_legacy_comment_still_parses():
    ev = parse_comment(COMMENT, HEAD)
    assert {d["dest"] for d in ev.destinations} == {"registry.npmjs.org", "localhost"}
    assert ev.status == "recorded"


def test_citation_block_cites_verifiable_evidence():
    ev = parse_comment(V66_COMMENT, HEAD)
    block = citation_block(ev)
    assert f"<code>{HEAD[:7]}</code>" in block
    assert "**diverged**" in block
    assert "`Runner.Worker > node` → `httpbin.org`" in block
    assert "https://app.garnet.ai/public/runs/1" in block
    assert f"must equal `{HEAD[:7]}`" in block


def test_citation_block_grounding_and_missing():
    ev = parse_comment(COMMENT, HEAD)
    block = citation_block(ev)
    assert "**recorded**" in block
    assert "execution chain(s)" in block
    assert "no static egress allowlist" in block
    assert "never approves a PR by itself" in block
    assert citation_block(RuntimeEvidence(status="missing")) is None


def test_evidence_dict_round_trip():
    ev = parse_comment(COMMENT, HEAD)
    d = evidence_dict(ev)
    assert d["status"] == "recorded"
    assert d["commit_sha"] == HEAD
    assert d["destinations"] == ev.destinations
    assert d["permalinks"] == ev.permalinks
    assert evidence_dict(None) is None


def test_prompt_block_missing():
    assert "none recorded" in prompt_block(RuntimeEvidence(status="missing"))


def test_load_config_validates(tmp_path):
    (tmp_path / "runtime-evidence.yml").write_text("version: 1\ntrusted_bots: [x]\nnope: 1\n")
    with pytest.raises(RuntimeEvidenceError):
        load_config(tmp_path)
    # The retired static allowlist key must be rejected, not silently read.
    (tmp_path / "runtime-evidence.yml").write_text("version: 1\ntrusted_bots: [x]\nexpected_destinations: ['^a$']\n")
    with pytest.raises(RuntimeEvidenceError):
        load_config(tmp_path)
    assert load_config(tmp_path.parent / "absent") is None
    (tmp_path / "runtime-evidence.yml").write_text(
        "version: 1\ntrusted_bots: ['garnet[bot]']\nbypass_categories: [deps_toolchain]\n"
    )
    cfg = load_config(tmp_path)
    assert cfg.trusted_bots == frozenset({"garnet[bot]"})
    assert cfg.bypass_categories == frozenset({"deps_toolchain"})


def test_removed_lines_contribute_to_previous_destination_set():
    # The `-` httpbin[.]org line records that the previous profile already
    # reached httpbin.org, so the `+` chain is reshaped, not genuinely new.
    body = V66_COMMENT.replace("-    └─ → nodejs[.]org", "-    └─ → httpbin[.]org")
    ev = parse_comment(body, HEAD)
    assert ev.status == "unchanged"
    assert ev.new_destinations == []
    assert [d["dest"] for d in ev.reshaped_chains] == ["httpbin.org"]


def test_plus_chain_with_destination_unchanged_elsewhere_is_reshaped():
    # The PR #77 shape: the same destination sits on unchanged chains in the
    # fence while a `+` chain reaches it under a different lineage —
    # installer nondeterminism, not divergence.
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org", "+    ├─ → github[.]com")
    ev = parse_comment(body, HEAD)
    assert ev.status == "unchanged"
    assert ev.new_destinations == []
    reshaped = ev.reshaped_chains
    assert [(d["dest"], d["lineage"]) for d in reshaped] == [("github.com", "Runner.Worker > node")]
    assert bypassable_deny(["deps_toolchain"], ev, _config()) == ["deps_toolchain"]


def test_plus_destination_known_only_from_snapshot_pre_stays_new():
    # registry.npmjs.org is recorded only in another job's snapshot <pre>,
    # which is current-head evidence with no previous-profile comparison —
    # it must not excuse a `+` chain in the fence.
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org", "+    ├─ → registry.npmjs[.]org")
    ev = parse_comment(body, HEAD)
    assert ev.status == "diverged"
    assert [d["dest"] for d in ev.new_destinations] == ["registry.npmjs.org"]
    assert ev.reshaped_chains == []
    assert bypassable_deny(["deps_toolchain"], ev, _config()) == []


def test_reshaped_chain_labeled_in_prompt_block():
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org", "+    ├─ → github[.]com")
    ev = parse_comment(body, HEAD)
    block = prompt_block(ev)
    assert "[reshaped chain]" in block
    assert "recorded in the previous profile under" in block
    assert "[NEW DESTINATION]" not in block


def test_citation_block_counts_reconcile_with_listed_lines():
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org", "+    ├─ → github[.]com")
    ev = parse_comment(body, HEAD)
    block = citation_block(ev)
    assert "1 reshaped chain(s)" in block
    reshaped_header = next(line for line in block.splitlines() if "reshaped chain(s)" in line)
    listed = [line for line in block.splitlines() if line.startswith("- `Runner.Worker")]
    assert reshaped_header.startswith("1 ") and len(listed) == 1


def test_citation_block_new_destination_count_matches_lines():
    ev = parse_comment(V66_COMMENT, HEAD)
    block = citation_block(ev)
    assert "1 destination(s) NEW versus the previously profiled commit:" in block


def test_real_pr77_comment_is_unchanged_not_diverged():
    # Regression fixture: the live Garnet comment from garnet-labs/posthog#77
    # whose `+` chains (registry.npmjs.org under node, github.com under sh)
    # all reach destinations the previous profile already recorded.
    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr77.md").read_text()
    assert parse_comment(body, "f" * 40).status == "missing"
    ev = parse_comment(body, "e90ee0b287e714d223cd4a7b4acbca0c176f4004")
    assert ev.status == "unchanged"
    assert ev.new_destinations == []
    reshaped_dests = {d["dest"] for d in ev.reshaped_chains}
    assert reshaped_dests == {"registry.npmjs.org", "github.com"}


def test_substrate_fold_never_produces_new_destinations():
    # A `+` line inside the dns + runner substrate fold is runner churn
    # (GitHub's own agent rotating IPs), not the PR's behavior — it must be
    # recorded as a substrate chain, never counted toward divergence.
    substrate = (
        "<details><summary><sub>dns + runner substrate · 2&nbsp;chains</sub></summary>\n\n"
        "```diff\n@@ 6e5d0d4 vs d84f4dc @@\n  systemd\n  └─ hosted-compute-agent\n"
        "+    ├─ → 140.82.114.24\n     └─ → localhost (dns resolver)\n```\n\n</details>\n"
    )
    body = V66_COMMENT.replace("+    ├─ → httpbin[.]org\n", "").replace(
        "<details><summary><sub>💡", substrate + "<details><summary><sub>💡"
    )
    ev = parse_comment(body, HEAD)
    assert ev.status == "unchanged"
    assert ev.new_destinations == []
    substrate_dests = {d["dest"] for d in ev.substrate_destinations}
    assert substrate_dests == {"140.82.114.24", "localhost"}
    assert "[runner substrate chain]" in prompt_block(ev)


def test_real_pr103_comment_diverges_only_on_workload_destinations():
    # Regression fixture: the live Garnet comment from garnet-labs/posthog#103.
    # The workload fence adds example.com and httpbin.org under the package's
    # install chain; the substrate fold's `+ 140.82.114.24` (runner IP churn)
    # must not appear among the new destinations.
    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr103.md").read_text()
    ev = parse_comment(body, "00a442b3de5b0adb635236e0ab967a7c75f57e71")
    assert ev.status == "diverged"
    assert [d["dest"] for d in ev.new_destinations] == ["example.com", "httpbin.org"]
    assert "140.82.114.24" in {d["dest"] for d in ev.substrate_destinations}


def test_new_chain_not_masked_by_identical_chain_in_earlier_job():
    # Two jobs in one comment: job A's snapshot <pre> records the same
    # (lineage, destination) that job B's comparison fence marks as NEW.
    # The + occurrence must win — status is diverged, never unchanged.
    snapshot_job = "<pre>\n<em>Runner.Worker</em>\n└─ <strong>node</strong>\n   └─ → httpbin[.]org\n</pre>\n"
    body = V66_COMMENT.replace("<details open><summary><b>+1", snapshot_job + "<details open><summary><b>+1")
    ev = parse_comment(body, HEAD)
    assert ev.status == "diverged"
    assert [d["dest"] for d in ev.new_destinations] == ["httpbin.org"]


def test_real_pr112_contract_v69_circle_leaves_parse_and_diverge():
    # Regression fixture: the live Garnet comment from garnet-labs/posthog#112
    # (contract v6.9.x). Destination leaves render as `○ name` instead of the
    # older `→ name`; a parser that only knows `→` extracts zero destinations
    # and fails closed to `missing` even though head-pinned evidence exists.
    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr112.md").read_text()
    ev = parse_comment(body, "7ff9aba949227f126da3c7c8aaa3a9c40ca0ab82")
    assert ev.status == "diverged"
    # v6.9 inlines the systemd-rooted runner substrate in the same diff fence
    # as the workload: rotating hosted-compute IPs classify as substrate, so
    # the only genuinely new destination is the one the PR itself caused.
    assert {d["dest"] for d in ev.new_destinations} == {"storage.googleapis.com"}
    assert "140.82.114.23" in {d["dest"] for d in ev.substrate_destinations}
    assert not any(d["new"] for d in ev.substrate_destinations)
    assert len(ev.destinations) == 11


def test_systemd_service_workload_is_not_treated_as_runner_substrate():
    # A workload can legitimately run as a systemd service. Only the hosted
    # runner shapes (systemd-network, hosted-compute-*) are substrate, so a
    # `systemd > deploy.service` chain must still count toward divergence.
    workload = (
        "```diff\n"
        "@@ prev vs cur @@\n"
        "  systemd\n"
        "+ └─ deploy.service\n"
        "+    └─ ○ shipping.example\n"
        "```\n"
    )
    body = V66_COMMENT.replace("<details open><summary><b>+1", workload + "<details open><summary><b>+1")
    ev = parse_comment(body, HEAD)
    assert ev.status == "diverged"
    assert "shipping.example" in {d["dest"] for d in ev.new_destinations}
    assert "shipping.example" not in {d["dest"] for d in ev.substrate_destinations}


def test_real_pr130_substrate_only_churn_is_unchanged():
    # Regression fixture: the live Garnet comment from garnet-labs/posthog#130
    # (a manifest-only pnpm pin bump). Every `+` line sits under the
    # systemd-rooted runner tree (provisioning churn); the workload chain is
    # identical to the previous profile — so the comparison is unchanged, the
    # deps bypass stays available, and no workload destination is new.
    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr130.md").read_text()
    ev = parse_comment(body, "eb0d3f112a57265e92e744ca62ee0a1c0cd6a1ef")
    assert ev.status == "unchanged"
    assert ev.new_workload_destinations == []
    assert ev.new_destinations == []
    assert "140.82.112.24" in {d["dest"] for d in ev.substrate_destinations}


def test_v610_inline_background_label_root_is_substrate():
    # Regression fixture: the live Garnet comment from garnet-labs/posthog#139
    # (a posthog-js catalog bump). Contract v6.10 labels the background
    # section root inline — `systemd (runner background · +3 −1)` — so the
    # root must classify on the process name, not the labelled string.
    # Background churn (rotating hosted-compute IPs) never diverges.
    body = (Path(__file__).parent / "fixtures" / "garnet_comment_pr139.md").read_text()
    ev = parse_comment(body, "5aba3c461a4872f7ca3d6a07ce739f2cb883e0cf")
    assert ev.status == "unchanged"
    assert ev.new_workload_destinations == []
    assert {d["dest"] for d in ev.new_destinations} <= {d["dest"] for d in ev.substrate_destinations}
    assert "140.82.112.24" in {d["dest"] for d in ev.substrate_destinations}
