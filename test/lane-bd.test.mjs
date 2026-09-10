import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { assessLiveReplaySupport } from "../lib/gate.mjs"
import { executionDiffFromProfiles } from "../lib/execution-diff.mjs"
import { createReplayBranch } from "../live/replay-branch.mjs"
import { renderComparison, repostPrComment } from "../renderer/compare.mjs"
import { validate } from "../lib/validate.mjs"

const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
const seeds = JSON.parse(await readFile(new URL("../seeds/seeds.json", import.meta.url), "utf8"))

test("live gate reports observation-only constraints", () => {
  const supported = assessLiveReplaySupport({
    repoMeta: { private: false },
    prMeta: { title: "Update ms from 2.1.2 to 2.1.3", user: { login: "dependabot[bot]" } },
    files: [{ filename: "package.json" }, { filename: "package-lock.json" }],
  })
  assert.equal(supported.supported, true)
  assert.deepEqual(supported.reasons, ["Linux is required"])

  const noLockfile = assessLiveReplaySupport({
    repoMeta: { private: false },
    prMeta: { title: "Add chart-helpers", user: { login: "dependabot[bot]" } },
    files: [{ filename: "package.json" }],
  })
  assert.equal(noLockfile.supported, true)
  assert.deepEqual(noLockfile.reasons, ["Linux is required"])

  const unsupported = assessLiveReplaySupport({ repoMeta: { private: true }, files: [] })
  assert.equal(unsupported.supported, false)
  assert.ok(unsupported.reasons.includes("repository is not public"))
  assert.ok(unsupported.reasons.includes("no package.json"))
  assert.doesNotMatch(unsupported.reasons.join(" "), /\b(?:unsafe|risky|verified)\b/i)
})

