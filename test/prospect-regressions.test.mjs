import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { buildModel, classify, extractChains, recordedEvidence, renderCard } from "../lib/card.mjs"
import { livePr } from "../lib/commands.mjs"
import { publicProfile } from "../lib/gh.mjs"
import { detectEcosystem, planReplay } from "../lib/replay-pr.mjs"
import { publicProfileIdentity, verifyExhibit } from "../lib/verify.mjs"

const HEAD = "a".repeat(40)
const PREVIOUS = "b".repeat(40)
const PROFILE = "00000000-0000-4000-8000-000000000000"
const LINK = `https://app.garnet.ai/public/runs/123?profile=${PROFILE}`
const RUN = { repository: "garnet-labs/example", run_id: "123", profile_id: PROFILE, commit_sha: HEAD, ref: "refs/heads/change" }

function record(capture = "complete", link = LINK) {
  return `<!-- garnet-runtime-review -->
<!-- garnet:commit ${HEAD} -->
<!-- garnet:summary ${JSON.stringify({ status: "finalized", commit: HEAD, previous: PREVIOUS, capture_quality: capture, changed: 0, added: 0, removed: 0 })} -->
> *1 job unchanged*
<details open><summary>Dependency installation</summary>

\`\`\`text
Runner.Worker
└─ node (step: "Install dependencies")
${Array.from({ length: 9 }, (_, i) => `   ├─ ○ registry${i}.example`).join("\n")}
\`\`\`

[View this job's Execution Profile in Garnet →](${link})
</details>

<details><summary>How to read this</summary>

\`\`\`text
example
└─ ○ teaching.example
\`\`\`
</details>`
}

function profileCheck(run = RUN) {
  return publicProfileIdentity({ profile: { run }, permalink: LINK, repository: RUN.repository, headSha: HEAD })
}

test("card scope follows the recorded pair when the ledger identifies commit 1", () => {
  const input = { slug: "example", forkPr: 1, headSha: HEAD, comment: { body: record() } }
  assert.equal(buildModel({ ...input, replay: { firstSha: PREVIOUS, scope: "pr-base-to-head" } }).scope, "immediate-parent-to-head")
  assert.equal(buildModel({ ...input, replay: { firstSha: "c".repeat(40), scope: "immediate-parent-to-head" } }).scope, "previous-recorded-head-to-head")
})

test("public report identity requires repository, run, profile and the exact head", () => {
  assert.equal(profileCheck().ok, true)
  for (const patch of [
    { commit_sha: PREVIOUS, ref: "refs/pull/1/merge" },
    { repository: "garnet-labs/elsewhere" },
    { run_id: "124" },
    { profile_id: "11111111-1111-4111-8111-111111111111" },
    { commit_sha: HEAD.slice(0, 7) },
  ]) {
    assert.equal(profileCheck({ ...RUN, ...patch }).ok, false)
  }
  assert.equal(publicProfileIdentity({ profile: null, permalink: LINK, repository: RUN.repository, headSha: HEAD }).ok, false)
  assert.match(profileCheck({ ...RUN, commit_sha: PREVIOUS, ref: "refs/pull/1/merge" }).detail, /refs\/pull\/1\/merge/)
})

