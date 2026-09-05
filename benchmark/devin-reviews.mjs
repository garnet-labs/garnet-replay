#!/usr/bin/env node
// Reviewer = Devin. Both arms authored by the same agent, per seed, in this order:
// control (title + body + diff only) was written and frozen before the Execution Diff
// block for that seed was read; treatment then re-reviewed with the block beside the diff.
// Severities follow the ReviewHog schema: must_fix > should_fix > consider.
// judgment: approve | comment | request_changes.
import { mkdirSync, writeFileSync } from "node:fs"

const RUNNER_ONLY = (head, scope) => ({
  title: "Recorded install shows no workload change",
  severity: "consider",
  evidence_grounded: true,
  text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}, ${scope}): 0 workload destinations added or removed; the only movement is runner-background infrastructure. The dependency install made no new outbound connection and started no new execution chain.`,
})

const catalogBump = (from, to, extra) => ({
  control: {
    judgment: "approve",
    issues: [{
      title: `posthog-js ${from} → ${to} catalog bump with lockfile refresh`,
      severity: "consider",
      evidence_grounded: false,
      text: `Patch/minor bump in pnpm-workspace.yaml catalog${extra ? `; lockfile also pulls ${extra}` : ""}. Nothing in the diff says what the install does; changelog check is the only available signal.`,
    }],
  },
  treatment: (head) => ({
    judgment: "approve",
    issues: [
      {
        title: `posthog-js ${from} → ${to} catalog bump with lockfile refresh`,
        severity: "consider",
        evidence_grounded: false,
        text: "Same as source-only read.",
      },
      RUNNER_ONLY(head, "previous recorded head → head"),
    ],
  }),
})

const reviews = {
  "real-reference-31": {
    control: {
      judgment: "comment",
      issues: [{
        title: "Adds chart-helpers from a vendored tarball (file:../vendor/chart-helpers-1.0.0.tgz); no lockfile in the diff",
        severity: "consider",
        evidence_grounded: false,
        text: "The update commit changes one file: npm-testbed/app/package.json gains a file: dependency on a tarball already in the repo. The tarball's contents, its bundled dependencies and any lifecycle scripts are not visible in this diff. Ask what the package does at install; nothing here says it does anything.",
      }],
    },
    treatment: (head) => ({
      judgment: "request_changes",
      issues: [{
        title: "Installing the vendored chart-helpers tarball connects to api.ipify.org, ip-api.com and httpbin.org",
        severity: "must_fix",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}, immediate parent 8703692 → head): workload destinations +4 −0. registry.npmjs.org (bash → bash → node) is the install itself; api.ipify.org, ip-api.com and httpbin.org all come from a new chain node → dash → node, i.e. a lifecycle script spawned by npm. Two of the three are public-IP lookup services. The one-line diff gives no reason for any of this traffic; the record is the only source for the finding. Do not merge as is.`,
      }],
    }),
  },
  "real-139": catalogBump("^1.407.2", "1.407.3", "@posthog/browser-common 0.2.2"),
  "real-141": catalogBump("^1.406.2", "1.407.1", "jest 30.0.5 peer re-resolution"),
  "real-143": catalogBump("^1.405.2", "1.406.2", "@posthog/browser-common 0.2.0, @posthog/types 1.395.0"),
  "real-146": catalogBump("^1.400.1", "1.401.0", "@posthog/types 1.395.0"),
  "real-147": catalogBump("^1.402.0", "1.402.2", "@posthog/core 1.42.0"),
  "real-148": catalogBump("^1.403.0", "1.404.0", "@posthog/core 1.43.1, @posthog/types 1.397.0"),
  "real-149": catalogBump("^1.407.1", "1.407.2", "@posthog/core 1.45.1"),
  "real-150": catalogBump("^1.402.2", "1.402.3", "@posthog/core 1.42.1"),
  "real-151": catalogBump("^1.404.0", "1.404.1", "unlayer-types 1.453.0"),

  "real-140": {
    control: {
      judgment: "comment",
      issues: [{
        title: "@swc/core ^1.11.4 → ^1.15.18 ships native binaries; lockfile loses 280 lines",
        severity: "consider",
        evidence_grounded: false,
        text: "@swc/core resolves platform-specific optional packages. The diff cannot show whether the install pulled a binary from outside the registry or which platform targets were dropped in the 280 removed lockfile lines.",
      }],
    },
    treatment: (head) => ({
      judgment: "approve",
      issues: [
        { title: "@swc/core ^1.11.4 → ^1.15.18 ships native binaries; lockfile loses 280 lines", severity: "consider", evidence_grounded: false, text: "Same as source-only read." },
        { ...RUNNER_ONLY(head, "previous recorded head → head"), text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}): 0 workload destinations added; the binary fetch stayed on the destinations the baseline install already used. The open question from the diff read is answered by the record.` },
      ],
    }),
  },
  "real-142": {
    control: { judgment: "approve", issues: [{ title: "Lockfile-only repair for streamlit_apps entries", severity: "consider", evidence_grounded: false, text: "Five resolved-version lines change; no manifest change." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "Lockfile-only repair for streamlit_apps entries", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-164": {
    control: {
      judgment: "comment",
      issues: [{
        title: "Eight @typescript/native-preview* packages added to pnpm onlyBuiltDependencies",
        severity: "should_fix",
        evidence_grounded: false,
        text: "This allow-lists their lifecycle scripts to run at install. The diff shows the allow-list, not what the scripts do or where they connect. Needs an answer before merge.",
      }],
    },
    treatment: (head) => ({
      judgment: "approve",
      issues: [{
        title: "Eight @typescript/native-preview* packages added to pnpm onlyBuiltDependencies",
        severity: "consider",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}): with the scripts allowed, the recorded install added 0 workload destinations and 0 new execution chains versus the previous recorded head. The allow-listed scripts ran without reaching anywhere new; the should-fix question is settled by the record.`,
      }],
    }),
  },
  "real-165": {
    control: {
      judgment: "comment",
      issues: [{
        title: "uWebSockets.js resolved from a codeload.github.com tarball, moved into nodejs/package.json",
        severity: "consider",
        evidence_grounded: false,
        text: "Commit-pinned tarball outside the registry. The diff cannot show whether install still fetched it, from where, or whether anything ran after fetch.",
      }],
    },
    treatment: (head) => ({
      judgment: "approve",
      issues: [{
        title: "uWebSockets.js resolved from a codeload.github.com tarball, moved into nodejs/package.json",
        severity: "consider",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}): 0 workload destinations added versus the previous recorded head; the tarball fetch used destinations the baseline already reached and no new execution chain appeared.`,
      }],
    }),
  },
  "real-145": {
    control: { judgment: "approve", issues: [{ title: "Declare @posthog/quill-charts as workspace:*", severity: "consider", evidence_grounded: false, text: "Workspace link only; nothing new is fetched." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "Declare @posthog/quill-charts as workspace:*", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-155": {
    control: { judgment: "approve", issues: [{ title: "Declare @posthog/quill-charts as workspace:*", severity: "consider", evidence_grounded: false, text: "Workspace link only; nothing new is fetched." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "Declare @posthog/quill-charts as workspace:*", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-173": {
    control: { judgment: "approve", issues: [{ title: "@posthog/mcp alias 0.4.0 → 0.5.0 (pulls @posthog/core 1.38.0)", severity: "consider", evidence_grounded: false, text: "Minor bump of an aliased package; changelog is the only signal." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "@posthog/mcp alias 0.4.0 → 0.5.0 (pulls @posthog/core 1.38.0)", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-176": {
    control: { judgment: "approve", issues: [{ title: "posthog-js '*' → 'catalog:' in products/posthog_ai", severity: "consider", evidence_grounded: false, text: "Tightens an open range to the catalog pin; lockfile shrinks." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "posthog-js '*' → 'catalog:' in products/posthog_ai", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-182": {
    control: {
      judgment: "comment",
      issues: [{
        title: "Five new root devDependencies (postcss, cssnano, autoprefixer, postcss-preset-env, @tailwindcss/postcss)",
        severity: "consider",
        evidence_grounded: false,
        text: "Large lockfile churn (+77/−105). autoprefixer pulls caniuse-lite and browserslist, which sometimes run update scripts; the diff cannot show whether anything ran or connected at install.",
      }],
    },
    treatment: (head) => ({
      judgment: "approve",
      issues: [{
        title: "Five new root devDependencies (postcss, cssnano, autoprefixer, postcss-preset-env, @tailwindcss/postcss)",
        severity: "consider",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}): 0 workload destinations added versus the previous recorded head. The new packages installed without any new outbound connection.`,
      }],
    }),
  },
  "real-184": {
    control: { judgment: "approve", issues: [{ title: "Remove @types/uuid stub from two manifests", severity: "consider", evidence_grounded: false, text: "Removal only." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "Remove @types/uuid stub from two manifests", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },
  "real-186": {
    control: { judgment: "approve", issues: [{ title: "One lockfile line: ai_gateway posthog-js entry aligned to 1.391.7", severity: "consider", evidence_grounded: false, text: "Lockfile-only." }] },
    treatment: (head) => ({ judgment: "approve", issues: [{ title: "One lockfile line: ai_gateway posthog-js entry aligned to 1.391.7", severity: "consider", evidence_grounded: false, text: "Same as source-only read." }, RUNNER_ONLY(head, "previous recorded head → head")] }),
  },

  "constructed-30304258281": {
    control: { judgment: "approve", issues: [{ title: "Add ms@2.1.3 to npm-testbed/app", severity: "consider", evidence_grounded: false, text: "Well-known package, exact pin, lockfile added. Nothing in the diff runs at install." }] },
    treatment: (head) => ({
      judgment: "approve",
      issues: [
        { title: "Add ms@2.1.3 to npm-testbed/app", severity: "consider", evidence_grounded: false, text: "Same as source-only read." },
        { title: "First recording for this repository; no comparison base", severity: "consider", evidence_grounded: true, text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}, no previous recorded head): the install reached registry.npmjs.org, github.com, api.github.com, release-assets.githubusercontent.com and localhost from Runner.Worker → node chains. This is the whole install, not a delta.` },
      ],
    }),
  },
  "constructed-30304293294": {
    control: {
      judgment: "request_changes",
      issues: [{
        title: "New postinstall script curls https://httpbin.org/get on every install",
        severity: "must_fix",
        evidence_grounded: false,
        text: "The script is in package.json in plain text: `curl -s https://httpbin.org/get > /dev/null || true`. An install-time outbound call with no functional purpose should not ship.",
      }],
    },
    treatment: (head) => ({
      judgment: "request_changes",
      issues: [{
        title: "New postinstall script curls https://httpbin.org/get on every install",
        severity: "must_fix",
        evidence_grounded: true,
        text: `Same as source-only read. Runtime evidence (Garnet, head ${head.slice(0, 7)}, compared with the clean constructed install b678bdb): workload destinations +1, chain node → dash → curl → httpbin.org. The record confirms the script ran and connected.`,
      }],
    }),
  },
  "constructed-30305397518": {
    control: {
      judgment: "comment",
      issues: [{
        title: "Vendored chart-helpers tarball bundles metrics-beacon, which the lockfile marks hasInstallScript",
        severity: "should_fix",
        evidence_grounded: false,
        text: "package-lock.json shows chart-helpers → date-fmt (bundled) → metrics-beacon (bundled, hasInstallScript: true). The tarball is opaque in the diff, so the script's behavior is unknown. Ask the author what the install script does before merging.",
      }],
    },
    treatment: (head) => ({
      judgment: "request_changes",
      issues: [{
        title: "Bundled metrics-beacon install script connects to api.ipify.org, ip-api.com and httpbin.org during npm install",
        severity: "must_fix",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}, compared with the clean constructed install b678bdb): workload destinations +3, all from the chain node → dash → node: api.ipify.org, ip-api.com, httpbin.org. Two of the three are public-IP lookup services. The diff only shows that an install script exists; the record shows where it connected. Do not merge as is.`,
      }],
    }),
  },
  "constructed-30376868306": {
    control: {
      judgment: "comment",
      issues: [{
        title: "Adds chart-helpers from a vendored tarball without a lockfile update",
        severity: "consider",
        evidence_grounded: false,
        text: "package.json is the only file changed. The tarball's contents, dependencies and any install scripts are invisible in this diff; a lockfile would at least list them.",
      }],
    },
    treatment: (head) => ({
      judgment: "request_changes",
      issues: [{
        title: "Installing the vendored tarball connects to api.ipify.org, ip-api.com and httpbin.org",
        severity: "must_fix",
        evidence_grounded: true,
        text: `Runtime evidence (Garnet, head ${head.slice(0, 7)}, compared with the clean constructed install b678bdb): workload destinations +3 from chain node → dash → node: api.ipify.org, ip-api.com, httpbin.org. Nothing in the one-file diff pointed at an install script; the record is the only source for this finding.`,
      }],
    }),
  },
}

const blocks = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("benchmark/blocks.json", "utf8")))
mkdirSync("benchmark/runs/devin", { recursive: true })
for (const [seed, arms] of Object.entries(reviews)) {
  const key = seed.replace(/^real-/, "")
  const head = blocks[key].block.head_sha
  const label = seed.startsWith("real-") ? "real" : "constructed"
  for (const arm of ["control", "treatment"]) {
    const review = arm === "control" ? arms.control : arms.treatment(head)
    writeFileSync(`benchmark/runs/devin/${seed}.${arm}.json`, `${JSON.stringify({
      seed, label, arm, reviewer: "devin", head_sha: head,
      block_receipt_id: arm === "treatment" ? blocks[key].block.receipt_id : null,
      ...review,
    }, null, 2)}\n`)
  }
}
console.log(`wrote ${Object.keys(reviews).length * 2} review files to benchmark/runs/devin`)
