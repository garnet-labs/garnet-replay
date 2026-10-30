import assert from "node:assert/strict"
import test from "node:test"

import { GARNET_ACTION_PIN, GARNET_ACTION_PIN_LABEL, actionWorkflowBodies, isExcludedRepinPath, planRepin, recordingWorkflowsAt, renderRepinPlan, repinActionRef, workflowBodiesAt } from "../lib/replay-pr.mjs"

const OLD = "e546567a72e4fede11ec39d6e9f75b539adef22c"
const body = [
  "name: Garnet Runtime Visibility",
  "on:",
  "  pull_request:",
  "jobs:",
  "  dep-install:",
  "    steps:",
  "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
  `      - uses: garnet-org/action@${OLD} # main 2026-09-04`,
  "      - run: pnpm install",
].join("\n")

test("repinActionRef moves the action step to the harness pin and keeps everything else", () => {
  const { body: out, before } = repinActionRef(body)
  assert.deepEqual(before, [OLD])
  assert.match(out, new RegExp(`^      - uses: garnet-org/action@${GARNET_ACTION_PIN} # ${GARNET_ACTION_PIN_LABEL.replace(".", "\\.")}$`, "m"))
  assert.doesNotMatch(out, /main 2026-09-04/)
  assert.match(out, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4\.2\.2/)
  assert.equal(out.split("\n").length, body.split("\n").length)
})

test("repinActionRef handles tags, quotes, with: blocks and leaves the pin alone", () => {
  const tagged = "    steps:\n      - uses: 'garnet-org/action@v2'\n        with:\n          api_token: ${{ secrets.GARNET_API_TOKEN }}\n"
  const { body: out, before } = repinActionRef(tagged)
  assert.deepEqual(before, ["v2"])
  assert.match(out, new RegExp(`- uses: 'garnet-org/action@${GARNET_ACTION_PIN}' # ${GARNET_ACTION_PIN_LABEL.replace(".", "\\.")}\n        with:`))
  const again = repinActionRef(out)
  assert.deepEqual(again.before, [])
  assert.equal(again.body, out)
})

test("repinActionRef leaves the Jibril version input unchanged", () => {
  const workflow = [
    `      - uses: garnet-org/action@${OLD}`,
    "        with:",
    "          jibril_version: 1.2.3",
  ].join("\n")
  const { body: out } = repinActionRef(workflow)
  assert.match(out, /jibril_version: 1\.2\.3/)
  assert.match(out, new RegExp(`uses: garnet-org/action@${GARNET_ACTION_PIN}`))
})

test("planRepin leaves excluded recording workflows on their own pin", () => {
  const workflows = {
    ".github/workflows/garnet-dependabot-record.yml": body,
    ".github/workflows/garnet-oidc-canary.yml": body,
    ".github/workflows/garnet-jibril-release-gate-check.yml": body,
    ".github/workflows/ci.yml": body,
  }
  const plan = planRepin({ fork: "garnet-labs/example", defaultBranch: "main", work: "/tmp/w", workflows })
  assert.deepEqual(plan.excludedPaths, Object.keys(workflows).slice(0, 3))
  assert.ok(Object.keys(workflows).slice(0, 3).every(isExcludedRepinPath))
  assert.equal(isExcludedRepinPath(".github/workflows/ci.yml"), false)
  assert.deepEqual(plan.changes.map((change) => change.path), [".github/workflows/ci.yml"])
  const rendered = renderRepinPlan(plan)
  assert.match(rendered, /left on their own pin: .*garnet-dependabot-record\.yml/)
  assert.doesNotMatch(rendered, /garnet-dependabot-record\.yml: .* →/)
})

