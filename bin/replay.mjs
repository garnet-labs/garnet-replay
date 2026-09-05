#!/usr/bin/env node

import { createReadStream } from "node:fs"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { dirname, extname, join, normalize, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildExecutionDiff, renderExecutionDiffText } from "../lib/execution-diff.mjs"
import { assessLiveReplaySupport, detectPackageManager } from "../lib/gate.mjs"
import { knownEvidence } from "../lib/known-evidence.mjs"
import { executionDiffFromProfiles } from "../lib/profile-diff.mjs"
import { createReplayBranch, pickDependencyFromHistory, planReplay } from "../live/replay-branch.mjs"
import { validate } from "../lib/validate.mjs"

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

async function seedConstructed(args) {
  const seedsPath = args[0]
  if (typeof seedsPath !== "string") throw new Error("seed-constructed requires a seeds path")
  const out = resolve(option(args, "--out", join(ROOT, "public", "replays")))
  const seeds = JSON.parse(await readFile(resolve(seedsPath), "utf8"))
  const schema = JSON.parse(await readFile(join(ROOT, "schema", "execution-diff.schema.json"), "utf8"))
  let count = 0
  for (const seed of seeds.filter((entry) => entry.label === "constructed")) {
    if (typeof seed.profile_fixture !== "string" || typeof seed.profile_id !== "string"
      || typeof seed.run_id === "undefined" || typeof seed.title !== "string" || typeof seed.note !== "string") {
      throw new Error(`constructed seed ${seed.id} is missing profile metadata`)
    }
    const profile = JSON.parse(await readFile(resolve(ROOT, seed.profile_fixture), "utf8"))
    const parsedUrl = new URL(seed.pr_url)
    const baseline = seed.base_fixture === null || seed.base_fixture === undefined
      ? null
      : JSON.parse(await readFile(resolve(ROOT, seed.base_fixture), "utf8"))
    const raw = profile.profiles?.[0]
    if (!raw?.run) throw new Error(`constructed profile ${seed.profile_fixture} is missing run metadata`)
    if (raw.run.profile_id !== seed.profile_id || String(raw.run.run_id) !== String(seed.run_id)) {
      throw new Error(`constructed seed ${seed.id} does not match its profile fixture`)
    }
    const baseRaw = baseline?.profiles?.[0]?.run
    if (baseline !== null && (!baseRaw
      || baseRaw.profile_id !== seed.base_profile_id
      || String(baseRaw.run_id) !== String(seed.base_run_id))) {
      throw new Error(`constructed seed ${seed.id} does not match its base fixture`)
    }
    const comparisonScope = baseline === null ? "unavailable" : "constructed-pair"
    const diff = executionDiffFromProfiles({
      baseline,
      update: profile,
      meta: {
        label: "constructed",
        repository: seed.source,
        repoUrl: `https://github.com/${seed.source}`,
        prNumber: Number(parsedUrl.pathname.split("/").at(-1)),
        prUrl: seed.pr_url,
        title: seed.title,
        note: seed.note,
        headSha: raw.run.commit_sha,
        runId: raw.run.run_id,
        headReceiptUrl: seed.head_receipt_url ?? seed.receipt_url ?? null,
        comparisonScope,
        ...(baseline === null ? {} : {
          baselineSha: baseline.profiles?.[0]?.run?.commit_sha ?? null,
          baseReceiptUrl: seed.base_receipt_url ?? null,
        }),
      },
    })
    const errors = validate(schema, diff)
    if (errors.length > 0) throw new Error(`constructed seed ${seed.id} is invalid: ${errors.join(", ")}`)
    await writeDiff(out, {
      owner: parsedUrl.pathname.split("/")[1],
      repo: parsedUrl.pathname.split("/")[2],
      number: Number(parsedUrl.pathname.split("/").at(-1)),
    }, diff)
    count += 1
  }
  console.log(`wrote ${count} constructed replay files to ${out}`)
}

function repoParts(value) {
  try {
    const url = new URL(value)
    const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean)
    if (url.hostname !== "github.com" || parts.length !== 2) return null
    return { owner: parts[0], repo: parts[1], url: `https://github.com/${parts[0]}/${parts[1]}.git` }
  } catch {
    return null
  }
}

async function githubJson(path, token) {
  if (typeof token !== "string" || token === "") throw new Error("GITHUB_TOKEN is required for a GitHub repository URL")
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.json()
}

