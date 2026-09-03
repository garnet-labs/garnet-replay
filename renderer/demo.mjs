#!/usr/bin/env node
/**
 * Renders the garnet_run_profile_comment from fixtures, so the exact markdown
 * can be reviewed without a live CI run. Run:
 *
 *   node cmd/garnet-runtime-review/demo.mjs            # print all fixtures
 *   node cmd/garnet-runtime-review/demo.mjs --assert   # self-check spec invariants
 *
 * Each fixture is a Run Profile object shaped exactly like buildRunProfile()'s
 * output, then passed through renderRunProfile() — the same code path CI uses.
 */

import { fileURLToPath } from "node:url"
import { renderRunProfile, COMMENT_MARKER } from "./review.mjs"

const RUN_ID = "ui-28500690627"
const PROFILE_ID = "demo-profile"
const REPOSITORY = "garnet-org/runtime-review-testbed"
const PERMALINK = `https://app.garnet.ai/public/runs/${RUN_ID}?profile=${PROFILE_ID}&utm_source=github&utm_medium=pr_comment`

/** @type {Record<string, any>} */
export const FIXTURES = {
  registry_only: {
    sha: "3e26d51",
    full_sha: "3e26d51",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/3e26d51",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [],
  },
  egress_facts: {
    sha: "a7ae2dc",
    full_sha: "a7ae2dc",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/a7ae2dc",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [{ name: "telemetry.nextjs.org", address: "telemetry.nextjs.org", ancestry: ["Runner.Worker", "next build"], step: "next build" }],
  },
  lineage_facts: {
    sha: "09109b1",
    full_sha: "09109b1",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/09109b1",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [{ name: "185.220.101.5", address: "185.220.101.5", ancestry: ["Runner.Worker", "postinstall", "sh -c curl"], step: "postinstall" }],
  },
  siblings_facts: {
    sha: "b8c3d91",
    full_sha: "b8c3d91",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/b8c3d91",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "api.garnet.ai", address: "api.garnet.ai", ancestry: ["Runner.Worker", "bash"], step: "Run workload" },
      { name: "registry.npmjs.org", address: "registry.npmjs.org", ancestry: ["Runner.Worker", "bash"], step: "Run workload" },
      { name: "github.com", address: "github.com", ancestry: ["Runner.Worker", "npm test"], step: "Run workload" },
    ],
  },
  // v6.9 one job = one block: every recorded root renders in the job's single
  // fold — the attributed npm chains and the systemd-rooted runner
  // infrastructure chains sit in the same block, independent roots separated
  // by one blank line, each with its factual bracket context.
  whole_job_block: {
    sha: "c4f1e22",
    full_sha: "c4f1e22",
    n_jobs: 1,
    timestamp: "2026-08-10T21:07:43.000Z",
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/c4f1e22",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "registry.npmjs.org", address: "registry.npmjs.org", ports: [], ancestry: ["Runner.Worker", "npm install"], step: "npm install" },
      { name: "localhost", address: "127.0.0.53", ports: ["53/udp"], ancestry: ["Runner.Worker", "npm install", "node"], step: "npm install" },
      { name: "hosted-compute-watchdog-prod-iad-01.githubapp.com", address: "140.82.112.23", ports: [], ancestry: ["systemd", "hosted-compute-agent"], step: "" },
      { name: "168.63.129.16", address: "168.63.129.16", ports: [], ancestry: ["systemd", "provjobd"], step: "" },
    ],
  },
  // v6.9 infrastructure-only record: still one job fold with one block —
  // there is no partition, so a job whose only recorded chains are runner
  // infrastructure renders them like any other chains.
  infra_only: {
    sha: "d5a2f33",
    full_sha: "d5a2f33",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/d5a2f33",
    permalink: PERMALINK,
    job: "lint",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "hosted-compute-watchdog-prod-iad-02.githubapp.com", address: "140.82.113.24", ports: [], ancestry: ["systemd", "hosted-compute-agent"], step: "" },
    ],
  },
  // v6.9.8 root ordering: the workload root leads the block even when an
  // infrastructure root sorts before it alphabetically. Classification is
  // structural (Runner.Worker descent or a recorded step) — names never
  // classify, and canonical order holds within each group.
  root_ordering: {
    sha: "f2b7c08",
    full_sha: "f2b7c08",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/f2b7c08",
    permalink: PERMALINK,
    job: "package",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "cdn.example.com", address: "93.184.216.34", ports: [], ancestry: ["cloud-init", "curl"], step: "" },
      { name: "registry.npmjs.org", address: "104.16.24.35", ports: [], ancestry: ["Runner.Worker", "npm publish"], step: "npm publish" },
    ],
  },
  // v6.9.8 factual context: '(cloud metadata)' for the standardized IMDS
  // constant only (vendor addresses render bare), '(step: …)' decorates the
  // step's topmost owning process; a real recorded step never restructures
  // the tree.
  context_facts: {
    sha: "e6b3a44",
    full_sha: "e6b3a44",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/e6b3a44",
    permalink: PERMALINK,
    job: "release",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "169.254.169.254", address: "169.254.169.254", ports: [], ancestry: ["Runner.Worker", "bash", "bun"], step: "Publish artifacts" },
      { name: "artifacts.example.net", address: "203.0.113.9", ports: [], ancestry: ["systemd", "node"], step: "Run integration tests" },
      { name: "168.63.129.16", address: "168.63.129.16", ports: [], ancestry: ["systemd", "walinuxagent"], step: "07. Runner Processes" },
    ],
  },
  // v6.9 garnet sensor context: garnet.ai and *.garnet.ai carry the
  // '(garnet sensor)' note.
  sensor_facts: {
    sha: "f7c4b55",
    full_sha: "f7c4b55",
    n_jobs: 1,
    commit_url: "https://github.com/garnet-org/runtime-review-testbed/commit/f7c4b55",
    permalink: PERMALINK,
    job: "build",
    workflow: "ci",
    repository: REPOSITORY,
    run_id: RUN_ID,
    profile_id: PROFILE_ID,
    egress: [
      { name: "api.garnet.ai", address: "34.36.10.5", ports: [], ancestry: ["systemd", "jibril"], step: "" },
      { name: "registry.npmjs.org", address: "registry.npmjs.org", ports: [], ancestry: ["Runner.Worker", "npm install"], step: "npm install" },
    ],
  },
}

