import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { canonicalParagraph, ground, groundingAt, groundingInventory, instrumentedRepos, KIT_SOURCE, mergeReviewer, planGrounding, PREVIOUS_CANONICAL_PARAGRAPH, PREVIOUS_CANONICAL_PARAGRAPHS, requireGrounding, writeGrounding, reviewerGrounded, reviewerKit } from "../lib/ground.mjs"
import { carryReviewerGuidance, GARNET_ACTION_PIN, planPureReplay, planReplay, planSetup } from "../lib/replay-pr.mjs"
import { planPrepared } from "../lib/replay-prepared.mjs"
import { livePr } from "../lib/commands.mjs"
import { evaluateExhibit } from "../lib/verify.mjs"
import { kitResponse } from "./fixtures/grounding.mjs"

test("vendored reviewer files preserve pinned source bytes", () => {
  assert.equal(KIT_SOURCE.repository, "garnet-labs/garnet-runtime-review-mcp")
  assert.equal(KIT_SOURCE.sha, "4253b0e490582e6f77c7ca368bb6006abd5beb7d")
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
  const dir = planGrounding({ ...kit, ".greptile": null })
  assert.equal(dir.conflict, false)
  assert.match(dir.files[".greptile/rules.md"], /The Runtime Review comment is the record/)
  const rules = planGrounding({ ...kit, ".greptile": null, ".greptile/rules.md": "# Upstream rules\n" })
  assert.match(rules.files[".greptile/rules.md"], /^# Upstream rules\n[\s\S]*## Runtime Review/)
  assert.equal(planGrounding({ ...kit, ".greptile": null, ".greptile/rules.md": rules.files[".greptile/rules.md"] }).grounded, true)
  assert.equal(planGrounding({ ...kit, ".greptile": "file" }).conflict, true)
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
  for (const [path, body] of [[".coderabbit.yaml", "reviews: {}"], [".pr_agent.toml", "[review_agent]"], ["greptile.json", "{"], ["greptile.json", "[]"], ["greptile.json", '{"customContext":{"other":false}}'], [".greptile", "file"]]) {
    assert.equal(mergeReviewer(path, body), null)
    assert.equal(planGrounding({ ...kit, [path]: body }).conflict, true)
  }
})

test("grounding updates only the exact prior reviewer paragraph in config files", () => {
  const kit = reviewerKit()
  const codeRabbit = `knowledge_base:
  mcp:
    usage: enabled
reviews:
  path_instructions:
    - path: "**"
      instructions: |
        ${PREVIOUS_CANONICAL_PARAGRAPH}
`
  const prAgent = `[review_agent]
override_effort = "standard"
issues_user_guidelines = """
${PREVIOUS_CANONICAL_PARAGRAPH}
"""
`
  for (const [path, body] of [[".coderabbit.yaml", codeRabbit], [".pr_agent.toml", prAgent]]) {
    const state = planGrounding({ ...kit, [path]: body })
    assert.equal(state.conflict, false, path)
    assert.equal(state.rows.find((row) => row.path === path).status, "merge", path)
    assert.equal(state.files[path], body.replace(PREVIOUS_CANONICAL_PARAGRAPH, canonicalParagraph()), path)
    assert.equal(planGrounding({ ...kit, ...state.files }).grounded, true, path)
  }
  assert.equal(mergeReviewer(".coderabbit.yaml", codeRabbit.replace("usage: enabled", "usage: disabled")), null)
  assert.equal(mergeReviewer(".pr_agent.toml", `${prAgent}${PREVIOUS_CANONICAL_PARAGRAPH}`), null)
})

test("grounding replaces prior kit bytes and paragraphs without retaining legacy guidance", () => {
  const kit = reviewerKit()
  const oldReview = readFileSync(new URL("./fixtures/previous-reviewer-REVIEW.md", import.meta.url), "utf8")
  const exact = planGrounding({ ...kit, "REVIEW.md": oldReview })
  assert.equal(exact.rows.find((row) => row.path === "REVIEW.md").status, "merge")
  assert.equal(exact.files["REVIEW.md"], kit["REVIEW.md"])

  const markdown = `# Local policy\n\nKeep this rule.\n\n## Runtime Review\n\n${PREVIOUS_CANONICAL_PARAGRAPH}\n`
  const markdownBody = mergeReviewer("REVIEW.md", markdown)
  assert.match(markdownBody, /Keep this rule\./)
  assert.equal(markdownBody.match(/## Runtime Review/g).length, 1)
  assert.equal(markdownBody.includes(PREVIOUS_CANONICAL_PARAGRAPH), false)
  const mixed = planGrounding({ ...kit, "REVIEW.md": `${markdown}\n${canonicalParagraph()}` })
  assert.equal(mixed.rows.find((row) => row.path === "REVIEW.md").status, "merge")
  assert.equal(mixed.files["REVIEW.md"].includes(PREVIOUS_CANONICAL_PARAGRAPH), false)

  const greptile = {
    instructions: "Keep these instructions.",
    customContext: {
      rules: ["Keep this rule."],
      other: [{ scope: ["src/**"], content: PREVIOUS_CANONICAL_PARAGRAPH }],
    },
    labels: ["upstream"],
  }
  const greptileBody = JSON.parse(mergeReviewer("greptile.json", JSON.stringify(greptile)))
  assert.deepEqual(greptileBody.labels, greptile.labels)
  assert.equal(greptileBody.instructions, greptile.instructions)
  assert.deepEqual(greptileBody.customContext.rules, greptile.customContext.rules)
  assert.equal(greptileBody.customContext.other[0].content, canonicalParagraph())

  const codeRabbit = `knowledge_base:\n  mcp:\n    usage: enabled\nreviews:\n  path_instructions:\n    - path: "**"\n      instructions: |\n        ${PREVIOUS_CANONICAL_PARAGRAPH}\n`
  const prAgent = `[review_agent]\nissues_user_guidelines = """\n${PREVIOUS_CANONICAL_PARAGRAPH}\n"""\n`
  const markdownSkill = `# Local skill policy\n\n${PREVIOUS_CANONICAL_PARAGRAPH}\n`
  const rules = `# Local Greptile policy\n\n${PREVIOUS_CANONICAL_PARAGRAPH}\n`
  const all = planGrounding({
    ...kit,
    ".coderabbit.yaml": codeRabbit,
    ".pr_agent.toml": prAgent,
    "greptile.json": JSON.stringify(greptile),
    "REVIEW.md": markdown,
    ".agents/skills/garnet-runtime-review/SKILL.md": markdownSkill,
    ".greptile": null,
    ".greptile/rules.md": rules,
  })
  assert.equal(all.conflict, false)
  for (const body of Object.values(all.files)) {
    assert.doesNotMatch(body, /get_runtime_review|get_execution_profile|garnet-runtime-review-mcp\.vercel\.app/)
  }
  assert.equal(mergeReviewer("REVIEW.md", `${markdown}${PREVIOUS_CANONICAL_PARAGRAPH}`), null)
  assert.equal(mergeReviewer("greptile.json", JSON.stringify({ first: PREVIOUS_CANONICAL_PARAGRAPH, second: PREVIOUS_CANONICAL_PARAGRAPH })), null)
  const ambiguousRules = planGrounding({
    ...kit,
    ".greptile": null,
    ".greptile/rules.md": `${PREVIOUS_CANONICAL_PARAGRAPH}\n${PREVIOUS_CANONICAL_PARAGRAPH}`,
  })
  assert.equal(ambiguousRules.rows.find((row) => row.path === ".greptile/rules.md").status, "conflict-manual")
})

test("grounding upgrades the cbc0ebe kit: exact bytes are replaced and its paragraph is swapped in place", () => {
  const kit = reviewerKit()
  const paragraph = PREVIOUS_CANONICAL_PARAGRAPHS[1]
  assert.notEqual(paragraph, PREVIOUS_CANONICAL_PARAGRAPH)
  assert.notEqual(paragraph, canonicalParagraph())
  assert.match(canonicalParagraph(), /Don't wait for Garnet: if no finalized `garnet:summary` is bound to the current head, review without it and say the runtime record isn't available yet\. Never poll or sleep for it\./)
  assert.doesNotMatch(paragraph, /Don't wait for Garnet/)

  const oldReview = readFileSync(new URL("./fixtures/cbc0ebe-reviewer-REVIEW.md", import.meta.url), "utf8")
  assert.equal(oldReview.includes(paragraph), true)
  assert.equal(reviewerGrounded("REVIEW.md", oldReview), false)
  const exact = planGrounding({ ...kit, "REVIEW.md": oldReview })
  assert.equal(exact.rows.find((row) => row.path === "REVIEW.md").status, "merge")
  assert.equal(exact.files["REVIEW.md"], kit["REVIEW.md"])

  const markdown = `# Local policy\n\nKeep this rule.\n\n## Runtime Review\n\n${paragraph}\n`
  const codeRabbit = `knowledge_base:\n  mcp:\n    usage: enabled\nreviews:\n  path_instructions:\n    - path: "**"\n      instructions: |\n        ${paragraph}\n`
  const prAgent = `[review_agent]\nissues_user_guidelines = """\n${paragraph}\n"""\n`
  const greptile = { instructions: "Keep these instructions.", customContext: { other: [{ scope: ["src/**"], content: paragraph }] } }
  const state = planGrounding({
    ...kit,
    ".coderabbit.yaml": codeRabbit,
    ".pr_agent.toml": prAgent,
    "greptile.json": JSON.stringify(greptile),
    "REVIEW.md": markdown,
    ".agents/skills/garnet-runtime-review/SKILL.md": `# Local skill policy\n\n${paragraph}\n`,
    ".greptile": null,
    ".greptile/rules.md": `# Local Greptile policy\n\n${paragraph}\n`,
  })
  assert.equal(state.conflict, false)
  assert.equal(state.files[".coderabbit.yaml"], codeRabbit.replace(paragraph, canonicalParagraph()))
  assert.equal(state.files[".pr_agent.toml"], prAgent.replace(paragraph, canonicalParagraph()))
  assert.equal(state.files["REVIEW.md"], markdown.replace(paragraph, canonicalParagraph()))
  assert.equal(JSON.parse(state.files["greptile.json"]).instructions, greptile.instructions)
  for (const body of Object.values(state.files)) {
    assert.equal(body.includes(paragraph), false)
    assert.equal(body.split(canonicalParagraph()).length - 1, 1)
  }
  assert.equal(planGrounding({ ...kit, ...state.files, ".greptile": null }).grounded, true)

  assert.equal(mergeReviewer("REVIEW.md", `${markdown}${PREVIOUS_CANONICAL_PARAGRAPH}`), null)
  assert.equal(mergeReviewer("greptile.json", JSON.stringify({ first: paragraph, second: PREVIOUS_CANONICAL_PARAGRAPH })), null)
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
  const pure = carryReviewerGuidance(planPureReplay({ ...input, forkDefaultSha: grounding.sha }), grounding)
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
  assert.equal(rows[0].conflict, false)
  assert.match(lines.join("\n"), /6 \| 0 \| 0 \| 0 \| 0/)
  await assert.rejects(ground([], { log: () => {} }), /requires/)
  await assert.rejects(ground(["posthog", "--dry-run"], { exec: () => { throw new Error("HTTP 500") }, log: () => {} }), /HTTP 500/)
})

test("kit onboarding uses one commit, fork-only writes, and refuses unrelated root paths", () => {
  const input = { slug: "posthog", upstream: "PostHog/posthog", fork: "garnet-labs/posthog", defaultBranch: "main", work: "/unused", mode: "inject", files: reviewerKit(), message: "ci: configure reviewer guidance", body: "Adds repository reviewer instructions.", branch: "reviewer-guidance" }
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
    write: (request) => { plans.push(request); return { forkPr: 99, createdPrUrl: "https://github.com/garnet-labs/posthog/pull/99", setupSha: "c".repeat(40) } },
  })
  assert.equal(plans.length, 1)
  assert.equal(Object.keys(plans[0].files).length, 5)
  assert.equal(plans[0].snapshot, "snapshot-tree")
  assert.equal(plans[0].branch, "reviewer-guidance")
  assert.equal(saved[0].grounding.state, "pending")
  assert.equal(saved[0].grounding.pr, 99)
  await ground(["posthog"], {
    exec: (_cmd, args) => kitResponse(args), log: () => {},
    save: (target) => saved.push(target), write: () => assert.fail("identical kit opened a PR"),
  })
  assert.equal(saved.at(-1).grounding.state, "grounded")
})

test("ground executes safe merges but refuses an entire mixed plan with a manual conflict", async () => {
  const exec = (_cmd, args) => args.at(-1).endsWith("/git/blobs/3")
    ? JSON.stringify({ encoding: "base64", content: Buffer.from("Existing review policy").toString("base64") })
    : kitResponse(args)
  const plans = []
  await ground(["posthog", "--branch", "reviewer-guidance-2"], { exec, log: () => {}, save: () => {}, write: (request) => { plans.push(request); return { forkPr: 1, createdPrUrl: "url", setupSha: "c".repeat(40) } } })
  assert.equal(plans.length, 1)
  assert.deepEqual(Object.keys(plans[0].files), ["REVIEW.md"])
  assert.ok(plans[0].files["REVIEW.md"].startsWith("Existing review policy"))
  assert.equal(plans[0].branch, "reviewer-guidance-2")
  const mixed = (_cmd, args) => args.at(-1).endsWith("/git/blobs/0")
    ? JSON.stringify({ encoding: "base64", content: Buffer.from("reviews: {}").toString("base64") })
    : exec(_cmd, args)
  const rows = await ground(["posthog"], { exec: mixed, log: () => {}, save: () => {}, write: () => assert.fail("manual conflict opened a PR") })
  assert.equal(rows[0].conflict, true)
})

test("grounding is written through the API as one commit on a new branch, never a clone", () => {
  const head = "a".repeat(40)
  const calls = []
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args, payload: options.input === undefined ? null : JSON.parse(options.input) })
    const path = args.at(-1) === "-" ? args[3] : args.at(-1)
    if (path.endsWith("/commits/main")) return JSON.stringify({ sha: head, commit: { tree: { sha: "snapshot-tree" } } })
    if (path.includes("/git/matching-refs/")) return JSON.stringify([{ ref: "refs/heads/reviewer-guidance-old" }])
    if (path.endsWith("/git/blobs")) return JSON.stringify({ sha: "b".repeat(40) })
    if (path.endsWith("/git/trees")) return JSON.stringify({ sha: "d".repeat(40) })
    if (path.endsWith("/git/commits")) return JSON.stringify({ sha: "c".repeat(40) })
    if (path.endsWith("/git/refs")) return "{}"
    if (path.endsWith("/pulls")) return JSON.stringify({ number: 7, html_url: "https://github.com/garnet-labs/posthog/pull/7" })
    throw new Error(`unexpected ${path}`)
  }
  const request = {
    repo: "garnet-labs/posthog", upstream: "PostHog/posthog", defaultBranch: "main", snapshot: "snapshot-tree",
    files: { "REVIEW.md": "policy", ".pr_agent.toml": "[review_agent]\n" }, modes: { "REVIEW.md": "100755" },
    branch: "reviewer-guidance", message: "ci: configure reviewer guidance [skip ci]", body: "Adds repository reviewer instructions.",
  }
  assert.deepEqual(writeGrounding(request, { exec }), { forkPr: 7, createdPrUrl: "https://github.com/garnet-labs/posthog/pull/7", setupSha: "c".repeat(40) })
  assert.ok(calls.every((call) => call.cmd === "gh" && call.args[0] === "api" && call.args.every((arg) => !arg.includes("PostHog/posthog"))))
  const writes = calls.filter((call) => call.payload !== null)
  assert.deepEqual(writes.map((call) => call.args[3].split("/").slice(3).join("/")), ["git/blobs", "git/blobs", "git/trees", "git/commits", "git/refs", "pulls"])
  assert.equal(Buffer.from(writes[0].payload.content, "base64").toString("utf8"), "policy")
  assert.deepEqual(writes[2].payload, { base_tree: "snapshot-tree", tree: [
    { path: "REVIEW.md", type: "blob", mode: "100755", sha: "b".repeat(40) },
    { path: ".pr_agent.toml", type: "blob", mode: "100644", sha: "b".repeat(40) },
  ] })
  assert.deepEqual(writes[3].payload, { message: request.message, tree: "d".repeat(40), parents: [head] })
  assert.deepEqual(writes[4].payload, { ref: "refs/heads/reviewer-guidance", sha: "c".repeat(40) })
  assert.deepEqual(writes[5].payload, { title: request.message, body: request.body, head: "reviewer-guidance", base: "main" })

  for (const [override, responses, pattern] of [
    [{ files: { "package.json": "{}" } }, {}, /refusing package\.json/],
    [{ files: { ".github/workflows/ci.yml": "on: push" } }, {}, /refusing/],
    [{ repo: "PostHog/posthog" }, {}, /restricted to garnet-labs/],
    [{ branch: "main" }, {}, /own branch/],
    [{ body: "See PostHog/posthog#1" }, {}, /upstream/i],
    [{}, { "/commits/main": JSON.stringify({ sha: head, commit: { tree: { sha: "moved" } } }) }, /moved since planning/],
    [{}, { "/git/matching-refs/": JSON.stringify([{ ref: "refs/heads/reviewer-guidance" }]) }, /already has a branch/],
  ]) {
    const written = []
    const guarded = (cmd, args, options = {}) => {
      if (options.input !== undefined) written.push(args[3])
      const match = Object.entries(responses).find(([part]) => args.at(-1).includes(part))
      return match === undefined ? exec(cmd, args, options) : match[1]
    }
    assert.throws(() => writeGrounding({ ...request, ...override }, { exec: guarded }), pattern)
    assert.deepEqual(written, [])
  }
})

