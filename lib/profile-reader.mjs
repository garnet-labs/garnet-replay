import { isRealRecordedStep } from "../renderer/review.mjs"

const CONTAINER = /^(?:containerd-shim(?:-runc-v\d+)?|containerd|runc|dockerd|docker-proxy|docker-init)$/
const HOST_SERVICE = /^(?:hosted-compute-agent|Runner\.Listener|systemd-(?:resolved|networkd)|NetworkManager|chronyd|chrony|waagent|walinuxagent|sshd)$/

function sources(profile) {
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Profile must be an object")
  if (Array.isArray(profile.profiles)) {
    if (profile.profiles.length === 0) throw new Error("Profile collection is empty")
    return profile.profiles.flatMap(sources)
  }
  if (profile.profile !== undefined) return sources(profile.profile)
  return [profile]
}

function commits(profile) {
  return [...new Set(sources(profile).map((source) => source.run?.head_sha ?? source.run?.commit_sha ?? source.scenarios?.github?.sha ?? source.github?.sha ?? "not recorded"))]
}

function actionKey(row) {
  return JSON.stringify([row.job, row.ancestry, row.destination, row.ports, row.protocol])
}

/** Declared capture limits prevent attribution additions, independently of the App result. */
export function captureAllowsComparison(record) {
  if (record === null || typeof record !== "object") return false
  const capture = record.capture_quality ?? record.capture?.status ?? record.capture
  if (capture !== undefined && capture !== "complete") return false
  if (typeof record.incomplete === "number" && record.incomplete > 0) return false
  if (Array.isArray(record.profiles) && !record.profiles.every(captureAllowsComparison)) return false
  if (record.profile !== undefined && !captureAllowsComparison(record.profile)) return false
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
  if (ancestry.some((name) => HOST_SERVICE.test(name))) return "runner-background"
  if (/^(?:systemd|init|tini|dumb-init)$/.test(ancestry[0] ?? "")) return ancestry.length > 1 ? "detached-root" : "runner-background"
  if (ancestry.length === 0) return "ancestry-unavailable"
  return isRealRecordedStep(step) ? "step-linked" : "runner-unlinked"
}

/** Read every outbound destination and acting ancestry from public, raw or summarized profiles. */
export function readProfileTrees(profile) {
  const rows = new Map()
  for (const source of sources(profile)) {
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
        const row = { destination, ancestry, ports, protocol: entry.protocol ?? "", kind, needsReview, job: source.run?.job ?? source.scenarios?.github?.job ?? source.github?.job ?? "" }
        rows.set(actionKey(row), row)
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
  return {
    rows,
    review: rows.filter((row) => row.needsReview),
    added: before === null ? null : rows.filter((row) => row.needsReview && !before.has(actionKey(row))),
    comparison: before === null ? "unavailable" : "available",
    ...(captureComplete ? {} : { comparisonReason: "Capture is not complete; additions cannot be determined." }),
    pair: { head: commits(head), compared: compared === null ? (comparedSha === null ? [] : [comparedSha]) : commits(compared), scope, transition: null },
  }
}

function code(value) {
  return `<code>${String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ")}</code>`
}

/** Render captured actions separately from any App comparison result. */
export function renderProfileTrees(report, { reviewOnly = false } = {}) {
  const lines = ["**Attribution review**", ""]
  if (report.error !== undefined) return [...lines, `Needs review: attribution could not be read. ${code(report.error)}`].join("\n")
  const compared = report.pair.compared.length === 0 ? "not recorded" : report.pair.compared.map(code).join(", ")
  const unavailable = report.comparisonReason === undefined ? " (profile unavailable)" : " (comparison unavailable)"
  lines.push(`Head: ${report.pair.head.map(code).join(", ")} · Compared: ${compared}${report.comparison === "unavailable" ? unavailable : ""}`, "")
  lines.push(`Scope: ${code(report.pair.scope)} · version transition: not derivable from the record.`, "")
  if (report.comparisonReason !== undefined) lines.push(report.comparisonReason, "")
  if (report.review.length > 0) {
    lines.push("**Needs review: not attributable to the runner.**", "")
    if (report.comparisonReason === undefined) lines.push(report.added === null ? "Compared profile unavailable; additions cannot be determined." : `${report.added.length} added action${report.added.length === 1 ? "" : "s"} requiring attribution review relative to the compared profile.`)
    lines.push("Host-rooted ancestry does not establish job origin.", "")
  }
  const rows = reviewOnly ? report.review : report.rows
  for (const row of rows) {
    const added = report.added?.some((entry) => JSON.stringify(entry) === JSON.stringify(row)) === true ? " · added" : ""
    const ports = row.ports.length === 0 ? "" : ` (ports ${code(row.ports.join(", "))})`
    const job = row.job === "" ? "" : ` · job ${code(row.job)}`
    lines.push(`- ${code(row.ancestry.join(" › ") || "ancestry not recorded")} → ${code(row.destination)}${ports} · ${row.kind}${added}${job}`)
  }
  if (rows.length === 0) lines.push("No outbound actions requiring attribution review in the supplied record.")
  return lines.join("\n")
}
