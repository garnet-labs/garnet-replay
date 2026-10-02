import assert from "node:assert/strict"
import test from "node:test"
import { mergeDecision } from "../lib/auto-merge.mjs"
import { main } from "../bin/auto-merge.mjs"
import { checkRuns, commitStatuses, mergePr, pullsForCommit, unresolvedReviewThreadCount, viewPr } from "../lib/gh.mjs"

const readyPr = (overrides = {}) => ({
  number: 48,
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "devin/auto-merge",
  headRefOid: "a".repeat(40),
  isCrossRepository: false,
  mergeable: "MERGEABLE",
  labels: [],
  ...overrides,
})

const passingRuns = [
  { name: "test", status: "completed", conclusion: "success" },
  { name: "optional", status: "completed", conclusion: "neutral" },
  { name: "docs", status: "completed", conclusion: "skipped" },
]

const decision = (overrides = {}) => mergeDecision({
  pr: readyPr(),
  checkRuns: passingRuns,
  statuses: [],
  unresolvedThreads: 0,
  ...overrides,
})

test("ready pull request with green checks and no unresolved threads merges", () => {
  assert.equal(decision().action, "merge")
})

test("closed pull request is skipped", () => {
  assert.equal(decision({ pr: readyPr({ state: "CLOSED" }) }).action, "skip")
})

test("draft pull request is skipped", () => {
  assert.equal(decision({ pr: readyPr({ isDraft: true }) }).action, "skip")
})

test("non-devin head branch is skipped", () => {
  assert.equal(decision({ pr: readyPr({ headRefName: "feature/change" }) }).action, "skip")
})

test("cross-repository pull request is skipped", () => {
  assert.equal(decision({ pr: readyPr({ isCrossRepository: true }) }).action, "skip")
})

test("pull request targeting a branch other than main is skipped", () => {
  assert.equal(decision({ pr: readyPr({ baseRefName: "release" }) }).action, "skip")
})

test("hold label skips the pull request", () => {
  assert.equal(decision({ pr: readyPr({ labels: [{ name: "hold" }] }) }).action, "skip")
})

test("conflicting pull request is skipped", () => {
  assert.equal(decision({ pr: readyPr({ mergeable: "CONFLICTING" }) }).action, "skip")
})

test("failed completed check skips the pull request and names the check", () => {
  const result = decision({ checkRuns: [...passingRuns, { name: "lint", status: "completed", conclusion: "failure" }] })
  assert.equal(result.action, "skip")
  assert.match(result.reason, /lint/)
})

test("incomplete check makes the decision wait", () => {
  assert.equal(decision({ checkRuns: [...passingRuns, { name: "lint", status: "in_progress", conclusion: null }] }).action, "wait")
})

test("pending auto-merge check does not block a ready pull request", () => {
  assert.equal(decision({
    checkRuns: [...passingRuns, { name: "auto-merge", status: "in_progress", conclusion: null }],
  }).action, "merge")
})

test("missing successful test check makes the decision wait", () => {
  assert.equal(decision({
    checkRuns: [{ name: "lint", status: "completed", conclusion: "success" }],
  }).action, "wait")
})

test("pending latest commit status makes the decision wait", () => {
  assert.equal(decision({ statuses: [{ context: "deploy", state: "pending" }] }).action, "wait")
})

test("error latest commit status skips the pull request", () => {
  assert.equal(decision({ statuses: [{ context: "deploy", state: "error" }] }).action, "skip")
})

test("only the latest commit status for each context is considered", () => {
  assert.equal(decision({
    statuses: [
      { context: "ci", state: "failure", updated_at: "2026-01-01T00:00:00Z" },
      { context: "ci", state: "success", updated_at: "2026-01-02T00:00:00Z" },
    ],
  }).action, "merge")
  assert.equal(decision({
    statuses: [
      { context: "ci", state: "success", updated_at: "2026-01-01T00:00:00Z" },
      { context: "ci", state: "failure", updated_at: "2026-01-02T00:00:00Z" },
    ],
  }).action, "skip")
})

test("unresolved review threads skip the pull request", () => {
  assert.equal(decision({ unresolvedThreads: 1 }).action, "skip")
})

