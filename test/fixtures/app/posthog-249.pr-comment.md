<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 71ab5eebb5f279f0771fa2795e765ae02846f24a -->
<!-- garnet:summary {"contract":"10.0.0","commit":"71ab5eebb5f279f0771fa2795e765ae02846f24a","previous":"7ba2b77e1e9fe875cc696fb4f0c8180a367a9553","scope":"pr-base","sincePush":null,"unattributed":0,"outcome":"changed","heading":"Runtime behavior changed","line":"Runtime behavior changed · 1 of 6 recorded jobs changed · 1 removed job","status":"finalized","capture_quality":"best-effort","jobs":6,"changed":1,"added":2,"removed":0,"backgroundAdded":0,"backgroundRemoved":0,"vanished":1,"incomplete":0,"destinations":30,"recorded":"2026-11-05 16:56:53 UTC","items":null,"trimmed":false} -->

### Runtime behavior changed

1 of 6 recorded jobs changed · 1 removed job · compared with the last 10 runs on `master`

<details>
<summary><b>Garnet Runtime Visibility / Dependency install (recorded)</b> · +2<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>MainThread</code> now reaches <code>2832391.fs1.hubspotusercontent-eu1[.]net</code>, <code>f.hubspotusercontent40[.]net</code></summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

```diff
  bash
  ├─ MainThread
  │  ├─ sh
  │  │  ├─ MainThread
+ │  │  │  ├─ 2832391.fs1.hubspotusercontent-eu1[.]net
+ │  │  │  ├─ f.hubspotusercontent40[.]net
  │  │  │  ├─ github[.]com
  │  │  │  └─ release-assets.githubusercontent[.]com
  │  │  └─ sh › node-gyp
  │  │     └─ nodejs[.]org (9 of the last 10 master runs)
  │  ├─ codeload.github[.]com (9 of the last 10 master runs)
  │  └─ registry.npmjs[.]org
  └─ node
     └─ registry.npmjs[.]org

  node
  ├─ node
  │  └─ registry.npmjs[.]org
  ├─ api.github[.]com (5 of the last 10 master runs)
  ├─ github[.]com
  └─ release-assets.githubusercontent[.]com
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-
  │  ├─ sudo › provjobd2614282
  │  │  └─ 140.82.113[.]24
  │  ├─ 140.82.113[.]23
  │  └─ 140.82.113[.]24
  ├─ hosted-compute-agent
  │  └─ 20.75.202[.]224
  ├─ systemd-resolved
  │  └─ 168.63.129[.]16
  ├─ python3.12 › python3.12
  │  ├─ python3.12
  │  │  ├─ 168.63.129[.]16
  │  │  └─ 169.254.169[.]254 (Cloud IMDS)
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ systemd-network
  │  └─ ip6-allrouters
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389828842?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1aca5-a71f-78b9-876e-1fe8a0379e30&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=changed">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / LLM gateway dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

```diff
  bash › uv
  └─ pypi[.]org (4 of the last 5 master runs)

  node
  ├─ bash › python3.14
  │  └─ pypi[.]org (4 of the last 5 master runs)
  ├─ api.github[.]com (3 of the last 5 master runs)
  ├─ github[.]com (3 of the last 5 master runs)
  └─ raw.githubusercontent[.]com (2 of the last 5 master runs)
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ python3 › python3
  │  └─ 168.63.129[.]16
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389828953?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1aca1-26f6-7fe1-8902-d5f6a3cb5572&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Acceptance tests requirements install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

```diff
  bash › python3.12
  ├─ dualstack.python.map.fastly[.]net
  └─ pypi[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-agent › sudo
  │  ├─ provjobd2252928128
  │  │  └─ 140.82.112[.]23
  │  └─ provjobd3485923855
  │     └─ 20.75.202[.]224
  ├─ python3.12 › python3.12
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ systemd-resolved
  │  └─ 168.63.129[.]16
  └─ systemd-networkd
     └─ ip6-allrouters
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389829079?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1aca0-1c97-7c3a-910e-77567fbabba0&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / CLI tools requirements install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

```diff
  bash › python3.12
  └─ pypi[.]org (3 of the last 5 master runs)
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-agent
  │  ├─ 135.130.109[.]33
  │  ├─ 140.82.114[.]23
  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  ├─ provjobd496541746
  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  ├─ python3.12 › python3.12
  │  └─ 168.63.129[.]16
  └─ systemd-resolved
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389828679?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1ac9f-f1f9-7840-9209-f8a0cbc6b635&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Desktop dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

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
  │  ├─ sudo › sudo
  │  │  ├─ 140.82.113[.]24
  │  │  └─ 20.75.202[.]224
  │  ├─ 140.82.113[.]24
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

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389828525?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1aca2-b57f-76a5-b448-ab9e16418fe8&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Visibility / Python dependency install (recorded)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · last 10 runs on <code>master</code> → <a href="https://github.com/garnet-labs/posthog/pull/249/commits/71ab5eebb5f279f0771fa2795e765ae02846f24a"><code>71ab5ee</code></a></sub>

```diff
  bash
  ├─ sudo › apt-get › http
  │  ├─ azure.archive.ubuntu[.]com
  │  └─ packages.microsoft[.]com
  └─ uv
     ├─ uv › uv › git-remote-http
     │  └─ github[.]com
     ├─ dualstack.python.map.fastly[.]net
     └─ pypi[.]org (7 of the last 8 master runs)

  node
  ├─ bash › python3.14
  │  ├─ dualstack.python.map.fastly[.]net
  │  └─ pypi[.]org (7 of the last 8 master runs)
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
  │  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  │  ├─ 140.82.114[.]24
  │  ├─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  │  └─ hosted-compute-request-orchestrator-prod-iad-01 (github infra)
  ├─ python3 › python3
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ python3.12 › http
  │  ├─ esm.ubuntu[.]com
  │  └─ motd.ubuntu[.]com
  ├─ systemd-network
  │  └─ ip6-allrouters
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/42068620121/job/127389829201?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/42068620121?profile=01a1aca0-dec7-7722-b699-a78e7cdb3cf1&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
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

<sub>Read down: what ran, then what it reached. <b>+</b> only in this commit · <b>−</b> only in the compared run · unmarked in both. Runner &amp; GitHub's own traffic is activity outside your steps and never counts. Recorded at the kernel, best-effort capture. · <a href="https://docs.garnet.ai/execution-profile?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=docs&amp;utm_term=changed#reading-the-comment">Docs ↗</a></sub>
</blockquote>
</details>

<sub>Recorded by Garnet · <a href="https://docs.garnet.ai/quickstart?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr249&amp;utm_content=add_to_ci&amp;utm_term=changed">Add it to your CI ↗</a></sub>
