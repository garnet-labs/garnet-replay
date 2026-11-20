"""Offline checks for the staged deterministic gate; no GitHub writes."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "gate", Path(__file__).parent / "files/.github/merge-gate/gate.py"
)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
HEAD = "a" * 40
PUBLISH_SPEC = importlib.util.spec_from_file_location(
    "publisher", Path(__file__).parent / "files/.github/scripts/stamphog-publish.py"
)
publisher = importlib.util.module_from_spec(PUBLISH_SPEC)
PUBLISH_SPEC.loader.exec_module(publisher)


class GateChecks(unittest.TestCase):
    def test_publisher_replay_receipt(self):
        body = publisher.render_body({"head_sha": HEAD, "final_verdict": "DRY-RUN",
                                      "classification": {"runtime_evidence_citation": "record citation"}})
        self.assertEqual(publisher.MARKER, "<!-- stamphog-sticky-review -->")
        self.assertIn(f"reviewed `{HEAD}` — verdict: **DRY_RUN**", body)
        self.assertIn("record citation", body)

    def run_gate(self, body):
        calls = []

        def fake_gh(method, path, fields=None):
            calls.append((method, path))
            self.assertEqual(method, "GET")
            if path.endswith("/pulls/1"):
                return {"head": {"sha": HEAD}}
            if "/comments" in path:
                return [] if body is None else [{"body": body, "user": {"login": gate.BOT}}]
            return [{"filename": "backend/package-lock.json"}]

        out = io.StringIO()
        with patch.object(gate, "gh", fake_gh), patch.object(
            sys, "argv", ["gate.py", "garnet-labs/infisical", "1", "--dry-run"]
        ), contextlib.redirect_stdout(out):
            gate.main()
        return out.getvalue(), calls

    def marker(self, **overrides):
        summary = dict(status="finalized", commit=HEAD, capture_quality="complete",
                       incomplete=0, outcome="unchanged", jobs=1, destinations=1)
        summary.update(overrides)
        return "<!-- garnet:summary " + json.dumps(summary) + " -->"

    def test_dry_run_complete(self):
        output, calls = self.run_gate(self.marker())
        self.assertIn("Merge gate: **NOTHING NEW**", output)
        self.assertEqual(len(calls), 3)

    def test_best_effort_never_nothing_new(self):
        output, _ = self.run_gate(self.marker(capture_quality="best-effort"))
        self.assertIn("Merge gate: **UNDETERMINABLE**", output)

    def test_stale_never_nothing_new(self):
        output, _ = self.run_gate(self.marker(commit="b" * 40))
        self.assertIn("Merge gate: **UNDETERMINABLE**", output)

    def test_missing_is_skipped_not_pass(self):
        output, calls = self.run_gate(None)
        self.assertIn("no Runtime Review comment found; skipping", output)
        self.assertEqual(len(calls), 2)

    def test_malformed_is_skipped_not_pass(self):
        output, _ = self.run_gate("<!-- garnet:summary {bad} -->")
        self.assertIn("no readable garnet:summary marker; skipping", output)

    def test_changed_scoped_result(self):
        body = self.marker(outcome="changed", capture_quality="best-effort")
        body += "\n<details><summary><b>install</b></summary>\n```diff\n npm\n+ └─ registry[.]npmjs[.]org\n```\n</details>"
        output, _ = self.run_gate(body)
        self.assertIn("Merge gate: **CHANGED**", output)
        self.assertIn("registry.npmjs.org", output)
        self.assertIn("Evidence gaps", output)


if __name__ == "__main__":
    unittest.main()