test("the reason names the first blocker", () => {
  const result = decision({
    pr: readyPr({ isDraft: true }),
    checkRuns: [{ name: "lint", status: "completed", conclusion: "failure" }],
    unresolvedThreads: 1,
  })
  assert.equal(result.action, "skip")
  assert.match(result.reason, /draft/)
})

test("commitStatuses returns the status list from the commit API", () => {
  let args
  const statuses = [{ context: "ci", state: "success" }]
  const result = commitStatuses("owner/repo", "abc", {
    exec: (_command, receivedArgs) => {
      args = receivedArgs
      return JSON.stringify({ statuses })
    },
  })
  assert.deepEqual(result, statuses)
  assert.deepEqual(args, ["api", "repos/owner/repo/commits/abc/status"])
})

test("unresolvedReviewThreadCount counts unresolved GraphQL threads", () => {
  let args
  const result = unresolvedReviewThreadCount("owner/repo", 48, {
    exec: (_command, receivedArgs) => {
      args = receivedArgs
      return JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] } } } },
      })
    },
  })
  assert.equal(result, 1)
  assert.ok(args.includes("-f"))
  assert.ok(args.some((arg) => arg.includes("reviewThreads(first:100)")))
  assert.ok(args.includes("-F"))
  assert.ok(args.includes("number=48"))
})

test("pullsForCommit returns only open pulls across paginated results", () => {
  let args
  const result = pullsForCommit("owner/repo", "abc", {
    exec: (_command, receivedArgs) => {
      args = receivedArgs
      return JSON.stringify([
        [{ number: 1, state: "open" }, { number: 2, state: "closed" }],
        [{ number: 3, state: "open" }],
      ])
    },
  })
  assert.deepEqual(result.map((pull) => pull.number), [1, 3])
  assert.ok(args.includes("--paginate"))
  assert.ok(args.includes("--slurp"))
})

test("mergePr uses the squash merge command with a head SHA guard", () => {
  let command
  let args
  const result = mergePr("owner/repo", 48, "abc", {
    exec: (receivedCommand, receivedArgs) => {
      command = receivedCommand
      args = receivedArgs
      return "merged"
    },
  })
  assert.equal(result, "merged")
  assert.equal(command, "gh")
  assert.deepEqual(args, ["pr", "merge", "48", "--repo", "owner/repo", "--squash", "--match-head-commit", "abc"])
})

test("viewPr requests the auto-merge pull request fields", () => {
  let args
  viewPr("owner/repo", 48, {
    exec: (_command, receivedArgs) => {
      args = receivedArgs
      return JSON.stringify({})
    },
  })
  assert.ok(args.at(-1).includes("isCrossRepository,mergeable,labels"))
})

test("checkRuns returns paginated check-run objects", () => {
  const runs = [{ name: "test", status: "completed", conclusion: "success" }]
  const result = checkRuns("owner/repo", "abc", {
    exec: () => JSON.stringify([{ check_runs: runs }]),
  })
  assert.deepEqual(result, runs)
})

test("CLI dry run prints its decision without calling merge", () => {
  const output = []
  const errors = []
  const commands = []
  const pr = readyPr()
  const result = main(["--repo", "owner/repo", "--pr", "48", "--dry-run"], {
    stdout: { write: (value) => output.push(value) },
    stderr: { write: (value) => errors.push(value) },
    exec: (command, args) => {
      commands.push(args)
      if (args[0] === "pr" && args[1] === "view") return JSON.stringify(pr)
      if (args[0] === "api" && args[1] === "--paginate") return JSON.stringify([{ check_runs: passingRuns }])
      if (args[0] === "api" && args[1].endsWith("/status")) return JSON.stringify({ statuses: [] })
      if (args[0] === "api" && args[1] === "graphql") {
        return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`)
    },
  })
  assert.equal(result, 0)
  assert.deepEqual(output, [
    "#48 merge: checks and statuses are settled, test succeeded, and no review threads are unresolved\n",
  ])
  assert.deepEqual(errors, [])
  assert.equal(commands.some((args) => args[0] === "pr" && args[1] === "merge"), false)
})
