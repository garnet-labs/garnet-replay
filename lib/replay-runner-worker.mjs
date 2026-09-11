import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parentPort, workerData } from "node:worker_threads"
import { livePr } from "./commands.mjs"
import { run } from "./gh.mjs"
import { waitForRecord } from "./wait.mjs"
import { verifyExhibit } from "./verify.mjs"
import { readReplayRequest, replayGithubToken } from "./replay-request.mjs"
import { assertPreparedPlan, planDetails, planSignature } from "./replay-runner.mjs"
import { validate } from "./validate.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

function exec(command, args, options = {}) {
  return run(command, args, { cwd: ROOT, timeout: 120000, ...options })
}

function emit(value) {
  parentPort.postMessage({ type: "progress", value })
}

async function saveEvidence(root, fork, number, diff) {
  const schema = JSON.parse(await readFile(join(ROOT, "schema", "execution-diff.schema.json"), "utf8"))
  if (validate(schema, diff).length > 0) throw new Error("The receipt does not meet the execution-diff contract.")
  const directory = join(root, "replays", "github", fork)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${number}.next`), `${JSON.stringify(diff, null, 2)}\n`)
  await rename(join(directory, `${number}.next`), join(directory, `${number}.json`))
}

/** Drive preparation, recording and verification through canonical command seams. */
export async function executeReplayJob(data, {
  live = livePr, wait = waitForRecord, verify = verifyExhibit, read = readReplayRequest,
  save = saveEvidence, execute = exec, progress = () => {},
} = {}) {
  const { action, slug, number, signature, root } = data
  const args = [slug, "--pr", String(number)]
  const log = (line) => progress({ line })
  if (action === "prepare") {
    const result = await live([...args, "--dry-run"], { exec: execute, log })
    return { state: "prepared", plan: planDetails(result.plan), signature: planSignature(result.plan) }
  }
  const result = await live(args, { exec: execute, log, beforeExecute: (plan) => assertPreparedPlan(plan, signature) })
  const { forkPr, forkHeadSha } = result.row
  if (!Number.isSafeInteger(forkPr) || typeof forkHeadSha !== "string") throw new Error("The harness did not report a fork PR and head. Inspect its output before retrying.")
  const forkUrl = `https://github.com/${result.plan.fork}/pull/${forkPr}`
  progress({ forkUrl, message: "The head is on the fork. Waiting for its final Runtime Review record." })
  const recorded = await wait({ fork: result.plan.fork, forkPr, sha: forkHeadSha, exec: execute, log })
  if (recorded.state !== "recorded") throw new Error(recorded.detail)
  progress({ state: "verifying", message: "Checking the exact pair, recording, label, and public receipt." })
  const verification = await verify(forkUrl, { token: replayGithubToken(execute) })
  if (verification.status !== "PASS" || verification.head !== forkHeadSha) throw new Error(`The replay is not shareable: ${verification.reasons.join("; ") || "head changed during verification"}`)
  const evidence = await read(forkUrl, { exec: execute })
  if (evidence.state !== "record" || evidence.record === null || evidence.record.head !== verification.head) throw new Error("The verified head has no matching execution diff.")
  await save(root, result.plan.fork, forkPr, evidence.record.artifact)
  return { state: "complete", forkUrl, verification, message: "The canonical share gate passed for this head." }
}

if (parentPort !== null) {
  executeReplayJob(workerData, { progress: emit }).then(
    (value) => parentPort.postMessage({ type: "result", value }),
    (error) => parentPort.postMessage({ type: "failure", message: error.message }),
  )
}
