#!/bin/bash
# Re-enable workflows disabled in the 2026-09-23 fork CI cleanup.
#   ./restore.sh                       all 355
#   ./restore.sh garnet-labs/posthog   one repo
#   ./restore.sh garnet-labs/roast ci.yaml   one workflow
set -euo pipefail
cd "$(dirname "$0")"
awk -F'\t' -v r="${1:-}" -v f="${2:-}" '(r==""||$1==r)&&(f==""||$3==f)' disabled.tsv |
while IFS=$'\t' read -r repo id file _; do
  gh api -X PUT "repos/$repo/actions/workflows/$id/enable" && echo "enabled $repo $file"
done
