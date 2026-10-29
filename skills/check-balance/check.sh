#!/usr/bin/env bash
# Balance check for unattended runs, such as a scheduled routine.
# Installs the tools on first use, then prints the JSON decision.
# Exit codes: 0 contribute, 10 skip, 2 unknown or error.
set -u
HOME_DIR="${AGENTS_CONTRIBUTING_HOME:-$HOME/.agents-contributing}"
TOOLS="$HOME_DIR/tools"
REPO_URL="https://github.com/matipojo/agents-contributing"

# Use this checkout if the script runs from inside it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$HERE/src/cli/check-balance.ts" ]] && TOOLS="$HERE"

if [[ ! -f "$TOOLS/src/cli/check-balance.ts" ]]; then
  git clone --quiet --depth 1 "$REPO_URL" "$TOOLS" >&2 || {
    echo '{"verdict":"unknown","reason":"Could not download the agents-contributing tools."}'; exit 2; }
fi
if [[ ! -x "$TOOLS/node_modules/.bin/tsx" ]]; then
  npm --prefix "$TOOLS" install --silent >&2 || {
    echo '{"verdict":"unknown","reason":"Could not install the agents-contributing tools."}'; exit 2; }
fi

exec "$TOOLS/node_modules/.bin/tsx" "$TOOLS/src/cli/check-balance.ts" "$@"
