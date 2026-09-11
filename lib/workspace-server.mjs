import { createReadStream } from "node:fs"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { recordSummary, workspaceRecord, workspaceTarget } from "./workspace.mjs"
import { validate } from "./validate.mjs"
import { parseReplayInput, replayContext } from "../public/pr-route.mjs"
import { readReplayRequest } from "./replay-request.mjs"
import { createReplayRunner } from "./replay-runner.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = { ".json": "application/json", ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".svg": "image/svg+xml" }

function inside(root, path) {
  const child = relative(root, path)
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !child.startsWith(sep))
}

async function jsonFiles(root) {
  const paths = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return paths
    throw error
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) paths.push(...await jsonFiles(path))
    else if (entry.isFile() && entry.name.endsWith(".json")) paths.push(path)
  }
  return paths
}

/** Load local artifacts; invalid files are reported without hiding healthy files. */
export async function loadWorkspace({ root, targetsDir, schema, revision }) {
  const records = []
  const targets = []
  const issues = []
  for (const path of await jsonFiles(join(root, "replays"))) {
    const id = relative(root, path).split(sep).join("/")
    try {
      const diff = JSON.parse(await readFile(path, "utf8"))
      const errors = validate(schema, diff)
      if (errors.length > 0) throw new Error(`Invalid execution diff: ${errors.join(", ")}`)
      records.push(recordSummary(workspaceRecord(diff, id)))
    } catch (error) {
      issues.push({ file: id, message: error.message })
    }
  }
  for (const path of await jsonFiles(targetsDir)) {
    try {
      targets.push(workspaceTarget(JSON.parse(await readFile(path, "utf8"))))
    } catch (error) {
      issues.push({ file: `targets/${relative(targetsDir, path)}`, message: error.message })
    }
  }
  records.sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "") || a.id.localeCompare(b.id))
  return { records, targets, issues, revision, loadedAt: new Date().toISOString() }
}

