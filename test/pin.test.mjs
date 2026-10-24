import assert from "node:assert/strict"
import test from "node:test"
import { pin as pinCommand } from "../lib/commands.mjs"
import { comparePin, rewritePinSource } from "../lib/pin.mjs"

const currentSha = "8cccc85403e4ac4e05fb7822c994d3c199f9aa57"
const oldSha = "245ad6be82de3200c205109c8ca7ac816dc692ea"

test("comparePin identifies current and behind pins", () => {
  assert.deepEqual(comparePin({ latestTag: "v2.4.0", latestSha: currentSha, pin: currentSha, label: "v2.4.0" }), {
    status: "current", latestTag: "v2.4.0", latestSha: currentSha, pin: currentSha, label: "v2.4.0",
  })
  assert.equal(comparePin({ latestTag: "v2.4.0", latestSha: currentSha, pin: oldSha, label: "v2.3.0" }).status, "behind")
  assert.throws(() => comparePin({ latestTag: "", latestSha: currentSha, pin: oldSha, label: "v2.3.0" }), /tag/)
  assert.throws(() => comparePin({ latestTag: "v2", latestSha: "bad", pin: oldSha, label: "v2.3.0" }), /SHA/)
  assert.throws(() => comparePin({ latestTag: "v2", latestSha: currentSha, pin: "bad", label: "v2.3.0" }), /pin/)
})

test("rewritePinSource updates only the action constants and the AGENTS pin sentence", () => {
  const source = [
    `export const GARNET_ACTION_PIN = "${oldSha}"`,
    `export const GARNET_ACTION_PIN_LABEL = "v2.3.0"`,
    "export const OTHER = 1",
  ].join("\n")
  assert.equal(rewritePinSource(source, { sha: currentSha, tag: "v2.4.0" }), [
    `export const GARNET_ACTION_PIN = "${currentSha}"`,
    `export const GARNET_ACTION_PIN_LABEL = "v2.4.0"`,
    "export const OTHER = 1",
  ].join("\n"))
  const agents = [
    "- The action pin is the commit covered by",
    "  release `v2.3.0` (`GARNET_ACTION_PIN` in `lib/replay-pr.mjs`). Move existing",
    "  forks with `replay repin <slug>`; never edit their workflows by hand. Since",
    "  v2.3.0 the companion GitHub App owns the Runtime Review comment; the action",
  ].join("\n")
  const updated = rewritePinSource(agents, { sha: currentSha, tag: "v2.4.0" })
  assert.match(updated, /release `v2\.4\.0`/)
  assert.match(updated, /Since\n  v2\.3\.0 the companion GitHub App owns/)
  assert.throws(() => rewritePinSource("no pin here", { sha: currentSha, tag: "v2.4.0" }), /expected AGENTS/)
  assert.throws(() => rewritePinSource(`export const GARNET_ACTION_PIN = "${oldSha}"`, { sha: currentSha, tag: "v2.4.0" }), /constants/)
})

test("pin check resolves release tag before its commit SHA", async () => {
  const calls = []
  const output = []
  const result = await pinCommand(["--check", "--json"], {
    exec: (_command, args) => {
      calls.push(args)
      return args.includes(".tag_name") ? "v2.4.0\n" : `${currentSha}\n`
    },
    log: (value) => output.push(value),
  })
  assert.equal(result.status, "current")
  assert.deepEqual(calls, [
    ["api", "repos/garnet-org/action/releases/latest", "--jq", ".tag_name"],
    ["api", "repos/garnet-org/action/commits/v2.4.0", "--jq", ".sha"],
  ])
  assert.equal(output.length, 1)
  assert.equal(JSON.parse(output[0]).latestSha, currentSha)
})

test("pin update rewrites both sources after resolving the release", async () => {
  const sources = {
    code: `export const GARNET_ACTION_PIN = "${oldSha}"\nexport const GARNET_ACTION_PIN_LABEL = "v2.3.0"`,
    agents: "  release `v2.3.0` (`GARNET_ACTION_PIN` in `lib/replay-pr.mjs`). Move existing",
  }
  const writes = []
  await pinCommand(["--update"], {
    exec: (_command, args) => args.includes(".tag_name") ? "v2.4.0" : currentSha,
    read: (path) => sources[path],
    write: (path, value) => writes.push([path, value]),
    replayPrSource: "code",
    agentsSource: "agents",
    log: () => {},
  })
  assert.equal(writes.length, 2)
  assert.match(writes[0][1], new RegExp(currentSha))
  assert.match(writes[1][1], /release `v2\.4\.0`/)
})
