#!/usr/bin/env bash
# Pack the package, install that tarball somewhere empty, and run the two commands
# a fresh install has to survive: --version, and validate on a copy of the template.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# prepack builds dist/ before the tarball is written. --silent still prints the name.
tarball=$(npm pack --silent --pack-destination "$work")
if [[ "$tarball" != /* ]]; then
  tarball="$work/$tarball"
fi

app="$work/app"
mkdir -p "$app"
cp "$root/templates/AGENTS-CONTRIBUTING.md" "$app/AGENTS-CONTRIBUTING.md"
npm install --silent --prefix "$app" "$tarball"

bin="$app/node_modules/.bin/agents-contributing"
got=$("$bin" --version)
want=$(node -p "require('./package.json').version")
if [[ "$got" != "$want" ]]; then
  echo "agents-contributing --version printed ${got@Q}, expected ${want@Q}" >&2
  exit 1
fi

"$bin" validate "$app/AGENTS-CONTRIBUTING.md"
