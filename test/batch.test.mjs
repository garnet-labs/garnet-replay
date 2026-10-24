import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { chosenPr, existingReplay, nextAction, planGroups, renderBoard, runBatch, validateTargets } from "../lib/batch.mjs"

function row(slug, fork, work = `/work/${slug}`) {
  return { slug, upstream: `source/${slug}`, fork, work, validation: null, blocked: null, pr: 1, find: {}, record: null, liveArgs: [] }
}

function runBatchOffline(args, deps = {}) {
  return runBatch(args, {
    probeFork: () => true,
    readForkFreshness: () => ({ forkBehind: 0, forkDefault: "main" }),
    readWorkflowBodies: () => ({}),
    ...deps,
  })
}

async function runBatchWithNewReplay({ target, pr, upstreamPr, forkPr }) {
  const dir = mkdtempSync(join(tmpdir(), "batch-new-replay-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({
    name: "new-replay",
    targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr, work: "/work/alpha" }],
  }))
  let ledger = target
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ledger,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const call = argv.slice(2)
      commands.push(call)
      if (call[0] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (call[0] === "live" && call.includes("--dry-run")) return { code: 0, stdout: "recorder health: ok", stderr: "" }
      if (call[0] === "live") {
        ledger = {
          ...ledger,
          replays: [...(Array.isArray(ledger.replays) ? ledger.replays : []), {
            upstreamPr,
            forkPr,
            state: "pending",
            openedAt: "2026-10-24T12:00:00.000Z",
          }],
        }
        return { code: 0, stdout: "live complete", stderr: "" }
      }
      if (call[0] === "verify") return { code: 0, stdout: JSON.stringify({ status: "PASS", legs: [] }), stderr: "" }
      if (call[0] === "card") return { code: 0, stdout: "card: out/card.md", stderr: "" }
      return { code: 1, stdout: "unexpected batch command", stderr: "" }
    },
  })
  return { board, commands }
}

test("batch state machine orders find, fork, write, refresh, setup, repin, live, verify, card", () => {
  const target = { observations: [], replays: [], workload: null }
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: false, upstreamPr: null, findChecked: false }).stage, "find")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: false }).stage, "fork")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true }).stage, "write")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true }).stage, "refresh")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true }).stage, "setup")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true }).stage, "repin")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true, repinChecked: true }).stage, "live")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true, repinChecked: true, replayDone: true }).stage, "verify")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true, repinChecked: true, replayDone: true, verifyResult: { status: "PASS", legs: [] } }).stage, "card")
  assert.equal(nextAction(row("alpha", "garnet-labs/alpha"), { ledgerExists: true, upstreamPr: 1, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true, repinChecked: true, replayDone: true, verifyResult: { status: "PASS", legs: [] } }).action, "card")
  assert.deepEqual(target.replays, [])
})

test("existingReplay selects the latest replay with a fork PR regardless of state", () => {
  const earlier = { upstreamPr: 18872, forkPr: 25, state: "undeterminable", openedAt: "2026-10-23T11:00:00.000Z" }
  const later = { upstreamPr: 18873, forkPr: 26, state: "fail-specimen", verdict: "FAIL", openedAt: "2026-10-23T12:00:00.000Z" }
  assert.equal(existingReplay({ replays: [later, earlier] }), later)

  const first = { upstreamPr: 18872, forkPr: 25, state: "undeterminable" }
  const last = { upstreamPr: 18873, forkPr: 26, state: "recorded" }
  assert.equal(existingReplay({ replays: [first, last] }), last)
  assert.equal(existingReplay({ replays: [{ upstreamPr: 1, forkPr: "1", state: "pending" }] }), null)
})

