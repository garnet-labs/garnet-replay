import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fork as forkCommand } from "../lib/commands.mjs"
import { executePlan, instrumentWorkflow, planRefresh, planReplay, renderPlan, renderRefreshPlan } from "../lib/replay-pr.mjs"

const fixture = (name) => readFile(join("test/fixtures/workflows", name), "utf8")

test("instrumentWorkflow adds the sensor after checkout with matrix gating and permissions", async () => {
  const body = await fixture("continuedev_continue-cli-pr-checks.yml")
  const result = instrumentWorkflow(body, { job: "test" })
  const start = result.content.indexOf("  test:")
  const end = result.content.indexOf("\n  lint:", start + 4)
  const job = result.content.slice(start, end < 0 ? undefined : end)
  assert.match(job, /- name: Checkout code[\s\S]*- uses: garnet-org\/action@e546567a72e4fede11ec39d6e9f75b539adef22c/)
  assert.match(job, /if: runner\.os == 'Linux'/)
  assert.match(job, /runs-on: \$\{\{ matrix\.os \}\}\n    permissions:\n      contents: read\n      id-token: write/)
  assert.equal(result.content.slice(0, start), body.slice(0, start))
})

test("instrumentWorkflow replaces a literal runner without matrix gating", async () => {
  const body = await fixture("anomalyco_opencode-typecheck.yml")
  const result = instrumentWorkflow(body, { job: "typecheck", runsOn: "ubuntu-24.04" })
  assert.match(result.content, /runs-on: ubuntu-24\.04/)
  assert.doesNotMatch(result.content, /garnet-org\/action@[^\n]+\n\s+if: runner\.os/)
  assert.match(result.content, /permissions:\n\s+contents: read\n\s+id-token: write/)
})

test("instrumentWorkflow drops jobs and dangling needs", async () => {
  const body = await fixture("OpenHands_OpenHands-ci.yml")
  const result = instrumentWorkflow(body, { job: "test-and-build", dropJobs: ["live-e2e"] })
  assert.doesNotMatch(result.content, /^\s+live-e2e:/m)
  assert.doesNotMatch(result.content, /needs:\s*\[[^\]]*live-e2e/)
  assert.match(result.content, /test-and-build:[\s\S]*garnet-org\/action@[\s\S]*if: runner\.os == 'Linux'/)
})

test("instrumentWorkflow handles the remaining workflow fixtures", async () => {
  for (const [name, job] of [
    ["modelcontextprotocol_servers-python.yml", "test"],
    ["langchain-ai_open-swe-ci.yml", "unit-tests"],
  ]) {
    const result = instrumentWorkflow(await fixture(name), { job })
    assert.match(result.content, new RegExp(`${job}:[\\s\\S]*garnet-org/action@`))
    assert.match(result.content, /contents: read/)
    assert.match(result.content, /id-token: write/)
    assert.ok(result.content.indexOf("actions/checkout") < result.content.indexOf("garnet-org/action@"))
  }
})

test("instrumentWorkflow rejects invalid requests", async () => {
  const body = await fixture("continuedev_continue-cli-pr-checks.yml")
  assert.throws(() => instrumentWorkflow(body, { job: "missing" }), /workflow has no job missing/)
  const once = instrumentWorkflow(body, { job: "test" })
  assert.throws(() => instrumentWorkflow(once.content, { job: "test" }), /already runs garnet-org\/action/)
  assert.throws(() => instrumentWorkflow(body.replace(/pull_request:/g, "workflow_dispatch:"), { job: "test" }), /does not run on pull_request/)
  assert.throws(() => instrumentWorkflow(body, { job: "test", dropJobs: ["missing"] }), /workflow has no job missing/)
})

