# Reviewer consumption: generalized mechanism, roadmap, maintained artifacts

Research observed 2026-09-22 UTC across seven review agents (Devin Review, Greptile,
Cursor Bugbot, GitHub Copilot code review, CodeRabbit, Qodo, Codex cloud review).
Per-tool reports with source URLs live in the research sessions linked at the end.
Inventory numbers come from `replay harvest` on 2026-09-22 (garnet-labs/pnpm,
garnet-labs/posthog) and the 120-repository sweep of the same day.

## 1. What the inventory shows

- 120 repositories, 958 fork pull requests probed; 28 repositories carry Garnet records;
  only pnpm, posthog and the runtime-review reference carry the evidence mirror.
- The exact contract line `Runtime evidence (Garnet, head <sha7>):` appears only from
  `devin-ai-integration[bot]` (12 utterances). After the classifier fixes pnpm has 7
  head-bound consumers in 57 recorded pull requests; posthog has 4 in 111 (Devin on
  three, Greptile on two of them when a session explicitly asked it to read the record).
- CodeRabbit, Greptile and Qodo talk about the record constantly (hundreds of
  `mention` receipts) and, unprompted, never bind to the head. Qodo output is mostly
  generic review stamps.
- The pnpm fork already ships `.coderabbit.yaml` asking for a grounding prefix, and
  CodeRabbit still never emitted it. Per-tool config alone does not produce the line.
- No repository has any evidence that the record changed a reviewer's judgment.

## 2. Why one config file per tool is not enough

Every tool researched reads the **PR description** (Qodo, CodeRabbit, Greptile,
Bugbot documented; Copilot and Codex by inference). Almost none read **issue
comments** as review input (Bugbot: top-level comments yes; CodeRabbit: discussion
yes; Devin automatic review, Greptile, Copilot, Qodo, Codex: no or undocumented).
Only CodeRabbit and Qodo read **check runs**, and only failing ones matter to Qodo.
Nobody reads artifacts. Nobody offers a deterministic output template; every tool
emits LLM prose that *may* follow an instruction.

So the Garnet PR comment, on its own, is invisible to most reviewers; the mirror in
the description is the only channel they all share, and the grounding line is a
best-effort observation, never an enforcement point.

Second timing problem: every tool reviews on `opened`/`synchronize`, which is before
the recorder finishes. Unless a review is re-triggered after `garnet/evidence`
binds, the reviewer reads an empty or stale mirror and correctly says "no evidence".
That is what the 2026-09-22 pnpm receipts show: Devin's first pass says
`No runtime evidence for this head`, its second pass (after CI) cites the record.

## 3. The generalized mechanism

Six layers; Garnet owns 1, 2, 5 and 6, the user's repository carries 3 and 4.

| layer | owner | mechanism | fail-closed? |
|---|---|---|---|
| 1 evidence | Garnet action + recorder | head-bound record comment, `<!-- garnet:commit <sha> -->` marker | yes |
| 2 delivery | privileged mirror workflow | copy the record into the PR description between `<!-- garnet:evidence:begin/end -->`; `garnet/evidence` check on the head | yes (required check) |
| 3 instruction | repository | one canonical `REVIEW.md` + thin per-tool adapters that point at it | no (prose) |
| 4 timing | mirror workflow | after `garnet/evidence` succeeds, request the review again (`/devin review`, `@coderabbitai review`, `@greptileai`, `bugbot run`, `@codex review`, `/agentic_review`, Copilot re-request) deduplicated per head | n/a |
| 5 measurement | `replay consume` / `harvest` | tiered receipts (utterance, citation, observation, mention); `consumed` only for head-bound utterance/citation | strict |
| 6 enforcement | branch protection | `garnet/evidence` required; reviewer output never gates | yes |

The reviewer's grounding line is the **user-facing** output; `garnet/evidence` is the
**merge** output. Keep them separate in copy and in telemetry.

## 4. Tool matrix (what to maintain per tool)

| tool | reads description | reads comments | reads checks | instruction surface Garnet should ship | re-trigger after evidence | first-line reliability | target now? |
|---|---|---|---|---|---|---|---|
| Devin Review | undocumented for auto review; sessions read anything | no (auto) | no (auto) | root `REVIEW.md` (+ `.agents/skills/garnet-runtime-review/SKILL.md` for sessions) | `/devin review` comment or REST API | partial; skill path is more deterministic | yes (only tool with observed utterances) |
| CodeRabbit | yes | yes | yes, incl. failed CI logs | `.coderabbit.yaml` (`tone_instructions`, path instructions, custom pre-merge check) + `AGENTS.md` import | `@coderabbitai review` / `full review` | partial | yes |
| Greptile | yes | yes (mentions) | no | `.greptile/config.json` + `.greptile/rules.md` (`greptile onboard` imports AGENTS/CLAUDE once) | `@greptileai` comment | partial | yes |
| Cursor Bugbot | yes | top-level + inline | no | `.cursor/BUGBOT.md` (root + nested); set PR summary to comment, disable incremental review | `bugbot run` / Enterprise API | partial | next |
| GitHub Copilot | metadata (inferred) | no | via GitHub MCP if instructed | `.github/copilot-instructions.md` + `.github/skills/garnet-runtime-review/SKILL.md`; instructions read from head branch | re-request reviewer via API | partial | next |
| Qodo | yes (raw, HTML incl.) | only when addressed | failing checks only | `.pr_agent.toml` guidelines + `REVIEW.md` (portal toggle) | `/agentic_review` (bot mentions may be filtered) | low | later |
| Codex cloud review | unknown | no | no | `AGENTS.md` `## Code Review Rules` | `@codex review` | low; no check run at all | later; use `openai/codex-action` in a workflow if deterministic output is needed |

