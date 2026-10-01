#!/usr/bin/env node
// Build benchmark/ci-contacts/tasks.json from the seeded replay records.
// Reviewer inputs: PostHog PRs from test/fixtures/posthog-corpus.json (replay scaffolding
// removed, description omitted because it is the replay's own text); the others from
// benchmark/ci-contacts/sources/<id>.{title,body,diff} (git show of the PR's change commit).
import { readFile, writeFile } from "node:fs/promises"

import { buildTask, diffFromFiles } from "../../lib/ci-contacts.mjs"

const seeds = JSON.parse(await readFile("seeds/seeds.json", "utf8"))
const corpus = JSON.parse(await readFile("test/fixtures/posthog-corpus.json", "utf8"))
const byNumber = new Map(corpus.prs.map((p) => [p.pr_number, p]))

const tasks = []
for (const seed of seeds) {
  const replay = JSON.parse(await readFile(seed.replay_json.replace(/^\/?replays\//, "public/replays/"), "utf8"))
  let title
  let body
  let diff
  let sourceNote
  const posthog = /^real-(\d+)$/.exec(seed.id)
  if (posthog !== null) {
    const pr = byNumber.get(Number(posthog[1]))
    title = pr.title
    body = ""
    diff = diffFromFiles(pr.files)
    sourceNote = `real dependency PR replayed on a PostHog fork (${pr.url}); description omitted`
  } else {
    const base = `benchmark/ci-contacts/sources/${seed.id}`
    title = (await readFile(`${base}.title`, "utf8")).trim()
    body = await readFile(`${base}.body`, "utf8")
    diff = (await readFile(`${base}.diff`, "utf8")).trimEnd()
    sourceNote = seed.label === "constructed"
      ? "constructed specimen; the compared base is a clean constructed install, not the PR's own parent"
      : "real PR in a demo repository; the dependency is an authored demo beacon"
  }
  tasks.push(buildTask({ id: seed.id, label: seed.label, title, body, diff, replay, source_note: sourceNote }))
}
await writeFile("benchmark/ci-contacts/tasks.json", `${JSON.stringify(tasks, null, 2)}\n`)
const count = (f) => tasks.filter(f).length
console.log(`wrote benchmark/ci-contacts/tasks.json: ${tasks.length} tasks; ` +
  `hidden-from-diff ${count((t) => t.key.hidden_from_diff.length > 0)}, ` +
  `visible ${count((t) => t.key.expected_verdict === "new-behavior" && t.key.hidden_from_diff.length === 0)}, ` +
  `unsupported-clean ${count((t) => t.key.expected_verdict === "cannot-tell")}, ` +
  `verified-clean ${count((t) => t.key.expected_verdict === "no-new-behavior")}`)
