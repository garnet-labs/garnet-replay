import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The gh wrapper picks its installation token from the cwd's git remote, so resolve one per fork. */
export function forkEnv(fork) {
  const dir = join(homedir(), ".cache", "agent-ab", "remotes", fork.replace("/", "__"))
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true })
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["remote", "add", "origin", `https://github.com/${fork}.git`], { cwd: dir })
  }
  return { ...process.env, GH_TOKEN: String(execFileSync("gh", ["auth", "token"], { cwd: dir })).trim() }
}
