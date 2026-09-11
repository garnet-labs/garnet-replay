import { createHash, randomUUID } from "node:crypto"
import { unlinkSync } from "node:fs"
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Worker } from "node:worker_threads"

const ACTIVE = new Set(["preparing", "recording", "verifying"])

async function acquireRunner(directory) {
  const path = join(directory, "runner.lock")
  try {
    const pid = Number(await readFile(path, "utf8"))
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("The runner lock is unreadable. Inspect it before restarting Replay.")
    try {
      process.kill(pid, 0)
      throw new Error("Another Replay server owns this checkout. Use its URL or stop it first.")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
    await rm(path)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const file = await open(path, "wx", 0o600)
  await file.writeFile(String(process.pid))
  await file.close()
  const release = () => {
    try { unlinkSync(path) } catch {}
    process.removeListener("exit", release)
  }
  process.once("exit", release)
  return release
}

/** Bind execution approval to the full canonical plan, including exact SHAs. */
export function planSignature(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex")
}

/** Return the prepared plan's user-visible inputs. */
export function planDetails(plan) {
  const { fork, baseSha, headSha, scope, record, ecosystem, paths, branch } = plan
  return { fork, baseSha, headSha, scope, record, ecosystem, paths, branch }
}

/** Reject every changed plan before the canonical command performs any writes. */
export function assertPreparedPlan(plan, signature) {
  if (planSignature(plan) !== signature) throw new Error("The replay plan changed. Prepare it again before starting.")
}

/** Keep interrupted local work explicit; remote workflows may still be running. */
export function recoverReplayJob(job) {
  return ACTIVE.has(job.state)
    ? { ...job, state: "interrupted", message: "The local runner stopped. Check the fork before preparing again; its workflows may still be running." }
    : job
}

/** Run blocking git operations away from the HTTP server's event loop. */
export function launchReplayWorker(action, data, emit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./replay-runner-worker.mjs", import.meta.url), { workerData: { action, ...data } })
    let finished = false
    worker.on("message", (message) => {
      if (message.type === "result") {
        finished = true
        resolve(message.value)
      } else if (message.type === "failure") {
        finished = true
        reject(new Error(message.message))
      } else emit(message.value)
    })
    worker.on("error", reject)
    worker.on("exit", (code) => {
      if (!finished) reject(new Error(`Runner exited before reporting a result (${code}). Check the fork before retrying.`))
    })
  })
}

/** Serialize local replay jobs and persist their state outside the public tree. */
export async function createReplayRunner({ directory, root, enabled = false, launch = launchReplayWorker }) {
  await mkdir(directory, { recursive: true })
  const release = await acquireRunner(directory)
  const path = join(directory, "jobs.json")
  let jobs = []
  try { jobs = JSON.parse(await readFile(path, "utf8")).map(recoverReplayJob) } catch (error) {
    if (error.code !== "ENOENT") {
      release()
      throw error
    }
  }
  let writes = Promise.resolve()
  const persist = () => {
    const text = JSON.stringify(jobs, null, 2)
    writes = writes.then(async () => {
      await writeFile(`${path}.next`, text, { mode: 0o600 })
      await rename(`${path}.next`, path)
    })
    return writes
  }
  try { await persist() } catch (error) {
    release()
    throw error
  }
  const busy = () => jobs.some((job) => ACTIVE.has(job.state))
  let closing = false
  const update = (job, delta) => {
    if (delta.line !== undefined) job.lines.push(delta.line)
    const { line: _line, ...fields } = delta
    Object.assign(job, fields, { updatedAt: new Date().toISOString() })
    return persist()
  }
  const work = async (action, job) => {
    try {
      const result = await launch(action, { slug: job.slug, number: job.number, signature: job.signature, root }, (delta) => {
        void update(job, delta).catch(() => {})
      })
      await update(job, result)
    } catch (error) {
      await update(job, { state: "blocked", message: error.message })
    } finally {
      if (closing) release()
    }
  }
  return {
    enabled,
    close() {
      closing = true
      if (!busy()) release()
    },
    get(id) {
      return jobs.find((job) => job.id === id) ?? null
    },
    forPr(url) {
      return jobs.findLast((job) => job.url.toLowerCase() === url.toLowerCase()) ?? null
    },
    async prepare(pr, target) {
      const existing = jobs.find((job) => job.url.toLowerCase() === pr.url.toLowerCase() && ACTIVE.has(job.state))
      if (existing !== undefined) return existing
      if (busy()) throw new Error("The local runner is busy with another replay. Try again after it finishes.")
      if (target === null || target.upstream.toLowerCase() !== pr.repository.toLowerCase() || !/^garnet-labs\/[a-z0-9_.-]+$/i.test(target.fork) || target.upstream.toLowerCase() === target.fork.toLowerCase()) {
        throw new Error("This upstream PR needs a configured garnet-labs fork before it can be replayed.")
      }
      const job = { id: randomUUID(), slug: target.slug, number: pr.number, url: pr.url, state: "preparing", lines: [], createdAt: new Date().toISOString() }
      jobs.push(job)
      await persist()
      void work("prepare", job).catch(() => {})
      return job
    },
    async start(id) {
      if (!enabled) throw new Error("Recording is disabled on this server. Start replay serve with --run-replays to enable explicit fork recording.")
      const job = jobs.find((entry) => entry.id === id)
      if (job === undefined) throw new Error("This plan is unavailable. Prepare the replay again.")
      if (ACTIVE.has(job.state)) return job
      if (job.state !== "prepared") throw new Error("Prepare a new replay plan before starting.")
      if (busy()) throw new Error("The local runner is busy with another replay.")
      await update(job, { state: "recording", message: "The canonical harness is creating the fork replay and waiting for the base recording." })
      void work("start", job).catch(() => {})
      return job
    },
  }
}
