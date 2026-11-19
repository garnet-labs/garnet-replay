## Summary
Adds `test/screenshot.test.js`, a `node:test` case that converts `README.md` to minimal HTML inline (`#` headings -> `<hN>`, other lines -> `<p>`, no markdown dependency), loads it in headless Chrome via `puppeteer.launch({ channel: "chrome" })` + `page.setContent()`, and asserts the first `<h1>` text is `ghaw-garnet-reference`. `puppeteer` 24.37.3 is added as a devDependency (package.json + package-lock.json). `.puppeteerrc.cjs` sets `skipDownload: true`, so `npm ci` does not download a Chrome build; the test uses the Google Chrome that `ubuntu-latest` already ships.

### Runtime evidence (Garnet, head f979055)
Nothing new recorded · compared with the last 9 runs on `main` (base `4916beef41f27247884de07ca96eebc7ad35baca`) · [record comment](https://github.com/garnet-labs/ghaw-garnet-reference/pull/22#issuecomment-6678536224) (status `finalized`, `incomplete: 0`, capture `best-effort`, recorded 2026-11-06 06:21:48 UTC) · CI run [42173880797](https://github.com/garnet-labs/ghaw-garnet-reference/actions/runs/42173880797) (success) · CP MCP `profiles` id `01a1af85-5e04-7e06-8c1d-be1dc232e238`.
- `systemd > hosted-compute-agent > Runner.Listener > Runner.Worker > bash > node` -> `registry.npmjs.org` (`CI`/`test`) - `npm ci` fetching the lockfile's packages, now including `puppeteer` and its dependencies; the comment marks it as present in 8 of the last 9 `main` runs, so it is not new for this diff.
- No other workload destination appears in the record. The profile's remaining egress is `localhost` (DNS from the same `node` chain to `systemd-resolved`) and runner traffic (`168.63.129.16`, `169.254.169.123`, `ip6-allrouters`), which the comment lists under "Runner & GitHub's own traffic". No destination is attributed to the runner's Chrome in this record; the capture is best-effort, so this is an observation about what was recorded, not a statement that the browser made no connection.

Earlier heads:
- `46015e6` (CI run [42173569203](https://github.com/garnet-labs/ghaw-garnet-reference/actions/runs/42173569203), failed; profile `01a1af82-95b9-7a9d-bb73-45fe4dd8b462`): "Runtime behavior changed · 1 of 1 recorded job changed", `CI`/`test` +1: `bash › node › dash › node` -> `storage.googleapis[.]com` - puppeteer's postinstall downloading a Chrome build during `npm ci`. The test does not need that download, and the downloaded build also failed to launch on the runner ("No usable sandbox"). Change: added `.puppeteerrc.cjs` (`skipDownload: true`) and switched the launch to `channel: "chrome"` (commit `f979055`, message cites this record).

### What the run reached (session receipt, local install+test windows)
Commands: `npm install --save-dev puppeteer@24.37.3`, `npm test` (x3; the last one against a Chrome build symlinked to `/opt/google/chrome/chrome`). Completeness: `complete for the requested windows` (backend `jibril`).
- `storage.googleapis.com` via `npm install pup > sh > node` (install window, before `.puppeteerrc.cjs`): puppeteer's install script downloading Chrome.
- `accounts.google.com`, `www.google.com`, `clients.l.google.com` via `npm test > sh > node > node > chrome > chrome` (test windows): background traffic from the locally launched Chrome build, not needed by the test. The CI record for `f979055` lists no destination for the runner's Chrome (see above).
- `git-manager.devin.ai`, `windsurf-stable.codeium.com`, `3.173.11.131` via `git`, `devin`, `code`: Devin environment traffic, not from the diff.
- Credential reads: none recorded.
The receipt and the Garnet record are observations, not approvals.

Link to Devin session: https://app.devin.ai/sessions/13cb3d2ed0fe45b3896409d00f2902f0
Open in Devin Desktop: https://app.devin.ai/desktop/session/13cb3d2ed0fe45b3896409d00f2902f0?variant=devin
Requested by: @jadoonf
<!-- devin-review-badge-begin -->

---

🟢 Devin Review found nothing to fix · [View findings](https://app.devin.ai/review/garnet-labs/ghaw-garnet-reference/pull/22) · [Follow Devin's work](https://app.devin.ai/sessions/13cb3d2ed0fe45b3896409d00f2902f0)

<a href="https://app.devin.ai/review/garnet-labs/ghaw-garnet-reference/pull/22" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://static.devin.ai/assets/gh-devin-review-dark.svg?v=4"><img src="https://static.devin.ai/assets/gh-devin-review-light.svg?v=4" alt="Devin Review"></picture></a><!-- devin-review-badge-end -->
