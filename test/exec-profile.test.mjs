import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { getExecProfile, githubRepository, latestAttempts, ledgerReplays, parseSubject, profilesForHead } from "../lib/exec-profile.mjs"
import { GET_EXEC_PROFILE_TOOL, handleMcpMessage } from "../lib/exec-profile-mcp.mjs"

const HEAD = "a".repeat(40)
const OTHER = "b".repeat(40)
const RAW = JSON.parse(readFileSync(new URL("./fixtures/demo-profiles/30304258281.json", import.meta.url), "utf8"))

function profile(id, { head = HEAD, runID = "7", runAttempt = 1, job = "test" } = {}) {
  return {
    id, githubOrg: "garnet-labs", repo: "demo", job, runID, runAttempt, createdAt: "2026-11-20T00:00:00Z",
    data: { scenarios: { github: { head_sha: head, sha: OTHER, job, repository: "garnet-labs/demo", workflow: "ci" } },
      network: { egress: { peers: [
        { remote_names: ["registry.npmjs.org"], remote_ports: [443], protocol: "TCP", proc_trees: [{ ancestry: ["Runner.Worker", "bash", "node"], github_step: "Run npm ci" }] },
        { remote_names: ["evil.example"], remote_ports: [443], protocol: "TCP", proc_trees: [{ ancestry: ["systemd", "node"] }] },
      ] } } },
  }
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function fakeFetch({ github = {}, npm = {}, profiles = () => ({ items: [], pageInfo: {} }) }) {
  const calls = []
  async function fetchImpl(url, init = {}) {
    calls.push({ url, init })
    if (url.startsWith("https://api.github.com")) {
      const path = url.slice("https://api.github.com".length)
      return path in github ? json(github[path]) : json({}, 404)
    }
    if (url.startsWith("https://registry.npmjs.org")) {
      const path = url.slice("https://registry.npmjs.org".length)
      return path in npm ? json(npm[path]) : json({}, 404)
    }
    const message = JSON.parse(init.body)
    const page = profiles(message.params.arguments)
    if (page.error !== undefined) return json({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: page.error }] } })
    return json({ jsonrpc: "2.0", id: 1, result: { structuredContent: page } })
  }
  return { fetchImpl, calls }
}

test("parseSubject accepts one PR, package or repository", () => {
  assert.deepEqual(parseSubject({ pr: "https://github.com/garnet-labs/express/pull/36" }), { kind: "pr", owner: "garnet-labs", repo: "express", number: 36 })
  assert.deepEqual(parseSubject({ pr: "garnet-labs/express#36" }), { kind: "pr", owner: "garnet-labs", repo: "express", number: 36 })
  assert.deepEqual(parseSubject({ pkg: "@napi-rs/canvas@0.1.65" }), { kind: "pkg", ecosystem: "npm", name: "@napi-rs/canvas", version: "0.1.65" })
  assert.deepEqual(parseSubject({ pkg: "esbuild" }), { kind: "pkg", ecosystem: "npm", name: "esbuild", version: null })
  assert.deepEqual(parseSubject({ repo: "https://github.com/garnet-labs/express.git", runID: "12" }), { kind: "repo", owner: "garnet-labs", repo: "express", runID: "12" })
  assert.throws(() => parseSubject({ pr: "garnet-labs/express#1", repo: "garnet-labs/express" }), /exactly one/)
  assert.throws(() => parseSubject({}), /exactly one/)
  assert.throws(() => parseSubject({ repo: "../etc/passwd" }), /repo must be/)
})

test("githubRepository reads npm repository fields", () => {
  assert.deepEqual(githubRepository({ type: "git", url: "git+https://github.com/evanw/esbuild.git" }), { owner: "evanw", repo: "esbuild" })
  assert.deepEqual(githubRepository("github:evanw/esbuild"), { owner: "evanw", repo: "esbuild" })
  assert.equal(githubRepository({ url: "https://gitlab.com/a/b" }), null)
})

