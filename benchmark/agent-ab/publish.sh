#!/usr/bin/env bash
# Publish one prepared pair on the express fork through the canonical harness.
# Usage: benchmark/agent-ab/publish.sh <task-id> <name> <version>
set -euo pipefail
id=$1 name=$2 version=$3
work="$HOME/forks/express-$id"
test -d "$work" || git clone -q https://github.com/garnet-labs/express.git "$work"
title="chore(deps): add $name $version"
exec node bin/replay.mjs live express --prepared "benchmark/agent-ab/prepared/$id.json" --work "$work" \
  --base-branch app-deps --branch "deps/add-${id#npm-}" \
  --first-message "ci: install and import app dependencies" --change-message "$title" --title "$title" \
  --body "Adds \`$name\` $version to \`app\`." --wait-minutes 45 "${@:4}"
