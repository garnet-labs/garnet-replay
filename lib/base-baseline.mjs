import { matchGlob } from "./paths.mjs"

function mapping(lines, start, end, indent) {
  const entries = new Map()
  let previous = null
  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const depth = line.search(/\S/)
    if (depth > indent) continue
    const match = /^(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'):\s*(.*)$/.exec(line.slice(indent))
    if (depth !== indent || match === null || line.slice(0, depth).includes("\t")) throw new Error("unsupported event mapping")
    const key = match[1] ?? match[2] ?? match[3]
    if (entries.has(key)) throw new Error(`duplicate ${key} key`)
    if (previous !== null) previous.end = index
    previous = { start: index, end, value: match[4].replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim() }
    entries.set(key, previous)
  }
  return entries
}

function childIndent(lines, entry, fallback) {
  const first = lines.slice(entry.start + 1, entry.end).find((line) => line.trim() !== "" && !line.trim().startsWith("#"))
  return first === undefined ? fallback : first.search(/\S/)
}

function branchValue(value) {
  const literal = value.replace(/\s+#.*$/, "").trim()
  const match = /^(?:'([A-Za-z0-9_./*!?@{}+-]+)'|"([A-Za-z0-9_./*!?@{}+-]+)"|([A-Za-z0-9_./@+-][A-Za-z0-9_./*!?@{}+-]*))$/.exec(literal)
  if (match === null) throw new Error("unsupported branch literal")
  return match[1] ?? match[2] ?? match[3]
}

function listValues(lines, entry) {
  if (entry.value.startsWith("[") && entry.value.endsWith("]")) {
    const items = entry.value.slice(1, -1).trim()
    return items === "" ? [] : items.split(",").map(branchValue)
  }
  if (entry.value !== "") throw new Error("unsupported filter list")
  const items = lines.slice(entry.start + 1, entry.end).filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
  const indent = items[0]?.search(/\S/)
  return items.map((line) => {
    if (line.search(/\S/) !== indent) throw new Error("unsupported filter indentation")
    if (!/^\s*-\s+/.test(line)) throw new Error("unsupported filter block list")
    return branchValue(line.replace(/^\s*-\s+/, ""))
  })
}

/** Add a final branch inclusion without removing existing push exclusions or path filters. */
export function addPushBranch(body, branch) {
  if (typeof body !== "string" || typeof branch !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock")) {
    throw new Error("baseline push needs workflow contents and a plain branch name")
  }
  try {
    const newline = body.includes("\r\n") ? "\r\n" : "\n"
    const lines = body.split(/\r?\n/)
    const top = mapping(lines, 0, lines.length, 0)
    const on = top.get("on")
    if (on === undefined) throw new Error("no on trigger mapping")
    if (on.value !== "") {
      const values = on.value.startsWith("[") && on.value.endsWith("]") ? on.value.slice(1, -1).split(",").map((value) => value.trim()) : [on.value]
      if (!values.every((value) => /^[a-z_]+$/.test(value))) throw new Error("expand the on event mapping")
      if (values.every((value) => value === "workflow_call")) return body
      if (values.includes("push")) return body
      lines.splice(on.start, 1, "on:", ...values.map((value) => `  ${value}:`), "  push:", `    branches: [${JSON.stringify(branch)}]`)
      return lines.join(newline)
    }
    const indent = childIndent(lines, on, 2)
    if (indent <= 0) throw new Error("unsupported on indentation")
    const events = mapping(lines, on.start + 1, on.end, indent)
    if (events.size === 1 && events.has("workflow_call")) return body
    const push = events.get("push")
    if (push === undefined) {
      lines.splice(on.end, 0, `${" ".repeat(indent)}push:`, `${" ".repeat(indent + 2)}branches: [${JSON.stringify(branch)}]`)
      return lines.join(newline)
    }
    if (["{}", "null", "~"].includes(push.value)) return body
    if (push.value !== "") throw new Error("expand the push event mapping")
    const propertiesIndent = childIndent(lines, push, indent + 2)
    if (propertiesIndent <= indent) throw new Error("unsupported push indentation")
    const properties = mapping(lines, push.start + 1, push.end, propertiesIndent)
    if (!properties.has("branches") && [...properties.keys()].every((key) => ["paths", "paths-ignore"].includes(key))) return body
    if ([...properties.keys()].some((key) => !["branches", "branches-ignore", "paths", "paths-ignore", "tags", "tags-ignore"].includes(key))) throw new Error("unsupported push filter")
    const branches = properties.get("branches")
    if (branches === undefined) return body
    if (branches.value.startsWith("[") && branches.value.endsWith("]")) {
      const items = branches.value.slice(1, -1).trim()
      const values = items === "" ? [] : items.split(",").map(branchValue)
      if (values.at(-1) === branch) return body
      const comment = /\s+#.*$/.exec(lines[branches.start])?.[0] ?? ""
      lines[branches.start] = `${" ".repeat(propertiesIndent)}branches: ${JSON.stringify([...values, branch])}${comment}`
    } else if (branches.value === "") {
      const items = lines.slice(branches.start + 1, branches.end).filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
      const values = items.map((line) => {
        if (!/^\s*-\s+/.test(line)) throw new Error("unsupported branches block list")
        return branchValue(line.replace(/^\s*-\s+/, ""))
      })
      if (values.at(-1) === branch) return body
      const listIndent = items.length === 0 ? propertiesIndent + 2 : items[0].search(/\S/)
      if (listIndent < propertiesIndent || items.some((line) => line.search(/\S/) !== listIndent)) throw new Error("unsupported branches indentation")
      lines.splice(branches.end, 0, `${" ".repeat(listIndent)}- ${JSON.stringify(branch)}`)
    } else throw new Error("expand the branches list")
    return lines.join(newline)
  } catch (error) {
    throw new Error(`cannot prepare baseline push for ${branch}: ${error.message}`)
  }
}

function filterMatches(value, patterns) {
  let matched = false
  for (const raw of patterns) {
    if (!/^!?[A-Za-z0-9_./*@-]+$/.test(raw)) throw new Error("unsupported filter glob")
    const negative = raw.startsWith("!")
    if (matchGlob(value, negative ? raw.slice(1) : raw)) matched = !negative
  }
  return matched
}

/** Whether a rewritten entry workflow provably accepts this branch and carry-commit paths. */
export function baselinePushExpected(body, branch, changedPaths) {
  try {
    const lines = body.split(/\r?\n/)
    const on = mapping(lines, 0, lines.length, 0).get("on")
    if (on === undefined) return false
    if (on.value !== "") {
      const values = on.value.startsWith("[") && on.value.endsWith("]") ? on.value.slice(1, -1).split(",").map((value) => value.trim()) : [on.value]
      return values.every((value) => /^[a-z_]+$/.test(value)) && values.includes("push")
    }
    const indent = childIndent(lines, on, 2)
    const push = mapping(lines, on.start + 1, on.end, indent).get("push")
    if (push === undefined) return false
    if (["{}", "null", "~"].includes(push.value)) return true
    if (push.value !== "") return false
    const properties = mapping(lines, push.start + 1, push.end, childIndent(lines, push, indent + 2))
    if ([...properties.keys()].some((key) => !["branches", "branches-ignore", "paths", "paths-ignore", "tags", "tags-ignore"].includes(key))) return false
    if (properties.has("branches") && properties.has("branches-ignore")) return false
    if (properties.has("paths") && properties.has("paths-ignore")) return false
    if (!properties.has("branches") && !properties.has("branches-ignore") && (properties.has("tags") || properties.has("tags-ignore"))) return false
    if (properties.has("branches") && !filterMatches(branch, listValues(lines, properties.get("branches")))) return false
    if (properties.has("branches-ignore")) {
      const ignored = listValues(lines, properties.get("branches-ignore"))
      if (ignored.some((pattern) => pattern.startsWith("!")) || filterMatches(branch, ignored)) return false
    }
    if (properties.has("paths")) return changedPaths.some((path) => filterMatches(path, listValues(lines, properties.get("paths"))))
    if (properties.has("paths-ignore")) {
      const ignored = listValues(lines, properties.get("paths-ignore"))
      if (ignored.some((path) => path.startsWith("!"))) return false
      return changedPaths.some((path) => !filterMatches(path, ignored))
    }
    return true
  } catch {
    return false
  }
}

/** A base upgrade must retain source ancestry and change only declared carry paths. */
export function canUpgradeBase({ containsBase, remotePaths, newPaths, allowedPaths }) {
  return containsBase === true && newPaths.length > 0
    && [...remotePaths, ...newPaths].every((path) => allowedPaths.includes(path))
}

/** Only successful exact-tip push runs of every selected recorder establish readiness. */
export function baseRecordState({ runs, workflows, branch, sha }) {
  if (workflows.length === 0) throw new Error("baseline needs a recording workflow")
  const pending = []
  for (const workflow of workflows) {
    const run = runs.filter((row) => row.event === "push" && row.head_branch === branch && row.head_sha === sha && row.path === workflow)
      .sort((left, right) => right.id - left.id)[0]
    if (run === undefined) pending.push(`${workflow}: no push run at ${sha.slice(0, 7)} yet`)
    else if (run.status !== "completed") pending.push(`${workflow}: ${run.status}`)
    else if (run.conclusion !== "success") return { state: "failed", detail: `${workflow} push run ${run.id} concluded ${run.conclusion}` }
    else if (!Array.isArray(run.jobs)) pending.push(`${workflow}: recording jobs unreadable`)
    else {
      const recording = run.jobs.filter((job) => (job.steps ?? []).some((step) => /garnet/i.test(step.name ?? "")))
      if (recording.length === 0 || recording.some((job) => job.status !== "completed" || job.conclusion !== "success" ||
        job.steps.some((step) => /garnet/i.test(step.name ?? "") && (step.status !== "completed" || step.conclusion !== "success")))) {
        return { state: "failed", detail: `${workflow} push run ${run.id} has no successful recording job or skipped/unsuccessful Garnet steps` }
      }
    }
  }
  return pending.length === 0 ? { state: "recorded", detail: `baseline push recorded at ${sha.slice(0, 7)}` } : { state: "pending", detail: pending.join("; ") }
}