test("chosenPr prefers an explicit PR, then the latest existing replay, then observations", () => {
  const target = {
    observations: [
      { upstreamPr: 19000, gap: { total: 100 }, kind: "other", transition: null, paths: [] },
      { upstreamPr: 19001, gap: { total: 50 }, kind: "other", transition: null, paths: [] },
    ],
    replays: [
      { upstreamPr: 17270, forkPr: 10, state: "undeterminable" },
      { upstreamPr: 18873, forkPr: 26, state: "pending", openedAt: "2026-10-23T12:00:00.000Z" },
    ],
    workload: null,
  }
  assert.equal(chosenPr(target, { pr: null }), 18873)
  assert.equal(chosenPr(target, { pr: 20000 }), 20000)

  const withoutReplay = {
    ...target,
    replays: [],
  }
  assert.equal(chosenPr(withoutReplay, { pr: null }), 19000)
})

test("batch resumes undeterminable and failed-specimen replays in real and dry-run modes", async () => {
  for (const replayState of [
    { state: "undeterminable" },
    { state: "fail-specimen", verdict: "FAIL" },
  ]) {
    const target = {
      slug: "alpha",
      setupPr: null,
      record: { mode: "instrument" },
      workload: null,
      observations: [
        { upstreamPr: 19000, gap: { total: 100 }, kind: "other", transition: null, paths: [] },
        { upstreamPr: 19001, gap: { total: 50 }, kind: "other", transition: null, paths: [] },
      ],
      replays: [
        { upstreamPr: 17270, forkPr: 10, state: "undeterminable" },
        { upstreamPr: 18873, forkPr: 26, ...replayState, openedAt: "2026-10-23T12:00:00.000Z" },
      ],
    }

    for (const dryRun of [false, true]) {
      const dir = mkdtempSync(join(tmpdir(), "batch-resume-existing-"))
      const file = join(dir, "targets.json")
      writeFileSync(file, JSON.stringify({
        name: "resume-existing",
        targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: null, work: "/work/alpha" }],
      }))
      const commands = []
      const args = [file, "--out", join(dir, "out")]
      if (dryRun) args.push("--dry-run")
      const board = await runBatchOffline(args, {
        env: { GH_TOKEN: "test-token" },
        exec: (command) => command === "git" ? "sha" : "",
        readLedger: () => target,
        probeWrite: () => ({ ok: true }),
        readForkFreshness: () => ({ forkBehind: 0, forkDefault: "main" }),
        readWorkflowBodies: () => ({}),
        runCommand: async (argv) => {
          const call = argv.slice(2)
          commands.push(call)
          if (call[0] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
          if (call[0] === "verify") return { code: 0, stdout: JSON.stringify({ status: "PASS", legs: [] }), stderr: "" }
          if (call[0] === "card") return { code: 0, stdout: "card: out/card.md", stderr: "" }
          return { code: 1, stdout: "unexpected batch command", stderr: "" }
        },
      })

      assert.equal(board.rows[0].upstreamPr, 18873)
      assert.equal(board.rows[0].state, "pass")
      assert.equal(board.rows[0].replayPr, "https://github.com/garnet-labs/alpha/pull/26")
      assert.deepEqual(commands.find((call) => call[0] === "verify"), ["verify", "https://github.com/garnet-labs/alpha/pull/26", "--json"])
      assert.ok(commands.some((call) => call[0] === "card"))
      assert.equal(commands.some((call) => call[0] === "live" || call[0] === "replay"), false)
    }
  }
})

test("an explicit different PR opens a new replay instead of reusing the latest one", async () => {
  const target = {
    slug: "alpha",
    setupPr: null,
    record: { mode: "instrument" },
    workload: null,
    observations: [],
    replays: [{ upstreamPr: 18873, forkPr: 26, state: "undeterminable", openedAt: "2026-10-23T12:00:00.000Z" }],
  }
  const { board, commands } = await runBatchWithNewReplay({ target, pr: 20000, upstreamPr: 20000, forkPr: 27 })
  const liveCalls = commands.filter((call) => call[0] === "live")
  assert.equal(board.rows[0].upstreamPr, 20000)
  assert.equal(board.rows[0].state, "pass")
  assert.equal(board.rows[0].replayPr, "https://github.com/garnet-labs/alpha/pull/27")
  assert.equal(liveCalls.length, 2)
  assert.ok(liveCalls.every((call) => call[2] === "--pr" && call[3] === "20000"))
  assert.deepEqual(commands.find((call) => call[0] === "verify"), ["verify", "https://github.com/garnet-labs/alpha/pull/27", "--json"])
})

