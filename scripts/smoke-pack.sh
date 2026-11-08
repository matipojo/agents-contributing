#!/usr/bin/env bash
# Install the packed tarball in an empty directory. `agents-contributing --version` must
# match package.json. `agents-contributing validate` must accept templates/AGENTS-CONTRIBUTING.md.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# prepack writes dist/ before the tarball. `npm pack --silent` still prints the filename.
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
