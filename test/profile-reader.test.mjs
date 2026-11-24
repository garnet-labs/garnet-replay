import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { attributionKind, captureAllowsComparison, compareProfileTrees, readProfileTrees, renderProfileTrees } from "../lib/profile-reader.mjs"
import { buildModel, cardForPr, renderCard } from "../lib/card.mjs"
import { assertVocabClean } from "../lib/guards.mjs"
import { profileAttributionForComment, renderVerifyReport, verifyExhibit } from "../lib/verify.mjs"
import { kitResponse } from "./fixtures/grounding.mjs"

const FIXTURE = new URL("./fixtures/demo-profiles/attribution-trees.json", import.meta.url)
const TREES = JSON.parse(readFileSync(FIXTURE, "utf8"))
const RECEIPT = new URL("./fixtures/demo-profiles/devin-receipt3.json", import.meta.url)
const HEAD = "a".repeat(40)
const PREVIOUS = "b".repeat(40)
const ID = "00000000-0000-4000-8000-000000000001"
const BASE_ID = "00000000-0000-4000-8000-000000000002"
const LINK = `https://app.garnet.ai/public/runs/123?profile=${ID}`
const BASE_LINK = `https://app.garnet.ai/public/runs/122?profile=${BASE_ID}`

function profile(head = HEAD, associations = TREES.profiles[0].associations) {
  return { run: { repository: "garnet-labs/example", job: "install", run_id: head === HEAD ? "123" : "122", profile_id: head === HEAD ? ID : BASE_ID, commit_sha: head }, associations }
}

function comment(head = HEAD, link = LINK) {
  return { user: { login: "garnet-runtime-review[bot]" }, body: [
    "<!-- garnet-runtime-review -->",
    `<!-- garnet:commit ${head} -->`,
    `<!-- garnet:summary ${JSON.stringify({ commit: head, previous: PREVIOUS, scope: "previous-push", outcome: "unchanged", status: "finalized", capture_quality: "complete", jobs: 1, changed: 0, incomplete: 0 })} -->`,
    "### No new runtime behavior recorded",
    `[Full record](${link})`,
  ].join("\n") }
}

test("fixture distinguishes detached and container roots from worker ancestry and ordinary host services", () => {
  const rows = readProfileTrees(TREES)
  assert.equal(rows.length, 8)
  assert.equal(rows.filter((row) => row.kind === "detached-root").length, 2)
  assert.equal(rows.filter((row) => row.kind === "container-rooted").length, 3)
  assert.equal(rows.filter((row) => row.kind === "runner-background").length, 2)
  assert.equal(rows.filter((row) => row.kind === "runner-linked").length, 1)
  assert.equal(attributionKind(["runc", "sh"]), "container-rooted")
  assert.equal(attributionKind(["Runner.Worker", "runc", "sh"]), "runner-linked")
  assert.equal(attributionKind(["bash", "node"], "1. Install"), "step-linked")
  assert.equal(attributionKind(["bash", "curl"], "99. Runner Processes"), "runner-unlinked")
  assert.equal(attributionKind(["systemd"]), "runner-background")
  assert.equal(rows.find((row) => row.destination === "alias.example").needsReview, true)
  assert.equal(rows.find((row) => row.kind === "runner-linked").needsReview, false)
})

test("raw peers, summarized records and public envelopes retain all destinations and jobs", () => {
  const raw = { network: { egress: { peers: [{ RemoteNames: ["one.example", "two.example"], RemotePorts: [443], ProcTrees: [{ Ancestry: ["init", "curl"] }] }] } } }
  assert.equal(readProfileTrees(raw).length, 2)
  const summarized = { egress: [{ name: "one.example", ancestry: ["Runner.Worker", "node"], step: "Install" }] }
  assert.equal(readProfileTrees(summarized)[0].kind, "runner-linked")
  assert.equal(readProfileTrees({ egress: { unique_domains: [{ domain: "one.example", ancestry: ["init", "curl"] }] } })[0].needsReview, true)
  assert.equal(readProfileTrees({ profile: profile() }).length, 8)
  assert.equal(readProfileTrees({ profiles: [profile(), { ...profile(), run: { job: "other" } }] }).length, 16)
  assert.equal(readProfileTrees({ associations: [{ remote_names: [], remote_address: "192.0.2.1", ancestry: ["init", "curl"] }] })[0].destination, "192.0.2.1")
})

test("actions retain workflow identity even when job names and actions match", () => {
  const first = profile()
  first.run.workflow_path = ".github/workflows/install.yml"
  const other = structuredClone(first)
  other.run.workflow_path = ".github/workflows/check.yml"
  assert.equal(readProfileTrees({ profiles: [first, other] }).length, 16)
  const rerun = structuredClone(first)
  rerun.run.run_id = "124"
  assert.equal(readProfileTrees({ profiles: [first, rerun] }).length, 8)
  assert.deepEqual(compareProfileTrees(first, rerun).added, [])
  delete first.run.workflow_path
  delete rerun.run.workflow_path
  assert.equal(readProfileTrees({ profiles: [first, rerun] }).length, 8)
  for (const metadata of ["github", "scenarios"]) {
    const a = metadata === "github" ? { github: { workflow: "install", job: "job" } } : { scenarios: { github: { workflow: "install", job: "job" } } }
    const b = structuredClone(a)
    if (metadata === "github") b.github.workflow = "check"
    else b.scenarios.github.workflow = "check"
    a.egress = [{ name: "example.org", ancestry: ["init", "curl"] }]
    b.egress = a.egress
    assert.equal(readProfileTrees({ profiles: [a, b] }).length, 2)
  }
})

