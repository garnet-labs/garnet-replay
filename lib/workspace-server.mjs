import { createReadStream } from "node:fs"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { recordSummary, workspaceRecord, workspaceTarget } from "./workspace.mjs"
import { validate } from "./validate.mjs"

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

/** Read-only HTTP interface for the local harness workspace and legacy pages. */
export function createWorkspaceServer({ root, targetsDir, schema, revision = "unknown" }) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'")
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end("Method Not Allowed\n")
      return
    }
    try {
      const url = new URL(request.url ?? "/", "http://localhost")
      const pathname = decodeURIComponent(url.pathname)
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
      const file = legacy ? `${pathname}.json` : pathname.endsWith("/") ? `${pathname}index.html` : pathname
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
export async function serveWorkspace(root, port, revision) {
  const schema = JSON.parse(await readFile(join(ROOT, "schema/execution-diff.schema.json"), "utf8"))
  const server = createWorkspaceServer({ root, targetsDir: join(ROOT, "targets"), schema, revision })
  await new Promise((ready, reject) => {
    server.once("error", reject)
    server.listen(port, ready)
  })
  console.log(`serving ${root} at http://localhost:${port}`)
  return server
}
