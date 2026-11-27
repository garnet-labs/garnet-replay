import test from "node:test"
import assert from "node:assert/strict"
import { ghAsync, githubReadFetch, jobLog } from "../lib/gh.mjs"

const endpoint = "repos/garnet-labs/example/actions/jobs/42/logs"
const refusal = () => Object.assign(new Error("gh api failed"), {
  stderr: Buffer.from("the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway"),
})

test("async gh forwards argv and execution options and returns stdout", async () => {
  const args = ["api", endpoint]
  const stdout = await ghAsync(args, { timeout: 60_000, exec: async (...call) => {
    assert.deepEqual(call, ["gh", args, { timeout: 60_000 }])
    return { stdout: "job log", stderr: "" }
  } })
  assert.equal(stdout, "job log")
})

test("job logs work on old gh without probing an unsupported flag, including empty logs", () => {
  for (const log of ["", "plain log", "\u001b[32mcolored log\u001b[0m"]) {
    const calls = []
    assert.equal(jobLog("garnet-labs/example", 42, { exec: (command, args) => {
      calls.push([command, args])
      if (args.includes("--allow-escape-sequences")) throw new Error("unknown flag: --allow-escape-sequences")
      return log
    } }), log)
    assert.deepEqual(calls, [["gh", ["api", endpoint]]])
  }
})

test("job logs retry the new gh escape refusal without changing log bytes or execution options", () => {
  const calls = []
  const log = "\u001b[36mprofile link\u001b[0m\n"
  const result = jobLog("garnet-labs/example", 42, { timeout: 60000, exec: (command, args, options) => {
    calls.push([command, args, options])
    if (calls.length === 1) throw refusal()
    return log
  } })
  assert.equal(result, log)
  assert.deepEqual(calls, [
    ["gh", ["api", endpoint], { timeout: 60000 }],
    ["gh", ["api", endpoint, "--allow-escape-sequences"], { timeout: 60000 }],
  ])
})

test("job log errors propagate without retrying unrelated failures or hiding fallback failures", () => {
  const denied = Object.assign(new Error("forbidden"), { stderr: "gh: Forbidden (HTTP 403)" })
  let calls = 0
  assert.throws(() => jobLog("garnet-labs/example", 42, { exec: () => { calls += 1; throw denied } }), (error) => error === denied)
  assert.equal(calls, 1)
  const fallback = new Error("network unavailable")
  calls = 0
  assert.throws(() => jobLog("garnet-labs/example", 42, { exec: () => {
    calls += 1
    throw calls === 1 ? refusal() : fallback
  } }), (error) => error === fallback)
  assert.equal(calls, 2)
})

test("GitHub read adapter routes job logs through the escape-safe reader", async () => {
  const calls = []
  const read = githubReadFetch({ exec: (command, args) => {
    calls.push([command, args])
    if (calls.length === 1) throw refusal()
    return "\u001b[32mraw log\u001b[0m"
  } })
  assert.equal(await (await read(`https://api.github.com/${endpoint}`)).text(), "\u001b[32mraw log\u001b[0m")
  assert.deepEqual(calls, [["gh", ["api", endpoint]], ["gh", ["api", endpoint, "--allow-escape-sequences"]]])
})