test("identical actions are not additions across runs and refs, with or without workflow metadata", () => {
  for (const withWorkflow of [true, false]) {
    const head = profile(HEAD)
    const base = profile(PREVIOUS)
    head.run.ref = "refs/pull/1/merge"
    base.run.ref = "refs/heads/main"
    if (withWorkflow) {
      head.run.workflow_ref = "garnet-labs/example/.github/workflows/install.yml@refs/pull/1/merge"
      base.run.workflow_ref = "garnet-labs/example/.github/workflows/install.yml@refs/heads/main"
    }
    const report = compareProfileTrees(head, base)
    assert.deepEqual(report.added, [])
    assert.equal(readProfileTrees({ profiles: [base, head] }).length, 8)
    assert.equal(report.rows[0].workflow, withWorkflow ? "garnet-labs/example/.github/workflows/install.yml" : "")
    assertVocabClean(renderProfileTrees(report))
  }
})

test("workflow references retain repository identity when repository metadata is absent", () => {
  const base = profile(PREVIOUS)
  const head = profile(HEAD)
  delete base.run.repository
  delete head.run.repository
  base.run.workflow_ref = "one/repo/.github/workflows/install.yml@refs/heads/main"
  head.run.workflow_ref = "two/repo/.github/workflows/install.yml@refs/pull/1/merge"
  assert.equal(readProfileTrees({ profiles: [base, head] }).length, 16)
  assert.equal(compareProfileTrees(head, base).added.length, 5)
  assert.equal(readProfileTrees(head)[0].workflow, "two/repo/.github/workflows/install.yml")
  head.run.workflow_ref = "one/repo/.github/workflows/install.yml@refs/pull/1/merge"
  assert.deepEqual(compareProfileTrees(head, base).added, [])
})

test("relative workflow paths and qualified references share an action identity", () => {
  const head = profile(HEAD)
  const base = profile(PREVIOUS)
  head.run.workflow_path = ".github/workflows/install.yml"
  base.run.workflow_ref = "garnet-labs/example/.github/workflows/install.yml@refs/heads/main"
  assert.deepEqual(compareProfileTrees(head, base).added, [])
  assert.deepEqual(compareProfileTrees(base, head).added, [])
  assert.equal(readProfileTrees({ profiles: [base, head] }).length, 8)
  assert.equal(readProfileTrees(head)[0].workflow, "garnet-labs/example/.github/workflows/install.yml")
  head.run.workflow_path = "garnet-labs/example/.github/workflows/install.yml"
  assert.deepEqual(compareProfileTrees(head, base).added, [])
  delete head.run.repository
  head.run.workflow_path = ".github/workflows/install.yml"
  assert.equal(readProfileTrees(head)[0].workflow, ".github/workflows/install.yml")
})

test("repeated actions retain review requirements in either observation order", () => {
  const linked = { remote_names: ["example.org"], ancestry: ["Runner.Worker", "node"] }
  const missing = { ...linked, lineage_recorded: false }
  const stepLinked = { remote_names: ["example.org"], ancestry: ["bash", "node"], github_step: "Install" }
  const unlinked = { ...stepLinked, github_step: "99. Runner Processes" }
  for (const pair of [[linked, missing], [missing, linked], [stepLinked, unlinked], [unlinked, stepLinked]]) {
    const rows = readProfileTrees({ associations: pair })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].needsReview, true)
    assert.notEqual(rows[0].kind, "step-linked")
  }
  assert.equal(readProfileTrees({ associations: [stepLinked] })[0].needsReview, false)
})

test("exported pairs prefer recorded PR heads over test-merge commits across profile shapes", () => {
  const merge = "c".repeat(40)
  const shapes = [
    { run: { head_sha: HEAD, commit_sha: merge } },
    { run: { commit_sha: merge, pull_request: { head: { sha: HEAD } } } },
    { run: { commit_sha: merge }, pull_request: { head: { sha: HEAD } } },
    { github: { head_sha: HEAD, sha: merge } },
    { github: { sha: merge, pull: { head: { sha: HEAD } } } },
    { scenarios: { github: { sha: merge, event: { pull_request: { head: { sha: HEAD } } } } } },
  ]
  for (const metadata of shapes) {
    const raw = { ...metadata, associations: [{ remote_names: ["example.com"], ancestry: ["Runner.Worker", "node"] }] }
    for (const record of [raw, { profile: raw }, { profiles: [raw] }]) {
      const report = compareProfileTrees(record, record)
      assert.deepEqual(report.pair.head, [HEAD])
      assert.deepEqual(report.pair.compared, [HEAD])
      assert.doesNotMatch(renderProfileTrees(report), new RegExp(merge))
    }
  }
  assert.deepEqual(compareProfileTrees({ associations: [], run: { commit_sha: merge } }).pair.head, [merge])
})

