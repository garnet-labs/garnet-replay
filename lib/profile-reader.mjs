import { isRealRecordedStep } from "../renderer/review.mjs"

const CONTAINER = /^(?:containerd-shim(?:-runc-v\d+)?|containerd|runc|dockerd|docker-proxy|docker-init)$/
const HOST_SERVICE = /^(?:hosted-compute-agent|Runner\.Listener|systemd-(?:resolved|networkd)|NetworkManager|chronyd|chrony|waagent|walinuxagent|sshd)$/

function sources(profile) {
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Profile must be an object")
  if (Array.isArray(profile.profiles)) {
    if (profile.profiles.length === 0) throw new Error("Profile collection is empty")
    return profile.profiles.flatMap(sources)
  }
  if (profile.profiles !== undefined) return sources(profile.profiles)
  if (Array.isArray(profile.items)) {
    if (profile.items.length === 0) throw new Error("Profile collection is empty")
    return profile.items.flatMap(sources)
  }
  if (profile.profile !== undefined) return sources(profile.profile)
  if (profile.data !== undefined) return sources(profile.data)
  return [profile]
}

function commits(profile) {
  return [...new Set(sources(profile).map((source) => {
    const metadata = [source.run, source.scenarios?.github, source.github, source]
      .filter((value) => value !== null && typeof value === "object")
    const head = metadata.flatMap((value) => [value.head_sha, value.pull_request?.head?.sha, value.pull?.head?.sha, value.event?.pull_request?.head?.sha])
      .find((value) => typeof value === "string" && value !== "")
    return head ?? metadata.map((value) => value.commit_sha ?? value.sha)
      .find((value) => typeof value === "string" && value !== "") ?? "not recorded"
  }))]
}

function actionKey(row) {
  return JSON.stringify([row.repository, row.workflow, row.job, row.ancestry, row.destination, row.ports, row.protocol])
}

function workflowIdentity(metadata) {
  const path = metadata.workflow_path ?? metadata.workflow_ref
  if (typeof path !== "string") return metadata.workflow ?? ""
  const workflow = path.split("@")[0]
  if (workflow.startsWith(".github/workflows/") && typeof metadata.repository === "string" && metadata.repository !== "") return `${metadata.repository}/${workflow}`
  return workflow
}

function hasMissingPages(record) {
  if (record === null || typeof record !== "object") return false
  if (Array.isArray(record)) return record.some(hasMissingPages)
  for (const page of [record, record.pageInfo, record.page_info, record.pagination]) {
    if (page === null || typeof page !== "object") continue
    if (page.has_more === true || page.hasMore === true || page.hasNextPage === true || page.has_next_page === true) return true
    const next = page.next_cursor ?? page.nextCursor ?? page.next
    if (next !== undefined && next !== null && next !== "") return true
    if (page.has_previous === true || page.hasPrevious === true || page.hasPreviousPage === true || page.has_previous_page === true || page.has_prev === true || page.hasPrev === true) return true
    const previous = [page.previous_cursor, page.previousCursor, page.prev_cursor, page.prevCursor]
    if (previous.some((cursor) => cursor !== undefined && cursor !== null && cursor !== "")) return true
  }
  return [record.profiles, record.profile, record.items].some(hasMissingPages)
}

/** Declared capture limits prevent attribution additions, independently of the App result. */
export function captureAllowsComparison(record) {
  if (record === null || typeof record !== "object") return false
  if (hasMissingPages(record)) return false
  const capture = record.capture_quality ?? record.capture?.status ?? record.capture
  if (capture !== undefined && capture !== "complete") return false
  if (typeof record.incomplete === "number" && record.incomplete > 0) return false
  if (Array.isArray(record.profiles) && !record.profiles.every(captureAllowsComparison)) return false
  if (record.profiles !== undefined && !Array.isArray(record.profiles) && !captureAllowsComparison(record.profiles)) return false
  if (Array.isArray(record.items) && !record.items.every(captureAllowsComparison)) return false
  if (record.profile !== undefined && !captureAllowsComparison(record.profile)) return false
  if (record.data !== undefined && !captureAllowsComparison(record.data)) return false
  return true
}

