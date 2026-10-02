import assert from "node:assert/strict"
import { once } from "node:events"
import { deflateRawSync } from "node:zlib"
import { test } from "node:test"
import { createHostedRunner, operatorKeyMatches, readZipEntry } from "../lib/hosted-runner.mjs"
import { createHostedWorkspace } from "../lib/hosted-workspace.mjs"

function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text))
  const file = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt16LE(file.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt16LE(file.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + file.length, 12)
  end.writeUInt32LE(30 + file.length + data.length, 16)
  return Buffer.concat([local, file, data, central, file, end])
}

test("operator keys and job artifacts are read strictly", () => {
  assert.equal(operatorKeyMatches("secret", "secret"), true)
  assert.equal(operatorKeyMatches("secret", "other"), false)
  assert.equal(operatorKeyMatches("", ""), false)
  assert.equal(operatorKeyMatches("secret", undefined), false)
  assert.equal(readZipEntry(zip("job.json", '{"state":"prepared"}'), "job.json").toString(), '{"state":"prepared"}')
  assert.equal(readZipEntry(zip("other.json", "{}"), "job.json"), null)
})

function fakeGithub() {
  const runs = []
  const artifacts = new Map()
  const calls = []
  const json = (value) => new Response(JSON.stringify(value), { status: 200 })
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search
    calls.push({ method: init.method ?? "GET", path, body: init.body === undefined ? null : JSON.parse(init.body) })
    if (path.endsWith("/dispatches")) {
      const { inputs } = JSON.parse(init.body)
      runs.unshift({ id: 100 + runs.length, status: "queued", path: ".github/workflows/replay.yml", html_url: "https://github.com/garnet-labs/garnet-replay/actions/runs/1", display_title: `replay ${inputs.slug}#${inputs.number} ${inputs.action} ${inputs.request} ${inputs.plan}` })
      return new Response(null, { status: 204 })
    }
    if (/\/workflows\/replay\.yml\/runs/.test(path)) return json({ workflow_runs: runs })
    const run = /\/actions\/runs\/(\d+)$/.exec(path)
    if (run !== null) return json(runs.find((entry) => entry.id === Number(run[1])))
    const listed = /\/actions\/runs\/(\d+)\/artifacts$/.exec(path)
    if (listed !== null) return json({ artifacts: artifacts.has(Number(listed[1])) ? [{ id: Number(listed[1]), name: "replay-job" }] : [] })
    const archive = /\/actions\/artifacts\/(\d+)\/zip$/.exec(path)
    if (archive !== null) return new Response(zip("job.json", JSON.stringify(artifacts.get(Number(archive[1])))), { status: 200 })
    if (path.startsWith("/repos/garnet-labs/uv/pulls")) return json([{ html_url: "https://github.com/garnet-labs/uv/pull/7" }])
    return new Response("missing", { status: 404 })
  }
  return { runs, artifacts, calls, fetchImpl }
}

test("hosted runner dispatches prepare, binds start to the prepared run, and reports fork progress", async () => {
  const github = fakeGithub()
  const runner = createHostedRunner({ token: "t", fetchImpl: github.fetchImpl, sleep: async () => {} })
  const target = { slug: "uv", upstream: "astral-sh/uv", fork: "garnet-labs/uv" }
  const pr = { url: "https://github.com/astral-sh/uv/pull/5", repository: "astral-sh/uv", number: 5 }
  await assert.rejects(runner.prepare(pr, null), /configured garnet-labs fork/)
  const prepared = await runner.prepare(pr, target)
  assert.equal((await runner.get(prepared.id)).state, "preparing")
  await assert.rejects(runner.start(prepared.id), /wait for its plan/)
  github.runs[0].status = "completed"
  github.runs[0].conclusion = "success"
  const plan = { fork: "garnet-labs/uv", branch: "replay/uv-5", baseSha: "a", headSha: "b", scope: "full", record: "fork-workflow", ecosystem: "cargo", paths: [] }
  github.artifacts.set(github.runs[0].id, { state: "prepared", slug: "uv", number: 5, plan, signature: "f".repeat(64) })
  const visible = await runner.get(prepared.id)
  assert.equal(visible.state, "prepared")
  assert.equal(visible.signature, undefined)
  const started = await runner.start(prepared.id)
  const dispatched = github.calls.filter((call) => call.path.endsWith("/dispatches")).map((call) => call.body.inputs)
  assert.deepEqual(dispatched.map(({ action, plan: from }) => [action, from]), [["prepare", ""], ["start", prepared.id]])
  const recording = await runner.forPr(pr.url, target)
  assert.equal(recording.id, started.id)
  assert.equal(recording.state, "recording")
  assert.equal(recording.forkUrl, "https://github.com/garnet-labs/uv/pull/7")
  assert.equal(await runner.forPr(pr.url, null), null)
  assert.equal(await runner.get("../1"), null)
})

test("hosted creation requires the operator key and exact origin", async (t) => {
  const prepared = []
  const runner = { enabled: true, hosted: true, get: async () => null, forPr: async () => null, prepare: async (pr) => (prepared.push(pr.url), { id: "1" }), start: async () => ({ id: "2" }) }
  const env = { REPLAY_DISPATCH_TOKEN: "t", REPLAY_OPERATOR_KEY: "key", REPLAY_ORIGIN: "https://replay.example" }
  const server = await createHostedWorkspace({ revision: "test", env, runner, readReplay: async () => ({ state: "no-record", record: null, metadata: { title: "PR", head: "a".repeat(40), state: "open" } }) })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const result = await (await fetch(`${base}/api/replay?url=astral-sh/uv%23999999`)).json()
  assert.equal(result.canPrepare, true)
  assert.equal(result.operatorRequired, true)
  const post = (headers) => fetch(`${base}/api/replay/prepare`, { method: "POST", headers: { "content-type": "application/json", "x-replay-intent": "same-origin", origin: "https://replay.example", ...headers }, body: JSON.stringify({ url: "https://github.com/astral-sh/uv/pull/999999" }) })
  assert.equal((await post({})).status, 401)
  assert.equal((await post({ "x-replay-operator": "wrong" })).status, 401)
  assert.equal((await post({ origin: "https://other.example", "x-replay-operator": "key" })).status, 403)
  assert.equal((await post({ "x-replay-operator": "key" })).status, 202)
  assert.deepEqual(prepared, ["https://github.com/astral-sh/uv/pull/999999"])
})
