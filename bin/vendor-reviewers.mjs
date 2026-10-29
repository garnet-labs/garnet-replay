#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { run } from "../lib/gh.mjs"

const source = process.argv[2]
const sha = process.argv[3]
if (typeof source !== "string" || !/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("usage: node bin/vendor-reviewers.mjs <source checkout> <full SHA>")
const root = fileURLToPath(new URL("../live/templates/reviewers/", import.meta.url))
const paths = [".coderabbit.yaml", ".pr_agent.toml", "greptile.json", "REVIEW.md"]
const sources = Object.fromEntries(paths.map((path) => [path, `examples/reviewers/${path}`]))
sources["SKILL.md"] = "skills/garnet-runtime-review/SKILL.md"
mkdirSync(root, { recursive: true })
const files = {}
for (const [path, original] of Object.entries(sources)) {
  const body = run("git", ["-C", source, "show", `${sha}:${original}`])
  writeFileSync(`${root}/${path}`, body)
  files[path] = { source: original, sha256: createHash("sha256").update(body).digest("hex") }
}
writeFileSync(`${root}/source.json`, `${JSON.stringify({ repository: "garnet-labs/garnet-runtime-review-mcp", sha, files }, null, 2)}\n`)