test("public JSON is fetched anonymously from only the supported selector", async () => {
  const calls = []
  const selected = await publicProfile(`${LINK}&utm_source=github`, { fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ profile: { run: RUN } }) }
  } })
  assert.deepEqual(selected, { run: RUN })
  assert.equal(calls[0].url, `https://app.garnet.ai/api/public/runs/123?profile=${PROFILE}`)
  assert.equal(calls[0].options.headers, undefined)
  assert.equal(calls[0].options.redirect, "error")
  for (const link of ["not a URL", "https://other.example/public/runs/123", "https://app.garnet.ai/public/runs/123", `${LINK.split("?")[0]}?profile=bad`, `${LINK}&profile=${PROFILE}`]) {
    await assert.rejects(publicProfile(link, { fetchImpl: () => assert.fail("must not fetch malformed selector") }))
  }
  await assert.rejects(publicProfile(LINK, { fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/)
  await assert.rejects(publicProfile(LINK, { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON") } }) }), /invalid JSON/)
})

function fetchExhibit(run, body = record()) {
  return async (url, options) => {
    if (url.startsWith("https://app.garnet.ai/api/")) {
      assert.equal(options.headers, undefined)
      return { ok: true, status: 200, json: async () => ({ profile: { run } }) }
    }
    if (url.startsWith("https://app.garnet.ai/public/")) return { status: 200 }
    if (url.includes("/pulls/1")) return { ok: true, json: async () => ({ head: { sha: HEAD }, base: { sha: PREVIOUS }, state: "open", body: "", labels: [] }) }
    if (url.includes("/comments?")) return { ok: true, json: async () => [{ user: { login: "garnet-runtime-review[bot]" }, body }] }
    if (url.includes("/check-runs?")) return { ok: true, json: async () => ({ check_runs: [{ name: "Garnet", status: "completed", conclusion: "success" }] }) }
    assert.fail(`unexpected fetch ${url}`)
  }
}

test("live verification rejects HTTP 200 with merge-ref or missing identity", async () => {
  const url = "https://github.com/garnet-labs/example/pull/1"
  const good = await verifyExhibit(url, { fetchImpl: fetchExhibit(RUN) })
  assert.equal(good.status, "PASS")
  for (const run of [{ ...RUN, commit_sha: PREVIOUS, ref: "refs/pull/1/merge" }, undefined]) {
    const result = await verifyExhibit(url, { fetchImpl: fetchExhibit(run) })
    assert.equal(result.status, "FAIL")
    assert.equal(result.legs.find((entry) => entry.name === "public permalink").ok, true)
    assert.equal(result.legs.find((entry) => entry.name === "public profile identity").ok, false)
  }
  const missing = await verifyExhibit(url, { fetchImpl: fetchExhibit(RUN, record("complete", "https://app.garnet.ai")) })
  assert.equal(missing.status, "FAIL")
  assert.ok(missing.reasons.some((reason) => reason.includes("no exact public")))
})

test("cards preserve every unchanged workload row and owning job, without teaching examples", () => {
  const body = record()
  const model = buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: { body }, replay: { scope: "pr-base-to-head", firstSha: PREVIOUS } })
  const card = renderCard(model)
  assert.equal(model.verdict, "unchanged")
  assert.equal(model.scope, "immediate-parent-to-head")
  assert.equal(extractChains(body).length, 9)
  assert.ok(card.includes(recordedEvidence(body)))
  assert.equal((card.match(/○ registry/g) ?? []).length, 9)
  assert.equal((card.match(/View this job's Execution Profile in Garnet/g) ?? []).length, 1)
  assert.doesNotMatch(card, /teaching\.example|How to read this/)
  assert.match(card, /Reviewer outcome: not recorded on this card/)
  assert.equal(buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: { body } }).scope, "previous-recorded-head-to-head")
})

test("partial and absent captures remain undeterminable while retaining recorded rows", async () => {
  for (const capture of ["partial", "none", "not-declared", null]) {
    const body = record(capture)
    assert.equal(classify({ comment: { body }, headSha: HEAD }).verdict, "undeterminable")
    const card = renderCard(buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: { body } }))
    assert.match(card, /Capture is incomplete/)
    assert.equal((card.match(/○ registry/g) ?? []).length, 9)
    assert.match(card, new RegExp(PREVIOUS))
    const verified = await verifyExhibit("https://github.com/garnet-labs/example/pull/1", { fetchImpl: fetchExhibit(RUN, body) })
    assert.equal(verified.status, "FAIL")
    assert.equal(verified.legs.find((entry) => entry.name === "capture completeness").ok, false)
  }
  const legacy = record().replace(/,"capture_quality":"complete"/, "")
  assert.equal(classify({ comment: { body: legacy }, headSha: HEAD }).verdict, "undeterminable")
  const body = `<!-- garnet:replay ${JSON.stringify({ head: HEAD, verdict: "new-behavior", capture: "partial", final: true })} -->`
  assert.equal(classify({ comment: { body }, headSha: HEAD }).verdict, "undeterminable")
})

