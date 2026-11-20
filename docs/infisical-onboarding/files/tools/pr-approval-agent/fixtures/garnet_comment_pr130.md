<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit eb0d3f112a57265e92e744ca62ee0a1c0cd6a1ef -->
<!-- garnet:summary {"contract":"6.9.8","githubMeta":"2026-08-08","commit":"eb0d3f112a57265e92e744ca62ee0a1c0cd6a1ef","previous":"f97b6a2cffd40796e3119a86b426bab7259173f1","jobs":1,"changed":1,"unchanged":0,"noOutbound":0,"vanished":0,"added":3,"removed":2,"vanishedDestinations":0,"chains":48,"destinations":12,"recorded":"2026-08-12 05:16:23 UTC","kinds":["network"]} -->
**Execution Profiles recorded for 1 job, triggered by [`eb0d3f1`](https://github.com/garnet-labs/posthog/commit/eb0d3f112a57265e92e744ca62ee0a1c0cd6a1ef)**

> *1&nbsp;job changed +3&nbsp;−2&nbsp;destinations · compared with [`f97b6a2`](https://github.com/garnet-labs/posthog/commit/f97b6a2cffd40796e3119a86b426bab7259173f1)*
> <sub>recorded at the kernel by Garnet · 2026-08-12 05:16 UTC</sub>

<details open><summary><b>+3&nbsp;−2</b> · <code>Garnet Runtime Visibility</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31565748691"><code>dep-install</code>&nbsp;↗</a></summary>

```diff
@@ f97b6a2 (previous) vs eb0d3f1 (current) @@
  Runner.Worker
  ├─ node
  │  └─ ○ api.github[.]com
  └─ bash
-    ├─ node (step: "Install dependencies (lifecycle scripts execute here)")
-    │  └─ ○ codeload.github[.]com
     └─ MainThread (step: "Install dependencies (lifecycle scripts execute here)")
        ├─ sh
        │  ├─ MainThread
        │  │  ├─ ○ github[.]com
        │  │  └─ ○ release-assets.githubusercontent[.]com
        │  └─ sh
        │     └─ node-gyp
        │        └─ ○ nodejs[.]org
        ├─ ○ localhost (dns resolver)
        └─ ○ registry.npmjs[.]org
 
  systemd
  ├─ hosted-compute-
+ │  ├─ sudo
+ │  │  └─ provjobd
+ │  │     └─ ○ 140.82.112.24
+ │  ├─ ○ 140.82.114.23
+ │  ├─ ○ 140.82.114.24
- │  └─ ○ 20.75.202.224
  ├─ python3.12
  │  └─ python3.12
  │     ├─ ○ 168.63.129.16
  │     └─ ○ 169.254.169.254 (cloud metadata)
  └─ systemd-network
     └─ ○ ip6-allrouters
```

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31565748691?profile=019ff466-8de6-72c9-96a6-bb13dcbd57df&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

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

<sub><i>+ only in the current record · − only in the previous record</i></sub>

</details>
