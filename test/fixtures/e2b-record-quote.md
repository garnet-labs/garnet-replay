**Unnecessary outbound call in the new API-types check**

- **Record:** [finalized Garnet Runtime Review comment](https://github.com/garnet-labs/E2B/pull/105#issuecomment-6990149912) for head `97ce81c075d7d2711f3d302868a43cdcd4d7bb1f` (status `finalized`, scope `pr-base`, outcome `Runtime behavior changed`, capture best-effort) · [execution profile](https://app.garnet.ai/public/runs/44387533472?profile=01a1f045-fe8c-716f-a7ee-77262632a755)
- **Job:** `Garnet Runtime Visibility / Dependency install (recorded)` ([run 44387533472, job 135096046440](https://github.com/garnet-labs/E2B/actions/runs/44387533472/job/135096046440))
- **Observed action:** `bash › node › dash › node` now reaches `otel.cloud.redocly[.]com` (new vs the last 10 runs on `main`).
- **Why it is unnecessary:** this comes from the `Check generated JS SDK API types` step this PR adds: `generate:api` runs `redocly bundle`, and Redocly CLI sends usage telemetry to its OpenTelemetry endpoint. Bundling a local spec and comparing `schema.gen.ts` needs no network; the telemetry adds nothing to the generated output or the diff check.
- **Fix (next commit):** set `REDOCLY_TELEMETRY: off` on that step only; the generator and `git diff --exit-code` stay unchanged.

[Written by Devin](https://app.devin.ai/sessions/2df1f9330d9641c4b13d169c8f6fdd28)
