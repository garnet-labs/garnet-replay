import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { canonicalParagraph, ground, groundingAt, groundingInventory, instrumentedRepos, KIT_SOURCE, mergeReviewer, planGrounding, requireGrounding, reviewerGrounded, reviewerKit } from "../lib/ground.mjs"
import { carryReviewerGuidance, GARNET_ACTION_PIN, planPureReplay, planReplay, planSetup } from "../lib/replay-pr.mjs"
import { planPrepared } from "../lib/replay-prepared.mjs"
import { livePr } from "../lib/commands.mjs"
import { evaluateExhibit } from "../lib/verify.mjs"
import { kitResponse } from "./fixtures/grounding.mjs"

test("vendored reviewer files preserve pinned source bytes", () => {
  assert.equal(KIT_SOURCE.repository, "garnet-labs/garnet-runtime-review-mcp")
  assert.equal(KIT_SOURCE.sha, "3dac9c38ab090dcfeed5aa165db5e65710abd1cb")
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
    const mergeable = path.endsWith(".md")
    assert.equal(state.conflict, !mergeable)
    assert.equal(state.grounded, false)
    assert.equal(state.rows.find((row) => row.path === path).status, mergeable ? "merge" : "conflict-manual")
    if (!mergeable) assert.equal(state.files[path], undefined)
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

test("paragraph-grounded custom files retain their policy and CodeRabbit requires enabled MCP usage", () => {
  const kit = reviewerKit()
  const merged = Object.fromEntries(Object.keys(kit).map((path) => [path, path === "greptile.json" ? JSON.stringify({ ...JSON.parse(kit[path]), existingPolicy: true }) : `${kit[path]}\n${path.endsWith(".md") ? canonicalParagraph() : "# Existing policy"}\n`]))
  assert.equal(planGrounding(merged).grounded, true)
  assert.deepEqual(planGrounding(merged).files, {})
  const paragraph = canonicalParagraph()
  for (const path of Object.keys(kit).filter((path) => path !== ".coderabbit.yaml")) assert.equal(reviewerGrounded(path, `upstream policy\n${paragraph}`), true)
  assert.equal(reviewerGrounded(".coderabbit.yaml", paragraph), false)
  assert.equal(reviewerGrounded(".coderabbit.yaml", `knowledge_base:\n  mcp:\n    usage: enabled\nreviews:\n  instructions: ${paragraph}`), true)
  for (const block of ["knowledge_base:\n  mcp:\n    usage: disabled", "knowledge_base:\n  mcp:\n    other: true\n  sibling:\n    usage: enabled", "knowledge_base:\n  mcp:\n    usage: enabled\n  mcp:\n    usage: disabled"]) {
    assert.equal(reviewerGrounded(".coderabbit.yaml", `${block}\n# ${paragraph}`), false)
  }
  for (const duplicate of ["knowledge_base: disabled", '"knowledge_base": disabled', "  mcp: disabled", '  "mcp": disabled', '    "usage": disabled']) {
    const config = `knowledge_base:\n  mcp:\n    usage: enabled\n${duplicate}\n# ${paragraph}`
    assert.equal(reviewerGrounded(".coderabbit.yaml", config), false)
  }
})

test("merge plans append Markdown, preserve Greptile keys, and leave unparseable formats manual", () => {
  const kit = reviewerKit()
  for (const path of ["REVIEW.md", ".agents/skills/garnet-runtime-review/SKILL.md"]) {
    const current = "Existing policy  \n\n"
    const state = planGrounding({ ...kit, [path]: current })
    assert.equal(state.conflict, false)
    assert.equal(state.rows.find((row) => row.path === path).status, "merge")
    assert.ok(state.files[path].startsWith(current))
    assert.equal(planGrounding({ ...kit, ...state.files }).grounded, true)
  }
  const config = { instructions: "Keep local policy", customContext: { rules: ["existing"], other: [{ scope: ["src/**"], content: "Keep this" }] }, labels: ["upstream"] }
  const state = planGrounding({ ...kit, "greptile.json": JSON.stringify(config) })
  const result = JSON.parse(state.files["greptile.json"])
  assert.deepEqual(result.labels, config.labels)
  assert.equal(result.instructions, config.instructions)
  assert.deepEqual(result.customContext.rules, config.customContext.rules)
  assert.deepEqual(result.customContext.other[0], config.customContext.other[0])
  assert.equal(result.customContext.other[1].content, canonicalParagraph())
  assert.equal(planGrounding({ ...kit, ...state.files }).grounded, true)
  for (const [path, body] of [[".coderabbit.yaml", "reviews: {}"], [".pr_agent.toml", "[review_agent]"], ["greptile.json", "{"], ["greptile.json", "[]"], ["greptile.json", '{"customContext":{"other":false}}'], [".greptile", null]]) {
    assert.equal(mergeReviewer(path, body), null)
    assert.equal(planGrounding({ ...kit, [path]: body }).conflict, true)
  }
})

test("shared URL/local admission refuses missing guidance, allows explicit override, and fails closed on API errors", () => {
  const missing = (_cmd, args) => args[1].includes("/git/trees/") ? '{"tree":[]}' : '{"default_branch":"main"}'
  assert.throws(() => requireGrounding("garnet-labs/example", { exec: missing, log: () => {} }), /--allow-ungrounded/)
  assert.equal(requireGrounding("garnet-labs/example", { exec: missing, log: () => {}, allowUngrounded: true }).grounded, false)
  assert.equal(requireGrounding("garnet-labs/example", { exec: (_cmd, args) => kitResponse(args), log: () => {} }).grounded, true)
  assert.throws(() => requireGrounding("garnet-labs/example", { exec: () => { throw new Error("HTTP 403") }, allowUngrounded: true }), /HTTP 403/)
})

test("upstream-based plans carry approved guidance onto the base and two-commit replay", () => {
  const input = { slug: "example", fork: "garnet-labs/example", upstream: "upstream/example", defaultBranch: "main", upstreamPr: 1, upstreamTitle: "fix: update source", baseSha: "a".repeat(40), headSha: "b".repeat(40), changes: [{ path: "src/a.js", status: "modified", previous: null }], baseBranch: "review/base", recordWorkflows: [".github/workflows/ci.yml"], work: "/unused" }
  const grounding = { current: reviewerKit(), sha: "c".repeat(40) }
  const pure = carryReviewerGuidance(planPureReplay(input), grounding)
  const base = pure.steps.find((step) => step.kind === "ensure-base")
  assert.deepEqual(base.reviewerPaths, Object.keys(reviewerKit()))
  assert.equal(base.reviewerFrom, grounding.sha)
  assert.equal(pure.steps.filter((step) => step.cmd === "git" && step.args.includes("commit")).length, 1)
  const two = carryReviewerGuidance(planReplay({ ...input, record: "inject", ecosystem: "npm" }), grounding)
  assert.ok(two.steps.findIndex((step) => step.id === "carry-reviewers") < two.steps.findIndex((step) => step.id === "first-commit"))
  assert.ok(two.contextPaths.includes("REVIEW.md"))
  assert.ok(two.steps.findIndex((step) => step.id === "head-reviewers") > two.steps.findIndex((step) => step.id === "change-head"))
  assert.ok(two.steps.findIndex((step) => step.id === "head-reviewers") < two.steps.findIndex((step) => step.id === "change-commit"))
  assert.ok(pure.steps.some((step) => step.id === "reviewer-snapshot"))
  assert.throws(() => carryReviewerGuidance({ ...pure, paths: ["REVIEW.md"] }, grounding), /preserve reviewer guidance/)
  assert.throws(() => carryReviewerGuidance({ ...pure, steps: [...pure.steps, { id: "change-remove", args: ["rm", "--", "REVIEW.md"] }] }, grounding), /preserve reviewer guidance/)
})

test("prepared baselines carry repository-approved guidance identically across the pair", () => {
  const workflow = ".github/workflows/ci.yml"
  const input = { slug: "example", upstream: "upstream/example", fork: "garnet-labs/example", defaultBranch: "main", work: "/unused", reviewerFiles: reviewerKit(), spec: { baseline: { [workflow]: `on: [pull_request]\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@${GARNET_ACTION_PIN}\n`, "package.json": "one" }, change: { "package.json": "two" }, workflow, transition: { name: "example", from: "1", to: "2" } } }
  const plan = planPrepared(input)
  for (const [path, content] of Object.entries(reviewerKit())) {
    assert.equal(plan.steps.find((step) => step.id === `first-file:${path}`).writeFileContent.content, content)
    assert.equal(plan.steps.find((step) => step.id === "prepared-states").baseline[path], content)
    assert.ok(!plan.paths.includes(path))
  }
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, change: { "REVIEW.md": "remove policy" } } }), /preserve reviewer guidance/)
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
    assert.equal(state.rows.find((row) => row.path === skill).status, mode === "040000" ? "identical" : "conflict-manual")
  }
})

