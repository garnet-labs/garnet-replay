import assert from "node:assert/strict"
import { test } from "node:test"
import { verifyRecordValueExhibit } from "../benchmark/record-value/verify.mjs"
import { recordValueShareStatus } from "../lib/record-value.mjs"

test("authenticated verification marks a throttled leg incomplete even when the gate returns FAIL", async () => {
  const row = { url: "https://github.com/garnet-labs/example/pull/1", appUrl: "record" }
  const verify = url => verifyRecordValueExhibit(url, {
    token: "test-token",
    verify: async (target, { token, fetchImpl }) => {
      assert.equal(target, row.url)
      assert.equal(token, "test-token")
      await fetchImpl("https://api.github.com/repos/garnet-labs/example/pulls/1")
      return { status: "FAIL" }
    },
    fetchImpl: async () => new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
  })
  assert.deepEqual(await recordValueShareStatus(row, verify), {
    reason: "Replay share gate incomplete: GitHub rate limit", evidence: "record", rateLimited: true,
  })
})

test("optional attribution throttling retains the passing gate and records attribution as unavailable", async () => {
  const row = { url: "https://github.com/garnet-labs/example/pull/1", headSha: "a".repeat(40), fingerprint: "b".repeat(64) }
  const verify = url => verifyRecordValueExhibit(url, {
    verify: async (_url, { onGateComplete, exec }) => {
      onGateComplete()
      assert.throws(() => exec("gh", ["api", "commits/base"]), /rate limit/)
      return { status: "PASS", head: row.headSha, receipt_fingerprint: row.fingerprint }
    },
    exec: () => { throw new Error("HTTP 403: API rate limit exceeded") },
  })
  assert.deepEqual(await recordValueShareStatus(row, verify), { verification: {
    status: "PASS", url: row.url, headSha: row.headSha, fingerprint: row.fingerprint,
    attribution: { status: "unavailable", reason: "GitHub rate limit" },
  } })
})