async function repositoryContext(repoUrl, token, repoDir, packageDir = ".") {
  if (repoUrl !== null) {
    const meta = await githubJson(`/repos/${repoUrl.owner}/${repoUrl.repo}`, token)
    const contents = await githubJson(`/repos/${repoUrl.owner}/${repoUrl.repo}/contents`, token)
    const files = Array.isArray(contents) ? contents.map((entry) => ({ filename: entry.name })) : []
    if (packageDir !== ".") {
      const path = packageDir.split("/").map(encodeURIComponent).join("/")
      try {
        await githubJson(`/repos/${repoUrl.owner}/${repoUrl.repo}/contents/${path}/package.json`, token)
        files.push({ filename: `${packageDir}/package.json` })
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("GitHub API 404")) throw error
      }
    }
    return { meta, files, cloneUrl: repoUrl.url, repository: `${repoUrl.owner}/${repoUrl.repo}` }
  }
  const remote = (() => {
    try {
      return gitOutput(repoDir, ["remote", "get-url", "origin"])
    } catch {
      return null
    }
  })()
  const parsed = remote === null ? null : repoParts(remote.replace(/\.git$/, ""))
  const files = await localRootFiles(repoDir, packageDir)
  return {
    meta: parsed === null ? {} : { private: false },
    files,
    cloneUrl: null,
    repository: parsed === null ? "" : `${parsed.owner}/${parsed.repo}`,
  }
}

function gitOutput(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim()
}

async function localRootFiles(repoDir, packageDir = ".") {
  const entries = await readdir(repoDir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => ({ filename: entry.name }))
  if (packageDir !== ".") {
    try {
      const packagePath = join(repoDir, packageDir, "package.json")
      const packageStat = await stat(packagePath)
      if (packageStat.isFile()) files.push({ filename: `${packageDir}/package.json` })
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  return files
}

async function cloneForReplay(source, cacheRoot) {
  await mkdir(cacheRoot, { recursive: true })
  const target = join(cacheRoot, `checkout-${Date.now().toString(36)}`)
  const cloneSource = source.cloneUrl ?? source.repoDir
  execFileSync("git", ["clone", cloneSource, target], { stdio: "pipe" })
  return target
}

async function live(args) {
  const target = args[0]
  if (typeof target !== "string") throw new Error("live requires a repository URL or path")
  const token = option(args, "--token", process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN)
  const packageDir = option(args, "--dir", ".")
  const repoUrl = repoParts(target)
  const localPath = repoUrl === null ? resolve(target) : null
  const context = await repositoryContext(repoUrl, token, localPath, packageDir)
  let repoDir = localPath
  if (repoUrl !== null || localPath !== null) {
    repoDir = await cloneForReplay(repoUrl === null ? { repoDir: localPath } : { cloneUrl: repoUrl.url }, join(process.env.HOME ?? ROOT, ".cache", "garnet-replay"))
  }
  const preliminaryGate = assessLiveReplaySupport({
    repoMeta: context.meta,
    prMeta: { user: { login: "dependabot[bot]" } },
    files: context.files,
  })
  if (!preliminaryGate.supported) {
    console.log(`Live replay is not supported: ${preliminaryGate.reasons.filter((reason) => reason !== "Linux is required").join("; ")}`)
    return
  }
  const explicitDependency = option(args, "--dependency", null)
  const explicitFrom = option(args, "--from", null)
  const explicitTo = option(args, "--to", null)
  let dependency = explicitDependency
  let from = explicitFrom
  let to = explicitTo
  if (args.includes("--pick-from-history")) {
    const picked = pickDependencyFromHistory(repoDir, packageDir)
    if (picked === null) {
      console.log("Live replay is not supported: no dependency version transition found in package.json history")
      return
    }
    dependency = picked.dependency
    from = picked.from
    to = picked.to
  }
  if (dependency === null || from === null || to === null) {
    throw new Error("live requires --dependency name --from x --to y or --pick-from-history")
  }
  const gate = assessLiveReplaySupport({
    repoMeta: context.meta,
    prMeta: { title: `Update ${dependency} from ${from} to ${to}`, user: { login: "dependabot[bot]" } },
    files: context.files,
  })
  if (!gate.supported) {
    console.log(`Live replay is not supported: ${gate.reasons.filter((reason) => reason !== "Linux is required").join("; ")}`)
    return
  }
  const packageManager = detectPackageManager(context.files)
  const plan = planReplay({ repoDir, packageDir, dependency, from, to, packageManager })
  if (args.includes("--dry-run")) {
    console.log(`Live replay plan: ${dependency} ${from} to ${to} using ${packageManager}`)
    console.log(`package dir: ${plan.packageDir}`)
    console.log(`branch: ${plan.branch}`)
    console.log(`checkout: ${repoDir}`)
    return
  }
  const result = createReplayBranch({ repoDir, packageDir, dependency, from, to, packageManager })
  console.log(`created replay branch ${result.branch}`)
  console.log(result.ghCommand)
}

async function main(args) {
  const command = args[0]
  if (command === "known") return known(args.slice(1))
  if (command === "seed-from-corpus") return seed(args.slice(1))
  if (command === "seed-constructed") return seedConstructed(args.slice(1))
  if (command === "live") return live(args.slice(1))
  if (command === "serve") {
    const root = resolve(option(args.slice(1), "--root", join(ROOT, "public")))
    const port = Number(option(args.slice(1), "--port", "8787"))
    return serve(root, port)
  }
  throw new Error("usage: replay.mjs known|serve|seed-from-corpus|seed-constructed")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
