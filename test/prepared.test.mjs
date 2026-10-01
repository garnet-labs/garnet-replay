import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { planPrepared, verifyPreparedPaths, verifyPreparedResume } from "../lib/replay-prepared.mjs"
import { executePlan, renderPlan } from "../lib/replay-pr.mjs"
import { livePr } from "../lib/commands.mjs"

const WORKFLOW = ".github/workflows/install.yml"
const workflow = `name: Install
on:
  pull_request:
    paths:
      - 'fixture/**'
jobs:
  install:
    runs-on: ubuntu-24.04
    steps:
      - uses: garnet-org/action@${"a".repeat(40)}
`;
const input = {
  slug: "pnpm", upstream: "pnpm/pnpm", fork: "garnet-labs/pnpm", defaultBranch: "main",
  work: "/nonexistent-prepared-checkout", branch: "deps/pnpm-12.3.0",
  spec: {
    transition: { name: "pnpm", from: "12.2.1", to: "12.3.0" },
    workflow: WORKFLOW,
    baseline: { [WORKFLOW]: workflow, "fixture/version": "12.2.1\n" },
    change: { "fixture/version": "12.3.0\n" },
  },
}

test("prepared: explicit files, identical recorder, and staged publication", () => {
  const plan = planPrepared(input)
  assert.equal(plan.scope, "immediate-parent-to-head")
  assert.equal(plan.record, "prepared-workflow")
  assert.match(renderPlan(plan), /identical on commit 2/)
  const ids = plan.steps.map((step) => step.id)
  assert.ok(ids.indexOf("push-first") < ids.indexOf("wait-first-record"))
  assert.ok(ids.indexOf("wait-first-record") < ids.indexOf("push-change"))
  assert.equal(plan.steps.filter((step) => step.writeFileContent?.file.endsWith(WORKFLOW)).length, 1)
  assert.equal(plan.steps.find((step) => step.id === "branch").args.includes("-B"), false)
})

test("prepared: can publish against an existing fork-only base branch", () => {
  const plan = planPrepared({ ...input, baseBranch: "garnet/replay-base" })
  assert.equal(plan.baseRef, "garnet/replay-base")
  assert.equal(plan.steps.find((step) => step.id === "branch").args.at(-1), "origin/garnet/replay-base")
  assert.ok(plan.steps.find((step) => step.id === "verify-commits").args.includes("origin/garnet/replay-base..HEAD"))
  assert.ok(plan.steps.find((step) => step.id === "pr-create").args.includes("garnet/replay-base"))
})

test("prepared: rejects ambiguous states, absent recorders, and path escapes", () => {
  assert.throws(() => planPrepared({ ...input, fork: input.upstream }), /upstream/)
  assert.throws(() => planPrepared({ ...input, branch: "main" }), /feature branch/)
  for (const path of ["../escape", "/absolute", ".git/config", "fixture/../../escape", "a\\b", "-flag", "a\nb"]) {
    assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, baseline: { ...input.spec.baseline, [path]: "x" } } }), /invalid/)
  }
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, change: { "other/file": "x" } } }), /explicit baseline/)
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, change: { "fixture/version": "12.2.1\n" } } }), /empty/)
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, change: { [WORKFLOW]: "changed" } } }), /identical/)
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, baseline: { ...input.spec.baseline, [WORKFLOW]: "name: absent" } } }), /record pull requests/)
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, baseline: { ...input.spec.baseline, [WORKFLOW]: workflow.replace("fixture/**", "other/**") } } }), /none of/)
  const gated = workflow.replace("    runs-on:", "    if: contains(github.event.pull_request.labels.*.name, 'run-install')\n    runs-on:")
  assert.throws(() => planPrepared({ ...input, spec: { ...input.spec, baseline: { ...input.spec.baseline, [WORKFLOW]: gated } } }), /requires --label/)
  assert.doesNotThrow(() => planPrepared({ ...input, label: "run-install", spec: { ...input.spec, baseline: { ...input.spec.baseline, [WORKFLOW]: gated } } }))
})

test("prepared CLI refuses no-wait and competing modes before planning", async () => {
  for (const option of ["--no-wait", "--dependency", "--pr", "--allow-build"]) {
    await assert.rejects(livePr(["pnpm", "--prepared", "unused.json", option, "1"], { exec: () => { throw new Error("unexpected network") } }), /cannot be combined/)
  }
})

test("prepared: actual commits match both states, resume validates, and an absent record stops the head push", async () => {
  const parent = join(homedir(), ".garnet-replay-tests")
  mkdirSync(parent, { recursive: true })
  const work = mkdtempSync(join(parent, "prepared-"))
  const env = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" }
  const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", env })
  const pushes = []
  try {
    git("init", "-q", "-b", "main")
    writeFileSync(join(work, "readme"), "fixture\n")
    git("add", "readme")
    git("commit", "-qm", "chore: initial state")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    const exec = (cmd, args, options = {}) => {
      if (cmd === "gh") {
        if (args[0] === "pr" && args[1] === "list") return "[]"
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/garnet-labs/pnpm/pull/999"
        if (args.some((arg) => arg.includes("check-runs"))) return JSON.stringify({ check_runs: [] })
        if (args.some((arg) => arg.includes("/comments"))) return "[]"
        throw new Error(`unexpected gh ${args}`)
      }
      if (args.includes("get-url")) return "https://github.com/garnet-labs/pnpm.git"
      if (args[2] === "fetch") return ""
      if (args[2] === "push") { pushes.push(args); return "" }
      return execFileSync(cmd, args, { ...options, encoding: "utf8", env })
    }
    const plan = planPrepared({ ...input, work })
    await assert.rejects(executePlan(plan, { exec, log: () => {}, wait: { timeoutMs: 0 } }), /Commit 1 is on the fork/)
    assert.equal(pushes.length, 1)
    assert.ok(pushes[0].some((arg) => arg.startsWith("HEAD~1:")))
    assert.equal(git("rev-list", "--count", "origin/main..HEAD").trim(), "2")
    assert.equal(git("show", "HEAD~1:fixture/version"), "12.2.1\n")
    assert.equal(git("show", "HEAD:fixture/version"), "12.3.0\n")
    const resume = planPrepared({ ...input, work, resume: true }).steps.find((step) => step.kind === "prepared-resume")
    verifyPreparedResume(resume, exec)
    assert.throws(() => verifyPreparedResume({ ...resume, change: { "fixture/version": "12.4.0\n" } }, exec), /differs/)
    const recorded = (cmd, args, options) => {
      if (cmd === "gh" && args.some((arg) => arg.includes("/comments"))) {
        return JSON.stringify([{ user: { login: "garnet-ai[bot]" }, body: `<!-- garnet-runtime-review -->\n<!-- garnet:commit ${git("rev-parse", "HEAD~1").trim()} -->\n<!-- garnet:summary {"status":"finalized"} -->` }])
      }
      return exec(cmd, args, options)
    }
    const completed = await executePlan(planPrepared({ ...input, work, resume: true }), { exec: recorded, log: () => {}, wait: { timeoutMs: 0 } })
    assert.equal(completed.firstRecord.state, "recorded")
    assert.ok(pushes.at(-1).some((arg) => arg.startsWith("HEAD:")))
    symlinkSync(parent, join(work, "link"))
    assert.throws(() => verifyPreparedPaths({ work, paths: ["link/escape"], ref: "HEAD" }, exec), /symlinks/)
    git("add", "link")
    git("commit", "-qm", "chore: extra change")
    assert.throws(() => verifyPreparedResume(resume, exec), /exactly two commits/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
