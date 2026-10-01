import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createWorkspaceServer } from "./workspace-server.mjs"
import { readReplayRequest } from "./replay-request.mjs"

/** Resolve public GitHub evidence without ambient server credentials. */
export function readPublicReplay(url) {
  return readReplayRequest(url, { token: null })
}

/** Build a public evidence viewer without workers or writable job storage. */
export async function createHostedWorkspace({ revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown", readReplay = readPublicReplay } = {}) {
  const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
  return createWorkspaceServer({
    root: fileURLToPath(new URL("../public/", import.meta.url)),
    targetsDir: fileURLToPath(new URL("../targets/", import.meta.url)),
    schema,
    revision,
    readReplay,
  })
}
