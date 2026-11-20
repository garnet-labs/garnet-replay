<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 00a442b3de5b0adb635236e0ab967a7c75f57e71 -->
<!-- garnet:summary {"contract":"6.6.1","commit":"00a442b3de5b0adb635236e0ab967a7c75f57e71","previous":"deaa5a526589ed486522df0061345f9910becfa4","jobs":2,"changed":1,"unchanged":1,"noOutbound":0,"vanished":0,"added":2,"removed":0,"vanishedChains":0,"chains":17,"destinations":12} -->
**Execution Profiles recorded for 2 jobs, triggered by [`00a442b`](https://github.com/garnet-labs/posthog/commit/00a442b3de5b0adb635236e0ab967a7c75f57e71)**

> *17&nbsp;execution chains · 12&nbsp;destinations · changed since [`deaa5a5`](https://github.com/garnet-labs/posthog/commit/deaa5a526589ed486522df0061345f9910becfa4) · recorded at the kernel by Garnet · 2026-08-10 19:55:27 UTC*
>
> *1&nbsp;job changed +2&nbsp;destinations · 1&nbsp;job unchanged*

<details open><summary><b>+2</b>&nbsp;destinations · <code>Vendored packages</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31426150164"><code>install</code>&nbsp;↗</a> · Install pinned tarball reached 3 destinations</summary>

```diff
@@ 00a442b vs deaa5a5 @@
  Runner.Worker
  ├─ node
  │  ├─ → api.github[.]com
  │  ├─ → github[.]com
  │  └─ → release-assets.githubusercontent[.]com
  └─ bash
     └─ node
        ├─ dash
        │  └─ node
        │     └─ node
+       │        ├─ → example[.]com
+       │        └─ → httpbin[.]org
        └─ → registry.npmjs[.]org
```

<details><summary><sub>dns + runner substrate · 5&nbsp;chains</sub></summary>

```diff
@@ 00a442b vs deaa5a5 @@
  systemd
  └─ hosted-compute-agent
     ├─ sudo
     │  └─ provjobd
-    │     └─ → 140.82.114.23
-    ├─ → 140.82.112.23
+    ├─ → 140.82.114.24
     ├─ → glb-2a3c35-public-internal.githubapp[.]com
     └─ → localhost (dns resolver)
```

</details>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31426150164?profile=019fed3c-6d65-7ff9-8434-692ca9142f90&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

<details><summary><code>Garnet Runtime Visibility</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31426150294"><code>dep-install</code>&nbsp;↗</a> · no change</summary>

<details><summary><sub>dns + runner substrate · 8&nbsp;chains</sub></summary>

<pre>
<em>Runner.Worker</em>
├─ <strong>node</strong>
│  └─ → api.github[.]com
└─ <em>bash</em>
   └─ <strong>MainThread</strong>
      ├─ <em>sh</em>
      │  ├─ <em>MainThread</em>
      │  │  ├─ → github[.]com
      │  │  └─ → release-assets.githubusercontent[.]com
      │  └─ <em>sh</em>
      │     └─ <em>node-gyp</em>
      │        └─ → nodejs[.]org
      ├─ → codeload.github[.]com
      └─ → registry.npmjs[.]org
<em>systemd</em>
├─ <em>systemd-network</em>
│  └─ → ip6-allrouters
└─ <strong>hosted-compute-</strong>
   └─ → localhost (dns resolver)
</pre>

</details>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31426150294?profile=019fed3e-8f58-775f-8995-e9d2eab70b70&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

---

<details><summary><sub>💡 How to read this</sub></summary>

<pre>
<em>Runner.Worker</em>                ← the runner: root of the job's execution tree (italic)
└─ <strong>npm install</strong>               ← a process your job ran (bold)
   └─ → registry.npmjs[.]org  ← an action: what the process did — an outbound connection, defanged
      ╰ one chain of processes, root to action: an execution chain
</pre>

<sub><i>The tree is every chain the job ran; a process appears only when it acted.</i></sub>

<sub><i><code>+</code> new destination · <code>−</code> destination no longer reached, vs the previous profiled commit.</i></sub>

</details>
