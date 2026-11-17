<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit fc4e11dc6dd6e8010a4a291109dcff68cd85c858 -->
<!-- garnet:summary {"contract":"10.0.0","commit":"fc4e11dc6dd6e8010a4a291109dcff68cd85c858","previous":"8cbeb06000f47c6837ae0da332d49a9f6f1bba65","scope":"pr-base","sincePush":{"sha":"58e9985cd3d69ec31a675c97cb4ef81797f95cd5","added":0,"removed":1},"unattributed":0,"outcome":"changed","heading":"Runtime behavior changed","line":"Runtime behavior changed · 1 of 2 recorded jobs changed · 3 removed jobs","status":"finalized","capture_quality":"best-effort","jobs":2,"changed":1,"added":2,"removed":1,"backgroundAdded":0,"backgroundRemoved":0,"vanished":3,"incomplete":0,"destinations":15,"recorded":"2026-11-04 17:27:14 UTC","items":null,"trimmed":false} -->

### Runtime behavior changed

> ***1 of 2 recorded jobs changed*** *· 3 removed jobs*
> <sub><i>Garnet records 2 of 3 Garnet Runtime Visibility jobs</i></sub>
> <sub><i>At [`fc4e11d`](https://github.com/garnet-labs/posthog/pull/240/commits/fc4e11dc6dd6e8010a4a291109dcff68cd85c858), compared with the last 10 recorded runs on `master` (latest [`8cbeb06`](https://github.com/garnet-labs/posthog/commit/8cbeb06000f47c6837ae0da332d49a9f6f1bba65))</i></sub>
> <sub>Recorded at the kernel (best-effort capture)</sub>

<details>
<summary><b>Garnet Runtime Visibility / Dependency install (recorded)</b> · +2<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>MainThread</code> now reaches <code>2832391.fs1.hubspotusercontent-eu1[.]net</code>, <code>f.hubspotusercontent40[.]net</code></summary>

<blockquote>

<sub>Workload · <a href="https://github.com/garnet-labs/posthog/commit/8cbeb06000f47c6837ae0da332d49a9f6f1bba65"><code>8cbeb06</code></a> → <a href="https://github.com/garnet-labs/posthog/pull/240/commits/fc4e11dc6dd6e8010a4a291109dcff68cd85c858"><code>fc4e11d</code></a></sub>

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
  │  │     └─ nodejs[.]org
  │  ├─ codeload.github[.]com
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
  │  ├─ sudo
  │  │  ├─ provjobd1402453
  │  │  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  │  │  └─ provjobd3487243
  │  │     └─ 140.82.112[.]24
  │  ├─ 140.82.114[.]24
  │  ├─ glb-2a3c35-public-internal.githubapp[.]com (github infra)
  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  ├─ python3.12 › python3.12
  │  ├─ python3.12
  │  │  ├─ 168.63.129[.]16
  │  │  └─ 169.254.169[.]254 (Cloud IMDS)
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ python3 › python3
  │  ├─ 168.63.129[.]16
  │  └─ 169.254.169[.]254 (Cloud IMDS)
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41876669088/job/126737799837?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41876669088?profile=01a1a79a-00ac-72f8-ac47-d3f43eafb122&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=execution_profile&amp;utm_term=changed">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<b>Vendored packages / install</b> · job removed<br>&emsp;↳ ran at the PR base, not in this commit

<b>Garnet Dependabot Record / record</b> · job removed<br>&emsp;↳ ran at the PR base, not in this commit

<b>Garnet Dependabot Livestream Review / dependency-runtime-review</b> · job removed<br>&emsp;↳ ran at the PR base, not in this commit

<details>
<summary><sub>Garnet Runtime Visibility / Python dependency install (recorded) · nothing new</sub></summary>

<blockquote>

<sub>Workload · <a href="https://github.com/garnet-labs/posthog/commit/8cbeb06000f47c6837ae0da332d49a9f6f1bba65"><code>8cbeb06</code></a> → <a href="https://github.com/garnet-labs/posthog/pull/240/commits/fc4e11dc6dd6e8010a4a291109dcff68cd85c858"><code>fc4e11d</code></a></sub>

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
     ├─ dualstack.python.map.fastly[.]net
-    └─ pypi[.]org (reached in all of the last 3 master runs)

  node
  ├─ bash › python3.14
  │  └─ dualstack.python.map.fastly[.]net
  ├─ api.github[.]com
  ├─ github[.]com
  ├─ raw.githubusercontent[.]com
  ├─ release-assets.githubusercontent[.]com
  └─ releases.astral[.]sh
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd
  ├─ hosted-compute-
  │  ├─ sudo › sudo
  │  │  ├─ 140.82.112[.]24
  │  │  └─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  │  ├─ 140.82.112[.]24
  │  ├─ glb-p4a577-public-internal.githubapp[.]com (github infra)
  │  └─ hosted-compute-request-orchestrator-prod-iad-02 (github infra)
  ├─ python3.12
  │  ├─ http
  │  │  ├─ esm.ubuntu[.]com
  │  │  └─ motd.ubuntu[.]com
  │  └─ python3.12
  │     ├─ python3.12
  │     │  ├─ 168.63.129[.]16
  │     │  └─ 169.254.169[.]254 (Cloud IMDS)
  │     ├─ 168.63.129[.]16
  │     └─ 169.254.169[.]254 (Cloud IMDS)
  ├─ python3 › python3
  │  └─ 168.63.129[.]16
  └─ systemd-resolve
     └─ 168.63.129[.]16
```

<sub><a href="https://github.com/garnet-labs/posthog/actions/runs/41876669088/job/126737799286?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/41876669088?profile=01a1a796-4c1a-7573-a691-fbb44a13aebb&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=execution_profile&amp;utm_term=no_change">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

---

<details>
<summary><sub>How to read this</sub></summary>

<blockquote>
<pre>
bash › curl                 <em>← ancestry as captured, then the process that acted</em>
└─ example[.]com            <em>← what it reached</em>
</pre>

<sub>Read down: what ran, then what it reached. <b>+</b> only in this commit · <b>−</b> only in the compared run · unmarked in both. Runner &amp; GitHub's own traffic is activity outside your steps and never counts. · <a href="https://docs.garnet.ai/execution-profile?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=docs&amp;utm_term=changed#reading-the-comment">Docs ↗</a></sub>
</blockquote>
</details>

<sub>Recorded by Garnet · <a href="https://garnet.ai/?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-posthog-pr240&amp;utm_content=add_to_ci&amp;utm_term=changed">Add it to your CI ↗</a></sub>
