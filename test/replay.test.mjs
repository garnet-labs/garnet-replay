import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { buildExecutionDiff, renderExecutionDiffText } from "../lib/execution-diff.mjs"
import { knownEvidence } from "../lib/known-evidence.mjs"
import { parsePrUrl, parseReceipt, isGarnetComment } from "../lib/receipt.mjs"
import { validate } from "../lib/validate.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const corpus = JSON.parse(await readFile(join(HERE, "fixtures/posthog-corpus.json"), "utf8"))
const blocks = JSON.parse(await readFile(join(HERE, "fixtures/posthog-blocks.json"), "utf8"))
const schema = JSON.parse(await readFile(join(ROOT, "schema/execution-diff.schema.json"), "utf8"))

test("receipt parsing preserves exact-head summaries for the corpus", () => {
  assert.equal(corpus.prs.length, 50)
  for (const pr of corpus.prs) {
    const receipt = parseReceipt(pr.garnet_comment_body)
    assert.equal(receipt.markerCommit, pr.head_sha)
    assert.deepEqual(receipt.summary, pr.garnet_summary)
    assert.equal(receipt.profileId?.length, 36)
    assert.match(receipt.runId, /^\d+$/)
  }
})

test("receipt URL and comment classification are explicit", () => {
  assert.deepEqual(parsePrUrl("https://github.com/garnet-labs/posthog/pull/139"), {
    owner: "garnet-labs",
    repo: "posthog",
    number: 139,
  })
  assert.throws(() => parsePrUrl("https://gitlab.com/garnet-labs/posthog/-/merge_requests/139"))
  assert.equal(isGarnetComment({ user: { login: "garnet-runtime-review[bot]" }, body: "" }), true)
  assert.equal(isGarnetComment({ user: { login: "someone" }, body: "<!-- garnet-runtime-review -->" }), true)
  assert.equal(isGarnetComment({ user: { login: "someone" }, body: "ordinary comment" }), false)
})

test("execution diff maps every corpus receipt and preserves destination parity", () => {
  for (const pr of corpus.prs) {
    const diff = buildExecutionDiff(pr)
    assert.notEqual(diff, null)
    assert.deepEqual(validate(schema, diff), [])
    const expected = blocks[String(pr.pr_number)].block.network_evidence
    const normalize = (entries) => entries.map((entry) => ({
      ...entry,
      process: null,
      ancestry: [],
    }))
    assert.deepEqual(diff.execution_diff.network_added, normalize(expected.added))
    assert.deepEqual(diff.execution_diff.network_removed, normalize(expected.removed))
  }
})

test("execution diff returns null for stale and incomplete receipts", () => {
  assert.equal(buildExecutionDiff({ garnet_exact_head: false, garnet_summary: {} }), null)
  assert.equal(buildExecutionDiff({ garnet_exact_head: true, garnet_summary: null }), null)
})

test("rendered execution diff keeps the known evidence line shapes", () => {
  const pr = corpus.prs.find((entry) => entry.pr_number === 139)
  const diff = buildExecutionDiff(pr)
  const expected = blocks["139"].rendered.split("\n")
  const actual = renderExecutionDiffText(diff).split("\n")
  for (const prefix of ["receipt_id:", "head:", "compared with previous recorded head:"]) {
    assert.equal(actual.find((line) => line.startsWith(prefix)), expected.find((line) => line.startsWith(prefix)))
  }
})

test("validator rejects a document with a bad required field and extra property", () => {
  const diff = buildExecutionDiff(corpus.prs[0])
  const bad = structuredClone(diff)
  delete bad.head.sha
  bad.extra = true
  const errors = validate(schema, bad)
  assert.ok(errors.includes("$.head.sha"))
  assert.ok(errors.includes("$.extra"))
})

test("vendored renderer files are byte-identical to their source SHA", () => {
  const sha = execFileSync("cat", ["renderer/VENDORED_FROM"], { cwd: ROOT, encoding: "utf8" }).trim()
  for (const name of ["review.mjs", "demo.mjs"]) {
    const upstream = execFileSync("git", [
      "-C", "/home/ubuntu/repos/garnet-ui", "show", `${sha}:cmd/garnet-runtime-review/${name}`,
    ])
    const local = execFileSync("cat", [`renderer/${name}`], { cwd: ROOT })
    assert.deepEqual(local, upstream, name)
  }
})

test("renderer demo self-check passes", () => {
  execFileSync("node", ["renderer/demo.mjs", "--assert"], { cwd: ROOT, stdio: "pipe" })
})

test("seed-from-corpus writes one JSON replay per exact-head PR", async () => {
  const out = await mkdtemp(join(tmpdir(), "garnet-replay-"))
  try {
    execFileSync("node", [
      "bin/replay.mjs", "seed-from-corpus", "test/fixtures/posthog-corpus.json", "--out", out,
    ], { cwd: ROOT, stdio: "pipe" })
    const files = execFileSync("find", [join(out, "github"), "-type", "f", "-name", "*.json"], { encoding: "utf8" })
      .trim().split("\n")
    assert.equal(files.length, 50)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})

test("known evidence reports no record without making a network request", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 })
  try {
    await assert.rejects(() => knownEvidence("https://github.com/example/project/pull/1"), /GitHub API 404/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