test("cards exclude open and multiline teaching folds without removing recorded jobs", () => {
  for (const heading of [
    "<details open><summary><sub>💡 How to read this</sub></summary>",
    '<details class="guide" open>\n<summary>\nReading this\n</summary>',
  ]) {
    const body = record().replace("<details><summary>How to read this</summary>", heading)
    const card = renderCard(buildModel({ slug: "example", forkPr: 1, headSha: HEAD, comment: { body } }))
    assert.equal(extractChains(body).length, 9)
    assert.equal((card.match(/○ registry/g) ?? []).length, 9)
    assert.equal((card.match(/View this job's Execution Profile in Garnet/g) ?? []).length, 1)
    assert.doesNotMatch(card, /teaching\.example|How to read this|Reading this/)
  }
})

test("mixed ecosystem paths require an explicit selection and generated bodies include setup files", () => {
  assert.equal(detectEcosystem(["package-lock.json", "uv.lock"]), null)
  assert.equal(detectEcosystem(["package-lock.json", "nested/pnpm-lock.yaml"]), "npm")
  const paths = Array.from({ length: 9 }, (_, i) => `packages/${i}/package.json`)
  const plan = planReplay({
    slug: "example", upstream: "upstream/example", fork: "garnet-labs/example", defaultBranch: "main",
    upstreamPr: 1, upstreamTitle: "Refresh dependencies", baseSha: PREVIOUS, headSha: HEAD,
    changes: paths.map((path) => ({ path, status: "modified", previous: null })),
    work: "/work/example", workExists: true, record: "inject", ecosystem: "npm", dependabotConfigured: false,
  })
  for (const path of paths) assert.ok(plan.body.includes(`- ${path}`))
  assert.doesNotMatch(plan.body, /and \d+ more/)
  assert.match(plan.body, /2 additional files:\n\n- \.github\/workflows\/garnet-record\.yml\n- \.github\/dependabot\.yml/)
})

test("agent CLI rejects the unsupported verify slug form with a nonzero exit", () => {
  const result = spawnSync(process.execPath, ["bin/replay.mjs", "verify", "example", "--pr", "1"], { encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /verify requires a pull request url/)
})

test("injected replay preserves Dependabot policy at its selected base and checks recorder health", async () => {
  for (const mode of [[], ["--base-branch", "review/control"], ["--sync-fork"]]) {
    const reads = []
    const exec = (command, args) => {
      assert.equal(command, "gh")
      reads.push(args)
      if (args[0] === "repo") return JSON.stringify({ defaultBranchRef: { name: "main" } })
      if (args[0] === "pr") return "[]"
      const path = args[1]
      if (path.includes("/git/trees/")) return '{"tree":[]}'
      if (path.endsWith("/pulls/1/files")) return '[{"filename":"package.json","status":"modified"}]'
      if (path.endsWith("/pulls/1")) return JSON.stringify({ title: "Refresh dependencies", base: { sha: PREVIOUS }, head: { sha: HEAD } })
      if (path.includes("/contents/.github/dependabot.yml")) {
        const repo = mode.length === 0 ? "garnet-labs/posthog" : "PostHog/posthog"
        const ref = mode.length === 0 ? "main" : PREVIOUS
        assert.equal(path, `repos/${repo}/contents/.github/dependabot.yml?ref=${ref}`)
        return '{"type":"file"}'
      }
      if (path.includes("/contents/package.json")) return '{"sha":"same-blob"}'
      assert.fail(`unexpected command ${args.join(" ")}`)
    }
    const result = await livePr(["posthog", "--pr", "1", "--record", "inject", "--ecosystem", "npm", "--dry-run", ...mode], { exec, log: () => {}, save: () => assert.fail("dry run must not save") })
    assert.equal(result.executed, false)
    assert.equal(result.health.verdict, "none")
    assert.equal(reads.filter((args) => args[0] === "pr").length, 1)
    assert.ok(reads.some((args) => args[1]?.includes("/contents/.github/dependabot.yml")))
    assert.doesNotMatch(result.plan.body, /- \.github\/dependabot\.yml/)
  }
})
