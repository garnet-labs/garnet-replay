import assert from "node:assert/strict"
import { test } from "node:test"
import { scoreRecordValueRow } from "../benchmark/record-value/score.mjs"

const row = { title: "Update download", body: "", diff: "+download", headSha: "a".repeat(40),
  comparedSha: "b".repeat(40), scope: "pr-base", capture: "complete",
  changes: [{ job: "Install", step: null, destination: "example[.]com", chain: "curl" }] }
const identity = { url: "https://github.com/garnet-labs/example/pull/1", headSha: row.headSha }
const options = { judgeModel: "test-model", key: "test-key" }

test("a scorer failure produces an incomplete row without calling the judge", async () => {
  const requests = []
  const result = await scoreRecordValueRow(row, identity, { ...options, fetchImpl: async (url, request) => {
    requests.push(url)
    assert.equal(request.method, "POST")
    return new Response(null, { status: 503 })
  } })
  assert.deepEqual(requests, ["http://127.0.0.1:8017/v1/systemone"])
  assert.equal(result.pair, undefined)
  assert.equal(result.failure.url, identity.url)
  assert.equal(result.failure.reason, "jevos did not complete: HTTP 503")
})

test("a judge failure preserves jevos scores but does not produce a complete pair", async () => {
  const requests = []
  const result = await scoreRecordValueRow(row, identity, { ...options, fetchImpl: async (url, request) => {
    requests.push(url)
    if (url.startsWith("http://127.0.0.1")) {
      return Response.json({ model: "jevos-v5", answers: { explains: { noul: 0.25 } } })
    }
    assert.equal(request.headers.authorization, "Bearer test-key")
    return Response.json({ choices: [{ message: { content: '{"option1":5,"option2":2}' } }] })
  } })
  assert.deepEqual(requests, ["http://127.0.0.1:8017/v1/systemone", "http://127.0.0.1:8017/v1/systemone",
    "https://ai-gateway.vercel.sh/v1/chat/completions"])
  assert.equal(result.pair, undefined)
  assert.deepEqual(result.failure.probabilities, { source: 0.25, record: 0.25 })
  assert.equal(result.failure.reason, "Judge did not complete: Invalid judge reply")
})
