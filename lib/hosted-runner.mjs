import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { inflateRawSync } from "node:zlib"

const API = "https://api.github.com"
const RUN_STATE = { queued: "recording", in_progress: "recording", waiting: "recording", requested: "recording", pending: "recording" }

/** Compare an operator key in constant time without revealing its length. */
export function operatorKeyMatches(expected, given) {
  if (typeof expected !== "string" || expected === "" || typeof given !== "string") return false
  const digest = (value) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(expected), digest(given))
}

/** Read one file from a zip archive (stored or deflated entries). */
export function readZipEntry(buffer, name) {
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error("The job artifact is not a zip archive.")
  let offset = buffer.readUInt32LE(end + 16)
  const count = buffer.readUInt16LE(end + 10)
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const size = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extra = buffer.readUInt16LE(offset + 30)
    const comment = buffer.readUInt16LE(offset + 32)
    const local = buffer.readUInt32LE(offset + 42)
    const entry = buffer.toString("utf8", offset + 46, offset + 46 + nameLength)
    if (entry === name) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      const data = buffer.subarray(start, start + size)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data)
      throw new Error("The job artifact uses an unsupported compression method.")
    }
    offset += 46 + nameLength + extra + comment
  }
  return null
}

/** Run the canonical replay job on GitHub Actions and read its state back. */
export function createHostedRunner({ token, repository = "garnet-labs/garnet-replay", workflow = "replay.yml", ref = "main", fetchImpl = fetch, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const api = async (path, init = {}) => {
    const response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`GitHub rejected the replay request (HTTP ${response.status}).`)
    return response
  }
  const runs = async ({ pages = 1 } = {}) => {
    const listed = []
    for (let page = 1; page <= pages; page += 1) {
      const batch = (await (await api(`/repos/${repository}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100&page=${page}`)).json()).workflow_runs ?? []
      listed.push(...batch)
      if (batch.length < 100) break
    }
    return listed
  }
  const parseTitle = (title) => {
    const match = /^replay (\S+)#(\d+) (prepare|start) (\S+)(?: (\d+))?$/.exec((title ?? "").trim())
    return match === null ? null : { slug: match[1], number: Number(match[2]), action: match[3], request: match[4], plan: match[5] === undefined ? null : Number(match[5]) }
  }
  const artifactJob = async (runId) => {
    const listed = (await (await api(`/repos/${repository}/actions/runs/${runId}/artifacts`)).json()).artifacts ?? []
    const artifact = listed.find((entry) => entry.name === "replay-job" && entry.expired !== true)
    if (artifact === undefined) return null
    const archive = Buffer.from(await (await api(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`)).arrayBuffer())
    const file = readZipEntry(archive, "job.json")
    return file === null ? null : JSON.parse(file.toString("utf8"))
  }
  const forkProgress = async (plan) => {
    if (typeof plan?.fork !== "string" || typeof plan?.branch !== "string") return null
    const [owner] = plan.fork.split("/")
    const listed = await (await api(`/repos/${plan.fork}/pulls?state=all&head=${encodeURIComponent(`${owner}:${plan.branch}`)}&per_page=1`)).json()
    return listed[0]?.html_url ?? null
  }
  const dispatch = async (inputs) => {
    const request = randomUUID()
    await api(`/repos/${repository}/actions/workflows/${workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref, inputs: { ...inputs, request } }) })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const run = (await runs()).find((entry) => parseTitle(entry.display_title)?.request === request)
      if (run !== undefined) return { run, request }
      await sleep(2000)
    }
    throw new Error("GitHub accepted the replay but its run has not appeared yet. Refresh this PR in a minute.")
  }
  const read = async (run, url) => {
    const title = parseTitle(run.display_title)
    const base = { id: String(run.id), slug: title.slug, number: title.number, url, runUrl: run.html_url, createdAt: run.created_at, updatedAt: run.updated_at, lines: [] }
    if (run.status !== "completed") {
      if (title.action === "prepare") return { ...base, state: "preparing", message: "GitHub Actions is checking the change and the fork recorder." }
      const prepared = title.plan === null ? null : await artifactJob(title.plan)
      const forkUrl = await forkProgress(prepared?.plan)
      return { ...base, state: RUN_STATE[run.status] ?? "recording", plan: prepared?.plan, forkUrl: forkUrl ?? undefined, message: forkUrl === null ? "GitHub Actions is creating the fork replay." : "The replay is on the fork. Waiting for its Runtime Review record." }
    }
    const job = await artifactJob(run.id)
    if (job === null) return { ...base, state: "blocked", message: `The replay run ended (${run.conclusion}) without a job report. Inspect the run before retrying.` }
    const { signature: _signature, ...visible } = job
    return { ...base, ...visible, id: String(run.id) }
  }
  return {
    enabled: true,
    hosted: true,
    async get(id) {
      if (!/^\d+$/.test(id ?? "")) return null
      const run = await (await api(`/repos/${repository}/actions/runs/${id}`)).json()
      const title = parseTitle(run.display_title)
      if (title === null || run.path?.endsWith(workflow) !== true) return null
      return read(run, null)
    },
    async forPr(url, target) {
      if (target === null || target === undefined) return null
      const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/i.exec(url ?? "")
      if (match === null || match[1].toLowerCase() !== target.upstream.toLowerCase()) return null
      const number = Number(match[2])
      const run = (await runs({ pages: 5 })).find((entry) => {
        const title = parseTitle(entry.display_title)
        return title !== null && title.slug === target.slug && title.number === number
      })
      return run === undefined ? null : read(run, url)
    },
    async prepare(pr, target) {
      if (target === null || target.upstream.toLowerCase() !== pr.repository.toLowerCase() || !/^garnet-labs\/[a-z0-9_.-]+$/i.test(target.fork) || target.upstream.toLowerCase() === target.fork.toLowerCase()) {
        throw new Error("This upstream PR needs a configured garnet-labs fork before it can be replayed.")
      }
      const { run } = await dispatch({ action: "prepare", slug: target.slug, number: String(pr.number), plan: "" })
      return { id: String(run.id) }
    },
    async start(id) {
      if (!/^\d+$/.test(id ?? "")) throw new Error("This plan is unavailable. Prepare the replay again.")
      const run = await (await api(`/repos/${repository}/actions/runs/${id}`)).json()
      const title = parseTitle(run.display_title)
      if (title === null || title.action !== "prepare" || run.status !== "completed") throw new Error("Prepare the replay and wait for its plan before starting.")
      const job = await artifactJob(run.id)
      if (job?.state !== "prepared" || typeof job.signature !== "string") throw new Error("Prepare a new replay plan before starting.")
      const started = await dispatch({ action: "start", slug: title.slug, number: String(title.number), plan: String(run.id) })
      return { id: String(started.run.id) }
    },
  }
}