test("live replay supports package subdirectories and dependency adds", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "garnet-replay-"))
  const packagePath = join(repoDir, "sub", "app", "package.json")
  try {
    await mkdir(join(repoDir, "sub", "app"), { recursive: true })
    await writeFile(packagePath, '{"name":"x","dependencies":{}}\n')
    execFileSync("git", ["-C", repoDir, "init", "-b", "main"], { stdio: "ignore" })
    execFileSync("git", ["-C", repoDir, "config", "user.email", "test@example.com"], { stdio: "ignore" })
    execFileSync("git", ["-C", repoDir, "config", "user.name", "Test"], { stdio: "ignore" })
    execFileSync("git", ["-C", repoDir, "add", "sub/app/package.json"], { stdio: "ignore" })
    execFileSync("git", ["-C", repoDir, "commit", "-m", "initial"], { stdio: "ignore" })

    const result = createReplayBranch({
      repoDir,
      packageDir: "sub/app",
      dependency: "chart-helpers",
      from: "none",
      to: "file:../vendor/chart-helpers-1.0.0.tgz",
      packageManager: "npm",
    })
    const baseline = JSON.parse(execFileSync("git", ["-C", repoDir, "show", `${result.baselineCommit}:sub/app/package.json`], { encoding: "utf8" }))
    const update = JSON.parse(execFileSync("git", ["-C", repoDir, "show", `${result.updateCommit}:sub/app/package.json`], { encoding: "utf8" }))
    assert.deepEqual(baseline, { name: "x", dependencies: {} })
    assert.equal(update.dependencies["chart-helpers"], "file:../vendor/chart-helpers-1.0.0.tgz")
    assert.notEqual(result.baselineCommit, result.updateCommit)
    assert.equal(execFileSync("git", ["-C", repoDir, "rev-list", "--count", result.updateCommit], { encoding: "utf8" }).trim(), "3")
    assert.match(await readFile(join(repoDir, ".github", "garnet-replay", "install.sh"), "utf8"), /cd "sub\/app"\nnpm install/)
    assert.equal(JSON.parse(await readFile(join(repoDir, ".github", "garnet-replay", "replay.json"), "utf8")).packageDir, "sub/app")
    assert.match(await readFile(join(repoDir, ".github", "DEPENDENCY_REPLAY.md"), "utf8"), /Baseline: not installed/)
    assert.match(await readFile(join(repoDir, ".github", "DEPENDENCY_REPLAY.md"), "utf8"), /Package dir: `sub\/app`/)
    const packagedModules = ["compare.mjs", "review.mjs", "profile-diff.mjs", "execution-diff.mjs"]
      .map((name) => join(repoDir, ".github", "garnet-replay", name))
    for (const modulePath of packagedModules) {
      execFileSync(process.execPath, ["--check", modulePath], { stdio: "ignore" })
    }
    const importPaths = packagedModules.filter((path) => path.endsWith("compare.mjs") || path.endsWith("profile-diff.mjs") || path.endsWith("execution-diff.mjs"))
    const imported = execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      'const { pathToFileURL } = await import("node:url"); const [compare, profile, execution] = await Promise.all([process.env.PACKAGED_COMPARE, process.env.PACKAGED_PROFILE, process.env.PACKAGED_EXECUTION].map((path) => import(pathToFileURL(path)))); if (typeof compare.renderComparison !== "function" || typeof profile.diffDestinations !== "function" || typeof execution.executionDiffFromProfiles !== "function") process.exit(1)',
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PACKAGED_COMPARE: importPaths[0],
        PACKAGED_PROFILE: importPaths[1],
        PACKAGED_EXECUTION: importPaths[2],
      },
    })
    assert.equal(imported, "")
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test("live replay workflow uses GitHub OIDC by default", async () => {
  const workflow = await readFile("live/templates/garnet-dependency-replay.yml", "utf8")
  assert.match(workflow, /garnet-org\/action@e546567a72e4fede11ec39d6e9f75b539adef22c/)
  assert.match(workflow, /^concurrency:\n  group: garnet-dependency-replay-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true$/m)
  assert.match(workflow, /^permissions: \{\}$/m)
  assert.match(workflow, /^  record:[\s\S]*?^      id-token: write$/m)
  assert.doesNotMatch(workflow, /^permissions:\n(?:  .*\n)*  id-token: write$/m)
  const compareSection = workflow.slice(workflow.indexOf("\n  compare:"))
  assert.doesNotMatch(compareSection, /id-token:/)
  assert.match(workflow, /^\s+#\s+api_token: \$\{\{ secrets\.GARNET_API_TOKEN \}\}$/m)
  assert.doesNotMatch(workflow, /^\s+api_token:/m)
  assert.doesNotMatch(workflow, /GARNET_API_TOKEN is not set/)
  assert.match(workflow, /GARNET_PROFILE_JOB:\s+record-\$\{\{ matrix\.side \}\}/)
  assert.match(workflow, /OIDC needs id-token: write and is unavailable on fork pull requests/)
  assert.match(workflow, /max-parallel:\s+1/)
  assert.match(workflow, /- name: Let sensor settle\s+if: always\(\)\s+run: sleep 30/)
  assert.match(workflow, /echo "\$\{\{ github\.run_id \}\}" > "\$RUNNER_TEMP\/profile\/run_id"/)
  assert.ok(workflow.includes('export BASELINE_SHA="$(cat profiles/garnet-profile-baseline/sha 2>/dev/null || git rev-parse HEAD~1)"'))
  assert.ok(workflow.includes('export HEAD_SHA="$(cat profiles/garnet-profile-update/sha 2>/dev/null || echo "$HEAD_SHA")"'))
  assert.match(workflow, /uses: actions\/download-artifact@v4\n\s+continue-on-error: true/)
  assert.match(workflow, /- name: Render comparison and post PR comment\n\s+if: always\(\)/)
})

test("compare publication only removes marked bot comments", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (String(url).includes("/pulls/")) return new Response(JSON.stringify({ head: { sha: "h".repeat(40) } }), { status: 200 })
    if (options.method === "DELETE") return new Response(null, { status: 204 })
    if (options.method === "POST") return new Response("{}", { status: 201 })
    return new Response(JSON.stringify([
      { id: 1, user: { login: "github-actions[bot]" }, body: "<!-- garnet-dependency-replay -->" },
      { id: 2, user: { login: "human" }, body: "<!-- garnet-dependency-replay -->" },
    ]), { status: 200 })
  }
  try {
    await repostPrComment({
      githubToken: "token",
      repository: "owner/repo",
      prNumber: "1",
      githubApiUrl: "https://api.github.com",
      headSha: "h".repeat(40),
    }, "body")
    assert.deepEqual(requests.filter(({ options }) => options.method === "DELETE").map(({ url }) => url), [
      "https://api.github.com/repos/owner/repo/issues/comments/1",
    ])
    assert.equal(requests.filter(({ options }) => options.method === "POST").length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("compare publication skips deletion and posting when the PR head moved", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(message)
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ head: { sha: "m".repeat(40) } }), { status: 200 })
  }
  try {
    await repostPrComment({
      githubToken: "token",
      repository: "owner/repo",
      prNumber: "1",
      githubApiUrl: "https://api.github.com",
      headSha: "h".repeat(40),
    }, "body")
    assert.equal(requests.length, 1)
    assert.match(warnings.join("\n"), /PR head moved to m{40}; not publishing comparison for h{40}/)
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
  }
})

