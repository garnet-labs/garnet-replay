import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import test from "node:test"
import assert from "node:assert/strict"

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