test("empty associations are readable; absent, malformed and empty collections fail closed", () => {
  assert.deepEqual(readProfileTrees({ associations: [] }), [])
  assert.deepEqual(compareProfileTrees({ associations: [] }, { associations: [] }).added, [])
  for (const value of [null, [], {}, { profiles: [] }, { associations: [null] }, { associations: [{ remote_names: [4], ancestry: [] }] }, { associations: [{ remote_names: ["x"], ancestry: "init" }] }, { associations: [{ ancestry: [] }] }]) {
    assert.throws(() => readProfileTrees(value))
  }
  const missing = readProfileTrees({ associations: [{ remote_names: ["unknown.example"], process: "curl" }] })[0]
  assert.equal(missing.kind, "ancestry-unavailable")
  assert.equal(missing.needsReview, true)
})

test("comparison catches added actors even at existing destinations, and distinguishes existing review rows", () => {
  const before = profile(PREVIOUS, TREES.profiles[0].associations.slice(0, 3))
  const report = compareProfileTrees(profile(), before)
  assert.equal(report.added.length, 5)
  assert.equal(report.added.some((row) => row.destination === "registry.npmjs.org"), true)
  assert.equal(compareProfileTrees(profile(), profile()).added.length, 0)
  assert.equal(compareProfileTrees(profile()).added, null)
  const html = renderProfileTrees(report)
  assert.match(html, /Needs review: not attributable to the runner/)
  assert.match(html, /5 added actions/)
  assertVocabClean(html)
  assertVocabClean(renderProfileTrees(compareProfileTrees({ associations: [] })))
})

test("reader rendering escapes captured HTML and does not imply job origin", () => {
  const report = compareProfileTrees({ associations: [{ remote_names: ["<script>"], ancestry: ["init", "<img onerror=x>"] }] })
  const html = renderProfileTrees(report)
  assert.doesNotMatch(html, /<script>|<img/)
  assert.match(html, /does not establish job origin/)
  assert.match(html, /Compared profile unavailable/)
})

test("text output distinguishes actions differing only by protocol", () => {
  const action = { remote_names: ["example.org"], ancestry: ["init", "curl"], remote_ports: ["443"] }
  const report = compareProfileTrees({ associations: [{ ...action, protocol: "TCP" }, { ...action, protocol: "UDP" }] })
  assert.equal(report.rows.length, 2)
  const lines = renderProfileTrees(report).split("\n").filter((line) => line.startsWith("- "))
  assert.equal(lines.filter((line) => line.includes("<code>TCP</code>")).length, 1)
  assert.equal(lines.filter((line) => line.includes("<code>UDP</code>")).length, 1)
  assert.doesNotMatch(renderProfileTrees(compareProfileTrees({ associations: [action] })), /<code>TCP<\/code>|<code>UDP<\/code>/)
})

test("text rows show the workflow path or name alongside the job only when recorded", () => {
  for (const metadata of [{ workflow_path: ".github/workflows/install.yml" }, { workflow: "Install dependencies" }]) {
    const raw = profile()
    Object.assign(raw.run, metadata)
    const text = renderProfileTrees(compareProfileTrees(raw))
    const workflow = metadata.workflow_path === undefined ? metadata.workflow : `garnet-labs/example/${metadata.workflow_path}`
    for (const line of text.split("\n").filter((line) => line.startsWith("- "))) {
      assert.equal(line.endsWith(` · job <code>install</code> · workflow <code>${workflow}</code>`), true)
    }
    assertVocabClean(text)
  }
  assert.doesNotMatch(renderProfileTrees(compareProfileTrees(profile())), / · workflow /)
})

test("file CLI reads a real recorded fixture and supports an explicit comparison", () => {
  const real = new URL("./fixtures/demo-profiles/30304258281.json", import.meta.url).pathname
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", real, "--base", real, "--json"], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const report = JSON.parse(child.stdout)
  assert.equal(report.rows.some((row) => row.ancestry.includes("Runner.Worker")), true)
  assert.deepEqual(report.added, [])
  const invalid = spawnSync(process.execPath, ["bin/replay.mjs", "profile", "missing-profile.json"], { encoding: "utf8" })
  assert.notEqual(invalid.status, 0)
})

test("CursorPage receipts read every item through the CLI and retain detached and container review", () => {
  const fixture = new URL("./fixtures/demo-profiles/devin-cursor-receipt.json", import.meta.url)
  const receipt = JSON.parse(readFileSync(fixture, "utf8"))
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", fixture.pathname, "--json"], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const report = JSON.parse(child.stdout)
  assert.equal(report.rows.length, 4)
  assert.deepEqual(new Set(report.rows.map((row) => row.job)), new Set(["install", "test"]))
  for (const destination of ["registry.npmjs.org", "session.example"]) {
    const row = report.rows.find((entry) => entry.destination === destination)
    assert.equal(row.kind, "session-linked")
    assert.equal(row.needsReview, false)
  }
  assert.equal(report.review.find((row) => row.destination === "example.com").kind, "detached-root")
  assert.equal(report.review.find((row) => row.destination === "container.example").kind, "container-rooted")
  assert.deepEqual(readProfileTrees(receipt.profiles), report.rows)
  const partial = structuredClone(receipt)
  partial.profiles.items[1].capture_quality = "partial"
  assert.equal(compareProfileTrees(partial, receipt).added, null)
  assert.deepEqual(compareProfileTrees(receipt, receipt).added, [])
})