test("missing replay profiles produce an unavailable diff and explicit comment line", async () => {
  const profile = JSON.parse(await readFile("test/fixtures/demo-profiles/30304293294.json", "utf8"))
  const raw = profile.profiles[0]
  const headSha = raw.run.commit_sha
  const baselineSha = "0".repeat(40)
  const diff = executionDiffFromProfiles({
    baseline: null,
    update: profile,
    meta: { baselineSha, headSha, repository: raw.run.repository, prNumber: 1 },
  })
  assert.deepEqual(validate(schema, diff), [])
  assert.deepEqual(diff.comparison, { available: false, scope: "unavailable" })
  assert.deepEqual(diff.execution_diff.network_added, [])
  const body = renderComparison({
    baseline: null,
    update: null,
    replay: {},
    cfg: { baselineSha, headSha, repository: raw.run.repository, prNumber: "1", githubServerUrl: "https://github.com", githubApiUrl: "https://api.github.com", publicReportUrl: "https://app.garnet.ai" },
  })
  assert.match(body, new RegExp(`no baseline execution record for \\\`${baselineSha}\\\``))
  const updateMissingBody = renderComparison({
    baseline: {},
    update: null,
    replay: {},
    cfg: { baselineSha, headSha, repository: raw.run.repository, prNumber: "1", githubServerUrl: "https://github.com", githubApiUrl: "https://api.github.com", publicReportUrl: "https://app.garnet.ai" },
  })
  assert.match(updateMissingBody, new RegExp(`no update execution record for \\\`${headSha}\\\``))
})

test("profiles from a different workflow run render as unavailable", () => {
  const profile = (runId) => ({
    timestamp: "2026-01-01T00:00:00Z",
    scenarios: { github: { sha: "x".repeat(40), run_id: runId, repository: "owner/repo" } },
    network: { egress: { peers: [] } },
  })
  const body = renderComparison({
    baseline: profile("run-1"),
    update: profile("run-2"),
    replay: {},
    cfg: {
      baselineSha: "a".repeat(40),
      headSha: "b".repeat(40),
      runId: "run-expected",
      repository: "owner/repo",
      githubServerUrl: "https://github.com",
    },
  })
  assert.match(body, /no baseline execution record for `a{40}`: the record found belongs to run run-1\./)
  assert.match(body, /no update execution record for `b{40}`: the record found belongs to run run-2\./)
  assert.match(body, /comparison unavailable/)
})

test("empty profiles are unavailable and missing heads have nullable destination totals", () => {
  const diff = executionDiffFromProfiles({
    baseline: {},
    update: {},
    meta: { baselineSha: "a".repeat(40), headSha: "b".repeat(40) },
  })
  assert.equal(diff.comparison.available, false)
  assert.equal(diff.execution_diff.totals.destinations, null)
})

test("full ancestry distinguishes process paths before their last three entries", () => {
  const profile = (root) => ({
    egress: [{
      name: `${root}.example`,
      ancestry: [root, "shared-a", "shared-b", "shared-c", "node1234"],
      step: "Install dependencies",
    }],
    github: { sha: root.repeat(40).slice(0, 40) },
  })
  const diff = executionDiffFromProfiles({ baseline: profile("base"), update: profile("head") })
  const added = diff.execution_diff.processes_added.map((entry) => entry.ancestry.join(" → "))
  const removed = diff.execution_diff.processes_removed.map((entry) => entry.ancestry.join(" → "))
  assert.deepEqual(added, ["head → shared-a → shared-b → shared-c → node"])
  assert.deepEqual(removed, ["base → shared-a → shared-b → shared-c → node"])
})