function associations(profile) {
  if (Array.isArray(profile.associations)) return profile.associations
  if (Array.isArray(profile.egress)) return profile.egress.map((entry) => ({ ...entry, remote_names: [entry.name ?? entry.address], github_step: entry.step }))
  if (Array.isArray(profile.egress?.unique_domains)) return profile.egress.unique_domains.map((entry) => ({ ...entry, remote_names: [entry.domain] }))
  if (Array.isArray(profile.network?.egress?.peers)) {
    return profile.network.egress.peers.flatMap((peer) => {
      const trees = peer.proc_trees ?? peer.ProcTrees ?? []
      return (trees.length === 0 ? [{}] : trees).map((tree) => ({
        ...peer, ancestry: tree.ancestry ?? tree.Ancestry ?? [],
        remote_names: peer.remote_names ?? peer.RemoteNames ?? [],
        remote_address: peer.remote_address ?? peer.RemoteAddress,
        remote_ports: peer.remote_ports ?? peer.RemotePorts ?? [],
        github_step: tree.github_step ?? tree.GithubStep ?? peer.github_step,
      }))
    })
  }
  throw new Error("Profile carries no readable outbound associations")
}

/** Classify recorded ancestry, without inferring that a host-rooted action came from the job. */
export function attributionKind(ancestry, step = "") {
  if (ancestry.includes("Runner.Worker")) return "runner-linked"
  if (ancestry.some((name) => CONTAINER.test(name))) return "container-rooted"
  if (ancestry.includes("devin-remote")) return "session-linked"
  if (ancestry.some((name) => HOST_SERVICE.test(name))) return "runner-background"
  if (/^(?:systemd|init|tini|dumb-init)$/.test(ancestry[0] ?? "")) return ancestry.length > 1 ? "detached-root" : "runner-background"
  if (ancestry.length === 0) return "ancestry-unavailable"
  return isRealRecordedStep(step) ? "step-linked" : "runner-unlinked"
}