test("planReplay instrument mode writes the selected workflow and uses its path filter", () => {
  const workflow = "on:\n  pull_request:\n    paths:\n      - src/**\njobs:\n  test:\n    runs-on: ubuntu-latest\n"
  const instrument = { path: ".github/workflows/ci.yml", content: workflow, changes: ["test: permissions contents: read, id-token: write"], job: "test" }
  const plan = planReplay({
    slug: "demo", upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", upstreamPr: 1,
    baseSha: "a".repeat(40), headSha: "b".repeat(40), changes: [{ path: "src/index.js", previous: null }],
    work: "/tmp/demo", record: "instrument", ecosystem: null, instrument, dependabotConfigured: true,
  })
  assert.deepEqual(plan.contextPaths, [instrument.path])
  assert.ok(plan.steps.some((step) => step.writeFileContent?.file.endsWith(instrument.path)))
  assert.deepEqual(plan.recordFilters, { [instrument.path]: ["src/**"] })
  assert.match(renderPlan(plan), /record: \.github\/workflows\/ci\.yml job test runs under the Garnet sensor from commit 1/)
  assert.throws(
    () => planReplay({
      slug: "demo", upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", upstreamPr: 1,
      baseSha: "a".repeat(40), headSha: "b".repeat(40), changes: [{ path: "docs/x.md", previous: null }],
      work: "/tmp/demo", record: "instrument", ecosystem: null, instrument, dependabotConfigured: true,
    }),
    /the fork's recording workflows run only when src\/\*\* change; commit 2 touches none of them/,
  )
  assert.throws(
    () => planReplay({
      slug: "demo", upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", upstreamPr: 1,
      baseSha: "a".repeat(40), headSha: "b".repeat(40), changes: [{ path: ".github/workflows/ci.yml", previous: null }],
      work: "/tmp/demo", record: "instrument", ecosystem: null, instrument, dependabotConfigured: true,
    }),
    /the change edits \.github\/workflows\/ci\.yml; pick another workflow\/job or another change/,
  )
})

test("instrumentWorkflow handles scalar and flow permissions", () => {
  const scalar = instrumentWorkflow(
    "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: echo test\n",
    { job: "test" },
  )
  assert.match(scalar.content, /permissions:\n      contents: read\n      id-token: write/)
  assert.doesNotMatch(scalar.content, /permissions: read-all/)

  const flow = instrumentWorkflow(
    "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    permissions: { contents: read, packages: write }\n    steps:\n      - run: echo test\n",
    { job: "test" },
  )
  assert.match(flow.content, /permissions:\n      contents: read\n      packages: write\n      id-token: write/)
})

test("instrumentWorkflow rejects reusable workflow callers", () => {
  const body = "on:\n  pull_request:\njobs:\n  test:\n    uses: ./.github/workflows/reusable.yml\n"
  assert.throws(
    () => instrumentWorkflow(body, { job: "test" }),
    /job test has no steps \(reusable workflow caller\); instrument the called workflow instead/,
  )
})

test("instrumentWorkflow rewrites quoted and commented needs", () => {
  const body = [
    "on:",
    "  pull_request:",
    "jobs:",
    "  drop:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo drop",
    "  keep:",
    "    needs: [\"drop\", test] # gate",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo keep",
    "  scalar:",
    "    needs: 'drop' # scalar gate",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo scalar",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo test",
    "",
  ].join("\n")
  const result = instrumentWorkflow(body, { job: "test", dropJobs: ["drop"] })
  assert.match(result.content, /needs: \[test\]/)
  assert.doesNotMatch(result.content, /needs:.*drop/)
})

test("instrumentWorkflow fails closed on an unrecognised dropped-job needs line", () => {
  const body = [
    "on:",
    "  pull_request:",
    "jobs:",
    "  drop:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo drop",
    "  keep:",
    "    needs: [drop",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo keep",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo test",
    "",
  ].join("\n")
  assert.throws(() => instrumentWorkflow(body, { job: "test", dropJobs: ["drop"] }), /cannot rewrite needs referencing dropped job drop/)
})

test("instrumentWorkflow inserts after the last checkout step", () => {
  const body = [
    "on:",
    "  pull_request:",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo before",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "      - run: echo after",
    "",
  ].join("\n")
  const result = instrumentWorkflow(body, { job: "test" })
  assert.ok(result.content.indexOf("actions/checkout@v4") < result.content.indexOf("garnet-org/action@"))
  assert.ok(result.content.indexOf("garnet-org/action@") < result.content.indexOf("echo after"))
})

