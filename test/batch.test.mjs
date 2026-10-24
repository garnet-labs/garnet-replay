import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nextAction, planGroups, renderBoard, runBatch, validateTargets } from "../lib/batch.mjs"

function row(slug, fork, work = `/work/${slug}`) {
  return { slug, upstream: `source/${slug}`, fork, work, validation: null, blocked: null, pr: 1, find: {}, record: null, liveArgs: [] }
}

test("batch state machine orders find, fork, write, setup, live, verify, card", () => {
  const target = { observations: [], replays: [], workload: null }
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: false, upstreamPr: null, findChecked: false }).stage, "find")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: false }).stage, "fork")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true }).stage, "write")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true }).stage, "setup")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, setupChecked: true, setupNothing: true }).stage, "live")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, setupChecked: true, setupNothing: true, replayDone: true }).stage, "verify")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, setupChecked: true, setupNothing: true, replayDone: true, verifyResult: { status: "PASS", legs: [] } }).stage, "card")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, setupChecked: true, setupNothing: true, replayDone: true, verifyResult: { status: "PASS", legs: [] } }).action, "card")
  assert.deepEqual(target.replays, [])
})

test("planGroups serializes same forks and rejects duplicate/shared identities", () => {
  const planned = planGroups([
    row("a", "garnet-labs/shared", "/work/a"),
    row("b", "garnet-labs/shared", "/work/b"),
    row("c", "garnet-labs/other", "/work/a"),
    row("d", "garnet-labs/third", "/work/d"),
    row("d", "garnet-labs/fourth", "/work/e"),
  ])
  assert.equal(planned.groups.length, 1)
  assert.ok(planned.rejected.some((candidate) => candidate.validation === "duplicate-slug"))
  assert.equal(planned.rejected.filter((candidate) => candidate.validation === "shared-checkout").length, 2)
})

test("targets validate fork ownership and preserve blocked rows", () => {
  const result = validateTargets({
    name: "sample",
    targets: [
      { slug: "ok", upstream: "source/ok", fork: "garnet-labs/ok" },
      { slug: "bad-fork", upstream: "source/bad", fork: "other/bad" },
      { slug: "blocked", upstream: null, blocked: "no source" },
    ],
  })
  assert.equal(result.rows[0].validation, null)
  assert.match(result.rows[1].validation, /garnet-labs/)
  assert.equal(result.rows[2].blocked, "no source")
})

test("write probe 403 blocks before setup/live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "probe", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatch([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [{ upstreamPr: 1, gap: { total: 1 }, kind: "dependency", transition: null, paths: [] }], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: false, stderr: "HTTP 403" }),
    runCommand: async (argv) => {
      commands.push(argv[2])
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "blocked-infra")
  assert.match(board.rows[0].reason, /no push access/)
  assert.deepEqual(commands, [])
})

test("two consecutive identical infra blockers stop later targets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({
    name: "stop",
    targets: [
      { slug: "a", upstream: "source/a", fork: "garnet-labs/a", pr: 1 },
      { slug: "b", upstream: "source/b", fork: "garnet-labs/b", pr: 1 },
      { slug: "c", upstream: "source/c", fork: "garnet-labs/c", pr: 1 },
    ],
  }))
  const commands = []
  const board = await runBatch([file, "--out", join(dir, "out"), "--concurrency", "1"], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: (slug) => ({ slug, observations: [], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: false, stderr: "HTTP 403" }),
    runCommand: async (argv) => {
      commands.push(argv[2])
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.deepEqual(commands, [])
  assert.equal(board.rows.filter((row) => row.state === "blocked-infra").length, 2)
  assert.equal(board.rows.find((row) => row.slug === "c").state, "not-started")
  assert.match(board.rows.find((row) => row.slug === "c").reason, /stopped: repeated infra blocker no push access/)
})