/** Read every outbound destination and acting ancestry from public, raw or summarized profiles. */
export function readProfileTrees(profile) {
  const rows = new Map()
  for (const source of sources(profile)) {
    const metadata = source.run ?? source.scenarios?.github ?? source.github ?? {}
    const workflow = workflowIdentity(metadata)
    const repository = metadata.repository ?? ""
    for (const entry of associations(source)) {
      const recordedAncestry = entry.ancestry ?? []
      if (!Array.isArray(recordedAncestry) || recordedAncestry.some((name) => typeof name !== "string")) throw new Error("Profile ancestry must contain process names")
      const ancestry = recordedAncestry.filter((name) => name !== "")
      const hasAncestry = ancestry.length > 0
      if (typeof entry.process === "string" && entry.process !== "" && ancestry.at(-1) !== entry.process) ancestry.push(entry.process)
      const names = entry.remote_names ?? []
      if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) throw new Error("Profile destinations must be strings")
      const destinations = names.filter((name) => name !== "")
      if (destinations.length === 0 && typeof entry.remote_address === "string" && entry.remote_address !== "") destinations.push(entry.remote_address)
      if (destinations.length === 0) throw new Error("Outbound association has no destination")
      const kind = attributionKind(hasAncestry && entry.lineage_recorded !== false ? ancestry : [], entry.github_step)
      const needsReview = ["container-rooted", "detached-root", "ancestry-unavailable", "runner-unlinked"].includes(kind)
      const remotePorts = entry.remote_ports ?? entry.ports ?? []
      if (!Array.isArray(remotePorts) || remotePorts.some((port) => typeof port !== "string" && typeof port !== "number")) throw new Error("Profile ports must be strings or numbers")
      const ports = [...new Set(remotePorts.map(String))].sort()
      for (const destination of destinations) {
        const row = { destination, ancestry, ports, protocol: entry.protocol ?? "", kind, needsReview, repository, workflow, job: metadata.job ?? "" }
        const key = actionKey(row)
        const previous = rows.get(key)
        if (previous?.needsReview !== true || row.needsReview) rows.set(key, row)
      }
    }
  }
  return [...rows.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/** Compare full execution chains, so an added detached actor to an existing destination is visible. */
export function compareProfileTrees(head, compared = null, { comparedSha = null, scope = "supplied-profiles", comparisonAllowed = true } = {}) {
  const rows = readProfileTrees(head)
  const captureComplete = comparisonAllowed && captureAllowsComparison(head) && (compared === null || captureAllowsComparison(compared))
  const before = compared === null || !captureComplete ? null : new Set(readProfileTrees(compared).map(actionKey))
  const comparisonReason = hasMissingPages(head) || hasMissingPages(compared)
    ? "Profile pages are missing; additions cannot be determined."
    : "Capture is not complete; additions cannot be determined."
  return {
    rows,
    review: rows.filter((row) => row.needsReview),
    added: before === null ? null : rows.filter((row) => row.needsReview && !before.has(actionKey(row))),
    comparison: before === null ? "unavailable" : "available",
    ...(captureComplete ? {} : { comparisonReason }),
    pair: { head: commits(head), compared: compared === null ? (comparedSha === null ? [] : [comparedSha]) : commits(compared), scope, transition: null },
  }
}

function code(value) {
  return `<code>${String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ")}</code>`
}

function captured(value) {
  return { value }
}

function capturedList(values) {
  return values.flatMap((value, index) => index === 0 ? [captured(value)] : [", ", captured(value)])
}

function profileLine(...parts) {
  return {
    text: parts.map((part) => typeof part === "string" ? part : code(part.value)).join(""),
    copy: parts.filter((part) => typeof part === "string").join(""),
  }
}

/** Keep generated copy separate from quoted values so card guards can check it. */
export function profileTreeLines(report, { reviewOnly = false } = {}) {
  const lines = [profileLine("**Attribution review**"), profileLine("")]
  if (report.error !== undefined) return [...lines, profileLine("Needs review: attribution could not be read. ", captured(report.error))]
  const compared = report.pair.compared.length === 0 ? ["not recorded"] : capturedList(report.pair.compared)
  const unavailable = report.comparisonReason === undefined ? " (profile unavailable)" : " (comparison unavailable)"
  lines.push(profileLine("Head: ", ...capturedList(report.pair.head), " · Compared: ", ...compared, report.comparison === "unavailable" ? unavailable : ""), profileLine(""))
  lines.push(profileLine("Scope: ", captured(report.pair.scope), " · version transition: not derivable from the record."), profileLine(""))
  if (report.comparisonReason !== undefined) lines.push(profileLine(report.comparisonReason), profileLine(""))
  if (report.review.length > 0) {
    lines.push(profileLine("**Needs review: not attributable to the runner.**"), profileLine(""))
    if (report.comparisonReason === undefined) lines.push(profileLine(report.added === null ? "Compared profile unavailable; additions cannot be determined." : `${report.added.length} added action${report.added.length === 1 ? "" : "s"} requiring attribution review relative to the compared profile.`))
    lines.push(profileLine("Host-rooted ancestry does not establish job origin."), profileLine(""))
  }
  const rows = reviewOnly ? report.review : report.rows
  for (const row of rows) {
    const added = report.added?.some((entry) => JSON.stringify(entry) === JSON.stringify(row)) === true ? " · added" : ""
    const ancestry = row.ancestry.length === 0 ? "<code>ancestry not recorded</code>" : captured(row.ancestry.join(" › "))
    const ports = row.ports.length === 0 ? [] : [" (ports ", captured(row.ports.join(", ")), ")"]
    const protocol = row.protocol === "" ? [] : [" · ", captured(row.protocol)]
    const job = row.job === "" ? [] : [" · job ", captured(row.job)]
    const workflow = row.workflow === "" ? [] : [" · workflow ", captured(row.workflow)]
    lines.push(profileLine("- ", ancestry, " → ", captured(row.destination), ...ports, ...protocol, " · ", row.kind, added, ...job, ...workflow))
  }
  if (rows.length === 0) lines.push(profileLine("No outbound actions requiring attribution review in the supplied record."))
  return lines
}

/** Render captured actions separately from any App comparison result. */
export function renderProfileTrees(report, options = {}) {
  return profileTreeLines(report, options).map((line) => line.text).join("\n")
}