test("profilesForHead binds on recorded head, never a merge-ref sha", () => {
  const unbound = { ...profile("x"), data: { scenarios: { github: { sha: HEAD.replace("a", "c") } } } }
  const legacy = { ...profile("y"), data: { scenarios: { github: { sha: HEAD } } } }
  assert.deepEqual(profilesForHead([profile("a"), profile("b", { head: OTHER }), unbound, legacy], HEAD).map((p) => p.id), ["a", "y"])
  assert.deepEqual(latestAttempts([profile("a"), profile("b", { runAttempt: 2 })]).map((p) => p.id), ["b"])
})

test("ledgerReplays matches a package version to its replay PR", () => {
  const targets = [{ fork: "garnet-labs/express", replays: [{ forkPr: 36, transition: { name: "esbuild", from: "absent", to: "0.24.0" } }, { forkPr: 40, transition: { name: "esbuild", to: "0.25.0" } }] }]
  assert.deepEqual(ledgerReplays(targets, "esbuild", "0.24.0").map((r) => r.forkPr), [36])
  assert.deepEqual(ledgerReplays(targets, "esbuild", null).map((r) => r.forkPr), [36, 40])
  assert.deepEqual(ledgerReplays(targets, "left-pad", "1.0.0"), [])
})

const PR_GITHUB = {
  "/repos/garnet-labs/demo/pulls/3": { head: { sha: HEAD }, html_url: "https://github.com/garnet-labs/demo/pull/3", state: "open", merged_at: null },
  "/repos/garnet-labs/demo/issues/3/comments?per_page=100": [{ html_url: "https://github.com/garnet-labs/demo/pull/3#issuecomment-1", body: `<!-- garnet:commit ${HEAD} -->\n<!-- garnet:summary {"status":"finalized","capture_quality":"best-effort","outcome":"unchanged","jobs":1,"changed":0} -->` }],
  [`/repos/garnet-labs/demo/actions/runs?head_sha=${HEAD}&per_page=100`]: { workflow_runs: [{ id: 7, status: "completed", html_url: "https://github.com/garnet-labs/demo/actions/runs/7" }] },
}

test("PR lookup returns head-bound profiles, chains, review rows and the App result", async () => {
  const { fetchImpl, calls } = fakeFetch({ github: PR_GITHUB, profiles: () => ({ items: [profile("p1"), profile("p0", { head: OTHER })], pageInfo: { hasNextPage: false } }) })
  const result = await getExecProfile({ pr: "garnet-labs/demo#3" }, { fetchImpl })
  assert.equal(result.schema, "garnet.exec-profile/v1")
  assert.equal(result.status, "partial")
  assert.deepEqual(result.profiles.map((p) => p.id), ["p1"])
  assert.match(result.limits[0], /1 profile\(s\) in these runs are not bound/)
  assert.deepEqual(result.app, { found: true, url: "https://github.com/garnet-labs/demo/pull/3#issuecomment-1", commit: HEAD, boundToHead: true, final: true, result: "nothing new", capture: "best-effort", line: null })
  assert.deepEqual(result.review.map((row) => [row.destination, row.kind]), [["evil.example", "detached-root"]])
  assert.equal(result.actions.length, 2)
  const mcp = calls.find((call) => call.url === "https://api.garnet.ai/api/v2/mcp")
  assert.deepEqual(JSON.parse(mcp.init.body).params.arguments, { githubOrg: "garnet-labs", repo: "demo", runID: "7", pageArgs: { first: 100 } })
})

test("a stale App comment is unknown for this head", async () => {
  const github = { ...PR_GITHUB, "/repos/garnet-labs/demo/issues/3/comments?per_page=100": [{ html_url: "c", body: `<!-- garnet:commit ${OTHER} -->` }] }
  const { fetchImpl } = fakeFetch({ github })
  const result = await getExecProfile({ pr: "garnet-labs/demo#3" }, { fetchImpl })
  assert.equal(result.app.result, "unknown for this head")
  assert.equal(result.status, "no-profile")
  assert.ok(result.limits.some((limit) => /earlier commit/.test(limit)))
})