test("per-tree SSH receipt attribution survives deduplication without linking unrelated or detached traffic", () => {
  const tree = { ancestry: ["systemd", "sshd-session: u", "bash"], process: "claude" }
  const peer = (destination, procTree, fields = {}) => ({ remote_names: [destination], proc_trees: [procTree], ...fields })
  const linked = peer("agent.example", { ...tree, attribution: "session-linked" })
  const unmarked = peer("agent.example", tree)
  for (const duplicates of [[linked, unmarked], [unmarked, linked]]) {
    const rows = readProfileTrees({ network: { egress: { peers: [
      ...duplicates,
      peer("unrelated.example", tree),
      peer("outside.example", { ...tree, attribution: "session-linked" }, { unattributed: true }),
      peer("detached.example", { ancestry: ["systemd"], process: "curl", attribution: "session-linked" }),
    ] } } })
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.destination, [row.kind, row.needsReview]])), {
      "agent.example": ["session-linked", false],
      "unrelated.example": ["runner-background", false],
      "outside.example": ["runner-background", false],
      "detached.example": ["detached-root", true],
    })
  }
})

test("real-shaped receipt recognizes truncated and full remote roots without matching lookalikes", () => {
  const fixture = new URL("./fixtures/demo-profiles/devin-remote-prefix.json", import.meta.url)
  const receipt = JSON.parse(readFileSync(fixture, "utf8"))
  const rows = readProfileTrees(receipt)
  assert.equal(rows.length, 10)
  for (const destination of ["registry.npmjs.org", "full.example", "exact.example"]) {
    const row = rows.find((entry) => entry.destination === destination)
    assert.equal(row.kind, "session-linked")
    assert.equal(row.needsReview, false)
  }
  for (const destination of ["suffix.example", "prefix.example", "example.com", "deep.example", "acting.example", "short-exact.example", "short-prefix.example"]) {
    const row = rows.find((entry) => entry.destination === destination)
    assert.equal(row.kind, "detached-root")
    assert.equal(row.needsReview, true)
  }
  assert.deepEqual(rows.find((row) => row.destination === "registry.npmjs.org").ancestry, ["systemd", "devin-remote-0.", "npm install"])
  assert.equal(captureAllowsComparison(receipt), false)
  assert.equal(attributionKind(["systemd", "devin-remote-0.", "dockerd", "node"]), "container-rooted")
  assert.equal(attributionKind(["systemd", "devin-remote-0.", "Runner.Worker", "node"]), "runner-linked")
  for (const root of ["systemd", "init", "tini", "dumb-init"]) {
    assert.equal(attributionKind([root, "devin-remote-0.", "npm install"]), "session-linked")
    assert.equal(attributionKind([root, "sh", "devin-remote-x", "curl"]), "detached-root")
    assert.equal(attributionKind([root, "sh", "devin-remote-x"]), "detached-root")
    assert.equal(attributionKind([root, "devin-remote-0."]), "detached-root")
  }
  assert.equal(attributionKind(["bash", "devin-remote-0.", "npm install"]), "runner-unlinked")
})

test("CursorPage input rejects unreadable collections and malformed items", () => {
  assert.throws(() => readProfileTrees({ profiles: { items: [] } }), /collection is empty/)
  assert.throws(() => readProfileTrees({ items: [null] }), /Profile must be an object/)
  assert.throws(() => readProfileTrees({ items: [{}] }), /no readable outbound associations/)
  assert.throws(() => readProfileTrees({ profiles: { items: null } }), /no readable outbound associations/)
  assert.equal(attributionKind(["systemd", "devin-remote", "dockerd", "node"]), "container-rooted")
})

test("real-shaped dev-api page skips three association-free items without implying complete capture", () => {
  const fixture = new URL("./fixtures/demo-profiles/devapi-mixed-items.json", import.meta.url)
  const page = JSON.parse(readFileSync(fixture, "utf8"))
  const readable = { items: page.items.filter((item) => item.data.network !== undefined) }
  assert.deepEqual(readProfileTrees(page), readProfileTrees(readable))
  assert.equal(readProfileTrees(page).length, 4)
  assert.equal(captureAllowsComparison(page), false)
  const report = compareProfileTrees(page, readable)
  assert.deepEqual(report.emptyItems, { head: 3, compared: 0 })
  assert.equal(report.comparison, "unavailable")
  assert.equal(report.added, null)
  assert.ok(report.pair.head.includes("62252d4fe153dfac463b65eadc6296c73588cba3"))
  const output = renderProfileTrees(report)
  assert.match(output, /Capture is not complete; additions cannot be determined/)
  assert.match(output, /Head: 3 items carried no outbound associations/)
  assert.doesNotMatch(output, /No outbound actions requiring attribution review/)
  assertVocabClean(output)
  const baseline = compareProfileTrees(readable, { profiles: page })
  assert.deepEqual(baseline.emptyItems, { head: 0, compared: 3 })
  assert.equal(baseline.added, null)
  assert.match(renderProfileTrees(baseline), /Compared: 3 items carried no outbound associations/)
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", fixture.pathname], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /3 items carried no outbound associations/)
})

