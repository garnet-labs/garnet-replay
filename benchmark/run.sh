#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
node benchmark/blocks-from-replays.mjs

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  {
    echo "# Benchmark results"
    echo
    echo "| seed | label | arm | judgment_changed | severity_changed | evidence_grounded_findings |"
    echo "|---|---|---|---|---|---|"
    node -e 'const s=require("./seeds/seeds.json"); for (const seed of s) for (const arm of ["control","treatment"]) console.log(`| ${seed.id} | ${seed.label} | ${arm} | not run | not run | not run |`)'
  } > benchmark/results.md
  echo "wrote benchmark/results.md (dry run; model call not run)"
  exit 0
fi

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required unless DRY_RUN=1}"
prs="$(node -e 'const s=require("./seeds/seeds.json"); console.log(s.filter(x=>x.label==="real").map(x=>x.id.replace(/^real-/,"")).join(","))')"
python3 /home/ubuntu/repos/posthog/products/review_hog/eval/experiments/2026-09-garnet-evidence-injection/harness/run_arms.py \
  --corpus test/fixtures/posthog-corpus.json \
  --blocks benchmark/blocks.json \
  --prs "$prs" \
  --out benchmark/runs
python3 /home/ubuntu/repos/posthog/products/review_hog/eval/experiments/2026-09-garnet-evidence-injection/harness/score.py \
  --runs benchmark/runs \
  --out benchmark/results.md
node benchmark/results-from-runs.mjs
