<!-- stamphog-sticky-review -->
<!-- stamphog-review-count:6 -->
> [!NOTE]
> 🤖 stamphog reviewed `304f116cfbea6fc11dbd42d2130121b8808ecd87` — verdict: **APPROVED**

Routine patch bump of PostHog's own posthog-js SDK (and its transitive @posthog/* deps) across lockfiles and manifests; no scripts/lifecycle hooks touched, CI attested every changed file lifting the dependency deny-list, and the diff is nothing but version/integrity-hash bumps.

<details>
<summary>Gate mechanics and policy version</summary>

| Gate |  | Result |
|---|---|---|
| prerequisites | ✓ | all clear |
| deny-list | ✓ | no hard-deny matches after attestation: deps_toolchain lifted for pnpm-lock.yaml, pnpm-workspace.yaml, products/desktop/packages/ui/package.json, products/desktop/pnpm-lock.yaml, products/desktop/tools/announcements-admin/package.json by Dependency proof |
| attestations | ✓ | CI attested every changed file |
| size | ✓ | 0L, 0F substantive, 196L/5F incl. docs/generated/snapshots — within ceiling |
| tier | ✓ | T1-agent / T1c-medium (196L, 5F, single-area, chore) |
| stamphog 2.0.0b3 |  | `.stamphog/policy.yml` @ `3cb5dbd` · reviewed head `304f116` |

</details>
