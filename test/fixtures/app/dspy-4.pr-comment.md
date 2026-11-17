<!-- garnet-runtime-review -->
<!-- garnet-control-plane-pr-comment:v1:app.garnet.ai -->
<!-- garnet:commit 2fc0049935672d48e5bc6384ec29043780bda08b -->
<!-- garnet:summary {"contract":"8.0.0","commit":"2fc0049935672d48e5bc6384ec29043780bda08b","previous":"a35181044b541a3843815318d1acd7c66429d628","scope":"pr-base","sincePush":null,"unattributed":0,"outcome":"changed","heading":"Runtime behavior changed","line":"Runtime behavior changed · 1 job changed","status":"finalized","capture_quality":"best-effort","jobs":1,"changed":1,"added":1,"removed":1,"backgroundAdded":0,"backgroundRemoved":0,"vanished":0,"incomplete":0,"destinations":3,"recorded":"2026-10-30 01:53:30 UTC","items":null,"trimmed":false} -->

### Runtime behavior changed

> ***1 job changed***
> <sub><i>1 job recorded at the kernel · `ubuntu-latest` (Linux x86_64)</i></sub>
>
> <details>
> <summary><sub><i>At <a href="https://github.com/garnet-labs/dspy/pull/4/commits/2fc0049935672d48e5bc6384ec29043780bda08b"><code>2fc0049</code></a>, compared with the PR base <a href="https://github.com/garnet-labs/dspy/commit/a35181044b541a3843815318d1acd7c66429d628"><code>a351810</code></a></i></sub></summary>
>
> | | Commit | Change to this head |
> |---|---|---|
> | head | [`2fc0049`](https://github.com/garnet-labs/dspy/pull/4/commits/2fc0049935672d48e5bc6384ec29043780bda08b)<br><sub>`onboarding/reviewer-guidance` · run [40987593597](https://github.com/garnet-labs/dspy/actions/runs/40987593597)</sub> |  |
> | PR base | [`a351810`](https://github.com/garnet-labs/dspy/commit/a35181044b541a3843815318d1acd7c66429d628)<br><sub>`main` · run [40987280738](https://github.com/garnet-labs/dspy/actions/runs/40987280738)</sub> | the job folds above |
>
> </details>

<details>
<summary><b>Lint, Test, and Build / Run MCP v2 Tests</b> · +1 −1<br>&emsp;↳ <code>bash</code> › <code>uv</code> now reaches <code>dualstack.python.map.fastly[.]net</code><br>&emsp;↳ <code>bash</code> › <code>uv</code> no longer reaches <code>pypi[.]org</code></summary>

<blockquote>

```diff
  Runner.Worker › bash
  └─ uv
+    ├─ ○ dualstack.python.map.fastly[.]net
-    └─ ○ pypi[.]org
```

<details>
<summary>Runner activity outside your workflow · +8 −8 · not counted</summary>

```text
  systemd
-   ├─ … (2)
-     │  └─ sudo
-   │     └─ ○ hosted-compute-watchdog-prod-eus-02[.]githubapp (github infra)
-   ├─ … (1)
-     │  └─ python3
-   │     └─ ○ 168.63.129[.]16
-   ├─ systemd-resolve
-   │  └─ ○ 168.63.129[.]16
+   ├─ … (2)
+     │  └─ hosted-compute-agent
+   │     └─ ○ hosted-compute-watchdog-prod-eus-02[.]githubapp (github infra)
+   ├─ systemd
+   │  └─ ○ 168.63.129[.]16
+   └─ … (1)
+       └─ systemd
+        └─ ○ 168.63.129[.]16
```

</details>

<sub>2 other destinations, nothing new · <a href="https://github.com/garnet-labs/dspy/actions/runs/40987593597/job/123842130922?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-dspy-pr4&amp;utm_content=job">Job log</a> · <a href="https://app.garnet.ai/public/runs/40987593597?profile=01a18a83-1c95-70dd-9479-bc2a0022143a&amp;utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-dspy-pr4&amp;utm_content=execution_profile&amp;utm_term=changed">Full record in Garnet ↗</a></sub>
</blockquote>
</details>


---

<details>
<summary><sub>How to read this</sub></summary>

<blockquote>
<pre>
Runner.Worker     <em>← process on a path</em>
└─ <b>curl</b>           <em>← process that acted</em>
   └─ ○ example[.]com <em>← observed action</em>
</pre>

<sub>Read down: what ran, then what it reached. <b>+</b> only in this commit · <b>−</b> only in the compared run. Capture is best-effort. · <a href="https://docs.garnet.ai/execution-profile?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-dspy-pr4&amp;utm_content=docs&amp;utm_term=changed#reading-the-comment">Docs ↗</a></sub>
</blockquote>
</details>

<sub>Runtime behavior, recorded by Garnet. <a href="https://docs.garnet.ai/quickstart?utm_source=github&amp;utm_medium=pr_comment&amp;utm_campaign=garnet-labs-dspy-pr4&amp;utm_content=add_to_ci&amp;utm_term=changed">Add it to your CI ↗</a></sub>
