<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 7ff9aba949227f126da3c7c8aaa3a9c40ca0ab82 -->
<!-- garnet:summary {"contract":"6.9.8","githubMeta":"2026-08-08","commit":"7ff9aba949227f126da3c7c8aaa3a9c40ca0ab82","previous":"732770e76ff162f2eb37df2b1c50b1ec25605c38","jobs":1,"changed":1,"unchanged":0,"noOutbound":0,"vanished":0,"added":2,"removed":2,"vanishedDestinations":0,"chains":40,"destinations":11,"recorded":"2026-08-11 21:32:11 UTC","kinds":["network"]} -->
**Execution Profiles recorded for 1 job, triggered by [`7ff9aba`](https://github.com/garnet-labs/posthog/commit/7ff9aba949227f126da3c7c8aaa3a9c40ca0ab82)**

> *1&nbsp;job changed +2&nbsp;−2&nbsp;destinations · compared with [`732770e`](https://github.com/garnet-labs/posthog/commit/732770e76ff162f2eb37df2b1c50b1ec25605c38)*
> <sub>recorded at the kernel by Garnet · 2026-08-11 21:32 UTC</sub>

<details open><summary><b>+2&nbsp;−2</b> · <code>Garnet Runtime Visibility</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31537928823"><code>dep-install</code>&nbsp;↗</a></summary>

```diff
@@ 732770e (previous) vs 7ff9aba (current) @@
  Runner.Worker
  ├─ node
  │  └─ ○ api.github[.]com
  └─ bash
     └─ MainThread
        ├─ sh
        │  ├─ MainThread
        │  │  ├─ ○ github[.]com
        │  │  ├─ ○ release-assets.githubusercontent[.]com
+       │  │  └─ ○ storage.googleapis[.]com
        │  └─ sh
        │     └─ node-gyp
        │        └─ ○ nodejs[.]org
        ├─ ○ codeload.github[.]com
        └─ ○ registry.npmjs[.]org
 
  systemd
  ├─ hosted-compute-
- │  ├─ sudo
- │  │  └─ provjobd
- │  │     └─ ○ 140.82.113.24
- │  ├─ ○ 140.82.113.23
+ │  ├─ ○ 140.82.114.23
  │  ├─ ○ glb-2a3c35-public-internal.githubapp[.]com (github infra)
  │  └─ ○ localhost (dns resolver)
  └─ systemd-network
     └─ ○ ip6-allrouters
```

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31537928823?profile=019ff2bd-7935-7652-b3fa-f739b23b32b3&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

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
