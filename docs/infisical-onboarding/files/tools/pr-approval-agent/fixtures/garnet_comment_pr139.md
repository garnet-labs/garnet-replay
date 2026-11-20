<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 5aba3c461a4872f7ca3d6a07ce739f2cb883e0cf -->
<!-- garnet:summary {"contract":"6.10.0","githubMeta":"2026-08-08","commit":"5aba3c461a4872f7ca3d6a07ce739f2cb883e0cf","previous":"c105d2b9b7cc6b0f4bca16f853a9a45d83c0f434","jobs":1,"changed":0,"unchanged":1,"noOutbound":0,"vanished":0,"added":0,"removed":0,"backgroundAdded":3,"backgroundRemoved":1,"vanishedDestinations":0,"chains":44,"destinations":13,"recorded":"2026-08-22 04:43:28 UTC","kinds":["network"]} -->
**Execution Profiles recorded for 1 job, triggered by [`5aba3c4`](https://github.com/garnet-labs/posthog/commit/5aba3c461a4872f7ca3d6a07ce739f2cb883e0cf)**

> *1&nbsp;job unchanged · compared with [`c105d2b`](https://github.com/garnet-labs/posthog/commit/c105d2b9b7cc6b0f4bca16f853a9a45d83c0f434)*
> <sub>recorded at the kernel by Garnet · 2026-08-22 04:43 UTC</sub>

<details><summary><code>Garnet Runtime Visibility</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/32552243818"><code>dep-install</code>&nbsp;↗</a> · 13&nbsp;destinations</summary>

```diff
@@ c105d2b (previous) vs 5aba3c4 (current) @@
  Runner.Worker
  ├─ node
  │  └─ ○ api.github[.]com
  └─ bash
     └─ MainThread (step: "Install dependencies (lifecycle scripts execute here)")
        ├─ sh
        │  ├─ MainThread
        │  │  ├─ ○ github[.]com
        │  │  └─ ○ release-assets.githubusercontent[.]com
        │  └─ sh
        │     └─ node-gyp
        │        └─ ○ nodejs[.]org
        ├─ ○ codeload.github[.]com
        └─ ○ registry.npmjs[.]org
 
  systemd (runner background · +3 −1)
  ├─ hosted-compute-
+ │  ├─ ○ 140.82.112.24
+ │  ├─ ○ 140.82.114.24
- │  ├─ ○ 20.75.202.224
+ │  ├─ ○ hosted-compute-request-orchestrator-prod-iad-01
  │  └─ ○ localhost (dns resolver)
  ├─ python3.12
  │  └─ python3.12
  │     ├─ ○ 168.63.129.16
  │     └─ ○ 169.254.169.254 (cloud metadata)
  └─ systemd-network
     └─ ○ ip6-allrouters
```

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/32552243818?profile=01a027c8-0525-7033-a2a3-8103c6ab91ba&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

---

<details open><summary><sub>💡 How to read this</sub></summary>

<pre>
Runner.Worker          <em>← process on a path</em>
└─ npm
   └─ <strong>node</strong>             <em>← process that acted</em>
      └─ ○ npmjs[.]org <em>← observed action</em>
</pre>

<sub><i>follow a path downward to see what ran and what it did — each path to an observed action is an execution chain</i></sub>

<sub><i>names on the path = processes · ○ = observed action · (…) = context</i></sub>

<sub><i>+ only in the current record · − only in the previous record · runner background = the runner's infrastructure, not your workflow</i></sub>

</details>