test("mixed pages count empty associations, but never suppress malformed recorded actions", () => {
  const recorded = profile()
  for (const empty of [{}, { network: {} }, { network: { egress: {} } }]) {
    const page = { items: [{ data: empty }, { data: recorded }] }
    assert.equal(compareProfileTrees(page).emptyItems.head, 1)
    assert.match(renderProfileTrees(compareProfileTrees(page)), /1 item carried no outbound associations/)
    assert.throws(() => readProfileTrees({ items: [{ data: empty }] }), /no readable outbound associations/)
  }
  for (const malformed of [null, { associations: "invalid" }, { associations: [{ ancestry: [] }] }, { associations: [{ remote_names: [4] }] }]) {
    assert.throws(() => readProfileTrees({ items: [recorded, malformed] }))
  }
  assert.throws(() => readProfileTrees({ items: [{}, { network: {} }] }), /no readable outbound associations/)
})

test("present scalar network and egress containers are malformed, not missing data", () => {
  const recorded = profile()
  for (const value of ["invalid", "", 42, 0, false, true, null]) {
    for (const malformed of [{ network: value }, { egress: value }, { network: { egress: value } }]) {
      const error = /Profile carries malformed outbound associations/
      assert.throws(() => readProfileTrees(malformed), error)
      assert.throws(() => readProfileTrees({ ...recorded, ...malformed }), error)
      for (const items of [[recorded, malformed], [malformed, recorded]]) {
        const page = { items: items.map((data) => ({ data })) }
        assert.throws(() => readProfileTrees(page), error)
        assert.throws(() => compareProfileTrees(recorded, page), error)
      }
    }
  }
})

test("explicit empty outbound arrays are recorded zero, not skipped items", () => {
  for (const source of [{ associations: [] }, { egress: [] }, { egress: { unique_domains: [] } }, { network: { egress: { peers: [] } } }]) {
    const zero = { items: [{ data: source }] }
    assert.deepEqual(readProfileTrees(zero), [])
    assert.equal(captureAllowsComparison(zero), true)
    assert.equal(compareProfileTrees(zero).emptyItems, undefined)
    assert.deepEqual(compareProfileTrees(zero, zero).added, [])
    const report = compareProfileTrees({ items: [profile()] }, zero)
    assert.equal(report.comparison, "available")
    assert.ok(report.added.length > 0)
    assert.equal(report.emptyItems, undefined)
    assert.doesNotMatch(renderProfileTrees(report), /carried no outbound associations/)
  }
})

test("an entirely unreadable compared page errors even when comparison is incomplete", () => {
  const fixture = new URL("./fixtures/demo-profiles/no-outbound-items.json", import.meta.url)
  const missing = JSON.parse(readFileSync(fixture, "utf8"))
  for (const base of [missing, { profiles: missing }, { ...missing, capture_quality: "partial" }]) {
    assert.throws(() => compareProfileTrees(profile(), base), /Profile carries no readable outbound associations/)
  }
  const head = new URL("./fixtures/demo-profiles/devapi-mixed-items.json", import.meta.url)
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", head.pathname, "--base", fixture.pathname], { encoding: "utf8" })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /Profile carries no readable outbound associations/)
})

test("real receipt CursorPage data items read through the CLI without manual unwrapping", () => {
  const receipt = JSON.parse(readFileSync(RECEIPT, "utf8"))
  assert.equal(receipt.items.length, 11)
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", RECEIPT.pathname, "--json"], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const report = JSON.parse(child.stdout)
  assert.equal(report.rows.some((row) => row.destination === "example.com"), true)
  assert.equal(report.rows.some((row) => row.destination === "registry.npmjs.org"), true)
  assert.deepEqual(report.rows, readProfileTrees({ profiles: receipt.items.map((item) => item.data) }))
  receipt.items[1].data.capture_quality = "partial"
  assert.equal(captureAllowsComparison(receipt), false)
  assert.throws(() => readProfileTrees({ items: [{ data: null }] }), /Profile must be an object/)
})