const ORDER = ["registry_only", "egress_facts", "lineage_facts", "siblings_facts", "whole_job_block", "root_ordering", "infra_only", "context_facts", "sensor_facts"]

/** Assert the hard spec invariants hold for every rendered state. */
function assertInvariants() {
  let failures = 0
  const check = (cond, msg) => {
    if (!cond) {
      console.error(`  ✗ ${msg}`)
      failures += 1
    }
  }
  for (const key of ORDER) {
    const rp = FIXTURES[key]
    const md = renderRunProfile(rp)
    console.error(`[${key}]`)
    check(md.startsWith(COMMENT_MARKER), "starts with the sticky marker")
    check(md.includes("**Execution Profiles recorded for"), "v6.9 headline")
    check(md.includes("> *"), "italic finding blockquote")
    check(!md.match(/> \*[^*]*<sub>/), "the finding line carries no sub")
    {
      // Meta block (v6.9.8 metaWeight): finding line, then exactly one quiet
      // provenance line carrying the kernel provenance at minute precision.
      const meta = md.split("\n").filter((line) => line.startsWith("> "))
      check(meta.length === 2, "meta block is exactly two blockquote lines")
      check(/^> \*\d+&nbsp;destinations?\*$/.test(meta[0] ?? ""), "finding line is the destination total alone")
      check(/^> <sub>recorded at the kernel by Garnet( · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)?<\/sub>$/.test(meta[1] ?? ""), "provenance line is quiet and minute-precise")
      check((md.match(/recorded at the kernel by Garnet/g) || []).length === 1, "kernel provenance renders exactly once")
    }
    check(!/\b(Runtime Review|process lineage|baseline|flagged|detected|process chains?)\b/i.test(md), "banned vocabulary absent")
    check(!md.includes("runner substrate"), "retired substrate fold/label absent")
    check(!md.includes("↷"), "retired moved note absent")
    check(!/&nbsp;execution chain|&nbsp;chain/.test(md), "chain counts never render on the human surface")
    // The record body ends where the explainer begins; the explainer's
    // symbol key and follow-path sentence legitimately carry → □ ▷.
    const recordBody = md.slice(0, md.indexOf("How to read this"))
    check(!recordBody.includes("→ ") || !/→ [a-z0-9]/.test(recordBody), "no action arrows before destinations")
    check(!recordBody.includes("□") && !recordBody.includes("▷"), "reserved file/execution terminal shapes never render in the record")
    {
      // v6.9 machine summary: fixed key order, kinds=[\"network\"], and every
      // number equals the corresponding rendered count.
      const summaryMatch = md.match(/<!-- garnet:summary (\{.*?\}) -->/)
      check(!!summaryMatch, "machine summary marker present")
      if (summaryMatch) {
        const summary = JSON.parse(summaryMatch[1])
        check(
          Object.keys(summary).join(",") ===
            "contract,githubMeta,commit,previous,jobs,changed,unchanged,noOutbound,vanished,added,removed,vanishedDestinations,chains,destinations,recorded,kinds",
          "machine summary key order is the v6.9 contract order",
        )
        check(summary.contract === "6.9.8", "machine summary carries contract 6.9.8")
        check(Array.isArray(summary.kinds) && summary.kinds.join(",") === "network", 'machine summary kinds is ["network"]')
        check(summary.previous === null && summary.vanishedDestinations === null, "comparison-only fields null on snapshot")
        check(
          summary.recorded === null || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(summary.recorded),
          "machine summary keeps the record's full-precision timestamp",
        )
        const metaDest = md.match(/> \*(\d+)&nbsp;destination/)
        check(!!metaDest && Number(metaDest[1]) === summary.destinations, "metadata destination count equals machine summary destinations")
        const leafCount = (md.match(/○ /g) || []).length - 1 // minus the explainer's ○ leaf
        check(leafCount === summary.destinations || new Set((Array.isArray(rp.egress) ? rp.egress : []).map((e) => e.name || e.address)).size === summary.destinations, "destination count reconciles with rendered ○ leaves")
      }
    }
    check(!md.includes("└─ Runner.Worker"), "root tree node has no branch glyph")
    check(!/<em>(?!\()[^<]*<\/em>(?!<\/sub>)/.test(md.slice(0, md.indexOf("How to read this"))), "italic wraps bracket annotations only in the record tree")
    check(!md.includes("telemetry[.]nextjs[.]org"), "only the final hostname dot is defanged")
    check(md.includes("/public/runs/") && md.includes("utm_source=github"), "permalink uses the public selector")
    if (key === "root_ordering") {
      const tree = md.slice(md.indexOf("<pre>"), md.indexOf("</pre>"))
      check(tree.indexOf("Runner.Worker") < tree.indexOf("cloud-init"), "the workload root renders above the infrastructure root")
    }
    check(md.includes("└─ ○ npmjs[.]org"), "explainer mini tree teaches the ○ network terminal")
    check(md.includes("<em>← process on a path</em>"), "explainer callout: process on a path")
    check(md.includes("<strong>node</strong>") && md.includes("<em>← process that acted</em>"), "explainer callout: process that acted, bold on the acting node")
    check(md.includes("<em>← observed action</em>"), "explainer callout: observed action")
    check(md.includes("names on the path = processes · ○ = observed action · (…) = context"), "explainer legend line verbatim")
    check(md.includes("follow a path downward to see what ran and what it did — each path to an observed action is an execution chain"), "explainer reading line verbatim")
    check(md.includes("**Execution Profiles recorded for 1 job"), "headline job count matches the demo fold")
    if (key === "registry_only") {
      const jobRow = (md.split("\n").find((line) => line.startsWith("<sub><code>")) || "")
      check(jobRow.includes("no outbound destinations recorded."), "empty projection renders a plain row")
      check(jobRow.includes("Garnet profile&nbsp;↗"), "empty row keeps the Garnet profile link")
      check(!md.includes("<details><summary><code>"), "empty projection renders no fold")
    }
    if (key === "siblings_facts") {
      check(md.includes("├─"), "sibling fixture renders a tee branch")
      check(md.includes("│  └─"), "sibling fixture renders a continuation branch")
      check(md.includes("\n├─ <strong>bash</strong>"), "depth-1 child branch starts at column zero (bash acted → bold)")
      check(md.includes("\n│  ├─ ○"), "depth-2 destination branch is indented three spaces")
    }
    if (key === "whole_job_block") {
      check((md.match(/<details><summary><code>/g) || []).length === 1, "one fold per job")
      const tree = md.slice(md.indexOf("<pre>"), md.indexOf("</pre>"))
      check(tree.includes("localhost <em>(dns resolver)</em>"), "dns-resolver leaf renders inline with its italic note")
      check(tree.includes("hosted-compute-watchdog"), "runner infrastructure chains render in the same job block")
      check(tree.includes("<em>(github infra)</em>"), "locked githubapp suffix carries the italic github-infra note")
      check(tree.includes("\n\n") || /\n\n/.test(tree), "independent recorded roots are whitespace-separated")
      check(!tree.includes("168.63.129.16 <em>"), "vendor-specific addresses render bare")
    }
    if (key === "infra_only") {
      check(md.includes("<details><summary><code>"), "infrastructure-only record still renders the job fold")
      check(md.includes("hosted-compute-watchdog"), "infrastructure chains render in the job block")
    }
    if (key === "context_facts") {
      const tree = md.slice(md.indexOf("<pre>"), md.indexOf("</pre>"))
      check(tree.includes("169.254.169.254 <em>(cloud metadata)</em>"), "the standardized IMDS constant carries the italic cloud-metadata note")
      check(tree.includes("artifacts.example[.]net"), "systemd-rooted chain with a real recorded step renders in the same block")
      check(tree.includes("<em>(step: &quot;"), "a real recorded step decorates its process line, quoted and italic")
      check(!tree.includes("Runner Processes"), "the runner-processes sentinel never renders as a step note")
      check(!tree.includes("168.63.129.16 <em>"), "vendor-specific addresses render bare")
    }
    if (key === "sensor_facts") {
      const tree = md.slice(md.indexOf("<pre>"), md.indexOf("</pre>"))
      check(tree.includes("api.garnet[.]ai <em>(garnet sensor)</em>"), "garnet.ai suffix carries the italic garnet-sensor note")
      check(tree.includes("registry.npmjs[.]org"), "workload chain renders in the same block")
    }
  }
  return failures
}

function main() {
  if (argv2Includes("--assert")) {
    const failures = assertInvariants()
    if (failures) {
      console.error(`\n${failures} invariant(s) failed.`)
      process.exitCode = 1
    } else {
      console.error("\nAll spec invariants hold across the fixtures.")
    }
    return
  }
  const blocks = []
  for (const key of ORDER) {
    blocks.push(`### State: \`${key}\``, "", "```markdown", renderRunProfile(FIXTURES[key]), "```", "")
  }
  process.stdout.write(blocks.join("\n"))
}

function argv2Includes(flag) {
  return process.argv.slice(2).includes(flag)
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) main()
