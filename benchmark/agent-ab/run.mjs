#!/usr/bin/env node
// Same model, same tools, same prompt; the arms differ only in how the head-bound
// Garnet record reaches the agent (lib/agent-ab.mjs ARMS). Model calls go through the Vercel AI Gateway
// (OpenAI-compatible); turns and tokens come from the API responses.
//
//   node benchmark/agent-ab/run.mjs --model anthropic/claude-opus-5.5 [--arm control,tool,mirror,guided] [--only id,..] [--tasks file,..] [--concurrency 6]
//
// Key: AI_GATEWAY_API_KEY. Output: benchmark/agent-ab/runs/<model>/<arm>/<task>.json
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { agentMessages, ARMS, toolSpecs } from "../../lib/agent-ab.mjs"

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    arm: { type: "string" },
    only: { type: "string" },
    tasks: { type: "string", default: "benchmark/agent-ab/tasks.json,benchmark/ci-contacts/tasks.json" },
    concurrency: { type: "string", default: "6" },
    "max-turns": { type: "string", default: "16" },
    force: { type: "boolean", default: false },
  },
})
if (typeof args.model !== "string") throw new Error("--model is required")
const key = process.env.AI_GATEWAY_API_KEY
if (typeof key !== "string" || key === "") throw new Error("AI_GATEWAY_API_KEY is required")
const arms = args.arm === undefined ? ARMS : args.arm.split(",")
const guideline = readFileSync("live/templates/stage2/REVIEW.md", "utf8")
const maxTurns = Number(args["max-turns"])
const cache = join(homedir(), ".cache", "agent-ab")
mkdirSync(cache, { recursive: true })

let tasks = args.tasks.split(",").filter((f) => existsSync(f)).flatMap((f) => JSON.parse(readFileSync(f, "utf8")))
if (typeof args.only === "string") {
  const ids = new Set(args.only.split(","))
  tasks = tasks.filter((t) => ids.has(t.id))
}

async function registry(name, version) {
  const file = join(cache, `${name.replace(/\//g, "__")}@${version}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"))
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`)
  if (!res.ok) throw new Error(`registry ${res.status} for ${name}@${version}`)
  const doc = await res.json()
  writeFileSync(file, JSON.stringify(doc))
  return doc
}

async function unpacked(name, version) {
  const dir = join(cache, `${name.replace(/\//g, "__")}@${version}`)
  if (!existsSync(dir)) {
    const doc = await registry(name, version)
    const res = await fetch(doc.dist.tarball)
    if (!res.ok) throw new Error(`tarball ${res.status}`)
    const tgz = `${dir}.tgz`
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
    mkdirSync(dir, { recursive: true })
    execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1", "--no-same-owner", "--no-same-permissions"])
  }
  return dir
}

const clip = (s) => (s.length > 20000 ? `${s.slice(0, 20000)}\n... (truncated)` : s)

async function callTool(task, arm, name, input) {
  if (name === "garnet_record") {
    if (arm !== "tool") throw new Error("garnet_record is not available")
    return task.record
  }
  if (name === "read_file") {
    if (task.tree === undefined) throw new Error("read_file is not available")
    const content = task.tree[String(input.path).replace(/^\.?\//, "")]
    return content === undefined ? `no such file; files: ${Object.keys(task.tree).join(", ")}` : clip(content)
  }
  if (name === "npm_view") {
    const d = await registry(input.name, input.version)
    const pick = ["name", "version", "scripts", "dependencies", "optionalDependencies", "peerDependencies", "bin", "os", "cpu", "binary", "gypfile", "engines"]
    return JSON.stringify(Object.fromEntries(pick.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])), null, 2)
  }
  if (name === "list_package_files") {
    const dir = await unpacked(input.name, input.version)
    const out = String(execFileSync("find", [".", "-type", "f"], { cwd: dir })).split("\n").filter(Boolean).sort()
    return clip(out.join("\n"))
  }
  if (name === "read_package_file") {
    const dir = await unpacked(input.name, input.version)
    const path = join(dir, String(input.path))
    if (!path.startsWith(`${dir}/`) || !existsSync(path)) return "no such file"
    return clip(readFileSync(path, "utf8"))
  }
  throw new Error(`unknown tool ${name}`)
}

async function chat(body) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) return json
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
  }
}

async function episode(task, arm) {
  const tools = toolSpecs(arm, { hasTree: task.tree !== undefined })
  const messages = agentMessages(task, arm, { guideline })
  const log = []
  const usage = { input_tokens: 0, output_tokens: 0, reported: true }
  let submission = null
  let turns = 0
  const started = Date.now()
  while (turns < maxTurns && submission === null) {
    turns += 1
    const reply = await chat({ model: args.model, messages, tools, tool_choice: turns === maxTurns ? { type: "function", function: { name: "submit" } } : "auto" })
    if (reply.usage === undefined) usage.reported = false
    else {
      usage.input_tokens += reply.usage.prompt_tokens ?? 0
      usage.output_tokens += reply.usage.completion_tokens ?? 0
    }
    const msg = reply.choices[0].message
    messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) })
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      messages.push({ role: "user", content: "Call submit with your review." })
      log.push({ turn: turns, text: msg.content ?? "" })
      continue
    }
    for (const call of calls) {
      let input = {}
      try { input = JSON.parse(call.function.arguments || "{}") } catch { input = {} }
      let result
      if (call.function.name === "submit") {
        submission = input
        result = "submitted"
      } else {
        try { result = await callTool(task, arm, call.function.name, input) } catch (error) { result = `error: ${error.message}` }
      }
      log.push({ turn: turns, tool: call.function.name, input, result_chars: result.length })
      messages.push({ role: "tool", tool_call_id: call.id, content: result })
    }
  }
  return {
    task: task.id, arm, model: args.model, submission, turns,
    tool_calls: log.filter((l) => l.tool !== undefined && l.tool !== "submit").length,
    record_read: log.some((l) => l.tool === "garnet_record"),
    usage: usage.reported ? usage : { input_tokens: null, output_tokens: null, reported: false },
    seconds: Math.round((Date.now() - started) / 1000), log, transcript: messages,
  }
}

const jobs = tasks.flatMap((t) => arms.map((arm) => [t, arm]))
  .filter(([t, arm]) => args.force || !existsSync(join("benchmark/agent-ab/runs", args.model.replace("/", "__"), arm, `${t.id}.json`)))
let next = 0
async function worker() {
  while (next < jobs.length) {
    const [task, arm] = jobs[next++]
    const dir = join("benchmark/agent-ab/runs", args.model.replace("/", "__"), arm)
    mkdirSync(dir, { recursive: true })
    try {
      const out = await episode(task, arm)
      writeFileSync(join(dir, `${task.id}.json`), `${JSON.stringify(out, null, 2)}\n`)
      console.log(`${arm} ${task.id}: ${out.submission?.decision ?? "none"} turns=${out.turns} tokens=${out.usage.input_tokens}/${out.usage.output_tokens}`)
    } catch (error) {
      console.error(`${arm} ${task.id}: ERROR ${error.message}`)
    }
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker))