test("planReplay instrument mode skips unsupported Dependabot ecosystems", () => {
  const plan = planReplay({
    slug: "demo", upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", upstreamPr: 1,
    baseSha: "a".repeat(40), headSha: "b".repeat(40), changes: [{ path: "bun.lock", previous: null }],
    work: "/tmp/demo", record: "instrument", ecosystem: "bun",
    instrument: { path: ".github/workflows/ci.yml", content: "on:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n", changes: [], job: "test" },
    dependabotConfigured: false,
  })
  assert.equal(plan.dependabotAdded, true)
  assert.ok(plan.steps.some((step) => step.writeFileContent?.file.endsWith(".github/dependabot.yml")))
})

test("planRefresh creates guarded fetch, merge, push, and distance steps", () => {
  const plan = planRefresh({ upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", work: "/tmp/demo" })
  assert.deepEqual(plan.steps.map((step) => step.id), ["clone-fork", "verify-origin", "remote-upstream", "remote-upstream-url", "verify-upstream-url", "remote-upstream-nopush", "fetch-upstream", "refresh-before", "refresh-branch", "refresh-merge", "refresh-push", "refresh-after"])
  assert.deepEqual(plan.steps.find((step) => step.id === "refresh-merge").args.slice(4, 6), ["-m", "Merge upstream main"])
  assert.equal(plan.steps.find((step) => step.id === "refresh-push").target, "garnet-labs/demo")
  assert.match(renderRefreshPlan(plan), /git clone https:\/\/github\.com\/garnet-labs\/demo\.git/)
})

test("planRefresh guards reused worktrees and upstream URL", async () => {
  const plan = planRefresh({ upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main", work: "/tmp/demo", workExists: true })
  assert.ok(plan.steps.some((step) => step.id === "verify-worktree"))
  await assert.rejects(
    executePlan(plan, {
      exec(command, args) {
        if (args.includes("get-url") && args.includes("upstream")) return "https://github.com/owner/other.git"
        if (args.includes("get-url") && args.includes("origin")) return "https://github.com/garnet-labs/demo.git"
        return ""
      },
    }),
    /upstream URL .* does not match/,
  )
  await assert.rejects(
    executePlan(plan, {
      exec(command, args) {
        if (args.includes("get-url") && args.includes("upstream")) return "https://github.com/owner/demo.git"
        if (args.includes("get-url") && args.includes("origin")) return "https://github.com/garnet-labs/demo.git"
        if (args.includes("rev-list")) return "1 0"
        if (args.includes("status")) return " M README.md"
        return ""
      },
    }),
    /checkout at \/tmp\/demo has uncommitted changes/,
  )
})

test("fork command refuses existing targets and polls the new fork", async () => {
  const calls = []
  let lookup = 0
  const result = await forkCommand(["owner/demo"], {
    exec(command, args) {
      calls.push([command, args])
      if (args[0] === "api") {
        lookup += 1
        if (lookup === 1) throw new Error("gh: Not Found (HTTP 404)")
        return JSON.stringify({ default_branch: "main" })
      }
      return ""
    },
    sleep: async () => {},
    log: () => {},
  })
  assert.deepEqual(result, { upstream: "owner/demo", fork: "garnet-labs/demo", defaultBranch: "main" })
  assert.deepEqual(calls[1], ["gh", ["repo", "fork", "owner/demo", "--org", "garnet-labs", "--clone=false", "--default-branch-only"]])
})

test("refresh merge conflicts abort and report conflicted paths", async () => {
  const calls = []
  const plan = {
    mode: "refresh", fork: "garnet-labs/demo", work: "/tmp/demo",
    steps: [{ id: "refresh-merge", kind: "write-local", onError: "refresh-merge", cmd: "git", args: ["-C", "/tmp/demo", "merge", "--no-edit", "upstream/main"] }],
  }
  await assert.rejects(
    executePlan(plan, {
      exec(command, args) {
        calls.push([command, args])
        if (args.includes("merge")) throw new Error("conflict")
        if (args.includes("--diff-filter=U")) return "package.json\nsrc/index.js\n"
        return ""
      },
    }),
    /merge conflict in package\.json, src\/index\.js/,
  )
  assert.ok(calls.some(([, args]) => args.includes("merge") && args.includes("--abort")))
})
