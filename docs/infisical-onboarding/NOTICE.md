# Vendored sources

The engine, standalone merge gate and policy originate from garnet-labs/posthog
at `aee1db69f6a10196dacd03f15721cf6e4df6b072` (PostHog copyright, MIT).
The license is included in `files/tools/pr-approval-agent/LICENSE`.

The owners resolver and publisher originate from
garnet-labs/garnet-runtime-review-reference at
`d6737ffcbb897ccf18b6f5954e98d5008451c34a` (MIT; original owners resolver
copyright PostHog). A copy of the license accompanies the resolver.
The canonical snapshot has no `tools/owners`, so this dependency uses the
secondary source.

Adaptations: allow deterministic inspection of bot-authored changes; serialize
runtime citations; publish the replay-compatible marker and head/verdict;
add standalone-gate `--dry-run`; use main and backend/frontend installs;
remove the absent Dependency proof attestation;
replace repository-specific steering. No LLM review or approval is enabled.

The five reviewer kit files are copied from the harness's SHA-pinned
`live/templates/reviewers/` source (see its `source.json`). The additional
`.greptile/rules.md` preserves the canonical paragraph because Infisical
already has a `.greptile/` directory. Existing upstream guidance is retained.