test("Devin description completeness limits comparisons through real receipt data windows", () => {
  const receipt = JSON.parse(readFileSync(RECEIPT, "utf8"))
  const complete = receipt.items[0]
  const partial = receipt.items[1]
  assert.match(partial.data.metadata.description, /^completeness=partial;/)
  assert.equal(captureAllowsComparison(complete), true)
  assert.equal(captureAllowsComparison(partial), false)
  assert.equal(captureAllowsComparison(receipt), false)
  for (const [head, base] of [[partial, complete], [complete, partial]]) {
    const report = compareProfileTrees(head, base)
    assert.equal(report.added, null)
    assert.match(renderProfileTrees(report), /Capture is not complete; additions cannot be determined/)
  }
  const child = spawnSync(process.execPath, ["bin/replay.mjs", "profile", RECEIPT.pathname, "--base", RECEIPT.pathname, "--json"], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const report = JSON.parse(child.stdout)
  assert.equal(report.added, null)
  assert.equal(report.comparison, "unavailable")
  assert.match(report.comparisonReason, /additions cannot be determined/)
  assert.equal(captureAllowsComparison({ metadata: { description: "" } }), true)
  assert.equal(captureAllowsComparison({ metadata: { description: "completeness=unknown; command kind=test" } }), false)
  assert.equal(captureAllowsComparison({ metadata: { description: "completeness=complete; completeness=partial" } }), false)
})

test("resolved IPs group with their host across windows without creating comparison additions", () => {
  const receipt = JSON.parse(readFileSync(RECEIPT, "utf8"))
  const rows = readProfileTrees(receipt)
  const curl = rows.filter((row) => row.kind === "detached-root" && row.job === "devin-install" && row.repository === "")
  assert.equal(curl.length, 1)
  assert.equal(curl[0].destination, "example.com")
  assert.deepEqual(curl[0].ancestry, ["systemd", "sh", "curl"])
  assert.deepEqual(curl[0].addresses, ["104.20.23.154", "172.66.147.243"])
  assert.equal(rows.some((row) => row.destination === "104.20.23.154"), false)
  const base = { associations: [{ ancestry: ["systemd", "sh"], process: "curl", remote_names: ["example.com", "192.0.2.1"], remote_ports: [443] }] }
  const head = structuredClone(base)
  head.associations[0].remote_names = ["192.0.2.2", "example.com"]
  assert.deepEqual(compareProfileTrees(head, base).added, [])
  assert.deepEqual(readProfileTrees({ profiles: [base, head, base] })[0].addresses, ["192.0.2.1", "192.0.2.2"])
  head.associations[0].process = "wget"
  assert.equal(compareProfileTrees(head, base).added.length, 1)
  assert.equal(readProfileTrees({ profiles: [base, head] }).length, 2)
})

test("review headings cover only flagged rows, with neutral actions in a separate section", () => {
  const report = compareProfileTrees(JSON.parse(readFileSync(RECEIPT, "utf8")))
  const text = renderProfileTrees(report)
  const [review, neutral] = text.split("**Other recorded outbound actions**")
  assert.match(review, /detached-root/)
  assert.doesNotMatch(review, /session-linked|runner-linked|runner-background/)
  assert.match(neutral, /session-linked/)
  assert.doesNotMatch(neutral, /detached-root|Needs review:/)
  const reviewOnly = renderProfileTrees(report, { reviewOnly: true })
  assert.doesNotMatch(reviewOnly, /Other recorded outbound actions|session-linked/)
  assert.match(reviewOnly, /detached-root/)
  const ordinary = compareProfileTrees({ associations: [{ remote_names: ["example.org"], ancestry: ["Runner.Worker", "node"] }] })
  assert.doesNotMatch(renderProfileTrees(ordinary), /Needs review:/)
  assert.match(renderProfileTrees(ordinary), /Other recorded outbound actions/)
  const card = renderCard(buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: comment(), attribution: report }))
  assert.match(card, /detached-root/)
  assert.doesNotMatch(card, /session-linked/)
})

test("CursorPages with further pages withhold additions and explain the missing pages", () => {
  const receipt = JSON.parse(readFileSync(new URL("./fixtures/demo-profiles/devin-cursor-receipt.json", import.meta.url), "utf8"))
  assert.equal(captureAllowsComparison(receipt), true)
  for (const pagination of [
    { has_more: true }, { next_cursor: "next-page" }, { nextCursor: "next-page" },
    { pageInfo: { hasNextPage: true } }, { pageInfo: { nextCursor: "next-page" } },
    { page_info: { has_more: true } },
  ]) {
    const incomplete = structuredClone(receipt)
    Object.assign(incomplete.profiles, pagination)
    assert.equal(captureAllowsComparison(incomplete), false)
    for (const [head, base] of [[incomplete, receipt], [receipt, incomplete], [incomplete, null]]) {
      const report = compareProfileTrees(head, base)
      assert.equal(report.added, null)
      assert.equal(report.rows.length, 4)
      assert.match(renderProfileTrees(report), /Profile pages are missing; additions cannot be determined/)
      assertVocabClean(renderProfileTrees(report))
    }
  }
  assert.equal(captureAllowsComparison({ ...receipt, has_more: true }), false)
  assert.equal(captureAllowsComparison({ ...receipt, pageInfo: { hasNextPage: false, endCursor: "last-item" } }), true)
})

test("CursorPages missing previous pages cannot determine additions", () => {
  const receipt = JSON.parse(readFileSync(new URL("./fixtures/demo-profiles/devin-cursor-receipt.json", import.meta.url), "utf8"))
  assert.equal(captureAllowsComparison({ ...receipt, previous: PREVIOUS }), true)
  for (const pagination of [
    { previous_cursor: "earlier" }, { previousCursor: "earlier" }, { prev_cursor: "earlier" },
    { has_previous: true }, { hasPrevious: true }, { has_prev: true },
    { pageInfo: { hasPreviousPage: true } }, { pageInfo: { previousCursor: "earlier" } },
    { page_info: { has_previous_page: true } },
  ]) {
    const incomplete = structuredClone(receipt)
    Object.assign(incomplete.profiles, pagination)
    assert.equal(captureAllowsComparison(incomplete), false)
    for (const [head, base] of [[incomplete, receipt], [receipt, incomplete], [incomplete, null]]) {
      const report = compareProfileTrees(head, base)
      assert.equal(report.added, null)
      assert.equal(report.rows.length, 4)
      assert.match(renderProfileTrees(report), /Profile pages are missing; additions cannot be determined/)
    }
  }
  for (const previous_cursor of [null, ""]) {
    assert.equal(captureAllowsComparison({ ...receipt, previous_cursor, has_previous: false, pageInfo: { hasPreviousPage: false, startCursor: "first-item" } }), true)
  }
})

