import { reviewerKit } from "../../lib/ground.mjs"

export function kitResponse(args) {
  const path = args[1] ?? ""
  if (/^repos\/garnet-labs\/[^/]+$/.test(path)) return JSON.stringify({ default_branch: "main" })
  if (path.includes("/git/trees/") && !path.includes(":.github/workflows")) {
    return JSON.stringify({ sha: "grounded-tree", tree: Object.keys(reviewerKit()).map((path, index) => ({ path, type: "blob", sha: String(index) })) })
  }
  if (path.includes("/git/blobs/")) {
    return JSON.stringify({ encoding: "base64", content: Buffer.from(Object.values(reviewerKit())[Number(path.split("/").at(-1))]).toString("base64") })
  }
  return null
}
