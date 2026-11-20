import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertHostedRecorder, assertReplayChanges, checkReplayBudget, rateBudget } from "../lib/replay-preflight.mjs"
import { executeReplayJob, retryingReplayExec } from "../lib/replay-runner-worker.mjs"
import { planSignature } from "../lib/replay-runner.mjs"
import { assertReplayAdmission } from "../lib/replay-pr.mjs"

const NOW = 1700000000000
const RATE = { remaining: 5000, reset: NOW / 1000 + 30 }
const PLAN = { fork: "garnet-labs/example", upstream: "source/example", branch: "change", baseBranch: null, singleCommit: true, forkDefaultSha: "base", baseSha: "before", headSha: "head", paths: ["file"], steps: [] }

function treeExec(equal = false) {
  return function execute(command, args) {
    assert.equal(command, "gh")
    assert.equal(args[0], "api")
    assert.match(args[1], /\/git\/trees\//)
    return JSON.stringify({ tree: [{ path: "file", type: "blob", mode: "100644", sha: args[1].endsWith("head") && !equal ? "new" : "old" }] })
  }
}

test("budget pass, long/expired reset refusal and malformed responses", async () => {
  assert.equal(rateBudget(RATE, NOW).wait, 0)
  assert.equal(rateBudget({ ...RATE, remaining: 199 }, NOW).wait, 30000)
  for (const reset of [NOW / 1000 - 1, NOW / 1000 + 61]) {
    assert.throws(() => rateBudget({ remaining: 0, reset }, NOW), { reason: "RATE_LIMIT_LOW" })
  }
  for (const rate of [null, {}, { remaining: -1, reset: 1 }, { remaining: 500, reset: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => rateBudget(rate, NOW), { reason: "RATE_LIMIT_UNREADABLE" })
  }
  await assert.rejects(checkReplayBudget({ exec: () => { throw new Error("HTTP 403") } }), { reason: "RATE_LIMIT_UNREADABLE" })
})

test("short reset waits once, logs and rechecks; still-low budget refuses", async () => {
  for (const recovered of [true, false]) {
    let calls = 0
    const waits = []
    const logs = []
    const work = checkReplayBudget({
      exec: () => JSON.stringify({ resources: { core: { ...RATE, remaining: ++calls === 2 && recovered ? 500 : 0 } } }),
      now: () => NOW, sleep: async (ms) => waits.push(ms), log: (line) => logs.push(line),
    })
    if (recovered) await work
    else await assert.rejects(work, { reason: "RATE_LIMIT_LOW" })
    assert.deepEqual(waits, [30000])
    assert.equal(calls, 2)
    assert.match(logs[0], /waiting.*checking once more/)
  }
})

test("recorder admission refuses none/stalled even for a single commit", () => {
  for (const verdict of ["none", "stalled"]) assert.throws(() => assertHostedRecorder({ verdict, line: `recorder health: ${verdict}` }), { reason: "RECORDER_UNHEALTHY" })
  for (const verdict of ["ok", "unknown"]) assertHostedRecorder({ verdict })
  assertHostedRecorder(null)
})

test("change preflight passes changed blobs and refuses empty with existing fork PR", () => {
  assertReplayChanges(PLAN, { exec: treeExec() })
  assert.throws(() => assertReplayChanges(PLAN, { exec: treeExec(true), prs: [{ headRefName: "change", url: "https://github.com/garnet-labs/example/pull/3" }] }), (error) => error.reason === "CHANGE_ALREADY_PRESENT" && /pull\/3/.test(error.message))
  assert.throws(() => assertReplayChanges(PLAN, { exec: treeExec(true) }), (error) => error.reason === "CHANGE_ALREADY_PRESENT" && /\/tree\/change/.test(error.message))
  for (const value of [{ tree: [], truncated: true }, {}, { tree: [{ path: "file" }] }]) {
    assert.throws(() => assertReplayChanges(PLAN, { exec: () => JSON.stringify(value) }), { reason: "CHANGE_UNREADABLE" })
  }
  assert.throws(() => assertReplayChanges(PLAN, { exec: () => { throw new Error("HTTP 403") } }), { reason: "CHANGE_UNREADABLE" })
  assert.throws(() => assertReplayChanges({ ...PLAN, paths: [] }), { reason: "CHANGE_UNREADABLE" })
})

test("change preflight includes renamed/removed paths, nested trees and file modes", () => {
  const plan = { ...PLAN, paths: ["dir/new"], steps: [{ id: "change-remove", args: ["-C", "work", "rm", "--", "old"] }] }
  const calls = []
  assertReplayChanges(plan, { exec: (_command, args) => {
    const endpoint = args[1]
    calls.push(endpoint)
    const tree = endpoint.endsWith("nested") ? [{ path: "new", type: "blob", mode: "100644", sha: "same" }] : [
      { path: "dir", type: "tree", mode: "040000", sha: "nested" },
      ...(endpoint.endsWith("base") ? [{ path: "old", type: "blob", mode: "100644", sha: "old" }] : []),
    ]
    return JSON.stringify({ tree })
  } })
  assert.ok(calls.some((path) => path.endsWith("nested")))
  assertReplayChanges(PLAN, { exec: (_command, args) => JSON.stringify({ tree: [{ path: "file", type: "blob", mode: args[1].endsWith("head") ? "100755" : "100644", sha: "same" }] }) })
})

test("base-branch and two-commit checks compare with source base, before ensure-base", () => {
  for (const plan of [{ ...PLAN, baseBranch: "other" }, { ...PLAN, singleCommit: false }, { ...PLAN, syncFork: true }]) {
    const calls = []
    assertReplayChanges(plan, { exec: (cmd, args) => { calls.push(args[1]); return treeExec()(cmd, args) } })
    assert.equal(calls[0], "repos/source/example/git/trees/before")
  }
})

test("git timeouts retry at bounded logged backoffs; ordinary failures/commits never retry", () => {
  for (const recovered of [true, false]) {
    let calls = 0
    const waits = []
    const logs = []
    const execute = retryingReplayExec(() => {
      calls += 1
      if (recovered && calls === 3) return "ok"
      throw Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" })
    }, (line) => logs.push(line), { sleep: (ms) => waits.push(ms) })
    if (recovered) assert.equal(execute("git", ["-C", "work", "fetch", "origin"]), "ok")
    else assert.throws(() => execute("git", ["fetch", "origin"]), /ETIMEDOUT/)
    assert.equal(calls, 3)
    assert.deepEqual(waits, [1000, 2000])
    assert.equal(logs.length, 2)
  }
  for (const [command, args, code] of [["git", ["commit"], "ETIMEDOUT"], ["gh", ["api"], "ETIMEDOUT"], ["git", ["fetch"], "EACCES"]]) {
    let calls = 0
    const execute = retryingReplayExec(() => { calls += 1; throw Object.assign(new Error("failed"), { code }) }, () => {}, { sleep: () => assert.fail("must not wait") })
    assert.throws(() => execute(command, args), /failed/)
    assert.equal(calls, 1)
  }
})

test("clone retry cleans only its own partial clone, never an existing checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-retry-"))
  const path = join(root, "clone")
  try {
    let calls = 0
    const execute = retryingReplayExec(() => {
      calls += 1
      assert.equal(existsSync(path), false)
      mkdirSync(path)
      if (calls === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
      return "cloned"
    }, () => {}, { sleep: () => {} })
    assert.equal(execute("git", ["clone", "fork", path]), "cloned")
    assert.equal(calls, 2)
    const existing = retryingReplayExec(() => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) }, () => {}, { sleep: () => assert.fail("must not retry") })
    assert.throws(() => existing("git", ["clone", "fork", path]), /timeout/)
    assert.equal(existsSync(path), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("existing duplicate admission retains fork PR/branch and a named refusal", () => {
  assert.throws(() => assertReplayAdmission({ replays: [{ upstreamPr: 1, forkPr: 3 }] }, { ...PLAN, upstreamPr: 1 }, {
    openPrs: [{ number: 3, headRefName: "other", url: "https://github.com/garnet-labs/example/pull/3", title: "old", body: "old" }],
  }), (error) => error.reason === "DUPLICATE_REPLAY" && /pull\/3.*other/.test(error.message))
})

test("offline hosted prepare exercises budget and preflight with no writes; start refuses before write", async () => {
  const lines = []
  let writes = 0
  const seams = {
    execute: (command, args) => args[1] === "rate_limit" ? JSON.stringify({ resources: { core: RATE } }) : treeExec()(command, args),
    live: async (args, options) => {
      options.preflight(PLAN, { verdict: "ok" }, [])
      if (!args.includes("--dry-run")) { options.beforeExecute(PLAN); writes += 1 }
      return { plan: PLAN }
    }, progress: (delta) => lines.push(delta.line),
  }
  const prepared = await executeReplayJob({ action: "prepare", slug: "example", number: 1 }, seams)
  assert.equal(prepared.state, "prepared")
  assert.equal(prepared.signature, planSignature(PLAN))
  assert.equal(writes, 0)
  assert.ok(lines.some((line) => /no fork writes performed/.test(line)))
  await assert.rejects(executeReplayJob({ action: "start", slug: "example", number: 1, signature: prepared.signature }, {
    ...seams, execute: (command, args) => args[1] === "rate_limit" ? JSON.stringify({ resources: { core: RATE } }) : treeExec(true)(command, args),
  }), { reason: "CHANGE_ALREADY_PRESENT" })
  assert.equal(writes, 0)
})
