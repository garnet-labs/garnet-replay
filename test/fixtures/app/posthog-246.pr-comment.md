<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 304f116cfbea6fc11dbd42d2130121b8808ecd87 -->
<!-- garnet:summary {"contract":"10.0.0","commit":"304f116cfbea6fc11dbd42d2130121b8808ecd87","previous":"7ba2b77e1e9fe875cc696fb4f0c8180a367a9553","scope":"pr-base","sincePush":{"sha":"63107cfb7ea457f31d7afb7891e9e60a4fd25b4b","added":3,"removed":0},"unattributed":0,"outcome":"unchanged","heading":"Nothing new recorded","line":"Nothing new recorded · 0 of 6 recorded jobs changed","status":"finalized","capture_quality":"best-effort","jobs":6,"changed":0,"added":0,"removed":0,"backgroundAdded":0,"backgroundRemoved":0,"vanished":1,"incomplete":0,"destinations":27,"recorded":"2026-11-05 06:11:06 UTC","items":null,"trimmed":false} -->

### Nothing new recorded

All 6 jobs recorded · compared with the last 10 runs on `master`

<details>
<summary><b>Garnet Runtime Visibility / Dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  bash
  ├─ MainThread
  │  ├─ sh
  │  │  ├─ MainThread
  │  │  │  ├─ github[.]com
  │  │  │  └─ release-assets.githubusercontent[.]com
  │  │  └─ sh › node-gyp
  │  │     └─ nodejs[.]org (9 of the last 10 master runs)
  │  ├─ codeload.github[.]com (9 of the last 10 master runs)
  │  └─ registry.npmjs[.]org
  └─ node
     └─ registry.npmjs[.]org

  node › node
  └─ registry.npmjs[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-
  │  ├─ sudo › provjobd1246262
  │  │  ├─ 140.82.113[.]24
  │  │  └─ hosted-compute-request-orchestrator-prod-iad-02 (github infra)
  │  ├─ 140.82.112[.]23
  │  ├─ 140.82.113[.]24
  │  ├─ 140.82.114[.]23
  │  └─ glb-2a3c35-public-internal.githubapp[.]com (github infra)
  ├─ hosted-compute-agent
  │  └─ 20.75.202[.]224
  ├─ python3.12 › python3.12
  │  └─ 168.63.129[.]16
  ├─ systemd-resolved
  │  └─ 168.63.129[.]16
  ├─ python3 › python3
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ systemd-network
  │  └─ ip6-allrouters
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423391?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa55-3a57-79d1-94ca-c1c01e5501fa&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / LLM gateway dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  node
  ├─ bash › python3.14
  │  └─ pypi[.]org (4 of the last 5 master runs)
  ├─ api.github[.]com (3 of the last 5 master runs)
  ├─ github[.]com (3 of the last 5 master runs)
  ├─ release-assets.githubusercontent[.]com (3 of the last 5 master runs)
  └─ releases.astral[.]sh (1 of the last 5 master runs)
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-
  │  └─ 20.75.202[.]224
  ├─ python3 › python3
  │  └─ 168.63.129[.]16
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423493?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa50-e7d9-75a8-add6-a09a481b1d00&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Python dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  bash
  ├─ sudo › apt-get
  │  ├─ apt-get
  │  │  └─ azure.archive.ubuntu[.]com
  │  └─ http
  │     ├─ azure.archive.ubuntu[.]com
  │     └─ packages.microsoft[.]com
  └─ uv
     ├─ git › git › git-remote-http
     │  └─ github[.]com
     └─ dualstack.python.map.fastly[.]net

  node
  ├─ bash › python3.14
  │  └─ dualstack.python.map.fastly[.]net
  ├─ api.github[.]com
  ├─ github[.]com
  ├─ raw.githubusercontent[.]com
  ├─ release-assets.githubusercontent[.]com (6 of the last 8 master runs)
  └─ releases.astral[.]sh
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-
  │  ├─ sudo › sudo
  │  │  ├─ 140.82.112[.]24
  │  │  └─ 20.75.202[.]224
  │  ├─ 140.82.114[.]24
  │  ├─ 20.75.202[.]224
  │  └─ hosted-compute-request-orchestrator-prod-iad-01 (github infra)
  ├─ python3 › python3
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ systemd-network
  │  └─ ip6-allrouters
  ├─ python3.12 › http
  │  ├─ esm.ubuntu[.]com
  │  └─ motd.ubuntu[.]com
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423655?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa51-fe53-7826-8040-7b0ef5b33b3c&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Acceptance tests requirements install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  bash › python3.12
  ├─ dualstack.python.map.fastly[.]net
  └─ pypi[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-agent
  │  ├─ sudo › provjobd3485923855
  │  │  └─ 20.75.202[.]224
  │  └─ 20.75.202[.]224
  ├─ python3.12 › python3.12
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ systemd-resolved
  │  └─ 168.63.129[.]16
  └─ systemd-networkd
     └─ ip6-allrouters
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423623?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa50-a56b-7004-9e6a-2d7d278273a1&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / CLI tools requirements install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  bash › python3.12
  └─ pypi[.]org (3 of the last 5 master runs)
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-agent
  │  ├─ 135.130.109[.]33
  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  ├─ provjobd496541746
  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  └─ systemd-resolved
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423605?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa50-99c3-7f4a-9274-8c64e19a7e61&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Desktop dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/246/commits/304f116cfbea6fc11dbd42d2130121b8808ecd87"><code>304f116</code></a></sub>

```diff
  bash › node
  ├─ dash
  │  ├─ bash › node
  │  │  ├─ node
  │  │  │  ├─ artifacts.electronjs[.]org (4 of the last 5 master runs)
  │  │  │  └─ github[.]com
  │  │  ├─ github[.]com
  │  │  └─ release-assets.githubusercontent[.]com
  │  └─ node
  │     ├─ github[.]com
  │     ├─ nodejs[.]org
  │     ├─ release-assets.githubusercontent[.]com
  │     └─ releases.posthog[.]com (4 of the last 5 master runs)
  └─ registry.npmjs[.]org

  node › node
  └─ registry.npmjs[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ chronyd
  │  └─ 169[.]254[.]169[.]123
  ├─ hosted-compute-
  │  ├─ sudo
  │  │  ├─ sudo
  │  │  │  └─ 20.75.202[.]224
  │  │  └─ provjobd8449925
  │  │     └─ 140.82.114[.]23
  │  ├─ 140.82.114[.]23
  │  ├─ 20.75.202[.]224
  │  └─ hosted-compute-request-orchestrator-prod-iad-02 (github infra)
  ├─ systemd-resolve
  │  ├─ 10.0.0[.]2
  │  └─ 168.63.129[.]16
  ├─ python3.12 › python3.12
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  └─ systemd-network
     └─ ip6-allrouters
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41974602964/job/127081423115?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41974602964?profile=01a1aa52-f386-75ba-8e66-06b9f9fafec5&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>
<details>
<summary>1 job ran on <code>master</code>, not on this commit</summary>

<blockquote>

<code>Vendored packages / install</code>

</blockquote>
</details>

<details>
<summary><sub>How to read this</sub></summary>

<blockquote>
<pre>
bash › curl                 <em>← ancestry as captured, then the process that acted</em>
└─ example[.]com            <em>← what it reached</em>
</pre>

<sub>Read down: what ran, then what it reached. <b>+</b> only in this commit · <b>−</b> only in the compared run · unmarked in both. Runner &amp; GitHub's own traffic is activity outside your steps and never counts. Recorded at the kernel, best-effort capture. · <a href="https://docs.garnet.ai/execution-profile?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=docs&amp;utm_term=no_change#reading-the-comment">Docs ↗</a></sub>
</blockquote>
</details>

<sub>Recorded by Garnet · <a href="https://docs.garnet.ai/quickstart?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr246&amp;utm_content=add_to_ci&amp;utm_term=no_change">Add it to your CI ↗</a></sub>