test("an empty replay ledger still runs live for a selected candidate", async () => {
  const target = {
    slug: "alpha",
    setupPr: null,
    record: { mode: "instrument" },
    workload: null,
    observations: [{ upstreamPr: 19000, gap: { total: 100 }, kind: "other", transition: null, paths: [] }],
    replays: [],
  }
  const { board, commands } = await runBatchWithNewReplay({ target, pr: null, upstreamPr: 19000, forkPr: 27 })
  const liveCalls = commands.filter((call) => call[0] === "live")
  assert.equal(board.rows[0].upstreamPr, 19000)
  assert.equal(board.rows[0].state, "pass")
  assert.equal(board.rows[0].replayPr, "https://github.com/garnet-labs/alpha/pull/27")
  assert.equal(liveCalls.length, 2)
  assert.ok(liveCalls.every((call) => call[2] === "--pr" && call[3] === "19000"))
})

test("batch refreshes a stale fork before setup and repins before the live dry-run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-freshness-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "freshness", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const oldPin = "245ad6be82de3200c205109c8ca7ac816dc692ea"
  const board = await runBatchOffline([file, "--out", join(dir, "out"), "--dry-run"], {
    readLedger: () => ({ observations: [], replays: [], setupPr: null, record: { mode: "instrument" } }),
    probeWrite: () => ({ ok: true }),
    readForkFreshness: () => ({ forkBehind: 2, forkDefault: "main" }),
    readWorkflowBodies: () => ({ ".github/workflows/ci.yml": `- uses: garnet-org/action@${oldPin} # v2.3.0` }),
    runCommand: async (argv) => {
      const call = argv.slice(2)
      commands.push(call)
      if (call[0] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (call[0] === "live") return { code: 1, stdout: "recorder health: none", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.deepEqual(commands.map((call) => call[0]), ["refresh", "setup", "repin", "live"])
  assert.deepEqual(commands[0], ["refresh", "alpha", "--dry-run"])
  assert.deepEqual(commands[2], ["repin", "alpha", "--dry-run"])
  assert.equal(board.rows[0].actionPin, "245ad6be (v2.3.0)")
  assert.match(renderBoard(board), /\| action pin \|/)
})

test("batch fails closed when fork freshness is unknown or refresh fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-refresh-failure-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "refresh-failure", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const base = {
    readLedger: () => ({ observations: [], replays: [], setupPr: null, record: { mode: "instrument" } }),
    probeWrite: () => ({ ok: true }),
    runCommand: async () => ({ code: 1, stdout: "", stderr: "refresh failed" }),
  }
  const unknown = await runBatchOffline([file, "--out", join(dir, "unknown-out")], {
    ...base,
    readForkFreshness: () => { throw new Error("compare failed") },
  })
  assert.equal(unknown.rows[0].state, "blocked-infra")
  assert.equal(unknown.rows[0].reason, "fork freshness unknown")
  const failed = await runBatchOffline([file, "--out", join(dir, "failed-out")], {
    ...base,
    readForkFreshness: () => ({ forkBehind: 1, forkDefault: "main" }),
  })
  assert.equal(failed.rows[0].state, "blocked-infra")
  assert.equal(failed.rows[0].reason, "refresh failed")
})

test("batch blocks on failed repin before live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-repin-failure-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "repin-failure", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    readLedger: () => ({ observations: [], replays: [], setupPr: null, record: { mode: "instrument" } }),
    probeWrite: () => ({ ok: true }),
    readForkFreshness: () => ({ forkBehind: 0, forkDefault: "main" }),
    readWorkflowBodies: () => ({ ".github/workflows/ci.yml": "uses: garnet-org/action@old" }),
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(command)
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "repin") return { code: 1, stdout: "", stderr: "push rejected" }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.deepEqual(commands, ["setup", "repin"])
  assert.equal(board.rows[0].state, "blocked-infra")
  assert.equal(board.rows[0].stage, "repin")
  assert.equal(board.rows[0].reason, "push rejected")
})

