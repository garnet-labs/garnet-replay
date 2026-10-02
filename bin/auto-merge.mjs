import { fileURLToPath } from "node:url"
import { mergeDecision } from "../lib/auto-merge.mjs"
import { checkRuns, commitStatuses, mergePr, pullsForCommit, unresolvedReviewThreadCount, viewPr } from "../lib/gh.mjs"

const USAGE = "usage: node bin/auto-merge.mjs --repo OWNER/REPO (--pr N | --sha SHA) [--dry-run]"

/**
 * @param {string[]} [argv]
 * @param {{
 *   exec?:(command:string,args:string[],options?:object)=>string,
 *   stdout?:{write:(value:string)=>unknown},
 *   stderr?:{write:(value:string)=>unknown}
 * }} [dependencies]
 * @returns {number}
 */
export function main(argv = process.argv.slice(2), { exec, stdout = process.stdout, stderr = process.stderr } = {}) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${USAGE}\n`)
    return 0
  }

  let pulls
  if (options.pr !== null) {
    pulls = [{ number: options.pr }]
  } else {
    try {
      pulls = pullsForCommit(options.repo, options.sha, { exec })
    } catch (error) {
      stderr.write(`${errorMessage(error)}\n`)
      return 0
    }
  }

  let mergeFailed = false
  for (const pull of pulls) {
    const number = pull?.number
    if (!Number.isSafeInteger(number) || number < 1) continue
    try {
      const pr = viewPr(options.repo, number, { exec })
      if (typeof pr?.headRefOid !== "string" || pr.headRefOid === "") {
        throw new Error(`pull request #${number} has no head commit SHA`)
      }
      const checks = checkRuns(options.repo, pr.headRefOid, { exec })
      const statuses = commitStatuses(options.repo, pr.headRefOid, { exec })
      const unresolvedThreads = unresolvedReviewThreadCount(options.repo, number, { exec })
      if (!Array.isArray(checks) || !Array.isArray(statuses) || !Number.isSafeInteger(unresolvedThreads)) {
        throw new Error(`could not read checks, statuses, or review threads for pull request #${number}`)
      }
      const decision = mergeDecision({ pr, checkRuns: checks, statuses, unresolvedThreads })
      stdout.write(`#${number} ${decision.action}: ${decision.reason}\n`)
      if (decision.action === "merge" && !options.dryRun) {
        try {
          mergePr(options.repo, number, pr.headRefOid, { exec })
        } catch (error) {
          mergeFailed = true
          stderr.write(`${errorMessage(error)}\n`)
        }
      }
    } catch (error) {
      const message = errorMessage(error)
      stderr.write(`${message}\n`)
      stdout.write(`#${number} wait: could not evaluate pull request: ${singleLine(message)}\n`)
    }
  }
  return mergeFailed ? 1 : 0
}

function parseArgs(argv) {
  let repo = null
  let pr = null
  let sha = null
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--dry-run") {
      dryRun = true
      continue
    }
    if (argument !== "--repo" && argument !== "--pr" && argument !== "--sha") {
      throw new Error(`unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (typeof value !== "string" || value === "" || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`)
    }
    index += 1
    if (argument === "--repo") repo = value
    else if (argument === "--pr") {
      const number = Number(value)
      if (!Number.isSafeInteger(number) || number < 1) throw new Error("--pr must be a positive integer")
      pr = number
    } else sha = value
  }
  if (typeof repo !== "string" || repo === "") throw new Error("--repo is required")
  if ((pr === null) === (sha === null)) throw new Error("provide exactly one of --pr or --sha")
  return { repo, pr, sha, dryRun }
}

function errorMessage(error) {
  const stderrText = error?.stderr
  if (typeof stderrText === "string" && stderrText.trim() !== "") return stderrText.trim()
  if (stderrText instanceof Uint8Array && stderrText.byteLength > 0) return new TextDecoder().decode(stderrText).trim()
  return error instanceof Error ? error.message : String(error)
}

function singleLine(value) {
  return value.replace(/\s+/gu, " ").trim()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = main()
  if (exitCode !== 0) process.exitCode = exitCode
}
