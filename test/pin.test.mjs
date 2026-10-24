import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { join } from "node:path"
import { pin as pinCommand } from "../lib/commands.mjs"
import { comparePin, PIN_SOURCE_FILES, rewritePinSource } from "../lib/pin.mjs"
import { GARNET_ACTION_PIN, GARNET_ACTION_PIN_LABEL } from "../lib/replay-pr.mjs"

const oldSha = "245ad6be82de3200c205109c8ca7ac816dc692ea"
const nextSha = "9".repeat(40)
const nextTag = "v9.9.9"

test("comparePin identifies current and behind pins", () => {
  assert.deepEqual(comparePin({
    latestTag: GARNET_ACTION_PIN_LABEL,
    latestSha: GARNET_ACTION_PIN,
    pin: GARNET_ACTION_PIN,
    label: GARNET_ACTION_PIN_LABEL,
  }), {
    status: "current",
    latestTag: GARNET_ACTION_PIN_LABEL,
    latestSha: GARNET_ACTION_PIN,
    pin: GARNET_ACTION_PIN,
    label: GARNET_ACTION_PIN_LABEL,
  })
  assert.equal(comparePin({
    latestTag: GARNET_ACTION_PIN_LABEL,
    latestSha: GARNET_ACTION_PIN,
    pin: oldSha,
    label: "v2.3.0",
  }).status, "behind")
  assert.throws(() => comparePin({ latestTag: "", latestSha: GARNET_ACTION_PIN, pin: oldSha, label: "v2.3.0" }), /tag/)
  assert.throws(() => comparePin({ latestTag: "v2", latestSha: "bad", pin: oldSha, label: "v2.3.0" }), /SHA/)
  assert.throws(() => comparePin({ latestTag: "v2", latestSha: GARNET_ACTION_PIN, pin: "bad", label: "v2.3.0" }), /pin/)
})

test("rewritePinSource updates every configured source kind", () => {
  for (const path of PIN_SOURCE_FILES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    const updated = rewritePinSource(source, {
      fromSha: GARNET_ACTION_PIN,
      fromLabel: GARNET_ACTION_PIN_LABEL,
      sha: nextSha,
      tag: nextTag,
      path,
    })
    if (path === "AGENTS.md") {
      assert.match(updated, new RegExp(`release \`${nextTag}\``))
      assert.match(updated, /Since\n  v2\.3\.0 the companion GitHub App owns/)
    } else {
      assert.ok(updated.includes(nextSha), path)
      assert.ok(!updated.includes(GARNET_ACTION_PIN), path)
    }
    if (path === "lib/replay-pr.mjs") assert.match(updated, new RegExp(`GARNET_ACTION_PIN_LABEL = "${nextTag}"`))
    if (path.startsWith("live/templates/")) assert.match(updated, new RegExp(`garnet-org/action@${nextSha} # ${nextTag}`))
    if (path === "README.md" || path === "docs/plan.md") assert.match(updated, new RegExp(`release ${nextTag}`))
  }
  assert.throws(() => rewritePinSource("no pin here", {
    fromSha: GARNET_ACTION_PIN,
    fromLabel: GARNET_ACTION_PIN_LABEL,
    sha: nextSha,
    tag: nextTag,
    path: "README.md",
  }), /README\.md.*current action pin SHA/)
})

test("pin source files agree on the current pin and have no other full action ref", () => {
  for (const path of PIN_SOURCE_FILES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    if (path === "AGENTS.md") assert.match(source, /GARNET_ACTION_PIN/)
    else assert.ok(source.includes(GARNET_ACTION_PIN), path)
    const refs = [...source.matchAll(/garnet-org\/action@([0-9a-f]{40})/gi)].map((match) => match[1])
    assert.ok(refs.every((ref) => ref === GARNET_ACTION_PIN), `${path}: ${refs.join(", ")}`)
  }
})

test("pin check resolves release tag before its commit SHA", async () => {
  const calls = []
  const output = []
  const result = await pinCommand(["--check", "--json"], {
    exec: (_command, args) => {
      calls.push(args)
      return args.includes(".tag_name") ? `${GARNET_ACTION_PIN_LABEL}\n` : `${GARNET_ACTION_PIN}\n`
    },
    log: (value) => output.push(value),
  })
  assert.equal(result.status, "current")
  assert.deepEqual(calls, [
    ["api", "repos/garnet-org/action/releases/latest", "--jq", ".tag_name"],
    ["api", `repos/garnet-org/action/commits/${GARNET_ACTION_PIN_LABEL}`, "--jq", ".sha"],
  ])
  assert.equal(output.length, 1)
  assert.equal(JSON.parse(output[0]).latestSha, GARNET_ACTION_PIN)
})

test("pin update rewrites all six sources before writing them", async () => {
  const root = "/pincopy"
  const sources = Object.fromEntries(PIN_SOURCE_FILES.map((path) => [
    join(root, path),
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  ]))
  const writes = []
  await pinCommand(["--update"], {
    root,
    exec: (_command, args) => args.includes(".tag_name") ? nextTag : nextSha,
    read: (path) => sources[path],
    write: (path, value) => writes.push([path, value]),
    log: () => {},
  })
  assert.equal(writes.length, PIN_SOURCE_FILES.length)
  for (const [path, updated] of writes) {
    if (!path.endsWith("AGENTS.md")) assert.ok(updated.includes(nextSha), path)
    else assert.ok(updated.includes(`release \`${nextTag}\``), path)
  }
})
