import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createWorkspaceServer } from "./workspace-server.mjs"
import { readReplayRequest } from "./replay-request.mjs"
import { createHostedRunner, operatorKeyMatches } from "./hosted-runner.mjs"

/** Resolve public GitHub evidence with only the explicitly configured read token. */
export function readPublicReplay(url, token = process.env.REPLAY_READ_TOKEN ?? null) {
  return readReplayRequest(url, { token })
}

/**
 * Build the hosted viewer. Fork recording is enabled only when an Actions
 * dispatch token, an operator key and the exact public origin are all configured;
 * the replay itself runs in the harness repository's `replay` workflow.
 */
export async function createHostedWorkspace({ revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown", readReplay = readPublicReplay, env = process.env, runner = undefined } = {}) {
  const schema = JSON.parse(await readFile(new URL("../schema/execution-diff.schema.json", import.meta.url), "utf8"))
  const configured = [env.REPLAY_DISPATCH_TOKEN, env.REPLAY_OPERATOR_KEY, env.REPLAY_ORIGIN].every((value) => typeof value === "string" && value !== "")
  const hostedRunner = runner !== undefined ? runner : configured ? createHostedRunner({ token: env.REPLAY_DISPATCH_TOKEN, repository: env.REPLAY_REPOSITORY ?? "garnet-labs/garnet-replay" }) : null
  return createWorkspaceServer({
    root: fileURLToPath(new URL("../public/", import.meta.url)),
    targetsDir: fileURLToPath(new URL("../targets/", import.meta.url)),
    schema,
    revision,
    readReplay,
    runner: hostedRunner,
    origin: env.REPLAY_ORIGIN ?? null,
    authorize: hostedRunner === null ? null : (request) => operatorKeyMatches(env.REPLAY_OPERATOR_KEY, request.headers["x-replay-operator"]),
  })
}