test("batch repins stale reusable or push workflows but leaves an excluded-only action ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-repin-all-workflows-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "repin-all", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const oldPin = "245ad6be82de3200c205109c8ca7ac816dc692ea"
  const run = async (workflows, outName) => {
    const commands = []
    await runBatchOffline([file, "--out", join(dir, outName), "--dry-run"], {
      readLedger: () => ({ observations: [], replays: [], setupPr: null, record: { mode: "instrument" } }),
      probeWrite: () => ({ ok: true }),
      readForkFreshness: () => ({ forkBehind: 0, forkDefault: "main" }),
      readWorkflowBodies: () => workflows,
      runCommand: async (argv) => {
        const call = argv.slice(2)
        commands.push(call)
        if (call[0] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
        if (call[0] === "live") return { code: 1, stdout: "recorder health: none", stderr: "" }
        return { code: 0, stdout: "", stderr: "" }
      },
    })
    return commands
  }
  const stale = await run({
    ".github/workflows/reusable.yml": `on:\n  workflow_call:\njobs:\n  record:\n    steps:\n      - uses: garnet-org/action@${oldPin}`,
  }, "stale-out")
  assert.ok(stale.some((call) => call[0] === "repin"))
  const excluded = await run({
    ".github/workflows/garnet-dependabot-record.yml": `uses: garnet-org/action@${oldPin}`,
  }, "excluded-out")
  assert.equal(excluded.some((call) => call[0] === "repin"), false)
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
  const tilde = validateTargets({
    name: "home",
    targets: [{ slug: "home", upstream: "source/home", fork: "garnet-labs/home", work: "~/work/home" }],
  })
  assert.equal(tilde.rows[0].work, join(homedir(), "work", "home"))
})

test("write probe 403 blocks before setup/live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "probe", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
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

test("write probe failures without a 403 retain their stderr tail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "probe", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: false, stderr: "temporary network failure" }),
    runCommand: async (argv) => {
      commands.push(argv[2])
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "blocked-infra")
  assert.equal(board.rows[0].reason, "write probe failed for garnet-labs/alpha: temporary network failure")
  assert.deepEqual(commands, [])
})

test("dry-run without an eligible candidate probes fork/write and runs setup dry-run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "empty", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha" }] }))
  let forkProbes = 0
  let writeProbes = 0
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out"), "--dry-run"], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
    probeFork: () => { forkProbes += 1; return true },
    probeWrite: () => { writeProbes += 1; return { ok: true } },
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(command)
      if (command === "setup") {
        assert.ok(argv.includes("--dry-run"))
        assert.ok(argv.includes("--work"))
        return { code: 0, stdout: "nothing to onboard", stderr: "" }
      }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(forkProbes, 1)
  assert.equal(writeProbes, 1)
  assert.deepEqual(commands, ["setup"])
  assert.equal(board.rows[0].state, "needs-find")
  assert.equal(board.rows[0].reason, "find is skipped in dry-run; no eligible candidate in the ledger")
})

