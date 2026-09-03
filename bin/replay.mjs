#!/usr/bin/env node

import { createReadStream } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, normalize, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildExecutionDiff, renderExecutionDiffText } from "../lib/execution-diff.mjs"
import { knownEvidence } from "../lib/known-evidence.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function option(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 || args[index + 1] === undefined ? fallback : args[index + 1]
}

function replayPath(out, pr) {
  return join(out, "github", pr.owner, pr.repo, `${pr.number}.json`)
}

async function writeDiff(out, pr, diff) {
  const path = replayPath(out, pr)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(diff, null, 2)}\n`)
  return path
}

function safeFilePath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0])
  const candidate = resolve(root, `.${normalize(decoded)}`)
  const relativePath = relative(root, candidate)
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${"/"}`))
    ? candidate
    : null
}

function contentType(path) {
  const extension = extname(path)
  return extension === ".json" ? "application/json; charset=utf-8"
    : extension === ".html" ? "text/html; charset=utf-8"
      : "application/octet-stream"
}

async function serve(root, port) {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" })
      response.end("Method Not Allowed\n")
      return
    }
    let requestPath
    try {
      requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)
    } catch {
      response.writeHead(400)
      response.end("Bad Request\n")
      return
    }
    if (/^\/replays\/github\/[^/]+\/[^/]+\/\d+$/.test(requestPath)) {
      requestPath = `${requestPath}.json`
    } else if (requestPath.endsWith("/")) {
      requestPath += "index.html"
    }
    const path = safeFilePath(root, requestPath)
    if (path === null) {
      response.writeHead(403)
      response.end("Forbidden\n")
      return
    }
    try {
      const fileStat = await stat(path)
      if (!fileStat.isFile()) throw new Error("not a file")
      response.writeHead(200, { "content-type": contentType(path) })
      createReadStream(path).pipe(response)
    } catch {
      response.writeHead(404)
      response.end("Not Found\n")
    }
  })
  await new Promise((resolveServer) => server.listen(port, resolveServer))
  console.log(`serving ${root} at http://localhost:${port}`)
}

async function known(args) {
  const url = args[0]
  if (typeof url !== "string") throw new Error("known requires a pull request URL")
  const token = option(args, "--token", process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN)
  const out = resolve(option(args, "--out", join(ROOT, "public", "replays")))
  const result = await knownEvidence(url, { token })
  if (result.status !== "ok") {
    throw new Error(`${result.status}: ${result.reason}`)
  }
  const parsed = new URL(url)
  const path = await writeDiff(out, {
    owner: parsed.pathname.split("/")[1],
    repo: parsed.pathname.split("/")[2],
    number: Number(parsed.pathname.split("/")[4]),
  }, result.diff)
  console.log(`wrote ${path}`)
  console.log(renderExecutionDiffText(result.diff))
}

async function seed(args) {
  const corpusPath = args[0]
  if (typeof corpusPath !== "string") throw new Error("seed-from-corpus requires a corpus path")
  const out = resolve(option(args, "--out", join(ROOT, "public", "replays")))
  const corpus = JSON.parse(await readFile(resolve(corpusPath), "utf8"))
  let count = 0
  for (const pr of corpus.prs ?? []) {
    const diff = buildExecutionDiff(pr)
    if (diff === null) continue
    const owner = new URL(pr.url).pathname.split("/")[1]
    const repo = new URL(pr.url).pathname.split("/")[2]
    await writeDiff(out, { owner, repo, number: pr.pr_number }, diff)
    count += 1
  }
  console.log(`wrote ${count} replay files to ${out}`)
}

async function main(args) {
  const command = args[0]
  if (command === "known") return known(args.slice(1))
  if (command === "seed-from-corpus") return seed(args.slice(1))
  if (command === "serve") {
    const root = resolve(option(args.slice(1), "--root", join(ROOT, "public")))
    const port = Number(option(args.slice(1), "--port", "8787"))
    return serve(root, port)
  }
  throw new Error("usage: replay.mjs known|serve|seed-from-corpus")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
