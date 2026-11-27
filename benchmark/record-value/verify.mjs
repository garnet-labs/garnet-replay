import { verifyExhibit } from "../../lib/verify.mjs"

/** Run the share gate without treating a throttled check as a verdict. */
export async function verifyRecordValueExhibit(url, { token, exec, fetchImpl = fetch, verify = verifyExhibit }) {
  let rateLimited = false
  const read = async (input, options) => {
    const response = await fetchImpl(input, options)
    if (new URL(input).hostname === "api.github.com" && (response.status === 429 ||
      (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))))) {
      rateLimited = true
    }
    return response
  }
  const execute = (command, args, options) => {
    try {
      return exec(command, args, options)
    } catch (error) {
      if (/rate limit|HTTP 429/i.test(String(error.stderr ?? error.message))) rateLimited = true
      throw error
    }
  }
  try {
    return await verify(url, { token, exec: execute, fetchImpl: read })
  } finally {
    if (rateLimited) throw Object.assign(new Error("GitHub rate-limited replay verification"), { code: "GITHUB_RATE_LIMIT" })
  }
}
