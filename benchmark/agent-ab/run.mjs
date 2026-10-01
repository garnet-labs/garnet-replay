#!/usr/bin/env node
// Same model, same tools, same prompt; the arms differ only in how the head-bound
// Garnet record reaches the agent (lib/agent-ab.mjs ARMS). Model calls go through the Vercel AI Gateway
// (OpenAI-compatible); turns and tokens come from the API responses.
//
//   node benchmark/agent-ab/run.mjs --model anthropic/claude-opus-5.5 [--arm control,tool,mirror,guided] [--only id,..] [--tasks file,..]
//     [--split dev|heldout] [--cohort baseline,ai-infra,prospect] [--concurrency 6] [--budget-usd 300] [--credit-floor-usd 2]
//
// Key: AI_GATEWAY_API_KEY. Output: benchmark/agent-ab/runs/<model>/<arm>/<task>.json
// Spend guard: each episode's cost is priced from the gateway's published model prices. No
// episode starts once recorded spend across every run file plus the in-flight reserve would pass
// --budget-usd, or once the gateway credit balance falls below --credit-floor-usd.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { agentMessages, ARMS, toolSpecs } from "../../lib/agent-ab.mjs"

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    arm: { type: "string" },
    only: { type: "string" },
    tasks: { type: "string", default: "benchmark/agent-ab/tasks.json,benchmark/agent-ab/prospect-tasks.json,benchmark/ci-contacts/tasks.json" },
    concurrency: { type: "string", default: "6" },
    "max-turns": { type: "string", default: "16" },
    split: { type: "string" },
    cohort: { type: "string" },
    force: { type: "boolean", default: false },
    "budget-usd": { type: "string", default: "300" },
    "credit-floor-usd": { type: "string", default: "2" },
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
if (typeof args.split === "string") tasks = tasks.filter((t) => t.split === args.split)
if (typeof args.cohort === "string") {
  const cohorts = new Set(args.cohort.split(","))
  tasks = tasks.filter((t) => cohorts.has(t.cohort ?? "baseline"))
}

const gateway = "https://ai-gateway.vercel.sh/v1"
const runsRoot = "benchmark/agent-ab/runs"
const budget = Number(args["budget-usd"])
const creditFloor = Number(args["credit-floor-usd"])
const price = (await (await fetch(`${gateway}/models`)).json()).data.find((m) => m.id === args.model)?.pricing
if (price?.input === undefined || price?.output === undefined) throw new Error(`no published price for ${args.model}; refusing to run unmetered`)

/** USD for one completion, from its usage and the model's published per-token prices. */
function costOf(usage) {
  const prompt = usage.prompt_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const cacheRate = Number(price.input_cache_read ?? price.input)
  return (prompt - cached) * Number(price.input) + cached * cacheRate + (usage.completion_tokens ?? 0) * Number(price.output)
}

/** Recorded spend across every episode file of every model. */
function recordedSpend(dir = runsRoot) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sum + recordedSpend(path)
    if (!entry.name.endsWith(".json")) return sum
    const cost = JSON.parse(readFileSync(path, "utf8")).cost_usd
    return sum + (typeof cost === "number" ? cost : 0)
  }, 0)
}

async function creditBalance() {
  const res = await fetch(`${gateway}/credits`, { headers: { authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`credits ${res.status}`)
  return Number((await res.json()).balance)
}

let spent = recordedSpend()
let inFlight = 0
let reserve = 1
let stopped = null

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
    const res = await fetch(`${gateway}/chat/completions`, {
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
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reported: true }
  let cost = 0
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
      usage.cached_input_tokens += reply.usage.prompt_tokens_details?.cached_tokens ?? 0
      cost += costOf(reply.usage)
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
    usage: usage.reported ? usage : { input_tokens: null, output_tokens: null, cached_input_tokens: null, reported: false },
    cost_usd: usage.reported ? cost : null,
    seconds: Math.round((Date.now() - started) / 1000), log, transcript: messages,
  }
}

const jobs = tasks.flatMap((t) => arms.map((arm) => [t, arm]))
  .filter(([t, arm]) => args.force || !existsSync(join("benchmark/agent-ab/runs", args.model.replace("/", "__"), arm, `${t.id}.json`)))
let next = 0
async function worker() {
  while (next < jobs.length && stopped === null) {
    if (spent + (inFlight + 1) * reserve > budget) { stopped = `budget: $${spent.toFixed(2)} spent of $${budget}`; break }
    const balance = await creditBalance()
    if (balance < creditFloor) { stopped = `credit balance $${balance.toFixed(2)} is below the $${creditFloor} floor`; break }
    const [task, arm] = jobs[next++]
    inFlight += 1
    const dir = join("benchmark/agent-ab/runs", args.model.replace("/", "__"), arm)
    mkdirSync(dir, { recursive: true })
    try {
      const out = await episode(task, arm)
      writeFileSync(join(dir, `${task.id}.json`), `${JSON.stringify(out, null, 2)}\n`)
      if (out.cost_usd === null) { stopped = `${task.id}: usage not reported, spend cannot be metered`; reserve = Infinity }
      else { spent += out.cost_usd; reserve = Math.max(reserve, 2 * out.cost_usd) }
      console.log(`${arm} ${task.id}: ${out.submission?.decision ?? "none"} turns=${out.turns} tokens=${out.usage.input_tokens}/${out.usage.output_tokens} $${out.cost_usd?.toFixed(3)} total $${spent.toFixed(2)}`)
    } catch (error) {
      console.error(`${arm} ${task.id}: ERROR ${error.message}`)
    } finally {
      inFlight -= 1
    }
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker))
console.log(`spend $${spent.toFixed(2)} of $${budget}${stopped === null ? "" : `; stopped: ${stopped}`}`)