test("an upstream-owned PR Agent file gains the paragraph inside its own guidelines; other shapes stay manual", () => {
  const owned = [
    "[config]", 'model = "x"', "", "[review_agent]", "# keep the bar high", 'comments_location_policy = "both"',
    'issues_user_guidelines = """', "Apply the review guide.", '"""', 'compliance_user_guidelines = """', "Enforce the contracts.", '"""', "",
  ].join("\n")
  const merged = mergeReviewer(".pr_agent.toml", owned)
  assert.equal(merged, owned.replace('Apply the review guide.\n"""', `Apply the review guide.\n\n${canonicalParagraph()}\n"""`))
  assert.equal(planGrounding({ ".pr_agent.toml": owned }).rows.find((row) => row.path === ".pr_agent.toml").status, "merge")
  assert.equal(planGrounding({ ".pr_agent.toml": merged }).rows.find((row) => row.path === ".pr_agent.toml").status, "grounded")
  for (const manual of [
    owned.replace("[review_agent]", "[other_agent]"),
    owned.replace('issues_user_guidelines = """\nApply the review guide.\n"""', 'issues_user_guidelines = "Apply the review guide."'),
    owned.replace('issues_user_guidelines = """', "issues_user_guidelines = '''").replace('Apply the review guide.\n"""', "Apply the review guide.\n'''"),
    `${owned}[pr_reviewer]\nissues_user_guidelines = """\nSecond.\n"""\n`,
    owned.replace("Apply the review guide.", 'Apply the """ guide.'),
    owned.replace("Apply the review guide.", "Apply the review guide.\\"),
    owned.replace("# keep the bar high", 'note = """\n[review_agent]\nissues_user_guidelines = """'),
    "[review_agent]\nenable = true\n",
  ]) {
    assert.equal(mergeReviewer(".pr_agent.toml", manual), null)
    assert.equal(planGrounding({ ".pr_agent.toml": manual }).rows.find((row) => row.path === ".pr_agent.toml").status, "conflict-manual")
  }
})

test("live refuses ungrounded default branches before any write, with explicit override hint", async () => {
  const lines = []
  const exec = (cmd, args) => {
    assert.equal(cmd, "gh")
    if (args[0] === "repo") return '{"defaultBranchRef":{"name":"main"}}'
    if (args[1] === "repos/garnet-labs/posthog/commits/main") return JSON.stringify({ sha: "c".repeat(40) })
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