test("dry-run no-candidate setup blockers win and real runs still repeat find", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  for (const scenario of [
    { name: "setup-failed", output: { code: 1, stdout: "", stderr: "setup failed" }, expected: "setup-failed" },
    { name: "needs-record-job", output: { code: 0, stdout: "plan recorder changes", stderr: "" }, expected: "needs-record-job" },
  ]) {
    const file = join(dir, `${scenario.name}.json`)
    writeFileSync(file, JSON.stringify({ name: scenario.name, targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha" }] }))
    const board = await runBatchOffline([file, "--out", join(dir, `${scenario.name}-out`), "--dry-run"], {
      env: { GH_TOKEN: "test-token" },
      exec: (command) => command === "git" ? "sha" : "",
      readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
      probeFork: () => true,
      probeWrite: () => ({ ok: true }),
      runCommand: async (argv) => argv[2] === "setup" ? scenario.output : { code: 0, stdout: "", stderr: "" },
    })
    assert.equal(board.rows[0].state, scenario.expected)
  }

  const file = join(dir, "live.json")
  writeFileSync(file, JSON.stringify({ name: "live", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha" }] }))
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "live-out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
    probeFork: () => { throw new Error("no candidate should reach fork") },
    probeWrite: () => { throw new Error("no candidate should reach write") },
    runCommand: async (argv) => {
      commands.push(argv[2])
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.deepEqual(commands, ["find"])
  assert.equal(board.rows[0].state, "no-candidate")
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
  const board = await runBatchOffline([file, "--out", join(dir, "out"), "--concurrency", "1"], {
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
  const board = await runBatchOffline([file, "--out", join(dir, "out"), "--concurrency", "2"], {
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
  const blockedBoard = await runBatchOffline([blockedFile, "--out", join(dir, "blocked-out")], {
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
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
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
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", setupPr: null, observations: [], replays: [{ upstreamPr: 1, forkPr: 3 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(command)
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "verify") return {
        code: 1,
        stdout: JSON.stringify({
          status: "FAIL",
          legs: [
            { name: "comment present", ok: true, detail: "1 Garnet comment" },
            { name: "comment finalized", ok: false, detail: "record still pending" },
          ],
          receipt: { commentPresent: true, pending: true, finalized: false, noProfile: false },
        }),
        stderr: "",
      }
      if (command === "card") throw new Error("card must not run")
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "awaiting-record")
  assert.equal(board.rows[0].verdict, "undeterminable")
  assert.equal(commands.includes("live"), false)
})

test("a final not-recorded receipt is terminal and never awaiting or shareable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "not-recorded", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", setupPr: null, observations: [], replays: [{ upstreamPr: 1, forkPr: 3 }] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(command)
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "verify") return {
        code: 1,
        stdout: JSON.stringify({
          status: "FAIL",
          legs: [
            { name: "comment present", ok: true, detail: "1 Garnet comment" },
            { name: "comment finalized", ok: false, detail: "no machine summary on the record" },
          ],
          receipt: { commentPresent: true, pending: false, finalized: false, noProfile: true },
        }),
        stderr: "",
      }
      if (command === "card") throw new Error("card must not run")
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "not-recorded")
  assert.equal(board.rows[0].verdict, "undeterminable")
  assert.equal(board.rows[0].shareable, false)
  assert.equal(commands.includes("card"), false)
})

test("live dry-run refuses only on the exact allow-pending note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  const target = {
    slug: "alpha",
    upstream: "source/alpha",
    fork: "garnet-labs/alpha",
    pr: 1,
    record: { mode: "instrument", job: "ci.yml/test" },
  }
  writeFileSync(file, JSON.stringify({ name: "live-refusal", targets: [target] }))
  const refusalCommands = []
  const refused = await runBatchOffline([file, "--out", join(dir, "refused")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      refusalCommands.push(argv.slice(2))
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "live") return {
        code: 0,
        stdout: "recorder health: none · no finalized records\nwithout --allow-pending-recorder, the run stops here",
        stderr: "",
      }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(refused.rows[0].state, "live-refused")
  assert.match(refused.rows[0].reason, /recorder health: none/)
  assert.equal(refusalCommands.some((args) => args[0] === "live" && !args.includes("--dry-run")), false)

  const broadText = await runBatchOffline([file, "--out", join(dir, "broad"), "--dry-run"], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({ slug: "alpha", observations: [], replays: [] }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      if (argv[2] === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (argv[2] === "live") return {
        code: 0,
        stdout: "recorder health: none · no finalized records\nplan guard: refused when behind-base; unsupported ecosystem",
        stderr: "",
      }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.notEqual(broadText.rows[0].state, "live-refused")
})

test("a nonzero live result rereads the ledger and verifies a newly opened fork PR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "resume-live", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1 }] }))
  let replayCreated = false
  const commands = []
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
    env: { GH_TOKEN: "test-token" },
    exec: (command) => command === "git" ? "sha" : "",
    readLedger: () => ({
      slug: "alpha",
      observations: [],
      replays: replayCreated ? [{ upstreamPr: 1, forkPr: 9 }] : [],
    }),
    probeFork: () => true,
    probeWrite: () => ({ ok: true }),
    runCommand: async (argv) => {
      const command = argv[2]
      commands.push(argv.slice(2))
      if (command === "setup") return { code: 0, stdout: "nothing to onboard", stderr: "" }
      if (command === "live" && argv.includes("--dry-run")) return { code: 0, stdout: "recorder health: none", stderr: "" }
      if (command === "live") {
        replayCreated = true
        return { code: 1, stdout: "", stderr: "wait timed out after opening pull request" }
      }
      if (command === "verify") return {
        code: 0,
        stdout: JSON.stringify({
          status: "PASS",
          legs: [
            { name: "comment present", ok: true, detail: "1 Garnet comment" },
            { name: "comment finalized", ok: true, detail: "record is final" },
          ],
          receipt: { commentPresent: true, pending: false, finalized: true, noProfile: false },
        }),
        stderr: "",
      }
      if (command === "card") return { code: 0, stdout: "card: out/card.md", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    },
  })
  assert.equal(board.rows[0].state, "pass")
  assert.equal(board.rows[0].replayPr, "https://github.com/garnet-labs/alpha/pull/9")
  assert.ok(commands.some((args) => args[0] === "verify"))
})

test("merged setup PR is rechecked and proceeds when recorder is present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "batch-"))
  const file = join(dir, "targets.json")
  writeFileSync(file, JSON.stringify({ name: "merged", targets: [{ slug: "alpha", upstream: "source/alpha", fork: "garnet-labs/alpha", pr: 1, record: { mode: "instrument", job: ".github/workflows/ci.yml/test" } }] }))
  let setupCalls = 0
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
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
  const board = await runBatchOffline([file, "--out", join(dir, "out")], {
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
  const common = { upstreamPr: 1, ledgerExists: true, forkExists: true, writeProbed: true, refreshChecked: true, setupChecked: true, setupNothing: true, repinChecked: true, replayDone: true }
  const product = nextAction(row("a", "garnet-labs/a"), { ...common, verifyResult: { status: "FAIL", legs: [{ name: "capture completeness", ok: false }] } })
  const specimen = nextAction(row("b", "garnet-labs/b"), { ...common, verifyResult: { status: "FAIL", legs: [{ name: "head-bound", ok: false }] } })
  assert.equal(product.state, "fail-product-gates")
  assert.equal(specimen.state, "fail-specimen")
  assert.notEqual(product.action, "card")
  assert.notEqual(specimen.action, "card")
})

test("board labels verify legs whose names use contract vocabulary", () => {
  const verify = { status: "FAIL", legs: [{ name: "verdict determinable", ok: false }, { name: "head-bound", ok: false }, { name: "label", ok: true }] }
  const board = {
    name: "sample",
    rows: [{ slug: "a", upstream: "source/a", fork: "garnet-labs/a", upstreamPr: 3, onboardingPr: null, replayPr: null, state: "awaiting-record", verify, publicReports: [], outreach: "gated" }],
  }
  const text = renderBoard(board)
  assert.match(text, /\| outcome determinable, head-bound \|/)
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
