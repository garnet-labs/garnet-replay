import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ghAsync, run } from "../../lib/gh.mjs"
import { parsePrUrl } from "../../lib/receipt.mjs"
import { recordValueFileDiff, recordValueHasVerification, recordValueReceipt, recordValueRetrySnapshot, recordValueShareStatus, recordValueSource } from "../../lib/record-value.mjs"
import { replayGithubToken } from "../../lib/replay-request.mjs"
import { verifyRecordValueExhibit } from "./verify.mjs"

const output = "out/record-value"
const cutoff = new Date().toISOString()
const retryDiff = process.argv[2] === "--retry-diff" ? process.argv[3] : null
const env = { ...process.env, GH_TOKEN: process.env.GARNET_LABS_GITHUB_PAT ?? process.env.GH_TOKEN }
const gh = (args, options = {}) => ghAsync(args, { env, maxBuffer: 24 * 1024 * 1024, ...options })
const api = async (...args) => JSON.parse(await gh(["api", ...args]))
const exec = (command, args, options) => run(command, args, { ...options, env })
const token = env.GH_TOKEN ?? replayGithubToken(exec)
if (typeof token !== "string" || token === "") throw new Error("GitHub authentication is required for replay verification")
const verify = url => verifyRecordValueExhibit(url, { exec, token })

async function search(window) {
  const pages = await api("--paginate", "--slurp", "-X", "GET", "search/issues",
    "-f", `q=org:garnet-labs is:pr commenter:app/garnet-runtime-review ${window}`, "-f", "per_page=100")
  const rows = pages.flatMap(page => page.items)
  if (pages.some(page => page.incomplete_results) || rows.length !== pages[0].total_count) {
    throw new Error(`GitHub search incomplete for ${window}`)
  }
  return rows.filter(pr => pr.created_at <= cutoff).map(pr => pr.html_url)
}

const ledgerPaths = (await readdir("targets")).filter(name => name.endsWith(".json"))
const ledgers = await Promise.all(ledgerPaths.map(async name => JSON.parse(await readFile(join("targets", name), "utf8"))))
const indexed = retryDiff ? [] : await Promise.all([search("created:<2026-11-01"), search("created:>=2026-11-01")])
const ledgerUrls = ledgers.flatMap(ledger => (ledger.replays ?? []).filter(r => Number.isInteger(r.forkPr) && r.forkPr > 0)
  .map(r => `https://github.com/${ledger.fork}/pull/${r.forkPr}`))
const named = [276, 277, 278, 280, 282].map(n => `https://github.com/garnet-labs/posthog/pull/${n}`)
const urls = [...new Set([...named, ...indexed.flat(), ...ledgerUrls].filter(url => url.startsWith("https://github.com/garnet-labs/")))]
  .sort((a, b) => a.localeCompare(b, "en"))
const preferred = new Set(named)
const qualified = []
const included = []
const incomplete = []
let ineligible = 0
let scanned = 0

function isRateLimited(error) {
  return /rate limit|HTTP 429/i.test(String(error.stderr ?? error.message))
}

