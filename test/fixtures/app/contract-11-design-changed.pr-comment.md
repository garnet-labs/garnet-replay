<sub>Comment lock · state 01: changed, complex live case · real data from <a href="https://github.com/garnet-org/runtime-review-testbed/pull/187">#187</a> at <code>391d282</code> · hand-assembled, not a live App comment</sub>
### 10 new destinations recorded

6 recorded jobs · compared with the PR base `devin/1793235720-complex-base` · 3 destinations no longer seen

<details>
<summary><b>Garnet Runtime Review (dev) / build</b> · +7 −1<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>bash</code> › <code>curl</code> reached <code>dl-cdn.alpinelinux[.]org</code>, <code>objects.githubusercontent[.]com</code> and 5 more</summary>

<blockquote>

<sub>Workload · <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a> → <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a></sub>

```diff
+ GitHub.Runner › bash › curl
+ ├─ crates[.]io
+ ├─ dl-cdn.alpinelinux[.]org
+ ├─ files.pythonhosted[.]org
+ ├─ objects.githubusercontent[.]com
+ ├─ proxy.golang[.]org
+ ├─ repo.maven.apache[.]org
+ └─ static.crates[.]io

  A › B › C › python3.12 › curl
- └─ pypi[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
+ GitHub.Runner › bash › curl
+ └─ productionresultssa0.blob.core.windows[.]net (github infra)

  systemd › hosted-compute-agent › sudo › provjobd3708248497
  └─ hosted-compute-watchdog-prod-iad-02[.]githubapp (github infra)
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Review (dev) / test</b> · +2 −2<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>bash</code> › <code>curl</code> reached <code>registry.npmmirror[.]com</code>, <code>registry.yarnpkg[.]com</code><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>bash</code> › <code>wget</code> reached <code>registry.yarnpkg[.]com</code></summary>

<blockquote>

<sub>Workload · <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a> → <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a></sub>

```diff
  GitHub.Runner › bash
  ├─ curl
+ │  ├─ registry.npmmirror[.]com
+ │  ├─ registry.yarnpkg[.]com
- │  └─ registry.npmjs[.]org
- ├─ node
- │  └─ api.github[.]com
+ └─ wget
+    └─ registry.yarnpkg[.]com
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Review (dev) / install (node 22)</b> · +1<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>node</code> reached <code>storage.googleapis[.]com</code></summary>

<blockquote>

<sub>Workload · <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a> → <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a></sub>

```diff
  GitHub.Runner › bash › node
+ ├─ node
+ │  └─ storage.googleapis[.]com
  └─ registry.npmjs[.]org
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Review (dev) / e2e</b> · first time recorded<br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> <code>bash</code> › <code>curl</code> reaches <code>example[.]org</code></summary>

<blockquote>

<sub>Workload</sub>

```diff
  GitHub.Runner › bash › curl
  └─ example[.]org
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Review (dev) / install (node 20)</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a> → <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a></sub>

```diff
  GitHub.Runner › bash › node
  └─ registry.npmjs[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd › hosted-compute-agent
  ├─ sudo › provjobd1525494919
  │  └─ glb-2a3c35-public-internal.githubapp[.]com (github infra)
  └─ glb-2a3c35-public-internal.githubapp[.]com (github infra)
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>

<details>
<summary><b>Garnet Runtime Review (dev) / lint</b><br>&emsp;<span title="Open the job for everything recorded: workload tree, runner and GitHub traffic">↳</span> nothing new</summary>

<blockquote>

<sub>Workload · <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a> → <a href="__REFERENCE_URL__"><code>__REFERENCE_SHA__</code></a></sub>

```diff
  GitHub.Runner › bash › node
  └─ registry.npmjs[.]org
```

<sub>Runner &amp; GitHub's own traffic · <code>ubuntu-latest</code> · Linux x86_64</sub>

```diff
  systemd › hosted-compute-agent › sudo
  ├─ provjobd1373830582
  │  └─ hosted-compute-watchdog-prod-iad-01[.]githubapp (github infra)
  └─ provjobd794181873
     └─ hosted-compute-watchdog-prod-iad-02[.]githubapp (github infra)
```

<sub><a href="__REFERENCE_URL__">Job log</a> · <a href="__REFERENCE_URL__">Full record in Garnet ↗</a></sub>
</blockquote>
</details>
<details>
<summary>1 job ran on <code>devin/1793235720-complex-base</code>, not on this commit</summary>

<blockquote>

<code>Garnet Runtime Review (dev) / docs</code>

</blockquote>
</details>

<details>
<summary><sub>How to read this</sub></summary>

<blockquote>
<pre>
bash › curl                 <em>← ancestry as captured, then the process that acted</em>
└─ example[.]com            <em>← what it reached</em>
</pre>

<sub>Read down: what ran, then what it reached. <b>+</b> only in this commit · <b>−</b> only in the compared run · unmarked in both. Runner &amp; GitHub's own traffic is activity outside your steps and never counts. · <a href="https://docs.garnet.ai/execution-profile?utm_source=github&amp;utm_medium=pr_comment&amp;utm_content=docs&amp;utm_term=changed#reading-the-comment">Docs ↗</a></sub>
</blockquote>
</details>

<sub>Recorded by Garnet · <a href="https://docs.garnet.ai/quickstart?utm_source=github&amp;utm_medium=pr_comment&amp;utm_content=add_to_ci&amp;utm_term=changed">Add it to your CI ↗</a></sub>
