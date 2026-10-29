import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { ground, groundingAt, instrumentedRepos, KIT_SOURCE, planGrounding, reviewerKit } from "../lib/ground.mjs"
import { planSetup } from "../lib/replay-pr.mjs"
import { livePr } from "../lib/commands.mjs"
import { evaluateExhibit } from "../lib/verify.mjs"
import { kitResponse } from "./fixtures/grounding.mjs"

test("vendored reviewer files preserve pinned source bytes", () => {
  assert.equal(KIT_SOURCE.repository, "garnet-labs/garnet-runtime-review-mcp")
  assert.equal(KIT_SOURCE.sha, "60d290ce9580492df64488e157f21b9b0d808211")
  for (const [file, metadata] of Object.entries(KIT_SOURCE.files)) {
    const body = readFileSync(new URL(`../live/templates/reviewers/${file}`, import.meta.url))
    assert.equal(createHash("sha256").update(body).digest("hex"), metadata.sha256, file)
  }
})

test("grounding plans missing, identical, custom files and legacy Greptile without overwrites", () => {
  const kit = reviewerKit()
  assert.equal(Object.keys(planGrounding({}).files).length, 5)
  assert.equal(planGrounding(kit).grounded, true)
  assert.deepEqual(planGrounding(kit).files, {})
  for (const path of Object.keys(kit)) {
    const state = planGrounding({ ...kit, [path]: "upstream policy" })
    assert.equal(state.conflict, true)
    assert.equal(state.grounded, false)
    assert.equal(state.files[path], undefined)
  }
  assert.equal(planGrounding({ ...kit, ".greptile": null }).conflict, true)
  assert.equal(planGrounding({}, {}).grounded, true)
})

test("grounding reads exact blobs, rejects non-forks and incomplete or failed API reads", () => {
  assert.equal(groundingAt("garnet-labs/posthog", null, { exec: (_cmd, args) => kitResponse(args) }).grounded, true)
  assert.throws(() => groundingAt("upstream/project"), /garnet-labs/)
  assert.throws(() => groundingAt("garnet-labs/posthog", null, { exec: (_cmd, args) => args[1].includes("/git/trees/") ? '{"truncated":true,"tree":[]}' : '{"default_branch":"main"}' }), /incomplete repository tree/)
  assert.throws(() => groundingAt("garnet-labs/posthog", null, { exec: () => { throw new Error("HTTP 403") } }), /HTTP 403/)
})

test("grounding traverses skill subtrees and treats blocked ancestors as conflicts", () => {
  const skill = ".agents/skills/garnet-runtime-review/SKILL.md"
  for (const mode of ["040000", "120000", "100644"]) {
    const exec = (_cmd, args) => {
      const path = args.at(-1)
      if (path.endsWith("/main")) return JSON.stringify({ sha: "root", tree: [{ path: ".agents", type: mode === "040000" ? "tree" : "blob", mode, sha: "agents" }] })
      if (path.endsWith("/agents")) return JSON.stringify({ tree: [{ path: "skills", type: "tree", sha: "skills" }] })
      if (path.endsWith("/skills")) return JSON.stringify({ tree: [{ path: "garnet-runtime-review", type: "tree", sha: "review" }] })
      if (path.endsWith("/review")) return JSON.stringify({ tree: [{ path: "SKILL.md", type: "blob", sha: "skill" }] })
      if (path.endsWith("/skill")) return JSON.stringify({ encoding: "base64", content: Buffer.from(reviewerKit()[skill]).toString("base64") })
      return '{"default_branch":"main"}'
    }
    const state = groundingAt("garnet-labs/posthog", null, { exec })
    assert.equal(state.rows.find((row) => row.path === skill).status, mode === "040000" ? "identical" : "conflict")
  }
})

test("fleet discovery includes instrumented non-forks, excludes archived repositories and ordinary workflows", () => {
  const exec = (_cmd, args) => {
    const path = args.at(-1)
    if (path.startsWith("orgs/")) return JSON.stringify([[{ full_name: "garnet-labs/new", default_branch: "main", archived: false }, { full_name: "garnet-labs/old", archived: true }, { full_name: "garnet-labs/plain", default_branch: "trunk" }]])
    if (path.includes("/git/trees/")) return JSON.stringify({ tree: [{ path: "ci.yml", type: "blob", sha: path.includes("/new/") ? "yes" : "no" }] })
    return JSON.stringify({ content: Buffer.from(path.endsWith("/yes") ? "steps:\n  - uses: garnet-org/action@v2\n" : "steps:\n  - uses: actions/checkout@v4\n").toString("base64") })
  }
  assert.deepEqual(instrumentedRepos({ exec }), ["garnet-labs/new"])
})