test("finalized PR profile fetching reuses exact selectors and binds both comparison sides", async () => {
  const calls = []
  const before = profile(PREVIOUS, TREES.profiles[0].associations.slice(0, 3))
  const report = await profileAttributionForComment({ comment: comment(), comments: [comment(PREVIOUS, BASE_LINK)], headSha: HEAD, repository: "garnet-labs/example" }, {
    fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({ profile: url.includes("/122?") ? before : profile() }) } },
  })
  assert.equal(report.added.length, 5)
  assert.equal(calls.length, 2)
  assert.equal(calls[0], LINK.replace("/public/", "/api/public/"))
  assert.equal(calls[1], BASE_LINK.replace("/public/", "/api/public/"))
})

test("PR reader fails closed on stale, unreadable or identity-mismatched profiles", async () => {
  const input = { comment: comment(), headSha: HEAD, repository: "garnet-labs/example" }
  const unreadable = await profileAttributionForComment(input, { fetchImpl: async () => { throw new Error("offline") } })
  assert.match(unreadable.error, /offline/)
  const mismatch = await profileAttributionForComment(input, { fetchImpl: async () => ({ ok: true, json: async () => ({ profile: profile(PREVIOUS) }) }) })
  assert.match(mismatch.error, /identity/)
  const stale = await profileAttributionForComment({ ...input, headSha: PREVIOUS }, { fetchImpl: () => assert.fail("stale record must not be fetched") })
  assert.match(stale.error, /No finalized/)
  const malformed = await profileAttributionForComment(input, { fetchImpl: async () => ({ ok: true, json: async () => ({ profile: { run: profile().run } }) }) })
  assert.match(malformed.error, /no readable outbound/)
})

test("a marker from a different commenter cannot supply the compared receipt", async () => {
  const forged = { ...comment(PREVIOUS, BASE_LINK), user: { login: "someone-else" } }
  for (const head of [comment(), { ...comment(), user: "garnet-runtime-review[bot]" }]) {
    const calls = []
    const report = await profileAttributionForComment({ comment: head, comments: [forged], headSha: HEAD, repository: "garnet-labs/example" }, {
      fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({ profile: profile() }) } },
    })
    assert.equal(report.added, null)
    assert.equal(report.review.length, 5)
    assert.deepEqual(calls, [LINK.replace("/public/", "/api/public/")])
  }
})

test("declared capture limits on either side prevent additions but retain head review rows", async () => {
  for (const changes of [{ capture_quality: "partial" }, { capture_quality: "not-complete" }, { capture_quality: "best-effort" }, { capture: { status: "partial" } }, { incomplete: 1 }]) {
    for (const side of ["head", "compared"]) {
      const head = profile()
      const compared = profile(PREVIOUS)
      Object.assign(side === "head" ? head : compared, changes)
      const report = compareProfileTrees(head, compared)
      assert.equal(report.added, null)
      assert.equal(report.review.length, 5)
      assert.match(renderProfileTrees(report), /Capture is not complete; additions cannot be determined/)
    }
  }
  for (const side of [HEAD, PREVIOUS]) {
    for (const changes of [{ capture_quality: "partial" }, { capture_quality: "not-complete" }, { capture_quality: "best-effort" }, { incomplete: 1 }]) {
      const limited = comment(side, side === HEAD ? LINK : BASE_LINK)
      limited.body = limited.body.replace(/<!-- garnet:summary (.*?) -->/, (_match, raw) => `<!-- garnet:summary ${JSON.stringify({ ...JSON.parse(raw), ...changes })} -->`)
      const report = await profileAttributionForComment({ comment: side === HEAD ? limited : comment(), comments: [side === PREVIOUS ? limited : comment(PREVIOUS, BASE_LINK)], headSha: HEAD, repository: "garnet-labs/example" }, {
        fetchImpl: async () => ({ ok: true, json: async () => ({ profile: profile() }) }),
      })
      assert.equal(report.added, null)
      assert.equal(report.review.length, 5)
      assert.match(renderProfileTrees(report), /Capture is not complete; additions cannot be determined/)
    }
  }
  const empty = compareProfileTrees({ associations: [], capture_quality: "partial" }, { associations: [] })
  assert.match(renderProfileTrees(empty), /additions cannot be determined/)
})

