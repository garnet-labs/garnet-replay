import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { parseReplayInput, replayContext, replayShareStatus } from "../public/pr-route.mjs"
import { renderLanding, renderReplayPending } from "../public/replay-page.mjs"
import { readReplayRequest } from "../lib/replay-request.mjs"
import { createWorkspaceServer } from "../lib/workspace-server.mjs"
import { workspaceRecord } from "../lib/workspace.mjs"
import { assertPreparedPlan, createReplayRunner, planSignature, recoverReplayJob } from "../lib/replay-runner.mjs"
import { executeReplayJob } from "../lib/replay-runner-worker.mjs"

const root = new URL("../public/", import.meta.url).pathname
const targetsDir = new URL("../targets/", import.meta.url).pathname
const fixture = JSON.parse(await readFile(new URL("../public/replays/github/garnet-labs/posthog/139.json", import.meta.url), "utf8"))
const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
const target = JSON.parse(await readFile(new URL("../targets/uv.json", import.meta.url), "utf8"))

test("workspace findings distinguish workload from background using rendered observations", () => {
  const diff = structuredClone(fixture)
  diff.execution_diff.totals.runner_background.added = 999
  const record = workspaceRecord(diff, null)
  assert.equal(record.reasons[0], "Recorded observations · workload: +0 / −0 · runner background: +3 / −1")
  assert.deepEqual(record.artifact.verdict.reasons, fixture.verdict.reasons)
  diff.capture.status = "partial"
  const partial = workspaceRecord(diff, null)
  assert.equal(partial.verdict, "undeterminable")
  assert.equal(partial.reasons[0], "Capture is partial.")
  assert.ok(partial.reasons.includes(record.reasons[0]))
})

test("host replacement normalizes PR paths while rejecting foreign hosts and unsafe identities", () => {
  for (const value of [
    "https://github.com/astral-sh/uv/pull/21570?diff=split#discussion",
    "github.com/astral-sh/uv/pull/21570/files",
    "/astral-sh/uv/pull/21570/",
    "astral-sh/uv/pull/21570",
    "astral-sh/uv#21570",
    "https://replay.example/astral-sh/uv/pull/21570",
  ]) {
    assert.deepEqual(parseReplayInput(value, "https://replay.example"), {
      repository: "astral-sh/uv", number: 21570, path: "/astral-sh/uv/pull/21570", url: "https://github.com/astral-sh/uv/pull/21570",
    })
  }
  for (const value of [
    "https://evil.example/a/b/pull/1", "https://github.com.evil.test/a/b/pull/1",
    "https://token@github.com/a/b/pull/1", "http://github.com/a/b/pull/1",
    "//evil.test/a/b/pull/1", "javascript:alert(1)", "a/b#0",
    "/a/b/pull/9007199254740992", "/a/b/pull/1/extra", "/a/b/issues/1",
    "/%2e%2e/b/pull/1", "/ignore/../a/b/pull/1", "/a/b\\c/pull/1", "/a/b/pull/1\n--flag",
  ]) assert.equal(parseReplayInput(value, "https://replay.example"), null, value)
})

test("upstream URLs bind only to the ledger's fork PR and exact saved head", () => {
  const record = { id: "uv-4", url: "https://github.com/garnet-labs/uv/pull/4", head: target.replays[0].forkHeadSha }
  const catalog = { targets: [target], records: [record] }
  const match = replayContext(parseReplayInput("astral-sh/uv#21570"), catalog)
  assert.equal(match.record, record)
  assert.equal(match.evidenceUrl, record.url)
  assert.equal(match.canPrepare, true)
  assert.equal(match.stale, false)
  assert.equal(replayContext(parseReplayInput("astral-sh/uv#4"), catalog).record, null)
  assert.equal(replayContext(parseReplayInput("garnet-labs/uv#4"), catalog).canPrepare, false)
  assert.equal(replayContext(parseReplayInput("other/uv#4"), catalog).target, null)
  assert.equal(replayContext(parseReplayInput("astral-sh/uv#21570"), { ...catalog, records: [{ ...record, head: "old" }] }).stale, true)
})

test("a completed share gate is displayed only for the verified fork and head", () => {
  const record = { head: "b".repeat(40), url: "https://github.com/garnet-labs/uv/pull/4" }
  const job = { state: "complete", forkUrl: record.url, verification: { status: "PASS", head: record.head }, updatedAt: "2026-09-11T16:00:00Z" }
  assert.equal(replayShareStatus(record, job), "Share gate passed for this head · 2026-09-11T16:00:00Z")
  for (const other of [
    undefined, { ...job, state: "verifying" }, { ...job, forkUrl: "https://github.com/garnet-labs/uv/pull/5" },
    { ...job, verification: { status: "FAIL", head: record.head } },
    { ...job, verification: { status: "PASS", head: "c".repeat(40) } },
  ]) assert.equal(replayShareStatus(record, other), "Share verification not checked")
})

