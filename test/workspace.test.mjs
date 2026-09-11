import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadWorkspace, createWorkspaceServer } from "../lib/workspace-server.mjs"
import { recordSummary, workspaceRecord, workspaceTarget } from "../lib/workspace.mjs"
import { targetView } from "../lib/status.mjs"
import { composeCommand, escapeHtml, matchingCandidates, matchingRecords, renderCandidate, safeUrl } from "../public/workspace-model.mjs"

const fixture = JSON.parse(await readFile(new URL("../public/replays/github/garnet-labs/posthog/139.json", import.meta.url), "utf8"))
const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
const target = JSON.parse(await readFile(new URL("../targets/uv.json", import.meta.url), "utf8"))

test("workspace preserves pair, attribution and every observation without summary totals", () => {
  const diff = structuredClone(fixture)
  diff.execution_diff.totals.runner_background.added = 999
  const record = workspaceRecord(diff, "replays/github/garnet-labs/posthog/139.json")
  assert.equal(record.verdict, "unchanged")
  assert.deepEqual(record.artifact.pair, diff.pair)
  assert.equal(record.groups[1].kinds[0].added.length, 3)
  assert.deepEqual(record.groups[1].kinds[0].removed, diff.execution_diff.network_removed)
  assert.equal(record.groups[0].kinds[1].recorded, false)
  assert.equal("artifact" in recordSummary(record), false)
  assert.equal("groups" in recordSummary(record), false)
  assert.deepEqual(workspaceTarget(target).view, targetView(target))
})

test("partial, missing, stale, unbound and inconsistent records fail closed and retain raw evidence", () => {
  const mutations = [
    (diff) => { diff.capture.status = "partial" },
    (diff) => { diff.capture.status = "none" },
    (diff) => { diff.capture.final_record = false },
    (diff) => { diff.capture.expected_cells = 2; diff.capture.recorded_cells = 1 },
    (diff) => { diff.capture.recorded_cells = 0 },
    (diff) => { diff.capture.lineage_missing = 1 },
    (diff) => { diff.supersession.superseded = true },
    (diff) => { diff.supersession.current_head = "a".repeat(40) },
    (diff) => { diff.supersession.record_head = null },
    (diff) => { diff.pair.head_sha = "a".repeat(40) },
    (diff) => { diff.pair.scope = "unavailable" },
    (diff) => { diff.comparison.available = false },
    (diff) => { diff.base.sha = null; diff.pair.base_sha = null },
    (diff) => { diff.execution_diff.kinds_recorded = [] },
  ]
  for (const mutate of mutations) {
    const diff = structuredClone(fixture)
    mutate(diff)
    const record = workspaceRecord(diff, "record")
    assert.equal(record.verdict, "undeterminable", mutate.toString())
    assert.equal(record.artifact.verdict.value, "unchanged")
    assert.equal(record.groups[1].kinds[0].added.length, 3)
  }
  assert.throws(() => workspaceTarget({ ...target, observations: [null] }), /object rows/)
})

test("search resolves only saved metadata and markup/links remain inert", () => {
  const record = recordSummary(workspaceRecord(fixture, "record"))
  assert.deepEqual(matchingRecords([record], `${fixture.pull_request.url}/`), [record])
  assert.deepEqual(matchingRecords([record], "POSTHOG-JS"), [record])
  assert.deepEqual(matchingRecords([record], "no-such-record"), [])
  assert.deepEqual(matchingRecords([record], "", "garnet-labs/uv"), [])
  const observations = [{ title: "Update", paths: ["apps/web/package.json"], reasons: ["new install script"] }]
  assert.deepEqual(matchingCandidates(observations, " APPS/WEB "), observations)
  assert.deepEqual(matchingCandidates(observations, "install script"), observations)
  assert.deepEqual(matchingCandidates(observations, "no-such-candidate"), [])
  assert.equal(safeUrl("javascript:alert(1)"), null)
  assert.equal(safeUrl("//evil.test"), null)
  assert.equal(safeUrl("https://example.com"), "https://example.com/")
  assert.equal(escapeHtml('<script a="x">\'&'), "&lt;script a=&quot;x&quot;&gt;&#39;&amp;")
})

