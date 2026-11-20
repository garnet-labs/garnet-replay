<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit e90ee0b287e714d223cd4a7b4acbca0c176f4004 -->
**Execution Profiles recorded for 2 jobs, triggered by [`e90ee0b`](https://github.com/garnet-labs/posthog/commit/e90ee0b287e714d223cd4a7b4acbca0c176f4004)**

> *47&nbsp;execution chains · 24&nbsp;destinations · changed since [`0c60f6f`](https://github.com/garnet-labs/posthog/commit/0c60f6ff9cc4d19f69e5ca4a7faa46fe9dc163ff) · recorded at the kernel by Garnet · 2026-08-06 05:05:02 UTC*

<details open><summary><b>+2&nbsp;−4</b> · <code>Garnet Runtime Visibility</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31072927528"><code>dep-install</code>&nbsp;↗</a> <sub>· 24&nbsp;chains · 12&nbsp;destinations</sub></summary>

```diff
@@ e90ee0b vs 0c60f6f @@
  Runner.Worker
  ├─ MainThread
  │  ├─ MainThread
- │  │  └─ → registry.npmjs[.]org
- │  ├─ → github[.]com
- │  ├─ → api.github[.]com
- │  └─ → release-assets.githubusercontent[.]com
  ├─ bash
  │  ├─ MainThread
  │  │  ├─ sh
  │  │  │  └─ MainThread
+ │  │  │     ├─ → github[.]com
  │  │  │     └─ → release-assets.githubusercontent[.]com
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  ├─ → registry.npmjs[.]org
  │  │  └─ → registry.npmjs[.]org
  │  └─ node
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     ├─ → registry.npmjs[.]org
+ │     └─ → registry.npmjs[.]org
  └─ node
     ├─ node
     │  └─ → registry.npmjs[.]org
     ├─ → api.github[.]com
     ├─ → github[.]com
     └─ → release-assets.githubusercontent[.]com
```

<details><summary><sub>dns + runner substrate · 13&nbsp;chains</sub></summary>

<pre>
<strong>Runner.Worker</strong>
├─ <em>bash</em>
│  ├─ <strong>MainThread</strong>
│  │  ├─ <em>sh</em>
│  │  │  ├─ <strong>MainThread</strong>
│  │  │  │  ├─ → localhost (dns resolver)
│  │  │  │  ├─ → release-assets.githubusercontent[.]com
│  │  │  │  └─ → release-assets.githubusercontent[.]com
│  │  │  └─ <em>sh</em>
│  │  │     └─ <strong>node-gyp</strong>
│  │  │        ├─ → nodejs[.]org
│  │  │        ├─ → nodejs[.]org
│  │  │        └─ → localhost (dns resolver)
│  │  ├─ → localhost (dns resolver)
│  │  └─ → codeload.github[.]com
│  └─ <strong>node</strong>
│     └─ → localhost (dns resolver)
├─ <strong>node</strong>
│  ├─ <strong>node</strong>
│  │  └─ → localhost (dns resolver)
│  └─ → localhost (dns resolver)
└─ → localhost (dns resolver)
<em>systemd</em>
└─ <em>systemd-network</em>
   └─ → ip6-allrouters
</pre>

</details>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31072927528?profile=019fd575-e89a-7640-b633-cf0b71f41cf7&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

<details><summary><code>demo — keyv Shai-Hulud install-time replica</code> / <a href="https://github.com/garnet-labs/posthog/actions/runs/31072927593"><code>install</code>&nbsp;↗</a> · Read manifest and install pinned tarball reached 3 destinations · no change <sub>· 6&nbsp;chains · 6&nbsp;destinations</sub></summary>

<pre>
<em>Runner.Worker</em>
├─ <strong>bash</strong>
│  └─ <strong>node</strong>
│     ├─ <strong>dash</strong>
│     │  └─ <strong>node</strong>
│     │     └─ <strong>node</strong>
│     │        ├─ → example[.]com
│     │        └─ → httpbin[.]org
│     └─ → registry.npmjs[.]org
└─ <strong>node</strong>
   ├─ → api.github[.]com
   ├─ → github[.]com
   └─ → release-assets.githubusercontent[.]com
</pre>

<details><summary><sub>dns + runner substrate · 4&nbsp;chains</sub></summary>

<pre>
<em>systemd</em>
└─ <strong>hosted-compute-agent</strong>
   └─ → localhost (dns resolver)
<em>Runner.Worker</em>
├─ <strong>bash</strong>
│  └─ <strong>node</strong>
│     ├─ <strong>dash</strong>
│     │  └─ <strong>node</strong>
│     │     └─ <strong>node</strong>
│     │        └─ → localhost (dns resolver)
│     └─ → localhost (dns resolver)
└─ <strong>node</strong>
   └─ → localhost (dns resolver)
</pre>

</details>

<p align="right"><sub><a href="https://app.garnet.ai/public/runs/31072927593?profile=019fd574-af91-7fe1-8e92-638b988e7657&amp;utm_source=github&amp;utm_medium=pr_comment">View this job's Execution Profile in Garnet →</a></sub></p>

</details>

---

<details><summary><sub>💡 How to read this</sub></summary>

<pre>
<em>Runner.Worker</em>                ← runner (italic)
└─ <strong>npm install</strong>               ← your workflow step (bold)
   └─ → registry.npmjs[.]org  ← outbound connection, defanged
</pre>

<sub><i><code>+</code> new · <code>−</code> no longer recorded, vs the previous profiled commit. A destination shows as both when its process chain changed.</i></sub>

</details>