test("fleet discovery skips empty repositories, but does not hide permission errors", () => {
  const exec = (_cmd, args) => {
    if (args.at(-1).startsWith("orgs/")) return '[[{"full_name":"garnet-labs/empty","default_branch":"main"}]]'
    throw new Error("gh: Git Repository is empty. (HTTP 409)")
  }
  assert.deepEqual(instrumentedRepos({ exec }), [])
  assert.throws(() => instrumentedRepos({ exec: (cmd, args) => args.at(-1).startsWith("orgs/") ? exec(cmd, args) : (() => { throw new Error("HTTP 403") })() }), /HTTP 403/)
})

test("ground dry-run is read-only and reports conflicts instead of writing partial kits", async () => {
  const lines = []
  const exec = (cmd, args) => {
    assert.equal(cmd, "gh")
    assert.equal(args[0], "api")
    if (args[1].includes("/git/trees/")) return '{"tree":[{"path":".greptile","type":"tree"}],"sha":"tree"}'
    return '{"default_branch":"main"}'
  }
  const rows = await ground(["posthog", "--dry-run"], { exec, log: (line) => lines.push(line), save: () => assert.fail("dry-run wrote ledger") })
  assert.equal(rows[0].conflict, true)
  assert.match(lines.join("\n"), /5 \| 0 \| 1/)
  await assert.rejects(ground([], { log: () => {} }), /requires/)
  await assert.rejects(ground(["posthog", "--dry-run"], { exec: () => { throw new Error("HTTP 500") }, log: () => {} }), /HTTP 500/)
})

test("kit onboarding uses one commit, fork-only writes, and refuses unrelated root paths", () => {
  const input = { slug: "posthog", upstream: "PostHog/posthog", fork: "garnet-labs/posthog", defaultBranch: "main", work: "/unused", mode: "inject", files: reviewerKit(), message: "ci: configure reviewer guidance", body: "Adds repository reviewer instructions.", branch: "onboarding/reviewer-guidance" }
  const plan = planSetup(input)
  assert.equal(plan.steps.filter((step) => step.cmd === "git" && step.args.includes("commit")).length, 1)
  assert.equal(plan.steps.filter((step) => step.cmd === "gh" && step.args.includes("create")).length, 1)
  for (const step of plan.steps.filter((step) => step.kind === "write-remote")) assert.equal(step.target, input.fork)
  assert.throws(() => planSetup({ ...input, files: { "package.json": "{}" } }), /refusing/)
})

test("ground proposes one guarded onboarding PR and saves pending, not grounded", async () => {
  const plans = []
  const saved = []
  const exec = (_cmd, args) => args[1].includes("/git/trees/")
    ? '{"tree":[],"sha":"snapshot-tree"}'
    : '{"default_branch":"main","parent":{"full_name":"PostHog/posthog"}}'
  await ground(["posthog"], {
    exec, log: () => {}, save: (target) => saved.push(target),
    execute: async (plan) => { plans.push(plan); return { forkPr: 99 } },
  })
  assert.equal(plans.length, 1)
  assert.equal(plans[0].files.length, 5)
  assert.ok(plans[0].steps.find((step) => step.id === "ground-snapshot").args.includes("snapshot-tree"))
  assert.equal(saved[0].grounding.state, "pending")
  assert.equal(saved[0].grounding.pr, 99)
  await ground(["posthog"], {
    exec: (_cmd, args) => kitResponse(args), log: () => {},
    save: (target) => saved.push(target), execute: () => assert.fail("identical kit opened a PR"),
  })
  assert.equal(saved.at(-1).grounding.state, "grounded")
})

test("live refuses ungrounded default branches before any write, with explicit override hint", async () => {
  const lines = []
  const exec = (cmd, args) => {
    assert.equal(cmd, "gh")
    if (args[0] === "repo") return '{"defaultBranchRef":{"name":"main"}}'
    if (args[1].includes("/git/trees/")) return '{"tree":[]}'
    if (args[1] === "repos/garnet-labs/posthog") return '{"default_branch":"main"}'
    assert.fail(args.join(" "))
  }
  await assert.rejects(livePr(["posthog", "--pr", "501", "--dry-run"], { exec, log: (line) => lines.push(line) }), /replay ground posthog.*--allow-ungrounded/)
  assert.match(lines.join("\n"), /reviewer grounding: missing or conflicting/)
})

test("verification fails when default branch reviewer grounding is missing", () => {
  const result = evaluateExhibit({ pr: { head_sha: "a".repeat(40), base_sha: "b".repeat(40), state: "open", body: "", labels: [] }, comments: [], checks: [], permalinkStatus: null, grounding: { name: "reviewer grounding", ok: false, detail: "kit missing" } })
  assert.equal(result.status, "FAIL")
  assert.ok(result.reasons.includes("reviewer grounding: kit missing"))
})
