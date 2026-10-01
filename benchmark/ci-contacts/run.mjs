#!/usr/bin/env node
// Run one model on one track and write raw replies + parsed answers.
//
//   node benchmark/ci-contacts/run.mjs --model anthropic:claude-sonnet-5 --track diff
//   node benchmark/ci-contacts/run.mjs --model openai:<model> --track record
//   node benchmark/ci-contacts/run.mjs --model gemini:<model> --track diff
//   node benchmark/ci-contacts/run.mjs --model cmd:'my-model-cli --json' --name mine --track diff   (prompt on stdin, reply on stdout)
//   node benchmark/ci-contacts/run.mjs --emit-prompts <dir> --track diff      (prompt files only, no key in them)
//   node benchmark/ci-contacts/run.mjs --import <dir> --name <model> --track diff   (<dir>/<task>.txt replies)
//
// Keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY. Output: benchmark/ci-contacts/runs/<name>/<track>/<task>.json
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"

import { parseAnswer, renderPrompt, TRACKS } from "../../lib/ci-contacts.mjs"

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    name: { type: "string" },
    track: { type: "string" },
    only: { type: "string" },
    "emit-prompts": { type: "string" },
    import: { type: "string" },
  },
})

if (!TRACKS.includes(args.track)) {
  console.error(`--track must be one of ${TRACKS.join(", ")}`)
  process.exit(2)
}
let tasks = JSON.parse(readFileSync("benchmark/ci-contacts/tasks.json", "utf8"))
if (typeof args.only === "string") {
  const ids = new Set(args.only.split(","))
  tasks = tasks.filter((t) => ids.has(t.id))
}

if (typeof args["emit-prompts"] === "string") {
  mkdirSync(args["emit-prompts"], { recursive: true })
  for (const t of tasks) {
    writeFileSync(`${args["emit-prompts"]}/${t.id}.prompt.md`, `${renderPrompt(t, args.track)}\n`)
  }
  console.log(`wrote ${tasks.length} ${args.track} prompts to ${args["emit-prompts"]}`)
  process.exit(0)
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  }
  return json
}

function needKey(name) {
  const key = process.env[name]
  if (typeof key !== "string" || key === "") {
    throw new Error(`${name} is required`)
  }
  return key
}

async function ask(model, prompt) {
  const [provider, ...rest] = model.split(":")
  const id = rest.join(":")
  if (provider === "anthropic") {
    const j = await post("https://api.anthropic.com/v1/messages", { "x-api-key": needKey("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" }, { model: id, max_tokens: 2048, messages: [{ role: "user", content: prompt }] })
    return j.content.filter((c) => c.type === "text").map((c) => c.text).join("")
  }
  if (provider === "openai") {
    const j = await post("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${needKey("OPENAI_API_KEY")}` }, { model: id, messages: [{ role: "user", content: prompt }] })
    return j.choices[0].message.content
  }
  if (provider === "gemini") {
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, { "x-goog-api-key": needKey("GEMINI_API_KEY") }, { contents: [{ role: "user", parts: [{ text: prompt }] }] })
    return j.candidates[0].content.parts.map((p) => p.text ?? "").join("")
  }
  if (provider === "cmd") {
    return execFileSync("sh", ["-c", id], { input: prompt, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  }
  throw new Error(`unknown provider ${provider} (anthropic:, openai:, gemini:, cmd:)`)
}

const name = typeof args.name === "string" ? args.name : String(args.model).replace(/^[a-z]+:/, "").replace(/[^A-Za-z0-9._-]+/g, "_")
const out = `benchmark/ci-contacts/runs/${name}/${args.track}`
mkdirSync(out, { recursive: true })
for (const t of tasks) {
  let reply
  let error = null
  try {
    reply = typeof args.import === "string" ? readFileSync(`${args.import}/${t.id}.txt`, "utf8") : await ask(args.model, renderPrompt(t, args.track))
  } catch (e) {
    reply = ""
    error = e.message
  }
  const answer = parseAnswer(reply)
  writeFileSync(`${out}/${t.id}.json`, `${JSON.stringify({ task: t.id, model: name, track: args.track, reply, answer, error }, null, 2)}\n`)
  console.log(`${t.id}: ${error ?? answer.verdict}`)
}
