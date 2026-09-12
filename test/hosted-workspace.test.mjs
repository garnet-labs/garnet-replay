import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import { createHostedWorkspace, readPublicReplay } from "../lib/hosted-workspace.mjs"
import { renderLanding, renderReplayPending } from "../public/replay-page.mjs"

test("hosted viewer serves direct links and evidence while rejecting every mutation", async (t) => {
  const reads = []
  const server = await createHostedWorkspace({
    revision: "hosted-test",
    readReplay: async (url) => {
      reads.push(url)
      return { state: "no-record", record: null, metadata: { title: "Public PR", head: "a".repeat(40), state: "open" } }
    },
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const path of ["/", "/workspace", "/astral-sh/uv/pull/21570", "/workspace.mjs", "/replay-page.css"]) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  }
  const catalog = await (await fetch(origin + "/api/workspace")).json()
  assert.equal(catalog.revision, "hosted-test")
  assert.equal(catalog.runnerAvailable, false)
  assert.ok(catalog.records.length > 0)
  assert.match(renderLanding(catalog, origin), /Public evidence viewer/)
  assert.doesNotMatch(renderLanding(catalog, origin), /prepare a new one/)
  const saved = await (await fetch(origin + "/api/replay?url=garnet-labs/posthog%23139")).json()
  assert.equal(saved.source, "saved")
  assert.equal(reads.length, 0)
  const missing = await (await fetch(origin + "/api/replay?url=astral-sh/uv%23999999")).json()
  assert.equal(missing.canPrepare, false)
  assert.equal(missing.runnerEnabled, false)
  assert.equal(missing.runnerAvailable, false)
  assert.equal(missing.state, "no-record")
  assert.equal(reads.length, 1)
  const html = renderReplayPending(missing)
  assert.match(html, /Prepare a replay in the local harness/)
  assert.doesNotMatch(html, /id="(?:prepare|start)-pr"/)
  for (const path of ["/api/replay/prepare", "/api/replay/start"]) {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "X-Replay-Intent": "same-origin" },
      body: JSON.stringify({ url: "astral-sh/uv#999999" }),
    })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "GET, HEAD")
  }
  assert.equal((await fetch(origin + "/api/replay/job?id=unknown")).status, 404)
})

test("public receipt lookups never forward ambient GitHub credentials", async (t) => {
  const previous = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  process.env.GH_TOKEN = "test-ambient-token"
  process.env.GITHUB_TOKEN = "test-other-ambient-token"
  const requests = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith("/pulls/123")) {
      return new Response(JSON.stringify({
        html_url: "https://github.com/a/b/pull/123", title: "Public PR", state: "open",
        head: { sha: "a".repeat(40) }, base: { sha: "b".repeat(40) },
      }))
    }
    return new Response("[]")
  })
  const result = await readPublicReplay("https://github.com/a/b/pull/123")
  assert.equal(result.state, "no-record")
  assert.equal(requests.length, 3)
  for (const { url, options } of requests) {
    assert.ok(url.startsWith("https://api.github.com/repos/a/b/"))
    assert.equal(options.headers.authorization, undefined)
  }
})
