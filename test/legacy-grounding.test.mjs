import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { createReplayBranch, planReplay } from "../live/replay-branch.mjs"

test("legacy guidance carry rejects arbitrary paths and symlink ancestors before any writes", () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-links-"))
  const input = { repoDir: root, dependency: "example", from: "1", to: "2", packageManager: "npm" }
  try {
    assert.throws(() => planReplay({ ...input, reviewerFiles: { ".env": "not reviewer guidance" } }), /invalid reviewer/)
    mkdirSync(join(root, "outside"))
    symlinkSync(join(root, "outside"), join(root, ".agents"))
    assert.throws(() => createReplayBranch({ ...input, reviewerFiles: { ".agents/skills/garnet-runtime-review/SKILL.md": "policy" } }), /must not traverse symlinks/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("local-checkout live refuses before cloning; its explicit override permits a dry-run without executing repository code", () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-grounding-"))
  const repo = join(root, "repo")
  const bin = join(root, "bin")
  try {
    mkdirSync(repo)
    mkdirSync(bin)
    writeFileSync(join(repo, "package.json"), '{"name":"example","dependencies":{"example":"1"}}\n')
    execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" })
    execFileSync("git", ["-C", repo, "add", "package.json"])
    execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"], { stdio: "ignore" })
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:garnet-labs/example.git"])
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\nconst path = process.argv.at(-1); console.log(JSON.stringify(path.includes('/git/trees/') ? { tree: [] } : { default_branch: 'main' }));\n`)
    chmodSync(join(bin, "gh"), 0o755)
    const args = [resolve("bin/replay.mjs"), "live", repo, "--dependency", "example", "--from", "1", "--to", "2", "--dry-run"]
    const options = { encoding: "utf8", env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` } }
    const refused = spawnSync(process.execPath, args, options)
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /reviewers are not grounded.*--allow-ungrounded/)
    assert.match(refused.stdout, /reviewer grounding: missing or conflicting/)
    const allowed = spawnSync(process.execPath, [...args, "--allow-ungrounded"], options)
    assert.equal(allowed.status, 0, allowed.stderr)
    assert.match(allowed.stdout, /Live replay plan:/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