test("same-fork targets serialize while different forks overlap at concurrency two", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({
    name: "parallel",
    targets: [
      { slug: "a", upstream: "source/a", fork: "garnet-labs/shared", pr: 1 },
      { slug: "b", upstream: "source/b", fork: "garnet-labs/shared", pr: 1 },
      { slug: "c", upstream: "source/c", fork: "garnet-labs/other", pr: 1 },
    ],
  }))
  const activeByFork = new Map()
  let active = 0
  let peak = 0
  let sameForkOverlap = false
  const board = await runBatch([file, "--out", join(dir, "out"), "--concurrency", "2"], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: (slug) => ({ slug, observations: [], replays: [{ upstreamPr: 1, forkPr: 5 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      if (command === "setup") {
        const slug = argv[3]
        const fork = slug === "c" ? "other" : "shared"
        const forkActive = activeByFork.get(fork) ?? 0
        if (forkActive > 0) sameForkOverlap = true
        activeByFork.set(fork, forkActive + 1)
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 15))
        active -= 1
        activeByFork.set(fork, activeByFork.get(fork) - 1)
        return { code: 0, stdout: "nothing to onboard", stderr: "" }
      }
      if (command === "verify") return { code: 0, stdout: JSON.stringify({ status: "PASS", legs: [] }), stderr: "" }
      if (command === "card") return { code: 0, stdout: "card: out/card.md", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(sameForkOverlap, false)
  assert.ok(peak >= 2)
  assert.equal(board.rows.filter((row) => row.state === "pass").length, 3)
})

test("blocked target never launches a child; one target error does not stop another", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const blockedFile = join(dir, "blocked.json")
  writeFileSync(blockedFile, JSON.stringify({ name: "blocked", targets: [{ slug: "blocked", upstream: null, blocked: "no source" }] }))
  let blockedCalls = 0
  const blockedBoard = await runBatch([blockedFile, "--out", join(dir, "blocked-out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    runCommand: async () => { blockedCalls += 1; return { code: 0, stdout: "", stderr: "" } },
  })
  assert.equal(blockedCalls, 0)
  assert.equal(blockedBoard.rows[0].state, "blocked")

  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "errors", targets: [
    { slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 },
    { slug: "beta", upstream: "source/beta", fork: "garnet-labs/beta", pr: 1 },
  ] }))
  const board = await runBatch([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: (slug) => ({ slug, observations: [], replays: [{ upstreamPr: 1, forkPr: 5 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      if (argv[2] === "setup" && argv[3] === "alpha") throw new Error("target-specific failure")
      if (argv[2] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (argv[2] === "verify") return { code: 0, stdout: JSON.stringify({ status: "PASS", legs: [] }), stderr: "" }
      return { code: 0, stdout: "card: out/card.md", stderr: "" }
    },
  })
  assert.equal(board.rows.find((row) => row.slug === "alpha").state, "error")
  assert.equal(board.rows.find((row) => row.slug === "beta").state, "pass")
})

test("pending verification awaits a record and keeps an undeterminable verdict", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "pending", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatch([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", setupPr: null, observations: [], replays: [{ upstreamPr: 1, forkPr: 3 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(command)
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "verify") return { code: 1, stdout: JSON.stringify({ status: "FAIL", legs: [{ name: "comment present", ok: false, detail: "no record" }] }), stderr: "" }
      if (command === "card") throw new Error("card must not run")
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "awaiting-record")
  assert.equal(board.rows[0].verdict, "undeterminable")
  assert.equal(commands.includes("live"), false)
})

test("merged setup PR is rechecked and proceeds when recorder is present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "merged", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1, record: { mode: "instrument", job: ".github/workflows/ci.yml/test" } }] }))
  let setupCalls = 0
  const board = await runBatch([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command, args) => {
      if (command === "git") return "sha"
      if (command === "gh" && args[0] === "api") return JSON.stringify({ state: "closed", merged: true })
      return ""
    },
    readLedger: () => ({ slug: "alpha", setupPr: 5, record: { mode: "instrument", job: ".github/workflows/ci.yml/test" }, observations: [], replays: [{ upstreamPr: 1, forkPr: 9 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      if (argv[2] === "setup") {
        setupCalls += 1
        return { code: 0, stdout: setupCalls === 1 ? "plan changes" : "nothing to onboard", stderr: "" }
      }
      if (argv[2] === "verify") return { code: 0, stdout: JSON.stringify({ status: "PASS", legs: [] }), stderr: "" }
      if (argv[2] === "card") return { code: 0, stdout: "wrote out/card.md", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(setupCalls, 2)
  assert.equal(board.rows[0].state, "pass")
  assert.equal(board.rows[0].replayPr, "https://github.com/garnet-labs/alpha/pull/9")
})

test("open onboarding PR ends the target before live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "open", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1, record: { mode: "instrument", job: ".github/workflows/ci.yml/test" } }] }))
  const commands = []
  const board = await runBatch([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : JSON.stringify({ state: "open", merged: false }),
    readLedger: () => ({ slug: "alpha", setupPr: 7, record: { mode: "instrument", job: ".github/workflows/ci.yml/test" }, observations: [], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      commands.push(argv[2])
      return { code: 0, stdout: "setup plan", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "awaiting-onboarding-merge")
  assert.deepEqual(commands, ["setup"])
})

test("known product and specimen failures are not shareable and skip cards", () => {
  const common = { upstreamPr: 1, ledgerExists: true, forkExists: true, writeProbed: true, setupChecked: true, setupNothing: true, replayDone: true }
  const product = nextAction(row("a", "garnet-labs/a"), { ...common, verifyResult: { status: "FAIL", legs: [{ name: "capture completeness", ok: false }] } })
  const specimen = nextAction(row("b", "garnet-labs/b"), { ...common, verifyResult: { status: "FAIL", legs: [{ name: "head-bound", ok: false }] } })
  assert.equal(product.state, "fail-product-gates")
  assert.equal(specimen.state, "fail-specimen")
  assert.notEqual(product.action, "card")
  assert.notEqual(specimen.action, "card")
})

test("board guard rejects upstream URLs and qualified upstream issue references", () => {
  const board = {
    name: "sample",
    rows: [{ slug: "a", upstream: "source/a", fork: "garnet-labs/a", upstreamPr: 3, onboardingPr: null, replayPr: null, state: "blocked", verify: null, publicReports: [], outreach: "gated" }],
  }
  assert.doesNotThrow(() => renderBoard(board))
  assert.throws(() => renderBoard({ ...board, rows: [{ ...board.rows[0], publicReports: ["https://github.com/source/a/pull/3"] }] }), /upstream leak/)
  assert.throws(() => renderBoard({ ...board, rows: [{ ...board.rows[0], fork: "source/a#3" }] }), /upstream leak|issue/)
})