/** Serve evidence and explicit local runner actions alongside legacy pages. */
export function createWorkspaceServer({ root, targetsDir, schema, revision = "unknown", readReplay = readReplayRequest, runner = null, origin = null }) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'")
    const actionRoute = /^\/api\/replay\/(prepare|start)$/.exec(request.url ?? "")
    if (request.method !== "GET" && request.method !== "HEAD" && !(request.method === "POST" && actionRoute !== null)) {
      response.writeHead(405, { allow: "GET, HEAD" }).end("Method Not Allowed\n")
      return
    }
    try {
      const url = new URL(request.url ?? "/", "http://localhost")
      const pathname = decodeURIComponent(url.pathname)
      if (request.method === "POST" && actionRoute !== null) {
        const allowed = [`http://localhost:${request.socket.localPort}`, `http://127.0.0.1:${request.socket.localPort}`, ...(origin === null ? [] : [origin])]
        const rejection = !allowed.includes(request.headers.origin)
          ? { code: "origin_mismatch", error: "This preview address is not enabled for preparation. The server operator must configure its exact origin." }
          : request.headers["x-replay-intent"] !== "same-origin"
            ? { code: "missing_intent", error: "The preview did not deliver Replay’s request-intent header. Reload and retry; if it persists, the preview proxy needs attention." }
            : request.headers["content-type"] !== "application/json"
              ? { code: "invalid_content_type", error: "Replay needs a JSON request. Reload the page and retry preparation." }
              : null
        if (rejection !== null) {
          console.warn("Replay request rejected", JSON.stringify({
            code: rejection.code, origin: request.headers.origin ?? null,
            contentType: request.headers["content-type"] ?? null,
            intentPresent: request.headers["x-replay-intent"] === "same-origin",
            configuredOrigin: origin, time: new Date().toISOString(),
          }))
          response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify(rejection))
          return
        }
        if (runner === null) {
          response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "The local runner is unavailable." }))
          return
        }
        let body = ""
        for await (const chunk of request) {
          body += chunk
          if (body.length > 4096) {
            response.writeHead(413).end("Request too large\n")
            return
          }
        }
        try {
          const input = JSON.parse(body)
          let job
          if (actionRoute[1] === "prepare") {
            const pr = parseReplayInput(input.url)
            if (pr === null) throw new Error("Enter a valid GitHub pull request URL.")
            const context = replayContext(pr, await loadWorkspace({ root, targetsDir, schema, revision }))
            job = await runner.prepare(pr, context.target)
          } else job = await runner.start(input.id)
          response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ id: job.id }))
        } catch (error) {
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }))
        }
        return
      }
      if (pathname === "/api/replay/job") {
        const job = runner?.get(url.searchParams.get("id")) ?? null
        if (job === null) {
          response.writeHead(404).end("Job unavailable\n")
          return
        }
        const { signature: _signature, ...publicJob } = job
        response.writeHead(200, { "content-type": "application/json" }).end(request.method === "HEAD" ? undefined : JSON.stringify(publicJob))
        return
      }
      if (pathname === "/api/replay") {
        const pr = parseReplayInput(url.searchParams.get("url"))
        if (pr === null) {
          response.writeHead(400).end("Enter a GitHub pull request URL.\n")
          return
        }
        const context = replayContext(pr, await loadWorkspace({ root, targetsDir, schema, revision }))
        const { record, target, candidate, ...identity } = context
        const result = {
          ...identity,
          target: target === null ? null : { slug: target.slug, upstream: target.upstream, fork: target.fork },
          title: record?.title ?? candidate?.title ?? `Pull request #${pr.number}`,
          recordId: record?.id ?? null,
          state: context.stale ? "stale-record" : record === null ? "no-record" : "record",
          source: "saved",
          checkedAt: null,
          revision,
          runnerEnabled: runner?.enabled ?? false,
        }
        if (record === null || url.searchParams.get("refresh") === "1") {
          try {
            const live = await readReplay(context.evidenceUrl)
            if (live.record !== null && validate(schema, live.record.artifact).length > 0) throw new Error("Invalid receipt")
            Object.assign(result, live, { source: "github", title: live.metadata.title })
            if (context.replay !== null && typeof context.replay.forkHeadSha === "string" && live.metadata.head !== context.replay.forkHeadSha) {
              result.state = "stale-record"
              result.record = null
            }
          } catch {
            result.state = record === null ? "unavailable" : result.state
            result.lookupError = "GitHub could not be read. The pull request may be private, missing, or temporarily unavailable."
          }
        }
        const job = runner?.forPr(pr.url) ?? null
        if (job !== null) {
          const { signature: _signature, ...publicJob } = job
          result.job = publicJob
        }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(result))
        return
      }
      if (pathname === "/api/workspace") {
        const catalog = await loadWorkspace({ root, targetsDir, schema, revision })
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(catalog))
        return
      }
      if (pathname === "/api/record") {
        const id = url.searchParams.get("id") ?? ""
        if (!/^replays\/github\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/\d+\.json$/.test(id)) {
          response.writeHead(400).end("Invalid record ID\n")
          return
        }
        const path = await realpath(resolve(root, id))
        if (!inside(await realpath(root), path)) {
          response.writeHead(403).end("Forbidden\n")
          return
        }
        const diff = JSON.parse(await readFile(path, "utf8"))
        if (validate(schema, diff).length > 0) {
          response.writeHead(422).end("Invalid execution diff\n")
          return
        }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(workspaceRecord(diff, id)))
        return
      }
      if (pathname.startsWith("/api/")) {
        response.writeHead(404).end("Unknown API route\n")
        return
      }
      const legacy = /^\/replays\/github\/[^/]+\/[^/]+\/\d+$/.test(pathname)
      const appRoute = pathname === "/workspace" || parseReplayInput(pathname) !== null
      const file = appRoute ? "/index.html" : legacy ? `${pathname}.json` : pathname.endsWith("/") ? `${pathname}index.html` : pathname
      const path = await realpath(resolve(root, `.${file}`))
      if (!inside(await realpath(root), path)) {
        response.writeHead(403).end("Forbidden\n")
        return
      }
      const info = await stat(path)
      if (!info.isFile()) {
        response.writeHead(404).end("Not Found\n")
        return
      }
      // Legacy result pages contain their own inline share handler.
      if (path.endsWith("index.html") && path !== resolve(root, "index.html")) response.removeHeader("Content-Security-Policy")
      response.writeHead(200, { "content-type": `${TYPES[extname(path)] ?? "application/octet-stream"}; charset=utf-8` })
      if (request.method === "HEAD") response.end()
      else createReadStream(path).on("error", () => response.destroy()).pipe(response)
    } catch (error) {
      const status = error instanceof URIError ? 400 : error instanceof SyntaxError ? 422 : error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500
      response.writeHead(status).end(status === 400 ? "Bad Request\n" : status === 404 ? "Not Found\n" : status === 422 ? "Invalid execution diff\n" : "Unable to read workspace\n")
    }
  })
}

/** Start the dependency-free workspace using the CLI's selected public root. */
export async function serveWorkspace(root, port, revision, { runReplays = false, origin = null } = {}) {
  const schema = JSON.parse(await readFile(join(ROOT, "schema/execution-diff.schema.json"), "utf8"))
  if (origin !== null && (new URL(origin).origin !== origin || !["http:", "https:"].includes(new URL(origin).protocol))) throw new Error("--origin needs an exact HTTP(S) origin, without a trailing slash")
  const runner = await createReplayRunner({ directory: join(ROOT, "out", "workspace"), root, enabled: runReplays })
  const server = createWorkspaceServer({ root, targetsDir: join(ROOT, "targets"), schema, revision, runner, origin })
  server.once("close", () => runner.close())
  await new Promise((ready, reject) => {
    server.once("error", reject)
    server.listen(port, ready)
  })
  console.log(`serving ${root} at http://localhost:${port}`)
  return server
}