test("fleet discovery includes instrumented non-forks, excludes archived repositories and ordinary workflows", () => {
  const exec = (_cmd, args) => {
    const path = args.at(-1)
    if (path.startsWith("orgs/")) return JSON.stringify([[{ full_name: "garnet-labs/new", default_branch: "main", archived: false }, { full_name: "garnet-labs/old", archived: true }, { full_name: "garnet-labs/plain", default_branch: "trunk" }]])
    if (path.includes("/git/trees/")) return JSON.stringify({ tree: [{ path: "ci.yml", type: "blob", sha: path.includes("/new/") ? "yes" : "no" }] })
    return JSON.stringify({ encoding: "base64", content: Buffer.from(path.endsWith("/yes") ? "on: [pull_request]\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n" : "on: push\nsteps:\n  - uses: actions/checkout@v4\n").toString("base64") })
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

test("inventory distinguishes private PR recorders, reusable callers, push-only and comment-only workflows", () => {
  const workflows = {
    direct: { "ci.yml": "on: pull_request\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n" },
    reusable: { "ci.yml": "on: [pull_request]\njobs:\n  record:\n    uses: ./.github/workflows/helper.yml\n", "helper.yml": "on: workflow_call\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n" },
    push: { "ci.yml": "on: push\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@v2\n" },
    comment: { "ci.yml": "on: pull_request\n# - uses: garnet-org/action@v2\n" },
  }
  const exec = (_cmd, args) => {
    const path = args.at(-1)
    if (path.startsWith("orgs/")) return JSON.stringify([Object.keys(workflows).map((name) => ({ full_name: `garnet-labs/${name}`, default_branch: "main", private: name === "direct", fork: name !== "direct" }))])
    const name = path.split("/")[2]
    if (path.includes("/git/trees/")) return JSON.stringify({ tree: Object.keys(workflows[name]).map((file) => ({ path: file, type: "blob", sha: file })) })
    return JSON.stringify({ encoding: "base64", content: Buffer.from(workflows[name][path.split("/").at(-1)]).toString("base64") })
  }
  const inventory = groundingInventory({ exec })
  assert.equal(inventory.length, 3)
  assert.equal(inventory.find((row) => row.repo.endsWith("/direct")).private, true)
  assert.deepEqual(inventory.find((row) => row.repo.endsWith("/push")).workflows, [])
  assert.deepEqual(instrumentedRepos({ exec }), ["garnet-labs/direct", "garnet-labs/reusable"])
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
  assert.match(lines.join("\n"), /5 \| 0 \| 0 \| 0 \| 1/)
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

test("ground executes safe merges but refuses an entire mixed plan with a manual conflict", async () => {
  const exec = (_cmd, args) => args.at(-1).endsWith("/git/blobs/3")
    ? JSON.stringify({ encoding: "base64", content: Buffer.from("Existing review policy").toString("base64") })
    : kitResponse(args)
  const plans = []
  await ground(["posthog"], { exec, log: () => {}, save: () => {}, execute: async (plan) => { plans.push(plan); return {} } })
  assert.equal(plans.length, 1)
  assert.deepEqual(plans[0].files, ["REVIEW.md"])
  assert.ok(plans[0].steps.find((step) => step.id === "setup-write-REVIEW.md").writeFileContent.content.startsWith("Existing review policy"))
  const mixed = (_cmd, args) => args.at(-1).endsWith("/git/blobs/0")
    ? JSON.stringify({ encoding: "base64", content: Buffer.from("reviews: {}").toString("base64") })
    : exec(_cmd, args)
  const rows = await ground(["posthog"], { exec: mixed, log: () => {}, save: () => {}, execute: () => assert.fail("manual conflict opened a PR") })
  assert.equal(rows[0].conflict, true)
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