test("all planner modes produce canonical dry runs and preserve shell metacharacters as data", () => {
  const common = { slug: "uv", work: "/home/user/a b'$(echo x)" }
  const cases = [
    [{ ...common, mode: "pr", pr: "42" }, ["--pr", "42"]],
    [{ ...common, mode: "prepared", prepared: "/home/in'put.json", branch: "version-update" }, ["--prepared", "/home/in'put.json", "--branch", "version-update"]],
    [{ ...common, mode: "dependency", dependency: "@org/name", to: "2.0.0" }, ["--dependency", "@org/name", "--to", "2.0.0"]],
    [{ ...common, mode: "allow-build", dependency: "package" }, ["--allow-build", "package"]],
  ]
  for (const [input, expected] of cases) {
    const command = composeCommand(input)
    const args = JSON.parse(execFileSync("sh", ["-c", `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${command}`], { encoding: "utf8" }))
    assert.deepEqual(args, ["node", "bin/replay.mjs", "live", "uv", ...expected, "--work", common.work, "--dry-run"])
  }
  assert.throws(() => composeCommand({ ...common, mode: "pr", pr: "0" }), /positive/)
  assert.throws(() => composeCommand({ ...common, mode: "pr", pr: "1\n--help" }), /single line/)
  assert.throws(() => composeCommand({ ...common, mode: "pr", pr: "1", slug: "../uv" }), /slug/)
  assert.throws(() => composeCommand({ ...common, mode: "pr", pr: "1", slug: "INVALID_SLUG" }), /slug/)
  assert.match(composeCommand({ ...common, mode: "dependency", dependency: "pkg", to: "1", packageDir: "apps/web", label: "record" }), /--label 'record' --package-dir 'apps\/web'/)
  assert.throws(() => composeCommand({ ...common, mode: "pr", pr: "1", label: "a\nb" }), /single line/)
})

test("candidate markup preserves the canonical nested gap score, every reason and path", () => {
  for (const row of target.observations) {
    const html = renderCandidate(row)
    assert.ok(html.includes(`title="Candidate score">${row.gap.total}</span>`))
    for (const reason of row.gap.reasons) assert.ok(html.includes(escapeHtml(reason.reason)))
    for (const path of row.paths) assert.ok(html.includes(escapeHtml(path)))
  }
  const html = renderCandidate({ ...target.observations[0], title: "<script>alert(1)</script>" })
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
  assert.ok(!html.includes("<script>"))
})

test("read-only server isolates malformed artifacts, loads details, preserves routes, and confines filesystem access", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "replay-workspace-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, "public")
  const records = join(root, "replays/github/garnet-labs/posthog")
  const targetsDir = join(directory, "targets")
  await mkdir(records, { recursive: true })
  await mkdir(targetsDir)
  await mkdir(join(records, "139"))
  await writeFile(join(records, "139.json"), JSON.stringify(fixture))
  await writeFile(join(records, "140.json"), "{")
  await writeFile(join(records, "141.json"), "{}")
  await writeFile(join(records, "139/index.html"), "<h1>Legacy result</h1>")
  await writeFile(join(root, "index.html"), "<h1>Workspace</h1>")
  await writeFile(join(root, "workspace.mjs"), "export const workspace = true")
  await writeFile(join(targetsDir, "uv.json"), JSON.stringify(target))
  await writeFile(join(targetsDir, "bad.json"), "null")
  await writeFile(join(directory, "outside"), "private")
  await symlink(join(directory, "outside"), join(root, "escape"))
  const options = { root, targetsDir, schema, revision: "a".repeat(40) }
  const catalog = await loadWorkspace(options)
  assert.equal(catalog.records.length, 1)
  assert.equal(catalog.targets.length, 1)
  assert.equal(catalog.issues.length, 3)
  assert.equal("artifact" in catalog.records[0], false)
  const server = createWorkspaceServer(options)
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready))
  t.after(() => new Promise((done) => server.close(done)))
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.equal((await (await fetch(`${origin}/api/workspace`)).json()).records.length, 1)
  const record = await (await fetch(`${origin}/api/record?id=${encodeURIComponent(catalog.records[0].id)}`)).json()
  assert.equal(record.artifact.head.sha, fixture.head.sha)
  for (const [path, status] of [
    ["/", 200], ["/replays/github/garnet-labs/posthog/139", 200],
    ["/replays/github/garnet-labs/posthog/139/", 200],
    ["/api/record?id=replays/github/garnet-labs/posthog/141.json", 422],
    ["/api/record?id=replays/github/garnet-labs/posthog/140.json", 422],
    ["/api/record?id=replays/github/garnet-labs/posthog/404.json", 404],
    ["/api/record?id=../../outside", 400], ["/api/unknown", 404], ["/escape", 403],
    ["/%E0%A4%A", 400], ["/missing", 404], ["/%2e%2e%2foutside", 403],
  ]) assert.equal((await fetch(origin + path)).status, status, path)
  assert.equal((await fetch(origin, { method: "POST" })).status, 405)
  assert.equal(await (await fetch(origin, { method: "HEAD" })).text(), "")
  assert.match((await fetch(`${origin}/workspace.mjs`)).headers.get("content-type"), /text\/javascript/)
  assert.equal((await fetch(`${origin}/api/workspace`)).headers.get("cache-control"), "no-store")
  const empty = await loadWorkspace({ ...options, root: join(directory, "empty"), targetsDir: join(directory, "missing") })
  assert.deepEqual(empty.records, [])
  assert.deepEqual(empty.targets, [])
})