test("compare comments prefer recorded replay SHAs over profile stamps", () => {
  const stampedSha = "x".repeat(40)
  const baselineSha = "a".repeat(40)
  const headSha = "b".repeat(40)
  const profile = (sha) => ({
    github: { sha, repository: "owner/repo", workflow: "workflow", job: "record" },
    egress: [],
  })
  const body = renderComparison({
    baseline: profile(stampedSha),
    update: profile(stampedSha),
    replay: {},
    cfg: {
      baselineSha,
      headSha,
      repository: "owner/repo",
      githubServerUrl: "https://github.com",
      githubApiUrl: "https://api.github.com",
      publicReportUrl: "https://app.garnet.ai",
    },
  })
  assert.match(body, new RegExp(`garnet:commit ${headSha}`))
  assert.match(body, new RegExp(`commit/${baselineSha}`))
  assert.doesNotMatch(body, new RegExp(stampedSha))
})

test("compare comment fold titles link commits with HTML, not markdown", () => {
  const baselineSha = "a".repeat(40)
  const headSha = "b".repeat(40)
  const profile = (sha) => ({
    github: { sha, repository: "owner/repo", workflow: "workflow", job: "record" },
    egress: [],
  })
  const body = renderComparison({
    baseline: profile(baselineSha),
    update: profile(headSha),
    replay: {},
    cfg: {
      baselineSha,
      headSha,
      repository: "owner/repo",
      githubServerUrl: "https://github.com",
      githubApiUrl: "https://api.github.com",
      publicReportUrl: "https://app.garnet.ai",
    },
  })
  const summaries = body.split("\n").filter((line) => line.includes("full Execution Profile"))
  assert.equal(summaries.length, 2)
  assert.equal(
    summaries[0],
    `<details><summary>update <a href="https://github.com/owner/repo/commit/${headSha}"><code>bbbbbbb</code></a> · full Execution Profile</summary>`,
  )
  for (const line of summaries) assert.doesNotMatch(line, /\]\(/)
})

test("constructed profile diffs preserve workload and runner background sections", async () => {
  const base = JSON.parse(await readFile("test/fixtures/demo-profiles/30304258281.json", "utf8"))
  const profile = JSON.parse(await readFile("test/fixtures/demo-profiles/30304293294.json", "utf8"))
  const raw = profile.profiles[0]
  const diff = executionDiffFromProfiles({
    baseline: base,
    update: profile,
    meta: {
      label: "constructed",
      repository: "garnet-labs/garnet-runtime-review-demo",
      prNumber: 30304293294,
      headSha: raw.run.commit_sha,
      runId: raw.run.run_id,
      comparisonScope: "constructed-pair",
      baseReceiptUrl: "https://app.garnet.ai/public/runs/30304258281?profile=019fa558-63f3-7d3f-b208-8258d1755c50",
    },
  })
  assert.deepEqual(validate(schema, diff), [])
  assert.equal(diff.mode, "live-replay")
  assert.deepEqual(diff.comparison, { available: true, scope: "constructed-pair" })
  assert.deepEqual(diff.execution_diff.network_added.filter((entry) => entry.section === "workload").map((entry) => entry.destination), ["httpbin.org"])
  const background = diff.execution_diff.network_added.filter((entry) => entry.section === "runner background")
  assert.ok(background.some((entry) => entry.process === "hosted-compute-agent"))
  assert.ok(background.some((entry) => entry.process === "provjobd"))
  assert.ok(diff.execution_diff.totals.runner_background.added > 0)
})

test("every seed points to a schema-valid replay", async () => {
  for (const seed of seeds) {
    assert.ok(["real", "constructed"].includes(seed.label))
    const replayPath = seed.replay_json.replace(/^\/?replays\//, "public/replays/")
    await access(replayPath)
    const replay = JSON.parse(await readFile(replayPath, "utf8"))
    assert.deepEqual(validate(schema, replay), [], seed.id)
    if (seed.label === "constructed") assert.match(seed.note, /constructed/)
  }
  assert.equal(seeds.length, 25)
  assert.equal(seeds.filter((seed) => seed.label === "real").length, 21)
  assert.equal(seeds.filter((seed) => seed.label === "constructed").length, 4)
})

test("constructed replay titles follow seed metadata", async () => {
  for (const seed of seeds.filter((entry) => entry.label === "constructed")) {
    const replayPath = seed.replay_json.replace(/^\/?replays\//, "public/replays/")
    const replay = JSON.parse(await readFile(replayPath, "utf8"))
    assert.equal(replay.pull_request.title, seed.title, seed.id)
  }
})