test("planRepin writes one routine commit to the fork default branch and nothing when already pinned", () => {
  const plan = planRepin({ fork: "garnet-labs/example", defaultBranch: "main", work: "/tmp/w", workflows: { ".github/workflows/garnet-record.yml": body } })
  assert.equal(plan.mode, "repin")
  assert.deepEqual(plan.changes, [{ path: ".github/workflows/garnet-record.yml", before: [OLD] }])
  assert.equal(plan.message, `ci: update garnet-org/action to ${GARNET_ACTION_PIN_LABEL} [skip ci]`)
  const remote = plan.steps.filter((step) => step.kind === "write-remote")
  assert.equal(remote.length, 1)
  assert.equal(remote[0].target, "garnet-labs/example")
  assert.deepEqual(remote[0].args.slice(-3), ["push", "origin", "main:refs/heads/main"])
  const edit = plan.steps.find((step) => step.editFile !== undefined)
  assert.equal(edit.editFile.transform(body), repinActionRef(body).body)
  assert.match(renderRepinPlan(plan), new RegExp(`garnet-record\\.yml: e546567a72e4fede11ec39d6e9f75b539adef22c → ${GARNET_ACTION_PIN}`))

  const pinned = planRepin({ fork: "garnet-labs/example", defaultBranch: "main", work: "/tmp/w", workflows: { ".github/workflows/garnet-record.yml": repinActionRef(body).body } })
  assert.deepEqual(pinned.steps, [])
  assert.match(renderRepinPlan(pinned), /already carries the pin; nothing to write/)
})

test("repin discovers action workflows across triggers and preserves excluded and input lines", () => {
  const old = "e546567a72e4fede11ec39d6e9f75b539adef22c"
  const paths = [
    "pull-request.yml",
    "reusable.yml",
    "push-only.yaml",
    "garnet-dependabot-record.yml",
    "no-action.yml",
  ]
  const contents = {
    "pull-request.yml": `name: PR recorder\non:\n  pull_request:\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@${GARNET_ACTION_PIN}\n`,
    "reusable.yml": `name: Reusable recorder\non:\n  workflow_call:\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n        with:\n          jibril_version: v2.8.0\n`,
    "push-only.yaml": `name: Push recorder\non:\n  push:\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@${old}\n        with:\n          jibril_version: \${{ inputs.jibril_version }}\n`,
    "garnet-dependabot-record.yml": `name: Dependabot recorder\non:\n  workflow_dispatch:\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@e546567a\n`,
    "no-action.yml": "name: Other workflow\non:\n  push:\njobs:\n  test:\n    steps:\n      - run: npm test\n",
  }
  const exec = (_command, args) => {
    if (args[1].includes("/git/trees/")) return JSON.stringify({ tree: paths.map((path) => ({ path, type: "blob" })) })
    const path = args[1].match(/\/contents\/\.github\/workflows\/([^?]+)/)?.[1]
    if (path !== undefined && path in contents) return contents[path]
    throw new Error(`unexpected gh call ${args.join(" ")}`)
  }
  const read = workflowBodiesAt("garnet-labs/example", "main", { exec })
  assert.deepEqual(Object.keys(read.bodies), paths.map((path) => `.github/workflows/${path}`))
  const actions = actionWorkflowBodies(read.bodies)
  assert.deepEqual(Object.keys(actions), paths.slice(0, 4).map((path) => `.github/workflows/${path}`))
  const recording = recordingWorkflowsAt("garnet-labs/example", "main", { exec })
  assert.deepEqual(recording.workflows, [".github/workflows/pull-request.yml"])
  assert.deepEqual(Object.keys(recording.bodies), recording.workflows)

  const plan = planRepin({ fork: "garnet-labs/example", defaultBranch: "main", work: "/tmp/w", workflows: actions })
  assert.deepEqual(plan.changes.map((change) => change.path), [".github/workflows/reusable.yml", ".github/workflows/push-only.yaml"])
  assert.deepEqual(plan.excludedPaths, [".github/workflows/garnet-dependabot-record.yml"])
  const edits = plan.steps.filter((step) => step.editFile !== undefined)
  for (const edit of edits) {
    const path = edit.editFile.file.split("/").at(-1)
    const before = contents[path].match(/^.*jibril_version:.*$/gm)
    const after = edit.editFile.transform(contents[path]).match(/^.*jibril_version:.*$/gm)
    assert.deepEqual(after, before)
  }
})

test("repin with only excluded action workflows plans nothing and lists the exclusion", () => {
  const workflows = actionWorkflowBodies({
    ".github/workflows/garnet-dependabot-record.yml": `uses: garnet-org/action@e546567a`,
  })
  const plan = planRepin({ fork: "garnet-labs/example", defaultBranch: "main", work: "/tmp/w", workflows })
  assert.deepEqual(plan.changes, [])
  assert.deepEqual(plan.excludedPaths, [".github/workflows/garnet-dependabot-record.yml"])
  assert.match(renderRepinPlan(plan), /left on their own pin: .*garnet-dependabot-record\.yml/)
  assert.match(renderRepinPlan(plan), /nothing to write/)
})
