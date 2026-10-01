import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import test from "node:test"
import assert from "node:assert/strict"
import { buildModel, renderCard } from "../lib/card.mjs"

const FORBIDDEN = /\b(verified|flagged|pass(ed)?|warn(ing)?|fail(ed)?|threat|detected|caught|process chain)\b/i

function stringLiterals(source) {
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2)
      index = end === -1 ? source.length : end + 1
      continue
    }
    if (source[index] === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2)
      index = end === -1 ? source.length : end
      continue
    }
    const quote = source[index]
    if (!["'", '"', "`"].includes(quote)) continue
    let value = ""
    for (index += 1; index < source.length; index += 1) {
      if (source[index] === "\\") {
        value += source[index + 1] ?? ""
        index += 1
      } else if (source[index] === quote) {
        break
      } else {
        value += source[index]
      }
    }
    values.push(value)
  }
  return values.join("\n")
}

test("visible artifacts use observation vocabulary", async () => {
  const trackedHtml = execFileSync("git", ["ls-files", "public/replays/**/*.html"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
  const paths = ["README.md", "renderer/compare.mjs", "seeds/seeds.json", ...trackedHtml]
  for (const path of paths) {
    const source = await readFile(path, "utf8")
    const content = path === "renderer/compare.mjs"
      ? stringLiterals(source)
      : source.replace(/<h1>.*?<\/h1>/gs, "")
    assert.equal(FORBIDDEN.test(content), false, `${path} contains forbidden vocabulary`)
  }
})

test("intent card copy uses observation vocabulary", () => {
  const intent = {
    outcome: "needs-explanation",
    steps: ["Run E2E test"],
    claims: [
      { id: "storefront-removed", kind: "network", match: { destination: "mock.shop" }, expect: "present-before-absent-after", outcome: "supported", before: ["mock.shop"], after: [] },
      { id: "held-on", kind: "network", match: { destination: "cdn.example.com" }, expect: "absent-both", outcome: "contradicted", before: [], after: ["cdn.example.com"] },
      { id: "never-seen", kind: "network", match: { destination: "api.example.com" }, expect: "present-before-absent-after", outcome: "unobservable", before: [], after: [] },
      { id: "lost-step", kind: "network", match: { destination: "auth.example.com" }, expect: "present-both", outcome: "undeterminable", reason: 'step "Login" missing from the head record', before: [], after: [] },
    ],
    uncovered: { added: [{ side: "added", destination: "telemetry.example.net", step: "Run E2E test" }], removed: [] },
    stepsMissing: { base: [], head: [] },
  }
  const card = renderCard(buildModel({ slug: "sentry-javascript", forkPr: 3, headSha: null, comment: null, intent }))
  assert.equal(FORBIDDEN.test(card), false, "intent card copy contains forbidden vocabulary")
  for (const phrase of [
    "Expected behaviour change is present in the record",
    "Record contradicts the stated change",
    "Not observable in either record",
    "Not determinable:",
    "Change the pull request does not describe",
  ]) {
    assert.ok(card.includes(phrase), `card is missing ${JSON.stringify(phrase)}`)
  }
})