## 5. Roadmap

Stage A — make delivery correct (this quarter, replay stage2 template)
1. Mirror workflow re-requests the configured reviewers after `garnet/evidence`
   succeeds, once per head. This alone converts "no runtime evidence" first passes
   into a second pass that can cite the record.
2. Ship the adapter set from section 6 through `replay stage2` so every fork gets
   `REVIEW.md` + `.coderabbit.yaml` + `.greptile/config.json` + `.cursor/BUGBOT.md`
   + `.github/copilot-instructions.md` in one commit.
3. Keep `garnet/evidence` as the only required check.

Stage B — measure the funnel (replay ledger)
4. Add funnel columns to `consumption[]`: delivered (mirror present at head),
   visible (tool reviewed after the mirror timestamp), attention (any receipt),
   grounded (head-bound utterance/citation), observation (destination repeated),
   decision impact (reviewer conclusion cites the record), attribution (link to
   app.garnet.ai). Today only attention and grounded are measured.
5. Add a cold-read score per surface (record comment, mirror, grounding line) so
   "intuitive" becomes a number. None exists today.

Stage C — deterministic path where a tool allows it
6. Devin: `.agents/skills` skill that emits the exact line; Copilot: `.github/skills`
   skill using GitHub MCP to read the body and the check; Codex: `codex-action` job
   `needs:` the Garnet job with `--output-schema`.
7. CodeRabbit custom pre-merge check that narrates `garnet/evidence` (informational,
   never the gate).

Stage D — public proof
8. Publish per-tool grounding rates from the ledger (proven-consumers) only for
   head-bound rows; list mention counts separately so the claim stays honest.

## 6. Artifacts and instructions to maintain (single source, generated adapters)

Canonical, one copy each, in the runtime-review reference and templated by
`replay stage2`:

1. `REVIEW.md` — the contract: where the record is, marker semantics, the exact
   grounding line, the `undeterminable` rule, "never approve on evidence".
2. Mirror block format — `<!-- garnet:evidence:begin -->` … `<!-- garnet:commit <sha> -->`
   … `<!-- garnet:evidence:end -->`; the only channel every reviewer reads.
3. `garnet/evidence` check semantics — the enforcement contract and its failure text
   (Qodo and CodeRabbit surface failing-check text to the reviewer).
4. Re-trigger workflow step — post-evidence review request per tool, deduplicated per
   head SHA.
5. Per-tool adapters, each ≤ 20 lines that point at `REVIEW.md`:
   `.coderabbit.yaml`, `.greptile/config.json` + `.greptile/rules.md`,
   `.cursor/BUGBOT.md`, `.github/copilot-instructions.md`, `.pr_agent.toml`,
   `AGENTS.md` `## Code Review Rules` section.
6. Agent skills — `.agents/skills/garnet-runtime-review/SKILL.md` (Devin) and
   `.github/skills/garnet-runtime-review/SKILL.md` (Copilot), same body.
7. Verification fixture — the 10-minute recipe: open a PR, wait for `garnet/evidence`,
   trigger the reviewer, check the first line and `commit_id` via the API, then a
   negative test (empty commit, expect `undeterminable`).
8. Consumption telemetry schema — the `consumption[]` row and receipt tiers, so
   numbers are comparable across forks and tools.
9. Compatibility matrix — section 4, re-verified when a tool's docs change.
10. Troubleshooting runbook — "reviewer said no evidence" (timing), "reviewer ignored
    the file" (tool does not read that surface), "line present but wrong head"
    (stale mirror; mirror workflow must rewrite on synchronize).

## 7. What this does not claim

A grounding line proves the record was read at the right head, not that the
reviewer's judgment changed. Decision-impact and attribution rows stay `unknown`
until the Stage B columns exist.

## Sources

Per-tool research (all observed 2026-09-22 UTC, source URLs inside):
Devin https://app.devin.ai/sessions/163e6efe67fd4951a252c5fbc26b2c14 ·
Greptile https://app.devin.ai/sessions/cc802162b5af44d0b5f2334405572b5f ·
Cursor Bugbot https://app.devin.ai/sessions/4d960adc6a7843a3861683da08bac503 ·
Copilot https://app.devin.ai/sessions/689c659923cd4eb78628b05012d62db0 ·
CodeRabbit https://app.devin.ai/sessions/53f1cd53286b435490dd9a383fc1004e ·
Qodo https://app.devin.ai/sessions/4d46f56b47a545c28841ed3c2277961c ·
Codex https://app.devin.ai/sessions/66c11b4cb05d44a0afcb192009d00aea
