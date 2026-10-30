import assert from "node:assert/strict"
import test from "node:test"

import { fleetDrift, fleetExitCode, pinBehind } from "../lib/fleet.mjs"
import { GARNET_ACTION_PIN } from "../lib/replay-pr.mjs"

const OLD = "8cccc85403e4ac4e05fb7822c994d3c199f9aa57"
const step = (ref) => ["on:", "  pull_request:", "jobs:", "  a:", "    steps:", `      - uses: garnet-org/action@${ref}`].join("\n")

test("pinBehind lists recording workflows off the harness pin and skips coupled recorders", () => {
  const bodies = {
    ".github/workflows/ci.yml": step(OLD),
    ".github/workflows/fresh.yml": step(GARNET_ACTION_PIN),
    ".github/workflows/garnet-dependabot-record.yml": step(OLD),
    ".github/workflows/other.yml": "on: push\njobs: {}\n",
  }
  assert.deepEqual(pinBehind(bodies), ["ci.yml"])
})

test("pinBehind treats the floating major tag as behind", () => {
  assert.deepEqual(pinBehind({ ".github/workflows/ci.yml": step("v2") }), ["ci.yml"])
})

test("fleetDrift separates what the job repairs from what needs a person", () => {
  const drift = fleetDrift({ pinBehind: ["ci.yml"], kit: "missing", gates: { "merge-gate.yml": "failure", "garnet-evidence-gate.yml": "success", "garnet-dependabot-record.yml": null } })
  assert.equal(drift.repair.length, 2)
  assert.deepEqual(drift.manual, ["merge-gate.yml last run failure"])
  assert.deepEqual(fleetDrift({ pinBehind: [], kit: "conflict", gates: {} }).manual, ["reviewer kit conflicts with upstream config"])
  assert.deepEqual(fleetDrift({ pinBehind: [], kit: "grounded", gates: { "merge-gate.yml": "timed_out", "garnet-evidence-gate.yml": "unreadable" } }).manual, ["merge-gate.yml last run timed_out", "garnet-evidence-gate.yml last run unreadable"])
})

test("fleetExitCode is clean only when no fork has drift", () => {
  assert.equal(fleetExitCode([{ repair: [], manual: [] }]), 0)
  assert.equal(fleetExitCode([{ repair: [], manual: [] }, { repair: ["pin"], manual: [] }]), 1)
})
