import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { renderResultPage, kindGroups } from "../renderer/result-page.mjs"
import { buildExecutionDiff } from "../lib/execution-diff.mjs"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const corpus = JSON.parse(readFileSync(join(ROOT, "test/fixtures/posthog-corpus.json"), "utf8"))
const BANNED = /\b(verified|flagged|pass(ed)?|warn(ing)?|fail(ed)?|threat|detected|caught|process chain)\b/i

function diffFor(number) {
  const pr = corpus.prs.find((p) => p.pr_number === number)
  return buildExecutionDiff(pr)
}

test("every rendered count equals the list rendered beside it (all 50 corpus PRs)", () => {
  for (const pr of corpus.prs) {
    const diff = buildExecutionDiff(pr)
    const html = renderResultPage(diff, { jsonHref: "/x.json" })
    for (const [section, added, removed] of kindGroups(diff, "network").map((g) => [g.section, g.added.length, g.removed.length])) {
      if (section === "runner background" && added + removed > 0) {
        const m = html.match(/<summary>runner background · \+(\d+) −(\d+)/)
        assert.ok(m, `PR ${pr.pr_number}: missing background summary`)
        assert.equal(Number(m[1]), added)
        assert.equal(Number(m[2]), removed)
        const inDetails = html.slice(html.indexOf("<details>"), html.indexOf("</details>"))
        assert.equal((inDetails.match(/<li>/g) ?? []).length, added + removed)
      }
    }
    const ours = html.replace(/<title>.*<\/title>/, "").replace(/<h1>.*?<span/s, "<h1><span")
    assert.ok(!BANNED.test(ours), `PR ${pr.pr_number}: banned vocabulary in page copy`)
  }
})

test("PR 139 page: delta-first summary, three controls, receipt link, scope", () => {
  const html = renderResultPage(diffFor(139), { jsonHref: "/replays/github/garnet-labs/posthog/139.json" })
  assert.match(html, /Nothing your workflow ran changed between c105d2b and 5aba3c4/)
  assert.match(html, /Full evidence/)
  assert.match(html, /href="\/replays\/github\/garnet-labs\/posthog\/139.json"/)
  assert.match(html, /data-share=/)
  assert.match(html, /https:\/\/app.garnet.ai\/public\/runs\/32552243818\?profile=01a027c8-0525-7033-a2a3-8103c6ab91ba/)
  assert.match(html, /previous recorded head → this head/)
  assert.match(html, /real pull request/)
})

test("constructed label is shown and hostile strings are escaped", () => {
  const diff = diffFor(139)
  diff.label = "constructed"
  diff.pull_request.title = "<script>alert(1)</script>"
  diff.receipt_urls.head = "javascript:alert(1)"
  const html = renderResultPage(diff, { jsonHref: "/x.json" })
  assert.match(html, /constructed test case/)
  assert.ok(!html.includes("<script>alert"))
  assert.ok(!html.includes('href="javascript:'))
})
