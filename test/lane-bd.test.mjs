import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

import { assessLiveReplaySupport } from "../lib/gate.mjs"
import { executionDiffFromProfiles } from "../lib/execution-diff.mjs"
import { validate } from "../lib/validate.mjs"

const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
const seeds = JSON.parse(await readFile(new URL("../seeds/seeds.json", import.meta.url), "utf8"))

test("live gate reports observation-only constraints", () => {
  const supported = assessLiveReplaySupport({
    repoMeta: { private: false },
    prMeta: { title: "Update ms from 2.1.2 to 2.1.3", user: { login: "dependabot[bot]" } },
    files: [{ filename: "package.json" }, { filename: "package-lock.json" }],
  })
  assert.equal(supported.supported, true)
  assert.deepEqual(supported.reasons, ["Linux is required"])

  const unsupported = assessLiveReplaySupport({ repoMeta: { private: true }, files: [] })
  assert.equal(unsupported.supported, false)
  assert.ok(unsupported.reasons.includes("repository is not public"))
  assert.ok(unsupported.reasons.includes("no npm/pnpm/yarn lockfile"))
  assert.doesNotMatch(unsupported.reasons.join(" "), /\b(?:unsafe|risky|verified)\b/i)
})

test("live replay workflow uses GitHub OIDC by default", async () => {
  const workflow = await readFile("live/templates/garnet-dependency-replay.yml", "utf8")
  assert.match(workflow, /garnet-org\/action@e546567a72e4fede11ec39d6e9f75b539adef22c/)
  assert.match(workflow, /^\s+id-token: write$/m)
  assert.match(workflow, /^\s+#\s+api_token: \$\{\{ secrets\.GARNET_API_TOKEN \}\}$/m)
  assert.doesNotMatch(workflow, /^\s+api_token:/m)
  assert.doesNotMatch(workflow, /GARNET_API_TOKEN is not set/)
  assert.match(workflow, /OIDC needs id-token: write and is unavailable on fork pull requests/)
})

test("constructed profile diffs preserve workload and runner background sections", async () => {
  const base = JSON.parse(await readFile("test/fixtures/demo-profiles/30304258281.json", "utf8"))
  const profile = JSON.parse(await readFile("test/fixtures/demo-profiles/30304293294.json", "utf8"))
  const raw = profile.profiles[0]
  const diff = executionDiffFromProfiles({
    baseline: base,
    update: profile,
    meta: {
      label: "constructed",
      repository: "garnet-labs/garnet-runtime-review-demo",
      prNumber: 30304293294,
      headSha: raw.run.commit_sha,
      runId: raw.run.run_id,
      comparisonScope: "constructed-pair",
      baseReceiptUrl: "https://app.garnet.ai/public/runs/30304258281?profile=019fa558-63f3-7d3f-b208-8258d1755c50",
    },
  })
  assert.deepEqual(validate(schema, diff), [])
  assert.equal(diff.mode, "live-replay")
  assert.deepEqual(diff.comparison, { available: true, scope: "constructed-pair" })
  assert.deepEqual(diff.execution_diff.network_added.filter((entry) => entry.section === "workload").map((entry) => entry.destination), ["httpbin.org"])
  const background = diff.execution_diff.network_added.filter((entry) => entry.section === "runner background")
  assert.ok(background.some((entry) => entry.process === "hosted-compute-agent"))
  assert.ok(background.some((entry) => entry.process === "provjobd"))
  assert.ok(diff.execution_diff.totals.runner_background.added > 0)
})

test("every seed points to a schema-valid replay", async () => {
  for (const seed of seeds) {
    assert.ok(["real", "constructed"].includes(seed.label))
    const replayPath = seed.replay_json.replace(/^\/?replays\//, "public/replays/")
    await access(replayPath)
    const replay = JSON.parse(await readFile(replayPath, "utf8"))
    assert.deepEqual(validate(schema, replay), [], seed.id)
    if (seed.label === "constructed") assert.match(seed.note, /constructed/)
  }
  assert.equal(seeds.length, 24)
  assert.equal(seeds.filter((seed) => seed.label === "real").length, 20)
  assert.equal(seeds.filter((seed) => seed.label === "constructed").length, 4)
})

test("constructed replay titles follow seed metadata", async () => {
  for (const seed of seeds.filter((entry) => entry.label === "constructed")) {
    const replayPath = seed.replay_json.replace(/^\/?replays\//, "public/replays/")
    const replay = JSON.parse(await readFile(replayPath, "utf8"))
    assert.equal(replay.pull_request.title, seed.title, seed.id)
  }
})
