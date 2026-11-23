import { createExecProfileMcpHandler } from "../lib/exec-profile-mcp.mjs"
import { getExecProfile } from "../lib/exec-profile.mjs"
import { createHostedWorkspace } from "../lib/hosted-workspace.mjs"

const server = await createHostedWorkspace()
const mcp = createExecProfileMcpHandler({ lookup: (input) => getExecProfile(input, { token: process.env.REPLAY_READ_TOKEN ?? null }) })

/** Restore the path Vercel rewrote into `__path`, keeping the remaining query. */
export function rewrittenUrl(url) {
  const parsed = new URL(url ?? "/", "http://localhost")
  const path = parsed.searchParams.get("__path")
  if (path === null) return url
  parsed.searchParams.delete("__path")
  const query = parsed.searchParams.toString()
  return `/${path.replace(/^\/+/, "")}${query === "" ? "" : `?${query}`}`
}

/** Vercel function entry: hand the request to the hosted evidence viewer. */
export default function handler(request, response) {
  request.url = rewrittenUrl(request.url)
  if (new URL(request.url, "http://localhost").pathname === "/mcp") return mcp(request, response)
  server.emit("request", request, response)
}