test("repo lookup follows pagination and reports unread pages", async () => {
  let page = 0
  const { fetchImpl } = fakeFetch({ profiles: (args) => {
    if (args.runID === undefined) return { items: [profile("new")], pageInfo: { hasNextPage: true, endCursor: "x" } }
    page += 1
    return { items: [profile(`p${page}`)], pageInfo: { hasNextPage: true, endCursor: `c${page}` } }
  } })
  const result = await getExecProfile({ repo: "garnet-labs/demo" }, { fetchImpl })
  assert.equal(result.subject.runID, "7")
  assert.equal(result.profiles.length, 5)
  assert.equal(result.status, "partial")
  assert.deepEqual(result.limits, ["profiles for garnet-labs/demo run 7: stopped after 5 pages; later pages unread"])
})

test("an unauthenticated no-match is no-profile, never an empty clean record", async () => {
  const { fetchImpl } = fakeFetch({ profiles: () => ({ error: "unauthenticated" }) })
  const result = await getExecProfile({ repo: "garnet-labs/private" }, { fetchImpl })
  assert.equal(result.status, "no-profile")
  assert.match(result.limits[0], /not evidence that nothing ran/)
})

test("package lookup joins dependency replays and the release commit's own CI", async () => {
  const github = {
    ...PR_GITHUB,
    [`/repos/evanw/esbuild/actions/runs?head_sha=${OTHER}&per_page=100`]: { workflow_runs: [] },
  }
  const npm = { "/esbuild/0.24.0": { version: "0.24.0", gitHead: OTHER, repository: { url: "git+https://github.com/evanw/esbuild.git" } } }
  const targets = [{ fork: "garnet-labs/demo", replays: [{ forkPr: 3, transition: { name: "esbuild", from: "absent", to: "0.24.0" } }] }]
  const { fetchImpl } = fakeFetch({ github, npm, profiles: () => ({ items: [profile("p1")], pageInfo: {} }) })
  const result = await getExecProfile({ pkg: "esbuild@0.24.0" }, { fetchImpl, targets })
  assert.equal(result.status, "recorded")
  assert.deepEqual(result.subject, { kind: "pkg", ecosystem: "npm", name: "esbuild", version: "0.24.0", repository: "evanw/esbuild", gitHead: OTHER })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].relation, "dependency-replay")
  assert.equal(result.matches[0].pr, "https://github.com/garnet-labs/demo/pull/3")
  assert.deepEqual(result.profiles.map((p) => p.id), ["p1"])
})

test("the reader output matches readProfileTrees on a real public profile", async () => {
  const item = { id: "r1", githubOrg: "garnet-labs", repo: "demo", runID: "7", runAttempt: 1, job: "test", data: { ...RAW, scenarios: { github: { ...(RAW.scenarios?.github ?? {}), head_sha: HEAD } } } }
  const { fetchImpl } = fakeFetch({ profiles: () => ({ items: [item], pageInfo: {} }) })
  const result = await getExecProfile({ repo: "garnet-labs/demo", runID: "7" }, { fetchImpl })
  assert.ok(result.actions.length > 0)
  assert.ok(result.actions.every((row) => row.profile === "r1" && Array.isArray(row.ancestry) && typeof row.destination === "string"))
})

test("MCP handler initializes, lists the one tool and calls it", async () => {
  const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
  assert.equal(init.result.protocolVersion, "2025-03-26")
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null)
  const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ["get_exec_profile"])
  assert.equal(GET_EXEC_PROFILE_TOOL.annotations.readOnlyHint, true)
  const call = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_exec_profile", arguments: { repo: "a/b" } } }, { lookup: async (input) => ({ status: "recorded", input }) })
  assert.deepEqual(call.result.structuredContent, { status: "recorded", input: { repo: "a/b" } })
  const bad = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_exec_profile", arguments: {} } }, { lookup: async () => { throw new Error("pass exactly one of pr, pkg or repo") } })
  assert.equal(bad.result.isError, true)
  assert.equal((await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "nope" })).error.code, -32601)
})