test("a fresh GitHub lookup retains pending and stale receipt states", async () => {
  const base = {
    pr_number: 42, url: "https://github.com/a/b/pull/42", title: "Change", state: "open",
    files: [{ filename: "pnpm-lock.yaml" }], head_sha: "b".repeat(40), base_sha: "a".repeat(40),
    garnet_summary: null, garnet_comment_body: null,
  }
  for (const [fields, state] of [
    [{ garnet_comment_present: false }, "no-record"],
    [{ garnet_comment_present: true, garnet_exact_head: false }, "stale-record"],
    [{ garnet_comment_present: true, garnet_exact_head: true }, "pending"],
  ]) {
    const result = await readReplayRequest(base.url, { read: async () => ({ ...base, ...fields }), exec: () => "" })
    assert.equal(result.state, state)
    assert.equal(result.record, null)
    assert.equal(result.metadata.ecosystem, "pnpm")
    assert.equal(result.metadata.head, base.head_sha)
  }
})

test("the landing opens PR routes; missing evidence exposes a next action without claiming a run", () => {
  const record = workspaceRecord(fixture, "record")
  const html = renderLanding({ records: [record] }, "https://replay.example")
  assert.ok(html.includes('href="/garnet-labs/posthog/pull/139"'))
  assert.ok(html.includes('data-pr-form'))
  assert.ok(html.includes("replay.example"))
  assert.ok(!html.includes("#record="))
  const pending = renderReplayPending({
    pr: parseReplayInput("astral-sh/uv#123"), target, canPrepare: true, state: "no-record", title: "<script>unsafe</script>",
  })
  assert.ok(pending.includes('id="prepare-pr"'))
  assert.ok(pending.includes("&lt;script&gt;unsafe&lt;/script&gt;"))
  assert.ok(!pending.includes('id="start-pr"'))
  assert.ok(!pending.includes("Replay verified"))
})

test("direct PR routes, saved and live APIs, method guards and origin checks work together", async (t) => {
  const reads = []
  let prepares = 0
  const server = createWorkspaceServer({
    root, targetsDir, schema, origin: "https://replay.example",
    readReplay: async (url) => {
      reads.push(url)
      return { state: "pending", record: null, metadata: { title: "Current PR", head: "a".repeat(40) }, checkedAt: "2026-09-11T00:00:00Z" }
    },
    runner: { enabled: false, forPr: () => null, get: () => null, prepare: async () => { prepares++; return { id: "job" } } },
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const path = "/api/replay?url=https://github.com/garnet-labs/posthog/pull/139"
  const saved = await (await fetch(origin + path)).json()
  assert.equal(saved.source, "saved")
  assert.equal(saved.recordId, "replays/github/garnet-labs/posthog/139.json")
  assert.equal(reads.length, 0)
  const live = await (await fetch(origin + path + "&refresh=1")).json()
  assert.equal(live.source, "github")
  assert.equal(live.state, "pending")
  assert.equal(reads.length, 1)
  for (const path of ["/garnet-labs/posthog/pull/139", "/astral-sh/uv/pull/21570", "/workspace"]) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 200)
    assert.ok((await response.text()).includes('src="/workspace.mjs"'))
  }
  assert.equal((await fetch(`${origin}/api/replay?url=https://evil.test/a/b/pull/1`)).status, 400)
  assert.equal((await fetch(`${origin}/api/replay`, { method: "POST" })).status, 405)
  const request = { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json", "X-Replay-Intent": "same-origin" }, body: JSON.stringify({ url: "astral-sh/uv#123" }) }
  assert.equal((await fetch(`${origin}/api/replay/prepare`, request)).status, 403)
  assert.equal(prepares, 0)
  request.headers.Origin = "https://replay.example"
  for (const [header, value, code] of [
    ["Origin", "https://other.example", "origin_mismatch"],
    ["X-Replay-Intent", "", "missing_intent"],
    ["Content-Type", "text/plain", "invalid_content_type"],
  ]) {
    const rejected = await fetch(`${origin}/api/replay/prepare`, {
      ...request, headers: { ...request.headers, [header]: value },
    })
    assert.equal(rejected.status, 403)
    assert.equal((await rejected.json()).code, code)
    assert.equal(prepares, 0)
  }
  assert.equal((await fetch(`${origin}/api/replay/prepare`, request)).status, 202)
  assert.equal(prepares, 1)
})

test("runner rejects unconfigured writes, deduplicates requests and recovers interrupted jobs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "replay-jobs-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const runner = await createReplayRunner({
    directory, root, enabled: false,
    launch: () => { calls++; return new Promise(() => {}) },
  })
  await assert.rejects(createReplayRunner({ directory, root }), /Another Replay server/)
  const pr = parseReplayInput("astral-sh/uv#21570")
  await assert.rejects(runner.prepare(pr, { ...target, fork: target.upstream }), /configured/)
  await assert.rejects(runner.prepare(pr, { ...target, fork: "other/uv" }), /configured/)
  const job = await runner.prepare(pr, target)
  assert.equal((await runner.prepare(pr, target)).id, job.id)
  assert.equal(calls, 1)
  await assert.rejects(runner.prepare(parseReplayInput("astral-sh/uv#1"), target), /busy/)
  await assert.rejects(runner.start(job.id), /disabled/)
  assert.equal(recoverReplayJob({ state: "recording" }).state, "interrupted")
  assert.equal(recoverReplayJob({ state: "complete" }).state, "complete")
  const stored = JSON.parse(await readFile(join(directory, "jobs.json"), "utf8"))
  assert.equal(stored[0].state, "preparing")
})