test("PR reader explicitly keeps comparison unavailable if the compared record is missing or unreadable", async () => {
  const input = { comment: comment(), comments: [comment(PREVIOUS, BASE_LINK)], headSha: HEAD, repository: "garnet-labs/example" }
  const options = { fetchImpl: async (url) => { if (url.includes("/122?")) throw new Error("missing compared profile"); return { ok: true, json: async () => ({ profile: profile() }) } } }
  const report = await profileAttributionForComment(input, options)
  assert.equal(report.review.length, 5)
  assert.equal(report.added, null)
  const missing = await profileAttributionForComment({ ...input, comments: [] }, options)
  assert.equal(missing.added, null)
  assert.deepEqual(missing.pair.compared, [PREVIOUS])
  assert.equal(missing.pair.scope, "previous-push")
  const reused = await profileAttributionForComment({ ...input, comments: [comment(PREVIOUS, LINK)] }, options)
  assert.equal(reused.added, null, "a cached head selector must not stand in for the compared commit")
})

test("cards and verification expose attribution independently of an otherwise no-new-workload result", () => {
  const input = { slug: "example", forkPr: 1, headSha: HEAD, comment: comment() }
  const original = buildModel(input)
  assert.equal(original.verdict, "unchanged")
  const attribution = compareProfileTrees(profile(), profile(PREVIOUS, TREES.profiles[0].associations.slice(0, 3)))
  const model = buildModel({ ...input, attribution })
  assert.equal(model.verdict, original.verdict)
  assert.equal(model.reason, original.reason)
  const card = renderCard(model)
  assert.match(card, /Needs review: not attributable to the runner/)
  assert.match(card, /5 added actions/)
  assert.match(card, /curl/)
  const verify = renderVerifyReport({ status: "PASS", head: HEAD, legs: [{ name: "example", ok: true, detail: "existing check" }], attribution })
  assert.match(verify, /^PASS/)
  assert.match(verify, /\[note\] Attribution needs review/)
  assert.match(verify, /5 added actions/)
  assert.match(renderCard(buildModel({ ...input, attribution: { error: "offline" } })), /attribution could not be read/)
  assert.doesNotMatch(renderCard(buildModel({ ...input, attribution: compareProfileTrees(profile(PREVIOUS, TREES.profiles[0].associations.slice(0, 3))) })), /Attribution review/)
})

test("card vocabulary and width guards check attribution copy but exempt quoted profile values", () => {
  const input = { slug: "example", forkPr: 1, headSha: HEAD, comment: comment() }
  const attribution = compareProfileTrees({ run: { workflow: `clean${"x".repeat(120)}` }, associations: [{ remote_names: [`clean${"x".repeat(120)}`], ancestry: ["init", "curl"] }] })
  assert.doesNotThrow(() => renderCard(buildModel({ ...input, attribution })))
  assert.throws(() => renderCard(buildModel({ ...input, attribution: { ...attribution, comparisonReason: "clean" } })), /banned vocabulary/)
  assert.throws(() => renderCard(buildModel({ ...input, attribution: { ...attribution, comparisonReason: "x".repeat(97) } })), /renderer-owned line exceeds phone width/)
  assert.match(renderCard(buildModel({ ...input, attribution })), /Needs review: not attributable to the runner/)
})

test("live verifier keeps its existing status and adds a review note without refetching head profiles", async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    let body
    if (url.includes("/api/public/")) body = { profile: url.includes("/122?") ? profile(PREVIOUS, TREES.profiles[0].associations.slice(0, 3)) : profile() }
    else if (url.includes("/public/")) return { status: 200 }
    else if (url.includes("/pulls/1")) body = { head: { sha: HEAD }, base: { sha: PREVIOUS }, state: "open", body: "", labels: [] }
    else if (url.includes("/comments?")) body = [comment(PREVIOUS, BASE_LINK), comment()]
    else if (url.includes("/check-runs?")) body = { check_runs: [{ name: "Garnet", status: "completed", conclusion: "success" }] }
    else if (url.includes("/jobs?")) body = { jobs: [{ id: 1, name: "install", steps: [{ name: "Run garnet-org/action", conclusion: "success" }] }] }
    else if (url.endsWith("/logs")) return { ok: true, text: async () => "Garnet Run Profile report: ok" }
    else assert.fail(`Unexpected URL ${url}`)
    return { ok: true, json: async () => body }
  }
  const result = await verifyExhibit("https://github.com/garnet-labs/example/pull/1", { fetchImpl, exec: (_command, args) => kitResponse(args) })
  assert.equal(result.status, "PASS", JSON.stringify(result.reasons))
  assert.equal(result.attribution.added.length, 5)
  assert.equal(calls.filter((url) => url.includes("/api/public/runs/123?")).length, 1)
  assert.match(renderVerifyReport(result), /\[note\] Attribution needs review/)
})

test("card command reader fetches raw profiles and keeps a missing comparison explicit", async () => {
  const result = await cardForPr({ slug: "example", fork: "garnet-labs/example" }, 1, {
    write: false,
    exec: (_command, args) => args[0] === "pr" ? JSON.stringify({ headRefOid: HEAD }) : JSON.stringify([comment()]),
    fetchImpl: async () => ({ ok: true, json: async () => ({ profile: profile() }) }),
  })
  assert.equal(result.row.verdict, buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: comment() }).verdict)
  assert.match(result.card, /Compared profile unavailable; additions cannot be determined/)
  assert.match(result.card, /curl/)
})
