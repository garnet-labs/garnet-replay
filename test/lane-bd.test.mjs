import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { assessLiveReplaySupport } from "../lib/gate.mjs"
import { executionDiffFromProfiles } from "../lib/execution-diff.mjs"
import { createReplayBranch } from "../live/replay-branch.mjs"
import { renderComparison } from "../renderer/compare.mjs"
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
  assert.match(workflow, /^\s+id-token: write$/m)
  assert.match(workflow, /^\s+#\s+api_token: \$\{\{ secrets\.GARNET_API_TOKEN \}\}$/m)
  assert.doesNotMatch(workflow, /^\s+api_token:/m)
  assert.doesNotMatch(workflow, /GARNET_API_TOKEN is not set/)
  assert.match(workflow, /OIDC needs id-token: write and is unavailable on fork pull requests/)
  assert.match(workflow, /max-parallel:\s+1/)
  assert.match(workflow, /echo "\$\{\{ github\.run_id \}\}" > "\$RUNNER_TEMP\/profile\/run_id"/)
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
