import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { withFileLock } from "../lib/ledger.mjs"

const LEDGER = new URL("../lib/ledger.mjs", import.meta.url).href

function writer(path, row) {
  const script = `
    import { readFileSync, writeFileSync, renameSync } from "node:fs"
    import { withFileLock } from ${JSON.stringify(LEDGER)}
    withFileLock(${JSON.stringify(path)}, () => {
      const rows = JSON.parse(readFileSync(${JSON.stringify(path)}, "utf8"))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      rows.push(${JSON.stringify(row)})
      writeFileSync(${JSON.stringify(path)} + "." + process.pid + ".tmp", JSON.stringify(rows))
      renameSync(${JSON.stringify(path)} + "." + process.pid + ".tmp", ${JSON.stringify(path)})
    })`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

test("withFileLock serializes read-modify-write across processes: no concurrent row is lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-lock-"))
  try {
    const path = join(dir, "x.json")
    writeFileSync(path, "[]")
    await Promise.all(Array.from({ length: 8 }, (_, index) => writer(path, `row-${index}`)))
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).sort(), Array.from({ length: 8 }, (_, index) => `row-${index}`).sort())
    assert.equal(existsSync(`${path}.lock`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("withFileLock takes over a stale lock and releases it on throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-lock-"))
  try {
    const path = join(dir, "x.json")
    writeFileSync(`${path}.lock`, "")
    const old = new Date(Date.now() - 60_000)
    utimesSync(`${path}.lock`, old, old)
    assert.equal(withFileLock(path, () => 42), 42)
    assert.throws(() => withFileLock(path, () => { throw new Error("boom") }), /boom/)
    assert.equal(existsSync(`${path}.lock`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