test("unavailable or malformed live lookups retain saved evidence and never manufacture a result", async (t) => {
  let mode = "unavailable"
  const server = createWorkspaceServer({
    root, targetsDir, schema,
    readReplay: async () => {
      if (mode === "unavailable") throw new Error("upstream error with sensitive internal details")
      return { state: "record", record: { artifact: {} }, metadata: { title: "invalid" } }
    },
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const get = async (url) => (await fetch(`${origin}/api/replay?refresh=1&url=${encodeURIComponent(url)}`)).json()
  const saved = await get("garnet-labs/posthog#139")
  assert.equal(saved.source, "saved")
  assert.equal(saved.recordId, "replays/github/garnet-labs/posthog/139.json")
  assert.ok(saved.lookupError)
  assert.ok(!JSON.stringify(saved).includes("sensitive internal"))
  for (mode of ["unavailable", "malformed"]) {
    const missing = await get("unconfigured/example#123")
    assert.equal(missing.state, "unavailable")
    assert.equal(missing.target, null)
    assert.equal(missing.canPrepare, false)
    assert.equal(missing.recordId, null)
    assert.equal(missing.record, undefined)
  }
})

test("execution stops on moved plans and verifies the recorded head before saving", async () => {
  const plan = { fork: "garnet-labs/uv", baseSha: "a".repeat(40), headSha: "b".repeat(40), steps: [{ id: "capture" }] }
  const signature = planSignature(plan)
  assert.throws(() => assertPreparedPlan({ ...plan, headSha: "c".repeat(40) }, signature), /changed/)
  let saved = false
  const events = []
  const seams = {
    execute: () => "",
    live: async (args, options) => {
      if (args.includes("--dry-run")) return { plan }
      options.beforeExecute(plan)
      events.push("live")
      return { plan, row: { forkPr: 4, forkHeadSha: "f".repeat(40) } }
    },
    wait: async ({ sha }) => { assert.equal(sha, "f".repeat(40)); events.push("wait"); return { state: "recorded" } },
    verify: async () => { events.push("verify"); return { status: "PASS", head: "f".repeat(40), reasons: [] } },
    read: async () => { events.push("read"); return { state: "record", record: { head: "f".repeat(40), artifact: fixture } } },
    save: async () => { events.push("save"); saved = true },
  }
  const input = { action: "prepare", slug: "uv", number: 21570, root }
  assert.equal((await executeReplayJob(input, seams)).state, "prepared")
  assert.equal(saved, false)
  assert.equal((await executeReplayJob({ ...input, action: "start", signature }, seams)).state, "complete")
  assert.deepEqual(events, ["live", "wait", "verify", "read", "save"])
  saved = false
  await assert.rejects(executeReplayJob({ ...input, action: "start", signature }, {
    ...seams, verify: async () => ({ status: "FAIL", head: "f".repeat(40), reasons: ["incomplete"] }),
  }), /not shareable/)
  assert.equal(saved, false)
  await assert.rejects(executeReplayJob({ ...input, action: "start", signature: "old-plan" }, seams), /changed/)
})