async function collect(url) {
  let metadata = {}
  try {
    const { owner, repo, number } = parsePrUrl(url)
    const root = `repos/${owner}/${repo}`
    const first = await api(`${root}/pulls/${number}`)
    metadata = { ...recordValueSource(first), createdAt: first.created_at, headSha: first.head.sha }
    if (first.base.repo.private !== false) {
      incomplete.push({ url, ...metadata, reason: "Non-public PR excluded from model evaluation", evidence: url })
      return
    }
    const comments = (await api("--paginate", "--slurp", `${root}/issues/${number}/comments?per_page=100`)).flat()
    const receipt = recordValueReceipt(first, comments)
    if (receipt.status === "not eligible") {
      ineligible += 1
      return
    }
    if (receipt.status === "incomplete") {
      incomplete.push({ url, ...metadata, reason: receipt.reason, evidence: receipt.evidence })
      return
    }
    let diff
    let diffSource = "gh pr diff"
    try {
      if (retryDiff) throw new Error("Retry via GitHub file patches")
      diff = await gh(["pr", "diff", String(number), "-R", `${owner}/${repo}`, "--color", "never"], { timeout: 25_000 })
    } catch {
      diffSource = "GitHub per-file patches"
      try {
        const files = (await api("--paginate", "--slurp", `${root}/pulls/${number}/files?per_page=100`)).flat()
        diff = recordValueFileDiff(files, first.changed_files)
      } catch (error) {
        const rateLimited = isRateLimited(error)
        incomplete.push({ url, ...metadata, reason: rateLimited ? "GitHub rate limit prevented collection" : "Neither full PR diff nor complete per-file patches were readable",
          evidence: receipt.appUrl, rateLimited })
        return
      }
    }
    const last = await api(`${root}/pulls/${number}`)
    const finalComments = (await api("--paginate", "--slurp", `${root}/issues/${number}/comments?per_page=100`)).flat()
    const final = recordValueReceipt(last, finalComments)
    if (diff === "" || first.head.sha !== last.head.sha || first.base.sha !== last.base.sha ||
      final.status !== "eligible" || final.fingerprint !== receipt.fingerprint) {
      incomplete.push({ url, ...metadata, reason: "Diff unavailable or PR/evidence changed during collection", evidence: receipt.appUrl })
      return
    }
    qualified.push({ url, ...metadata, ...receipt, baseSha: first.base.sha, title: last.title, body: last.body ?? "", diff, diffSource })
  } catch (error) {
    const code = /HTTP (\d+)/.exec(error.stderr ?? "")?.[1]
    const rateLimited = isRateLimited(error)
    const reason = rateLimited ? "GitHub rate limit prevented collection" : code === undefined ? "Could not fetch or parse requested GitHub evidence" : `GitHub HTTP ${code}`
    incomplete.push({ url, ...metadata, reason, evidence: url, rateLimited })
  }
}

const prior = retryDiff ? JSON.parse(await readFile(join(output, "rows.json"), "utf8")) : null
if (retryDiff && !prior.incomplete.some(row => row.url === retryDiff)) {
  throw new Error("Retry URL must be in the snapshot's incomplete list")
}
if (prior !== null && !prior.included.every(recordValueHasVerification)) {
  throw new Error("Snapshot contains a row without matching passing replay verification; rerun full collection")
}
const queue = retryDiff ? [retryDiff] : [...urls.filter(url => preferred.has(url)), ...urls.filter(url => !preferred.has(url))]
await Promise.all(Array.from({ length: 10 }, async () => {
  while (queue.length > 0) {
    await collect(queue.shift())
    scanned += 1
    if (scanned % 100 === 0) console.log(`inspected ${scanned}/${urls.length} PRs; ${qualified.length} qualifying receipts`)
  }
}))
let verified = 0
await Promise.all(Array.from({ length: 2 }, async () => {
  while (qualified.length > 0) {
    const row = qualified.shift()
    const checked = await recordValueShareStatus(row, verify)
    if (checked.verification !== undefined) included.push({ ...row, ...checked })
    else {
      const { url, source, group, createdAt, headSha } = row
      incomplete.push({ url, source, group, createdAt, headSha, ...checked })
    }
    verified += 1
    if (verified % 10 === 0) console.log(`verified ${verified} qualifying receipts; ${included.length} shareable`)
  }
}))
const ordered = rows => rows.sort((a, b) => a.url.localeCompare(b.url, "en"))
await mkdir(output, { recursive: true })
const snapshot = prior === null ? {
  cutoff, candidates: urls.length, indexed: new Set(indexed.flat()).size, ledger: new Set(ledgerUrls).size,
  ineligible, included: ordered(included), incomplete: ordered(incomplete),
} : recordValueRetrySnapshot(prior, retryDiff, { included, incomplete, ineligible })
if (snapshot === prior) console.log("Retry rate-limited; left snapshot unchanged")
else {
  await writeFile(join(output, "rows.json"), JSON.stringify(snapshot, null, 2) + "\n")
  console.log(`wrote ${output}/rows.json: ${snapshot.included.length} eligible, ${snapshot.incomplete.length} incomplete, ${snapshot.ineligible} not eligible`)
}
